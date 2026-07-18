export const platformColors = {
  微信视频号: '#07c160',
  抖音: '#000000',
  快手: '#ff4906',
  小红书: '#fe2c55',
  B站: '#00a1d6',
  YouTube: '#ff0000',
  X: '#111827',
  TikTok: '#25f4ee',
  Instagram: '#c13584',
  Facebook: '#1877f2',
  Vimeo: '#1ab7ea',
  微博: '#e6162d',
};

export const supportedPlatformText =
  '视频号、抖音、小红书、快手、B站、YouTube、X、TikTok、Instagram、Facebook、Vimeo、微博';

// 视频号 / finder 链接判定：这类链接走桌面微信路径，其余平台走浏览器/yt-dlp。
export const WECHAT_URL_REGEX = /(^|\/\/|\.)weixin\.qq\.com|finder\.video\.qq\.com/i;

export const CERT_COMMON_NAME_PREFIX = 'WebScoop Local CA';
