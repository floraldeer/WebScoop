import {
  isQqMusicLoginPopupUrl,
  parseQqMusicUrl,
  QQ_MUSIC_HOME_URL,
} from '../../electron/qqMusicLogin';

describe('QQ Music login URL security', () => {
  test('uses the QQ Music homepage as the explicit login entry', () => {
    expect(QQ_MUSIC_HOME_URL).toBe('https://y.qq.com/');
    expect(parseQqMusicUrl()).toBe(QQ_MUSIC_HOME_URL);
  });

  test('accepts QQ Music pages as initial window URLs', () => {
    expect(parseQqMusicUrl('https://i.y.qq.com/v8/playsong.html?songid=724394')).toBe(
      'https://i.y.qq.com/v8/playsong.html?songid=724394',
    );
  });

  test.each([
    'https://ssl.ptlogin2.qq.com/',
    'https://graph.qq.com/oauth2.0/show',
    'https://y.qq.com/',
    'https://c6.y.qq.com/',
    'https://open.weixin.qq.com/connect/qrconnect',
  ])('accepts trusted login popup URL %s', (url) => {
    expect(isQqMusicLoginPopupUrl(url)).toBe(true);
  });

  test.each([
    'https://qq.com.evil.example/',
    'https://fakeweixin.qq.com.evil.example/',
    'https://evil.example.com/',
    ['javascript', 'alert(1)'].join(':'),
    'file:///tmp/login.html',
  ])('rejects untrusted login popup URL %s', (url) => {
    expect(isQqMusicLoginPopupUrl(url)).toBe(false);
  });
});
