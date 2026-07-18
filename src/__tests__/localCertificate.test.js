import crypto from 'crypto';
import fs from 'fs';

jest.mock('../../electron/const', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webscoop-cert-test-'));
  return {
    __esModule: true,
    default: {
      CERT_PATH: directory,
      CERT_PRIVATE_PATH: path.join(directory, 'private.pem'),
      CERT_PUBLIC_PATH: path.join(directory, 'public.pem'),
      CERT_IDENTITY_PATH: path.join(directory, 'identity.json'),
      OPEN_SSL_BIN_PATH: 'openssl',
      OPEN_SSL_CNF_PATH: '',
    },
  };
});

import { ensureLocalCertificate } from '../../electron/localCertificate';
import CONFIG from '../../electron/const';

describe('local certificate', () => {
  afterAll(() => {
    fs.rmSync(CONFIG.CERT_PATH, { recursive: true, force: true });
  });

  test('creates a per-device CA with a protected matching private key', async () => {
    const identity = await ensureLocalCertificate();
    const certificate = fs.readFileSync(CONFIG.CERT_PUBLIC_PATH, 'utf8');
    const privateKeyPath = CONFIG.CERT_PRIVATE_PATH;
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    const parsedCertificate = new crypto.X509Certificate(certificate);

    expect(identity.commonName).toContain('WebScoop Local CA');
    expect(parsedCertificate.ca).toBe(true);
    expect(
      parsedCertificate.publicKey
        .export({ type: 'spki', format: 'der' })
        .equals(crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' })),
    ).toBe(true);
    expect(fs.statSync(privateKeyPath).mode & 0o777).toBe(0o600);
  });
});
