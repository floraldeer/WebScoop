import {
  getMediaSizeFromHeaders,
  parsePlatformVideo,
} from '../../electron/platformParsers';

describe('platform parser media size', () => {
  test('uses the total length from a range response', () => {
    expect(
      getMediaSizeFromHeaders(
        {
          'content-range': 'bytes 0-1/12345678',
          'content-length': '2',
        },
        206,
      ),
    ).toBe(12345678);
  });

  test('uses content length for a full response', () => {
    expect(
      getMediaSizeFromHeaders({ 'content-length': '7654321' }, 200),
    ).toBe(7654321);
  });

  test('does not treat a partial content length as total size', () => {
    expect(
      getMediaSizeFromHeaders({ 'content-length': '2' }, 206),
    ).toBe(0);
  });

  test('supports object storage size headers', () => {
    expect(
      getMediaSizeFromHeaders({ 'x-oss-object-size': '9988776' }, 206),
    ).toBe(9988776);
  });

  test('keeps WeChat URLs on the capture-only path', async () => {
    await expect(
      parsePlatformVideo('https://weixin.qq.com/sph/protected-path'),
    ).rejects.toThrow('需要页面运行后才能拿到真实媒体地址');
  });
});
