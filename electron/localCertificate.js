import crypto from 'crypto';
import fs from 'fs';
import { execFile } from 'child_process';
import CONFIG from './const';

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

function readIdentity() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.CERT_IDENTITY_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function certificateMatchesPrivateKey(certificate, privateKey) {
  try {
    const certPublicKey = new crypto.X509Certificate(certificate).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    const privatePublicKey = crypto
      .createPublicKey(privateKey)
      .export({ type: 'spki', format: 'der' });
    return certPublicKey.equals(privatePublicKey);
  } catch (e) {
    return false;
  }
}

function hasValidLocalCertificate() {
  try {
    const identity = readIdentity();
    const certificate = fs.readFileSync(CONFIG.CERT_PUBLIC_PATH, 'utf8');
    const privateKey = fs.readFileSync(CONFIG.CERT_PRIVATE_PATH, 'utf8');
    const parsedCertificate = new crypto.X509Certificate(certificate);
    return (
      !!identity?.commonName &&
      parsedCertificate.ca &&
      certificateMatchesPrivateKey(certificate, privateKey)
    );
  } catch (e) {
    return false;
  }
}

async function writeAtomic(filePath, content, mode) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, content, { mode });
  await fs.promises.chmod(tempPath, mode);
  await fs.promises.rename(tempPath, filePath);
}

export async function ensureLocalCertificate() {
  if (hasValidLocalCertificate()) return readIdentity();

  await fs.promises.mkdir(CONFIG.CERT_PATH, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(CONFIG.CERT_PATH, 0o700);

  const installationId = crypto.randomUUID().replace(/-/g, '');
  const commonName = `WebScoop Local CA ${installationId.slice(0, 12)}`;
  const tempPrefix = `${CONFIG.CERT_PATH}/generate-${process.pid}-${Date.now()}`;
  const tempKeyPath = `${tempPrefix}.key`;
  const tempCertPath = `${tempPrefix}.crt`;
  const tempConfigPath = `${tempPrefix}.cnf`;
  const config = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
O = WebScoop
CN = ${commonName}

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign,digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`;

  try {
    await fs.promises.writeFile(tempConfigPath, config, { mode: 0o600 });
    try {
      await execFileAsync(process.platform === 'win32' ? CONFIG.OPEN_SSL_BIN_PATH : 'openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-days',
        '3650',
        '-nodes',
        '-keyout',
        tempKeyPath,
        '-out',
        tempCertPath,
        '-config',
        tempConfigPath,
      ]);
    } catch (error) {
      throw new Error(`生成本机 CA 失败：${String(error.stderr || error.message || error)}`);
    }

    const certificate = await fs.promises.readFile(tempCertPath, 'utf8');
    const privateKey = await fs.promises.readFile(tempKeyPath, 'utf8');
    const parsedCertificate = new crypto.X509Certificate(certificate);
    if (!parsedCertificate.ca || !certificateMatchesPrivateKey(certificate, privateKey)) {
      throw new Error('生成的本机 CA 证书无效');
    }

    const identity = {
      installationId,
      commonName,
      fingerprint256: parsedCertificate.fingerprint256,
      createdAt: new Date().toISOString(),
    };
    await writeAtomic(CONFIG.CERT_PRIVATE_PATH, privateKey, 0o600);
    await writeAtomic(CONFIG.CERT_PUBLIC_PATH, certificate, 0o644);
    await writeAtomic(CONFIG.CERT_IDENTITY_PATH, `${JSON.stringify(identity, null, 2)}\n`, 0o600);
    return identity;
  } finally {
    await Promise.all([
      fs.promises.unlink(tempKeyPath).catch(() => {}),
      fs.promises.unlink(tempCertPath).catch(() => {}),
      fs.promises.unlink(tempConfigPath).catch(() => {}),
    ]);
  }
}

export function getLocalCertificateIdentity() {
  return readIdentity();
}
