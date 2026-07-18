import {
  getPlatformFromUrl,
  isVideoRequest,
  buildFullUrl,
  injectScriptToHtml,
  walkFeedMedia,
} from '../../electron/proxy/mediaMatchers';

describe('getPlatformFromUrl', () => {
  test('maps known hostnames to platforms', () => {
    expect(getPlatformFromUrl('v3-web.douyinvod.com')).toBe('抖音');
    expect(getPlatformFromUrl('js.a.kwimgs.gifshow.com')).toBe('快手');
    expect(getPlatformFromUrl('sns-video.xhscdn.com')).toBe('小红书');
    expect(getPlatformFromUrl('upos-sz.bilivideo.com')).toBe('B站');
    expect(getPlatformFromUrl('finder.video.qq.com')).toBe('微信视频号');
    expect(getPlatformFromUrl('f.video.weibocdn.com')).toBe('微博');
  });

  test('returns empty string for unknown hosts', () => {
    expect(getPlatformFromUrl('example.com')).toBe('');
    expect(getPlatformFromUrl('')).toBe('');
  });
});

describe('isVideoRequest', () => {
  test('detects by content type', () => {
    expect(isVideoRequest('https://x.com/a', 'video/mp4')).toBe(true);
  });
  test('detects by extension', () => {
    expect(isVideoRequest('https://x.com/a/b.mp4?t=1', '')).toBe(true);
    expect(isVideoRequest('https://x.com/a/b.webm', 'application/octet-stream')).toBe(true);
  });
  test('detects wechat finder stodownload', () => {
    expect(isVideoRequest('http://finder.video.qq.com/x/stodownload?a=1', '')).toBe(true);
  });
  test('ignores non-video', () => {
    expect(isVideoRequest('https://x.com/a.js', 'text/javascript')).toBe(false);
    expect(isVideoRequest('', 'video/mp4')).toBe(false);
  });
});

describe('buildFullUrl', () => {
  test('prefers req.fullUrl() when a function', () => {
    expect(buildFullUrl({ fullUrl: () => 'https://a.com/x' })).toBe('https://a.com/x');
  });
  test('falls back to protocol/host/path', () => {
    expect(buildFullUrl({ protocol: 'https:', hostname: 'a.com', url: '/p' })).toBe(
      'https://a.com/p',
    );
  });
  test('returns path only when no host', () => {
    expect(buildFullUrl({ url: '/p' })).toBe('/p');
  });
});

describe('injectScriptToHtml', () => {
  test('injects before </body>', () => {
    const out = injectScriptToHtml('<html><body>hi</body></html>');
    expect(out).toMatch(/<script>[\s\S]*<\/script><\/body>/);
  });
  test('appends when no body/html', () => {
    const out = injectScriptToHtml('plain');
    expect(out.startsWith('plain<script>')).toBe(true);
  });
});

describe('walkFeedMedia', () => {
  test('collects media entries with decode_key', () => {
    const json = {
      object: [
        {
          nickname: '作者A',
          object_desc: {
            description: '视频A',
            media: [
              { url: 'https://cdn/x', url_token: '?t=1', decode_key: 'KEY1', file_size: 100 },
            ],
          },
        },
      ],
    };
    const hits = walkFeedMedia(json);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      url: 'https://cdn/x?t=1',
      decode_key: 'KEY1',
      size: 100,
      description: '视频A',
      uploader: '作者A',
    });
  });

  test('skips media without decode_key', () => {
    const json = { media: [{ url: 'https://cdn/x' }] };
    expect(walkFeedMedia(json)).toHaveLength(0);
  });
});
