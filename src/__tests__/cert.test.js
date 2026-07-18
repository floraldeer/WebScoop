jest.mock('electron-log', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('sudo-prompt', () => ({ __esModule: true, default: { exec: jest.fn() } }));

jest.mock('../../electron/const', () => ({
  __esModule: true,
  default: {
    CERT_PUBLIC_PATH: '/tmp/webscoop/public.pem',
    CERT_PRIVATE_PATH: '/tmp/webscoop/private.pem',
    CERT_IDENTITY_PATH: '/tmp/webscoop/identity.json',
    CERT_PATH: '/tmp/webscoop',
    LEGACY_CERT_COMMON_NAME: 'legacy',
    HOME_PATH: '/tmp/webscoop',
    INSTALL_CERT_FLAG: '/tmp/webscoop/installed.lock',
  },
}));

import { classifyTrustOutcome, CERT_STATUS } from '../../electron/cert';

describe('classifyTrustOutcome', () => {
  test('already trusted maps to trusted', () => {
    expect(classifyTrustOutcome({ trusted: true })).toEqual({ status: CERT_STATUS.TRUSTED });
  });

  test('user cancelling the native auth dialog maps to failed (back to idle, retryable)', () => {
    const result = classifyTrustOutcome({
      trusted: false,
      error: new Error('exit 1'),
      stderr: 'SecTrustSettingsSetTrustSettings: The authorization was cancelled by the user.',
    });
    expect(result.status).toBe(CERT_STATUS.FAILED);
    expect(result.message).toMatch(/取消/);
  });

  test('errAuthorizationCanceled (-60006) also maps to failed', () => {
    expect(classifyTrustOutcome({ trusted: false, stderr: 'error -60006' }).status).toBe(
      CERT_STATUS.FAILED,
    );
  });

  test('authorized but still unverified maps to installed_untrusted (manual/retry guidance)', () => {
    expect(classifyTrustOutcome({ trusted: false, stderr: '' }).status).toBe(
      CERT_STATUS.INSTALLED_UNTRUSTED,
    );
  });

  test('non-cancel failure maps to installed_untrusted rather than dead-ending', () => {
    expect(
      classifyTrustOutcome({ trusted: false, error: new Error('some other security error') })
        .status,
    ).toBe(CERT_STATUS.INSTALLED_UNTRUSTED);
  });
});
