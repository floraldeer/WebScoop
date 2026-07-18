import { isRelaxedTlsHost } from '../../electron/scopedTls';

describe('scoped TLS relaxation', () => {
  test.each([
    'channels.weixin.qq.com',
    'finder-api.weixin.qq.com',
    'finder.video.qq.com',
    'res.wx.qq.com',
    'wx.qpic.cn',
    'badjs.weixinbridge.com',
  ])('allows Tencent host %s', (host) => {
    expect(isRelaxedTlsHost(host)).toBe(true);
  });

  test.each([
    'qq.com.evil.example',
    'fakeweixin.qq.com.evil.example',
    'xiaohongshu.com',
    'kuaishou.com',
    'github.com',
  ])('keeps normal TLS validation for %s', (host) => {
    expect(isRelaxedTlsHost(host)).toBe(false);
  });
});
