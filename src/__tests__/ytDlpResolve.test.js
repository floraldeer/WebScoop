import { resolveYtDlpBinaryPath } from '../../electron/platformParsers';

describe('resolveYtDlpBinaryPath', () => {
  test('returns the first candidate the probe accepts', () => {
    const probe = (p) => p === '/usr/local/bin/yt-dlp';
    const resolved = resolveYtDlpBinaryPath(
      ['/nope/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'],
      probe,
    );
    expect(resolved).toBe('/usr/local/bin/yt-dlp');
  });

  test('ignores falsy candidates', () => {
    const probe = (p) => p === '/opt/homebrew/bin/yt-dlp';
    const resolved = resolveYtDlpBinaryPath(
      [null, undefined, '', '/opt/homebrew/bin/yt-dlp'],
      probe,
    );
    expect(resolved).toBe('/opt/homebrew/bin/yt-dlp');
  });

  test('returns null when nothing is available', () => {
    expect(resolveYtDlpBinaryPath(['/a', '/b'], () => false)).toBeNull();
  });
});
