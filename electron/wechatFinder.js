import axios from 'axios';
import log from 'electron-log';
import https from 'https';

// 视频号短链元信息兜底解析器 + 播放页 URL 转换器：
//
// 1) 短链 /finder-preview/pages/sph?id=Xxxx —— 匿名或已登录 web 端都只是二维码引导页，永远不会渲染播放器。
// 2) API get_feed_info 匿名调用返回 authorInfo + feedInfo（description/coverUrl），不含 videoUrl，但会返
//    `sceneInfo.dynamicExportId`（以 export/ 开头）。
// 3) 拿到 dynamicExportId 后拼装成 https://channels.weixin.qq.com/web/pages/feed?exportId=xxx，
//    再用 Windows 微信 UA 打开、就是电脑客户端真正的播放页。登录态下页面会主动请求 finder.video.qq.com CDN，
//    hoxy 就能拦到真视频流字节；如果登录接口本身也能返 videoUrl，我们也顺手采下来。

const WX_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/20G75 MicroMessenger/8.0.42(0x18002a2f) NetType/WIFI ' +
  'Language/zh_CN';

// 桌面版微信客户端 UA：/web/pages/feed 页面靠这个尾巴判定是"真微信内嵌浏览器"，
// 缺 MicroMessenger/XWEB 后缀会被判为普通 Chrome，跳回扫码引导页。
const DESKTOP_WX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ' +
  'MicroMessenger/7.0.1 WindowsWechat(0x63090c33) XWEB/13947';

// 微信/腾讯自签中间证书链在 Node 默认 CA 里会报错，主进程直接调 API 时需要放行
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function extractShortUri(url) {
  const s = String(url || '');
  const m1 = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]shortUri=([A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  const m3 = s.match(/\/sph\/([A-Za-z0-9_-]+)/);
  if (m3) return m3[1];
  const m4 = s.match(/weixin\.qq\.com\/([A-Za-z0-9_-]{6,})(?:[?/]|$)/);
  if (m4) return m4[1];
  return '';
}

function extractExportId(url) {
  const m = String(url || '').match(/[?&](?:exportId|eid)=([A-Za-z0-9_/=+-]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// 通用 API 调用：可选传 cookieHeader（登录态），否则匿名。
async function callFeedInfoApi(inputUrl, cookieHeader = '') {
  const shortUri = extractShortUri(inputUrl);
  const exportId = extractExportId(inputUrl);
  if (!shortUri && !exportId) {
    throw new Error('未识别到视频号 shortUri / exportId');
  }

  const rid = `webscoop-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const referer = shortUri
    ? `https://channels.weixin.qq.com/finder-preview/pages/sph?id=${shortUri}`
    : `https://channels.weixin.qq.com/web/pages/feed?exportId=${encodeURIComponent(exportId)}`;

  const apiUrl =
    `https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info` +
    `?_rid=${rid}&_pageUrl=${encodeURIComponent(referer)}`;

  const payload = shortUri
    ? { baseReq: { generalToken: '' }, shortUri }
    : { baseReq: { generalToken: '' }, exportId };

  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN',
    'Content-Type': 'application/json',
    Origin: 'https://channels.weixin.qq.com',
    Referer: referer,
    'User-Agent': cookieHeader ? DESKTOP_WX_UA : WX_UA,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;

  log.info('[wxapi] fetch shortUri=' + shortUri + ' exportId=' + (exportId || '-') + ' logged=' + !!cookieHeader);

  const resp = await axios.post(apiUrl, payload, {
    httpsAgent,
    timeout: 15000,
    validateStatus: () => true,
    headers,
  });
  return { body: resp.data || {}, referer, shortUri, exportId };
}

function walkFindVideoUrl(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  for (const k in node) {
    const v = node[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
      const isPic = /picformat=|wxampicformat=/i.test(v);
      const isMedia = /\.mp4(\?|$)/i.test(v) || (/finder\.video\.qq\.com\/.*stodownload/i.test(v) && !isPic);
      if (isMedia && !/(coverUrl|thumbUrl|headImgUrl|avatarUrl)/i.test(k)) out.push(v);
    }
    if (v && typeof v === 'object') walkFindVideoUrl(v, out, depth + 1);
  }
}

// 主进程 IPC 入口：解析视频号短链拿元信息 + 可能的视频 URL，供 UI 直接展示。
export async function parseWechatShortLink(inputUrl) {
  const { body, referer, shortUri, exportId } = await callFeedInfoApi(inputUrl);
  log.info('[wxapi] resp errCode=' + body.errCode, 'keys=' + JSON.stringify(Object.keys(body.data || {})));
  if (body.errCode && body.errCode !== 0) {
    throw new Error(`视频号接口返回错误：${body.errMsg || body.errCode}`);
  }
  const data = body.data || {};
  const feed = data.feedInfo || {};
  const author = data.authorInfo || {};
  const scene = data.sceneInfo || {};

  const found = [];
  walkFindVideoUrl(data, found);
  const videoUrl = found[0] || '';
  const description = (feed.description || '视频号视频').trim().slice(0, 120) || '视频号视频';

  return {
    videoUrl,
    coverUrl: feed.coverUrl || '',
    description,
    uploader: author.nickname || author.nickName || '',
    createTime: feed.createtime || 0,
    hasVideo: !!videoUrl,
    referer,
    shortUri,
    dynamicExportId: scene.dynamicExportId || exportId || '',
    rawKeys: Object.keys(feed),
  };
}

// wechatBrowser 用：把用户粘贴的短链 / /sph/ / 已在 /web/pages/feed 的 URL，
// 都转成能真正播放的 /web/pages/feed?exportId=xxx。找不到 exportId 时保底回退原始 URL。
// cookieHeader 可选：传入登录态 cookies 后 API 有机会返回真视频 URL，同步一并返回。
export async function resolveWechatPlayableUrl(inputUrl, { cookieHeader = '' } = {}) {
  // 已经是 /web/pages/feed 的直接放行
  if (/channels\.weixin\.qq\.com\/web\/pages\/feed/i.test(String(inputUrl || ''))) {
    return { playableUrl: inputUrl, dynamicExportId: extractExportId(inputUrl) };
  }
  try {
    const { body } = await callFeedInfoApi(inputUrl, cookieHeader);
    const data = body && body.data || {};
    const scene = data.sceneInfo || {};
    const dynamicExportId = scene.dynamicExportId || '';
    if (dynamicExportId) {
      const playableUrl =
        'https://channels.weixin.qq.com/web/pages/feed?exportId=' + encodeURIComponent(dynamicExportId);
      const found = [];
      walkFindVideoUrl(data, found);
      return { playableUrl, dynamicExportId, videoUrl: found[0] || '' };
    }
  } catch (err) {
    log.warn('[wxapi] resolveWechatPlayableUrl failed:', String(err && err.message || err));
  }
  return { playableUrl: inputUrl, dynamicExportId: '' };
}
