import CONFIG from './const';
import { execFile } from 'child_process';
import sudo from 'sudo-prompt';
import log from 'electron-log';
import { ensureLocalCertificate } from './localCertificate';

// 安装结果统一结构，供 IPC / 前端状态机分流：
//   { status: 'trusted' }                         证书已装且被系统信任，可直接用
//   { status: 'installed_untrusted', commonName } 证书已进钥匙串但未受信，需要用户手动信任
//   { status: 'failed', message }                 安装过程本身失败（如用户取消提权）
export const CERT_STATUS = {
  TRUSTED: 'trusted',
  INSTALLED_UNTRUSTED: 'installed_untrusted',
  FAILED: 'failed',
};

// 双条件都要满足才算装好：
// 1) 证书在系统钥匙串里
// 2) 信任设置 trustRoot（被 macOS 网络栈 / WKWebView / 微信 XWeb 认可）
async function verifyCertTrusted() {
  if (process.platform !== 'darwin') return false;
  await ensureLocalCertificate();
  // 用 security verify-cert 直接问系统："这个证书现在能被信任吗？"
  // -p ssl 表示 SSL 场景（网络请求）；成功=0 就是被信任
  return new Promise((resolve) => {
    execFile(
      'security',
      ['verify-cert', '-c', CONFIG.CERT_PUBLIC_PATH, '-p', 'ssl'],
      (err, stdout, stderr) => {
        const ok = !err;
        log.info(
          '[cert] verify-cert result ok=',
          ok,
          'stdout=',
          (stdout || '').trim().slice(0, 200),
          'stderr=',
          (stderr || '').trim().slice(0, 200),
        );
        resolve(ok);
      },
    );
  });
}

export async function checkCertInstalled() {
  const identity = await ensureLocalCertificate();
  if (process.platform === 'darwin') {
    return await verifyCertTrusted();
  }
  const fs = require('fs');
  try {
    return fs.readFileSync(CONFIG.INSTALL_CERT_FLAG, 'utf8').trim() === identity.installationId;
  } catch (e) {
    return false;
  }
}

// 把 add-trusted-cert 的执行结果映射为统一状态（纯函数，便于单测）：
//   trusted=true                      → trusted
//   用户主动取消/拒绝了授权对话框        → failed（回到空闲，允许再点一键）
//   其余（已授权但没验过 / 非取消类报错） → installed_untrusted（引导手动或重试）
export function classifyTrustOutcome({ trusted, error, stderr = '' }) {
  if (trusted) return { status: CERT_STATUS.TRUSTED };
  const text = `${error ? error.message || error : ''} ${stderr}`;
  // errAuthorizationCanceled = -60006；osascript/security 取消时文案含 cancel。
  if (/cancel|User (canceled|did not grant)|-60006/i.test(text)) {
    return { status: CERT_STATUS.FAILED, message: '已取消授权，未完成证书信任' };
  }
  return { status: CERT_STATUS.INSTALLED_UNTRUSTED };
}

// 直接以本进程（Electron 主进程，处于用户 GUI 会话）的子进程运行 security，写入
// 「用户域（login 钥匙串）」的 SSL 信任。macOS（尤其 15 Sequoia）设置根证书信任必须
// 有一次交互式授权，系统会自动弹出原生授权框——这一点只有在标准 GUI 会话里才成立。
// 旧实现用 sudo-prompt（osascript 提权）执行 security，属于非交互 root 上下文，
// SecTrustSettingsSetTrustSettings 会以「no user interaction possible」被拒，导致
// 证书进了钥匙串却没设上信任（CSSMERR_TP_NOT_TRUSTED）。用户域信任无需 root，且同样被
// SecTrust 认可：security verify-cert、Chromium / 微信 XWeb 都读取 login+System 钥匙串
// 里「始终信任」的设置。
function execSecurity(args) {
  return new Promise((resolve) => {
    execFile('security', args, (error, stdout, stderr) =>
      resolve({ error, stdout: stdout || '', stderr: stderr || '' }),
    );
  });
}

function addTrustedCertDarwin() {
  return execSecurity([
    'add-trusted-cert',
    '-r',
    'trustRoot',
    '-p',
    'ssl',
    CONFIG.CERT_PUBLIC_PATH,
  ]);
}

// login 钥匙串里若已有同名证书但未受信，再次 add-trusted-cert 常因「证书已存在」失败，
// 信任设置也就写不进去。先从默认（login）钥匙串删掉未信任副本，再走交互式写入。
// 不动 System.keychain（需要 root）；用户域信任本身足够让 verify-cert / 浏览器通过。
async function removeUntrustedLoginCopy(commonName) {
  const result = await execSecurity(['delete-certificate', '-c', commonName]);
  if (result.error) {
    log.info(
      '[cert] delete login copy skipped:',
      String(result.stderr || result.error.message || '').slice(0, 160),
    );
  } else {
    log.info('[cert] removed existing login-keychain copy before re-trust');
  }
}

async function installCertDarwin(identity) {
  log.info('[cert] setting user-domain trust via security add-trusted-cert (interactive)');
  await removeUntrustedLoginCopy(identity.commonName);
  const { error, stderr } = await addTrustedCertDarwin();
  const trusted = await verifyCertTrusted();
  log.info(
    '[cert] add-trusted-cert done trusted=',
    trusted,
    'err=',
    error ? String(error.message || error) : 'none',
    'stderr=',
    stderr.trim().slice(0, 200),
  );
  const outcome = classifyTrustOutcome({ trusted, error, stderr });
  if (outcome.status === CERT_STATUS.INSTALLED_UNTRUSTED) {
    outcome.commonName = identity.commonName;
  }
  return outcome;
}

function installCertWindows(identity) {
  const fs = require('fs');
  return new Promise((resolve) => {
    const command =
      `certutil -delstore Root "${CONFIG.LEGACY_CERT_COMMON_NAME}" >NUL 2>&1 ` +
      `& certutil -delstore Root "${identity.commonName}" >NUL 2>&1 ` +
      `& certutil -addstore -f Root "${CONFIG.CERT_PUBLIC_PATH}"`;
    sudo.exec(command, { name: 'WebScoop' }, (error, _stdout, stderr) => {
      if (error) {
        log.error('[cert] Windows CA migration failed:', String(stderr || error));
        const message = /User (canceled|did not grant)/i.test(String(error))
          ? '已取消授权，未安装证书'
          : '本机 CA 安装失败';
        resolve({ status: CERT_STATUS.FAILED, message });
        return;
      }
      fs.mkdirSync(CONFIG.HOME_PATH, { recursive: true });
      fs.writeFileSync(CONFIG.INSTALL_CERT_FLAG, identity.installationId);
      resolve({ status: CERT_STATUS.TRUSTED });
    });
  });
}

export async function installCert(checkInstalled = true) {
  const identity = await ensureLocalCertificate();
  if (checkInstalled && (await checkCertInstalled())) {
    return { status: CERT_STATUS.TRUSTED };
  }

  if (process.platform === 'darwin') {
    return installCertDarwin(identity);
  }
  return installCertWindows(identity);
}
