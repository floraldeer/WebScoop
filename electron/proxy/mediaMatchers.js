// 代理拦截用到的纯函数：平台识别、视频请求判定、URL 拼装、HTML 注入、feed 媒体挖掘。
// 抽离自 proxyServer.js，全部无副作用，便于单测。
import { WVDS_INJECT_SCRIPT } from '../inject/wvdsInjectScript';

const PLATFORM_HOST_RULES = [
  { platform: '抖音', keywords: ['douyin', 'iesdouyin', 'bytecdn', 'douyinvod', 'byteimg'] },
  { platform: '快手', keywords: ['kuaishou', 'ksapisrv', 'gifshow', 'ksurl', 'ksyungslb'] },
  { platform: '小红书', keywords: ['xiaohongshu', 'xhscdn', 'xhsslink'] },
  { platform: 'B站', keywords: ['bilibili', 'bilivideo', 'hdslb'] },
  { platform: '微信视频号', keywords: ['weixin', 'qq.com', 'qpic.cn'] },
  { platform: '微博', keywords: ['miaopai', 'weibo', 'sinaimg'] },
  { platform: '优酷', keywords: ['youku', 'tudou', 'cibntv'] },
];

export function getPlatformFromUrl(hostname) {
  const hn = (hostname || '').toLowerCase();
  for (const rule of PLATFORM_HOST_RULES) {
    if (rule.keywords.some((kw) => hn.indexOf(kw) !== -1)) return rule.platform;
  }
  return '';
}

export function isVideoRequest(url, contentType) {
  const ct = String(contentType || '').toLowerCase();
  const u = String(url || '')
    .split('?')[0]
    .toLowerCase();
  if (!u) return false;
  if (ct.indexOf('video/') !== -1) return true;
  if (ct.indexOf('octet-stream') !== -1 && /\.(mp4|webm|mov|m4v|flv|mkv)(\?|$)/.test(u))
    return true;
  if (/\.(mp4|webm|mov|m4v|flv|mkv)(\?|$)/.test(u)) return true;
  // 视频号 CDN 明文 HTTP，无扩展名，走 stodownload
  if (/finder\.video\.qq\.com/i.test(u) && /stodownload/i.test(u)) return true;
  return false;
}

// 拼装完整 URL：hoxy 的 req.fullUrl 是一个方法而不是属性，直接读会拿到函数引用，
// 因此必须用 req.fullUrl() 调用。
export function buildFullUrl(req) {
  try {
    if (typeof req.fullUrl === 'function') return String(req.fullUrl() || '');
  } catch (e) {}
  const proto = req.protocol || 'https:';
  const host = req.hostname || '';
  const path = req.url || '';
  if (!host) return path;
  return proto + '//' + host + path;
}

export function injectScriptToHtml(html) {
  const scriptTag = '<script>' + WVDS_INJECT_SCRIPT + '</script>';
  if (html.indexOf('</body>') !== -1) return html.replace('</body>', scriptTag + '</body>');
  if (html.indexOf('</html>') !== -1) return html.replace('</html>', scriptTag + '</html>');
  return html + scriptTag;
}

// 递归找带 decode_key 的 media 对象；有 decode_key 才是可下载的真视频。
export function walkFeedMedia(root) {
  const hits = [];
  const walk = (node, meta, depth) => {
    if (!node || typeof node !== 'object' || depth > 10) return;
    let localDesc = meta.description;
    let localUploader = meta.uploader;
    if (node.description && typeof node.description === 'string') localDesc = node.description;
    if (node.nickname && typeof node.nickname === 'string') localUploader = node.nickname;
    const mArr = node.media || node.mediaList || null;
    if (mArr && mArr.length) {
      const m = mArr[0];
      const mUrl = m.url || m.Url || '';
      const dk = m.decode_key || m.decodeKey || '';
      if (mUrl && dk) {
        hits.push({
          url: mUrl + (m.url_token || m.urlToken || ''),
          hd_url:
            m.hd_url || m.hdUrl
              ? (m.hd_url || m.hdUrl) + (m.hd_url_token || m.hdUrlToken || '')
              : null,
          decode_key: dk,
          size: m.file_size || m.fileSize || 0,
          description: (localDesc || '微信视频号视频').toString().trim().slice(0, 120),
          uploader: localUploader || '',
        });
      }
    }
    if (Array.isArray(node)) {
      for (const it of node)
        walk(it, { description: localDesc, uploader: localUploader }, depth + 1);
      return;
    }
    for (const k in node) {
      if (node[k] && typeof node[k] === 'object') {
        walk(node[k], { description: localDesc, uploader: localUploader }, depth + 1);
      }
    }
  };
  walk(root, { description: '', uploader: '' }, 0);
  return hits;
}
