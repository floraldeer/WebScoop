import axios from "axios";
import { execFileSync } from "child_process";
import path from "path";
import { app, session } from "electron";
import youtubedl from "youtube-dl-exec";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

export const PLATFORM_CONFIGS = [
  {
    platform: "小红书",
    hosts: ["xiaohongshu.com", "xhslink.com", "xhscdn.com", "xhsslink.com"],
    parser: "page",
  },
  {
    platform: "抖音",
    hosts: [
      "douyin.com",
      "iesdouyin.com",
      "douyinvod.com",
      "bytecdn.cn",
      "byteimg.com",
    ],
    parser: "ytdlp",
  },
  {
    platform: "快手",
    hosts: [
      "kuaishou.com",
      "gifshow.com",
      "ksapisrv.com",
      "ksurl.cn",
      "chenzhongtech.com",
    ],
    parser: "page",
  },
  {
    platform: "微信视频号",
    hosts: [
      "weixin.qq.com",
      "channels.weixin.qq.com",
      "finder.video.qq.com",
      "qpic.cn",
    ],
    parser: "capture",
  },
  {
    platform: "B站",
    hosts: ["bilibili.com", "b23.tv", "bilivideo.com", "hdslb.com"],
    parser: "bili",
  },
  {
    platform: "YouTube",
    hosts: ["youtube.com", "youtu.be", "googlevideo.com"],
    parser: "ytdlp",
  },
  {
    platform: "X",
    hosts: ["x.com", "twitter.com", "twimg.com"],
    parser: "ytdlp",
  },
  {
    platform: "TikTok",
    hosts: ["tiktok.com", "tiktokcdn.com"],
    parser: "ytdlp",
  },
  {
    platform: "Instagram",
    hosts: ["instagram.com", "cdninstagram.com"],
    parser: "ytdlp",
  },
  {
    platform: "Facebook",
    hosts: ["facebook.com", "fb.watch", "fbcdn.net"],
    parser: "ytdlp",
  },
  {
    platform: "Vimeo",
    hosts: ["vimeo.com", "vimeocdn.com"],
    parser: "ytdlp",
  },
  {
    platform: "微博",
    hosts: ["weibo.com", "weibo.cn", "sinaimg.cn"],
    parser: "ytdlp",
  },
];

function extractFirstUrl(input = "") {
  const match = String(input).match(/https?:\/\/[^\s"'<>，。]+/i);
  if (match) return match[0];
  const text = String(input).trim();
  if (/^[\w.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return text;
}

function ensureHttpUrl(inputUrl) {
  const url = extractFirstUrl(inputUrl);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("请输入有效的视频分享链接");
  }
  return url;
}

function detectPlatform(url) {
  const { hostname } = new URL(url);
  const host = hostname.toLowerCase();
  const config = PLATFORM_CONFIGS.find((item) =>
    item.hosts.some((domain) => host.includes(domain))
  );
  if (!config) {
    throw new Error(
      `暂不支持该平台链接，请粘贴 ${getSupportedPlatformNames()} 分享链接`
    );
  }
  return config;
}

export function getPlatformFromHostname(hostname = "") {
  const host = String(hostname).toLowerCase();
  const config = PLATFORM_CONFIGS.find((item) =>
    item.hosts.some((domain) => host.includes(domain))
  );
  return config?.platform || "";
}

function getSupportedPlatformNames() {
  return PLATFORM_CONFIGS.map((item) => item.platform).join("、");
}

function normalizeUrl(url, baseUrl) {
  if (!url) return "";
  let value = String(url)
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
  if (value.startsWith("//")) value = `https:${value}`;
  if (value.startsWith("/")) value = new URL(value, baseUrl).toString();
  return value;
}

function decodeHtmlText(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/");
}

function collectVideoCandidates(html, baseUrl) {
  const decoded = decodeHtmlText(html);
  const candidates = [];
  const patterns = [
    /https?:\/\/[^"'\\\s<>]+?(?:\.mp4|\.m4v|\.mov|video_id|playwm|play|tos-[^"'\\\s<>]+|bilivideo|googlevideo)[^"'\\\s<>]*/gi,
    /"(?:masterUrl|backupUrl|backup_url|mainUrl|baseUrl|base_url|url|playAddr|downloadAddr|srcNoMark|photoUrl|videoUrl)"\s*:\s*"([^"]+)"/gi,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(decoded))) {
      const raw = match[1] || match[0];
      const url = normalizeUrl(raw, baseUrl);
      if (
        /^https?:\/\//i.test(url) &&
        !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)
      ) {
        candidates.push(url);
      }
    }
  });

  return [...new Set(candidates)].sort(
    (a, b) => scoreVideoUrl(b) - scoreVideoUrl(a)
  );
}

function scoreVideoUrl(url) {
  let score = 0;
  if (/\.mp4(\?|$)/i.test(url)) score += 10;
  if (/watermark|playwm|logo|wm_/i.test(url)) score -= 20;
  if (
    /douyinvod|bytecdn|xhscdn|sns-video|kuaishou|gifshow|ksapisrv|videocdn|bilivideo|googlevideo/i.test(
      url
    )
  )
    score += 4;
  if (
    /h264|hevc|main|master|origin|backup|no.?watermark|nowatermark|play_addr/i.test(
      url
    )
  )
    score += 3;
  if (/sns-video/i.test(url)) score += 5;
  return score;
}

function isLikelyVideoUrl(url) {
  return (
    /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url) ||
    /douyinvod|bytecdn|xhscdn|sns-video|kuaishou|gifshow|ksapisrv|videocdn|bilivideo|googlevideo|tos-/i.test(
      url
    )
  );
}

export function getMediaSizeFromHeaders(headers = {}, status = 0) {
  const contentRange = String(headers["content-range"] || "");
  const rangeTotal = Number.parseInt(contentRange.match(/\/(\d+)\s*$/)?.[1] || "0", 10);
  if (Number.isSafeInteger(rangeTotal) && rangeTotal > 0) return rangeTotal;

  const explicitTotal = Number.parseInt(
    headers["x-file-size"] ||
      headers["x-content-length"] ||
      headers["x-oss-object-size"] ||
      "0",
    10
  );
  if (Number.isSafeInteger(explicitTotal) && explicitTotal > 0) {
    return explicitTotal;
  }

  const contentLength = Number.parseInt(headers["content-length"] || "0", 10);
  return status !== 206 &&
    Number.isSafeInteger(contentLength) &&
    contentLength > 0
    ? contentLength
    : 0;
}

async function inspectVideoUrl(url, referer) {
  if (!isLikelyVideoUrl(url)) return { valid: false, size: 0 };
  const headers = {
    ...DEFAULT_HEADERS,
    Referer: referer,
    Range: "bytes=0-1",
  };
  try {
    const response = await axios.get(url, {
      maxRedirects: 5,
      timeout: 15000,
      responseType: "stream",
      headers,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    response.data?.destroy?.();
    const contentType = response.headers?.["content-type"] || "";
    const resolvedUrl = response.request?.res?.responseUrl || url;
    return {
      valid:
        contentType.includes("video/") ||
        /\.(mp4|mov|m4v|webm)(\?|$)/i.test(resolvedUrl),
      size: getMediaSizeFromHeaders(response.headers, response.status),
    };
  } catch (e) {
    return { valid: false, size: 0 };
  }
}

async function validateVideoUrl(url, referer) {
  return (await inspectVideoUrl(url, referer)).valid;
}

async function selectPlayableCandidate(candidates, referer) {
  for (const url of candidates
    .filter((url) => !/watermark|playwm|logo|wm_/i.test(url))
    .slice(0, 12)) {
    if (await validateVideoUrl(url, referer)) {
      return url;
    }
  }
  return candidates.find(isLikelyVideoUrl) || "";
}

function extractTitle(html, platform) {
  const decoded = decodeHtmlText(html);
  const titleMatch = decoded.match(/<title[^>]*>([^<]+)<\/title>/i);
  const ogTitleMatch = decoded.match(
    /property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  const descMatch = decoded.match(
    /property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  );
  const jsonTitle =
    decoded.match(/"title"\s*:\s*"([^"\\]{2,120})"/i)?.[1] ||
    decoded.match(/"desc"\s*:\s*"([^"\\]{2,120})"/i)?.[1] ||
    decoded.match(/"caption"\s*:\s*"([^"\\]{2,120})"/i)?.[1];
  const rawTitle =
    ogTitleMatch?.[1] ||
    jsonTitle ||
    descMatch?.[1] ||
    titleMatch?.[1] ||
    `${platform}视频`;
  return (
    rawTitle
      .replace(/ - 小红书$/, "")
      .replace(/ - 抖音$/, "")
      .replace(/ - 快手$/, "")
      .replace(/_哔哩哔哩_bilibili$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || `${platform}视频`
  );
}

function extractAuthor(html) {
  const decoded = decodeHtmlText(html);
  const authorMatch =
    decoded.match(/"nickname"\s*:\s*"([^"]+)"/i) ||
    decoded.match(/"authorName"\s*:\s*"([^"]+)"/i) ||
    decoded.match(/"name"\s*:\s*"([^"]+)"/i);
  return authorMatch?.[1] || "";
}

// 小红书专用：从 __INITIAL_STATE__/__INITIAL_SSR_STATE__ 中优先挖 h264[].masterUrl（无水印）；
// 若失败退到 stream.h264/backupUrl；再退回带 sns-video 的原始 mp4。
// 顺便把作者名字从描述里剥掉（用户要求）。
function parseXiaohongshu(html, resolvedUrl) {
  const decoded = decodeHtmlText(html);
  const state =
    decoded.match(/window\.__INITIAL_SSR_STATE__\s*=\s*({[\s\S]+?});?\s*<\/script>/)?.[1] ||
    decoded.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});?\s*<\/script>/)?.[1];

  const videoUrls = [];
  const collectVideoUrl = (u) => {
    if (!u) return;
    const url = normalizeUrl(String(u), resolvedUrl);
    if (!/^https?:/.test(url)) return;
    // 去掉带水印路径
    if (/watermark|playwm|logo|wm_/i.test(url)) return;
    videoUrls.push(url);
  };

  if (state) {
    // masterUrl 优先，其次 backupUrls，最后 originVideoKey 拼接
    const masterUrls = state.match(/"masterUrl"\s*:\s*"([^"]+)"/g) || [];
    masterUrls.forEach((m) => {
      const url = m.match(/"masterUrl"\s*:\s*"([^"]+)"/)?.[1];
      collectVideoUrl(url);
    });
    const backupUrls = state.match(/"backupUrls"\s*:\s*\[([^\]]+)\]/g) || [];
    backupUrls.forEach((m) => {
      (m.match(/"([^"]+)"/g) || []).forEach((u) => collectVideoUrl(u.replace(/"/g, "")));
    });
  }

  // 兜底：从整个 HTML 里找 sns-video/xhscdn 的 mp4
  const snsPattern = /https?:\/\/[^"'\s]+?(?:sns-video[^"'\s]*|xhscdn[^"'\s]*)\.mp4[^"'\s]*/gi;
  let m;
  while ((m = snsPattern.exec(decoded))) {
    collectVideoUrl(m[0]);
  }

  // 标题：note.title/note.desc（无水印时的原始标题）
  const rawTitle =
    decoded.match(/"title"\s*:\s*"([^"\\]{1,200})"/)?.[1] ||
    decoded.match(/"desc"\s*:\s*"([^"\\]{1,200})"/)?.[1] ||
    decoded.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    decoded.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
    "小红书视频";

  // 清洗：去 @作者、# 号标签保留，去多余空白，去尾部 "- 小红书"
  const title = rawTitle
    .replace(/@[\S]+?\s?/g, "")
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/[-—]\s?小红书$/i, "")
    .trim()
    .slice(0, 80) || "小红书视频";

  return {
    videoUrl: [...new Set(videoUrls)][0] || "",
    title,
  };
}

// 快手专用：从 __APOLLO_STATE__ / window.__INITIAL_STATE__ 挖 photo.caption + mainMvUrls[0].url
function parseKuaishou(html, resolvedUrl) {
  const decoded = decodeHtmlText(html);

  const collectMp4 = () => {
    const urls = [];
    const patterns = [
      /"mainMvUrls"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i,
      /"photoUrl"\s*:\s*"([^"]+)"/i,
      /"srcNoMark"\s*:\s*"([^"]+)"/i,
    ];
    patterns.forEach((p) => {
      const match = decoded.match(p);
      if (match?.[1]) urls.push(normalizeUrl(match[1], resolvedUrl));
    });
    // 兜底：直接扫 gifshow/chenzhongtech CDN mp4
    const cdnPattern = /https?:\/\/[^"'\s]+?(?:gifshow|kuaishou|chenzhongtech|ksurl\.cn)[^"'\s]*\.mp4[^"'\s]*/gi;
    let m;
    while ((m = cdnPattern.exec(decoded))) urls.push(m[0]);
    return urls.filter((u) => /^https?:/.test(u));
  };

  const rawTitle =
    decoded.match(/"caption"\s*:\s*"([^"\\]{1,200})"/)?.[1] ||
    decoded.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    decoded.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
    "快手视频";

  const title = rawTitle
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/[-—]\s?快手$/i, "")
    .trim()
    .slice(0, 80) || "快手视频";

  return {
    videoUrl: [...new Set(collectMp4())][0] || "",
    title,
  };
}

async function getCookieHeader(url) {
  try {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  } catch (e) {
    return "";
  }
}

// B站解析：走官方 API
// 1) 从 URL 提取 bvid（BVxxxx）或 aid（av123）
// 2) 调 api.bilibili.com/x/web-interface/view?bvid=xxx 拿 cid 和 title
// 3) 调 api.bilibili.com/x/player/playurl?bvid=xxx&cid=xxx&fnval=1（durl 直链）
//    或 fnval=16（DASH，需 SESSDATA 才有 1080p+）
// Referer 必须是 https://www.bilibili.com/，Cookie 用浏览器 session 的
async function parseBilibili(inputUrl) {
  const url = ensureHttpUrl(inputUrl);
  // b23.tv 短链先跟随重定向
  let pageUrl = url;
  if (/b23\.tv/i.test(pageUrl)) {
    try {
      const resp = await axios.get(pageUrl, {
        maxRedirects: 10,
        validateStatus: (s) => s >= 200 && s < 400,
        headers: DEFAULT_HEADERS,
      });
      pageUrl = resp.request?.res?.responseUrl || pageUrl;
    } catch (e) {}
  }

  const bvidMatch = pageUrl.match(/\/(BV[0-9A-Za-z]+)/);
  const aidMatch = pageUrl.match(/\/av(\d+)/i);
  if (!bvidMatch && !aidMatch) {
    throw new Error("未识别到 B站 BV/AV 号，请确认链接");
  }

  const cookie = await getCookieHeader("https://www.bilibili.com/");
  const apiHeaders = {
    ...DEFAULT_HEADERS,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
    ...(cookie ? { Cookie: cookie } : {}),
  };

  const viewParams = bvidMatch ? `bvid=${bvidMatch[1]}` : `aid=${aidMatch[1]}`;
  const viewResp = await axios.get(
    `https://api.bilibili.com/x/web-interface/view?${viewParams}`,
    { headers: apiHeaders, timeout: 15000, validateStatus: () => true }
  );
  if (viewResp.data?.code !== 0) {
    throw new Error(
      `B站视频信息获取失败：${viewResp.data?.message || "接口返回异常"}。可能需要登录，请点击【浏览器打开】在系统浏览器里登录 bilibili.com 后重试。`
    );
  }
  const info = viewResp.data.data;
  const bvid = info.bvid;
  const cid = info.cid;
  const title = (info.title || "B站视频").slice(0, 80);
  const uploader = info.owner?.name || "";

  // 先尝试 fnval=1（durl，返回直接可播的 flv/mp4 分段）
  const playParams = `bvid=${bvid}&cid=${cid}&qn=80&fnval=1&fnver=0&fourk=1`;
  const playResp = await axios.get(
    `https://api.bilibili.com/x/player/playurl?${playParams}`,
    { headers: apiHeaders, timeout: 15000, validateStatus: () => true }
  );
  if (playResp.data?.code !== 0) {
    throw new Error(
      `B站视频地址获取失败：${playResp.data?.message || "playurl 返回异常"}。请点击【浏览器打开】在系统浏览器里登录 bilibili.com（Chrome/Safari）后重试。`
    );
  }
  const playData = playResp.data.data;
  let videoUrl = "";
  let filesize = 0;
  if (Array.isArray(playData.durl) && playData.durl.length) {
    videoUrl = playData.durl[0].url || playData.durl[0].backup_url?.[0] || "";
    filesize = playData.durl[0].size || 0;
  } else if (playData.dash?.video?.length) {
    // dash 是分离的 video+audio；只拿视频轨会没声音；用 durl 更靠谱
    // 兜底：挑最高清晰度的 video baseUrl
    const bestVideo = playData.dash.video.sort(
      (a, b) => (b.bandwidth || 0) - (a.bandwidth || 0)
    )[0];
    videoUrl = bestVideo.baseUrl || bestVideo.base_url || "";
  }
  if (!videoUrl) {
    throw new Error(
      "B站视频未返回可下载地址，可能是充电专享/大会员视频。请点击【浏览器打开】用系统浏览器登录后重试。"
    );
  }

  return {
    url: videoUrl,
    size: filesize,
    description: title,
    decode_key: "",
    hd_url: null,
    uploader,
    platform: "B站",
    referer: "https://www.bilibili.com/",
    noDecrypt: true,
    sourceUrl: pageUrl,
  };
}

async function fetchResolvedPage(inputUrl) {
  const url = ensureHttpUrl(inputUrl);
  const cookie = await getCookieHeader(url);
  const response = await axios.get(url, {
    maxRedirects: 10,
    timeout: 20000,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      ...DEFAULT_HEADERS,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const resolvedUrl = response.request?.res?.responseUrl || url;
  return {
    originalUrl: url,
    resolvedUrl,
    html:
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data),
    cookie,
  };
}

function selectYtDlpUrl(info) {
  if (info?.url && isLikelyVideoUrl(info.url)) return info.url;
  const requested = info?.requested_downloads?.find(
    (item) => item.url && isLikelyVideoUrl(item.url)
  );
  if (requested) return requested.url;
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const candidates = formats
    .filter((item) => item.url && item.vcodec !== "none")
    .map((item) => ({
      url: item.url,
      score:
        (item.ext === "mp4" ? 20 : 0) +
        (item.acodec && item.acodec !== "none" ? 12 : 0) +
        (item.height || 0) / 100 +
        (item.tbr || 0) / 1000 -
        (/watermark|playwm|logo/i.test(item.format_id || item.url) ? 30 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.url || info?.url || "";
}

function buildYtDlpError(platform, err) {
  const text = String(err?.stderr || err?.message || err || "");
  if (/unsupported version of Python|Python versions 3\.10/i.test(text)) {
    return `${platform}解析组件需要 Python 3.10+ 或系统 yt-dlp。请安装/升级 yt-dlp（推荐 brew install yt-dlp）后重试，或点击【浏览器打开】在系统浏览器里播放视频自动捕获。`;
  }
  if (/timed out|timeout|ETIMEDOUT|ChildProcessError/i.test(text)) {
    return `${platform}解析请求超时。请检查网络是否能访问该平台，或稍后重试；也可以点击【浏览器打开】在系统浏览器里播放视频自动捕获。`;
  }
  if (/cookies|login|sign in|fresh cookies|not logged in/i.test(text)) {
    return `${platform}解析需要登录态或新鲜 Cookie。请点击【浏览器打开】在系统浏览器（推荐 Chrome/Safari）中登录并播放该视频，再点【解析下载】即可自动读取 Cookie。`;
  }
  if (
    /HTTP Error 412|Precondition Failed|403|429|captcha|verify|risk|风控/i.test(
      text
    )
  ) {
    return `${platform}解析被平台风控拦截（412/403/429）。请点击【浏览器打开】用系统浏览器（推荐 Chrome，且需登录 ${platform}）播放视频后再重试；或稍后更换网络重试。`;
  }
  if (/Unsupported URL/i.test(text)) {
    return `暂不支持该 ${platform} 链接类型，请确认链接为公开视频地址。`;
  }
  return `${platform}视频解析失败：${
    text.split("\n")[0] || "未获取到可下载的视频地址"
  }`;
}

function getYtDlpRunner() {
  const createRunner = youtubedl.create || youtubedl.youtubeDl?.create;
  if (!createRunner) return youtubedl;

  // 打包后 node_modules 不再进 asar，yt-dlp 走 extraResources 落到 resources/yt-dlp-bin。
  // 开发态仍回退到 node_modules 内置二进制。
  const ytDlpFile = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const bundledYtDlp = app?.isPackaged
    ? path.join(process.resourcesPath, "yt-dlp-bin", ytDlpFile)
    : null;

  const candidates = [
    process.env.YT_DLP_PATH,
    bundledYtDlp,
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ].filter(Boolean);

  for (const binaryPath of candidates) {
    try {
      execFileSync(binaryPath, ["--version"], {
        stdio: "ignore",
        timeout: 3000,
      });
      return createRunner(binaryPath);
    } catch (e) {}
  }

  try {
    const command = process.platform === "win32" ? "where" : "which";
    const detected = execFileSync(command, ["yt-dlp"], {
      encoding: "utf8",
      timeout: 3000,
    })
      .split(/\r?\n/)
      .find(Boolean);
    if (detected) return createRunner(detected.trim());
  } catch (e) {}

  return youtubedl;
}

async function parseWithYtDlp(url, platform, cookie) {
  const addHeader = [
    `user-agent:${DEFAULT_HEADERS["User-Agent"]}`,
    `referer:${new URL(url).origin}/`,
  ];
  if (cookie) addHeader.push(`cookie:${cookie}`);

  const baseOptions = {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    socketTimeout: 20,
    format: "best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]/best",
    addHeader,
  };

  const cookieBrowsers =
    process.platform === "darwin"
      ? ["safari", "chrome", "firefox"]
      : ["chrome", "firefox", "edge"];
  const attemptOptions = cookie
    ? [baseOptions]
    : cookieBrowsers
        .map((browser) => ({ ...baseOptions, cookiesFromBrowser: browser }))
        .concat([baseOptions]);

  let lastErr;
  for (const options of attemptOptions) {
    try {
      const info = await getYtDlpRunner()(url, options, { timeout: 60000 });
      const videoUrl = selectYtDlpUrl(info);
      if (!videoUrl) {
        throw new Error("未获取到可下载的视频地址");
      }
      return {
        url: videoUrl,
        size: info?.filesize || info?.filesize_approx || 0,
        description: (info?.title || `${platform}视频`).slice(0, 80),
        decode_key: "",
        hd_url: null,
        uploader: info?.uploader || info?.channel || "",
        platform,
        referer: info?.webpage_url || url,
        noDecrypt: true,
        sourceUrl: info?.webpage_url || url,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(buildYtDlpError(platform, lastErr));
}

export async function parsePlatformVideo(inputUrl) {
  const initialUrl = ensureHttpUrl(inputUrl);
  let initialConfig = null;
  try {
    initialConfig = detectPlatform(initialUrl);
  } catch (e) {}

  if (initialConfig?.parser === "capture") {
    throw new Error(
      `${initialConfig.platform}链接需要页面运行后才能拿到真实媒体地址。请点击【浏览器打开】用系统浏览器打开并播放视频，软件会自动捕获到下方列表。`
    );
  }

  if (initialConfig?.parser === "ytdlp") {
    return parseWithYtDlp(
      initialUrl,
      initialConfig.platform,
      await getCookieHeader(initialUrl)
    );
  }

  if (initialConfig?.parser === "bili") {
    try {
      return await parseBilibili(initialUrl);
    } catch (err) {
      try {
        return await parseWithYtDlp(
          initialUrl,
          initialConfig.platform,
          await getCookieHeader(initialUrl)
        );
      } catch (fallbackErr) {
        throw new Error(err?.message || fallbackErr?.message || "B站解析失败");
      }
    }
  }

  const page = await fetchResolvedPage(inputUrl);
  const config = detectPlatform(page.resolvedUrl);
  const platform = config.platform;

  if (config.parser === "capture") {
    throw new Error(
      `${platform}链接需要页面运行后才能拿到真实媒体地址。请点击【浏览器打开】用系统浏览器打开并播放视频，软件会自动捕获到下方列表。`
    );
  }

  if (config.parser === "ytdlp") {
    return parseWithYtDlp(page.resolvedUrl, platform, page.cookie);
  }

  if (config.parser === "bili") {
    try {
      return await parseBilibili(page.resolvedUrl);
    } catch (err) {
      try {
        return await parseWithYtDlp(page.resolvedUrl, platform, page.cookie);
      } catch (fallbackErr) {
        throw new Error(err?.message || fallbackErr?.message || "B站解析失败");
      }
    }
  }

  // 小红书/快手：专用解析，去水印 + 精确标题
  if (platform === "小红书") {
    const { videoUrl, title } = parseXiaohongshu(page.html, page.resolvedUrl);
    if (videoUrl) {
      const mediaInfo = await inspectVideoUrl(videoUrl, page.resolvedUrl);
      return {
        url: videoUrl,
        size: mediaInfo.size,
        description: title,
        decode_key: "",
        hd_url: null,
        uploader: "",
        platform,
        referer: page.resolvedUrl,
        noDecrypt: true,
        sourceUrl: page.resolvedUrl,
      };
    }
  }
  if (platform === "快手") {
    const { videoUrl, title } = parseKuaishou(page.html, page.resolvedUrl);
    if (videoUrl) {
      const mediaInfo = await inspectVideoUrl(videoUrl, page.resolvedUrl);
      return {
        url: videoUrl,
        size: mediaInfo.size,
        description: title,
        decode_key: "",
        hd_url: null,
        uploader: extractAuthor(page.html),
        platform,
        referer: page.resolvedUrl,
        noDecrypt: true,
        sourceUrl: page.resolvedUrl,
      };
    }
  }

  const candidates = collectVideoCandidates(page.html, page.resolvedUrl);
  const videoUrl = await selectPlayableCandidate(candidates, page.resolvedUrl);

  if (!videoUrl) {
    try {
      return await parseWithYtDlp(page.resolvedUrl, platform, page.cookie);
    } catch (err) {
      throw new Error(
        `${platform}视频解析失败：页面中未找到可下载的视频地址。${
          err?.message || "请点击【浏览器打开】在系统浏览器里播放视频后自动捕获，或稍后重试。"
        }`
      );
    }
  }

  return {
    url: videoUrl,
    size: 0,
    description: extractTitle(page.html, platform),
    decode_key: "",
    hd_url: null,
    uploader: extractAuthor(page.html),
    platform,
    referer: page.resolvedUrl,
    noDecrypt: true,
    sourceUrl: page.resolvedUrl,
  };
}
