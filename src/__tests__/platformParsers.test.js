import {
  getMediaSizeFromHeaders,
  parseKuaishouInitialState,
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
    expect(getMediaSizeFromHeaders({ 'content-length': '7654321' }, 200)).toBe(7654321);
  });

  test('does not treat a partial content length as total size', () => {
    expect(getMediaSizeFromHeaders({ 'content-length': '2' }, 206)).toBe(0);
  });

  test('supports object storage size headers', () => {
    expect(getMediaSizeFromHeaders({ 'x-oss-object-size': '9988776' }, 206)).toBe(9988776);
  });

  test('keeps WeChat URLs on the capture-only path', async () => {
    await expect(parsePlatformVideo('https://weixin.qq.com/sph/protected-path')).rejects.toThrow(
      '需要页面运行后才能拿到真实媒体地址',
    );
  });

  test('reads the matching Kuaishou representation size from INIT_STATE', () => {
    const html = `<script>window.INIT_STATE = ${JSON.stringify({
      cache: {
        photo: {
          caption: '测试视频',
          userName: '测试作者',
          share_info: 'photoId=abc123',
          mainMvUrls: [{ url: 'https://mov.example.com/path/video.mp4?token=main' }],
          manifest: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://cdn.example.com/path/video.mp4?token=cdn',
                    fileSize: 5922303,
                  },
                  {
                    url: 'https://cdn.example.com/path/video-h265.mp4',
                    fileSize: 3358847,
                  },
                ],
              },
            ],
          },
        },
      },
    })}</script>`;

    expect(parseKuaishouInitialState(html, 'https://m.gifshow.com/fw/photo/abc123')).toEqual({
      videoUrl: 'https://mov.example.com/path/video.mp4?token=main',
      title: '测试视频',
      size: 5922303,
      uploader: '测试作者',
    });
  });
});
