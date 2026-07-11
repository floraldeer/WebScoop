import CONFIG from './const';
import { execFile } from 'child_process';
import sudo from 'sudo-prompt';
import spawn from 'cross-spawn';
import log from 'electron-log';

// hoxy 自签根证书 CN，钥匙串里靠这个名字定位
const CERT_COMMON_NAME = 'lecepin-2022-05-19';

// 双条件都要满足才算装好：
// 1) 证书在系统钥匙串里
// 2) 信任设置 trustRoot（被 macOS 网络栈 / WKWebView / 微信 XWeb 认可）
async function verifyCertTrusted() {
  if (process.platform !== 'darwin') return false;
  // 用 security verify-cert 直接问系统："这个证书现在能被信任吗？"
  // -p ssl 表示 SSL 场景（网络请求）；成功=0 就是被信任
  return new Promise((resolve) => {
    execFile(
      'security',
      ['verify-cert', '-c', CONFIG.CERT_PUBLIC_PATH, '-p', 'ssl'],
      (err, stdout, stderr) => {
        const ok = !err;
        log.info('[cert] verify-cert result ok=', ok, 'stdout=', (stdout || '').trim().slice(0, 200), 'stderr=', (stderr || '').trim().slice(0, 200));
        resolve(ok);
      },
    );
  });
}

export async function checkCertInstalled() {
  if (process.platform === 'darwin') {
    return await verifyCertTrusted();
  }
  const fs = require('fs');
  return fs.existsSync(CONFIG.INSTALL_CERT_FLAG);
}

export async function installCert(checkInstalled = true) {
  if (checkInstalled && (await checkCertInstalled())) {
    return;
  }

  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      // 先尝试删除同名旧证书（存在但未信任的情况），再重新装并信任
      const delCmd = `security delete-certificate -c "${CERT_COMMON_NAME}" /Library/Keychains/System.keychain 2>/dev/null; true`;
      const addCmd = `security add-trusted-cert -d -r trustRoot -p ssl -k /Library/Keychains/System.keychain "${CONFIG.CERT_PUBLIC_PATH}"`;
      const full = `${delCmd}; ${addCmd}`;
      log.info('[cert] installing via sudo-prompt', full);
      sudo.exec(full, { name: 'WebScoop' }, async (error, _stdout, stderr) => {
        if (error) {
          log.error('[cert] sudo failed:', String(error), 'stderr=', String(stderr || ''));
          return reject(new Error(String(error)));
        }
        const ok = await verifyCertTrusted();
        log.info('[cert] verify after install trusted=', ok);
        if (!ok) {
          return reject(new Error('证书已安装但系统未信任。请打开"钥匙串访问"，找到 lecepin-2022-05-19，双击并把"使用此证书时"设为"始终信任"'));
        }
        resolve();
      });
    });
  }

  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const result = spawn.sync(CONFIG.WIN_CERT_INSTALL_HELPER, [
      '-c',
      '-add',
      CONFIG.CERT_PUBLIC_PATH,
      '-s',
      'root',
    ]);

    if (result.stdout && result.stdout.toString().indexOf('Succeeded') > -1) {
      fs.writeFileSync(CONFIG.INSTALL_CERT_FLAG, '');
      resolve();
    } else {
      reject();
    }
  });
}
