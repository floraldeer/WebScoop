export const QQ_MUSIC_HOME_URL = 'https://y.qq.com/';

const QQ_MUSIC_HOSTS = ['y.qq.com', 'qqmusic.qq.com'];
const QQ_MUSIC_LOGIN_HOSTS = ['qq.com', 'qqmusic.qq.com', 'weixin.qq.com'];

function matchesHostname(hostname, allowedHosts) {
  const normalized = String(hostname || '').toLowerCase();
  return allowedHosts.some(
    (allowedHost) => normalized === allowedHost || normalized.endsWith(`.${allowedHost}`),
  );
}

export function parseQqMusicUrl(inputUrl = QQ_MUSIC_HOME_URL) {
  const url = new URL(String(inputUrl || QQ_MUSIC_HOME_URL));
  if (url.protocol !== 'https:' || !matchesHostname(url.hostname, QQ_MUSIC_HOSTS)) {
    throw new Error('只允许打开 QQ 音乐 HTTPS 链接');
  }
  return url.toString();
}

export function isQqMusicLoginPopupUrl(inputUrl) {
  try {
    const url = new URL(String(inputUrl || ''));
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      matchesHostname(url.hostname, QQ_MUSIC_LOGIN_HOSTS)
    );
  } catch (error) {
    return false;
  }
}
