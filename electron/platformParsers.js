import axios from "axios";
import { execFileSync } from "child_process";
import { session } from "electron";
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
    parser: "page",
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

async function validateVideoUrl(url, referer) {
  if (!isLikelyVideoUrl(url)) return false;
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
    return (
      contentType.includes("video/") ||
      /\.(mp4|mov|m4v|webm)(\?|$)/i.test(resolvedUrl)
    );
  } catch (e) {
    return false;
  }
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
  const rawTitle = ogTitleMatch?.[1] || titleMatch?.[1] || `${platform}视频`;
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

async function getCookieHeader(url) {
  try {
    const cookies = await session
      .fromPartition("persist:wvds")
      .cookies.get({ url });
    return cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  } catch (e) {
    return "";
  }
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
    return `${platform}解析组件需要 Python 3.10+ 或系统 yt-dlp。请安装/升级 yt-dlp 后重试，或先在内置浏览器中打开并播放视频触发自动捕获。`;
  }
  if (/timed out|timeout|ETIMEDOUT|ChildProcessError/i.test(text)) {
    return `${platform}解析请求超时。请检查网络是否能访问该平台，或稍后重试；也可以先在内置浏览器中打开并播放视频触发自动捕获。`;
  }
  if (/cookies|login|sign in|fresh cookies|not logged in/i.test(text)) {
    return `${platform}解析需要登录态或新鲜 Cookie。请先点击“前往”在内置浏览器中打开该链接并完成登录/播放，再点击“解析下载”。`;
  }
  if (
    /HTTP Error 412|Precondition Failed|403|429|captcha|verify|risk|风控/i.test(
      text
    )
  ) {
    return `${platform}解析被平台风控拦截。请先在内置浏览器中打开并播放该视频，或稍后更换网络后重试。`;
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

  const candidates = [
    process.env.YT_DLP_PATH,
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
  try {
    const addHeader = [
      `user-agent:${DEFAULT_HEADERS["User-Agent"]}`,
      `referer:${new URL(url).origin}/`,
    ];
    if (cookie) addHeader.push(`cookie:${cookie}`);
    const info = await getYtDlpRunner()(
      url,
      {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        socketTimeout: 20,
        format: "best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]/best",
        addHeader,
      },
      { timeout: 60000 }
    );
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
    throw new Error(buildYtDlpError(platform, err));
  }
}

export async function parsePlatformVideo(inputUrl) {
  const initialUrl = ensureHttpUrl(inputUrl);
  let initialConfig = null;
  try {
    initialConfig = detectPlatform(initialUrl);
  } catch (e) {}

  if (initialConfig?.parser === "capture") {
    throw new Error(
      `${initialConfig.platform}链接已识别。该平台需要页面运行后才能拿到真实媒体地址，请点击“前往”打开链接并播放视频，软件会自动捕获到下载列表。`
    );
  }

  if (initialConfig?.parser === "ytdlp") {
    return parseWithYtDlp(
      initialUrl,
      initialConfig.platform,
      await getCookieHeader(initialUrl)
    );
  }

  const page = await fetchResolvedPage(inputUrl);
  const config = detectPlatform(page.resolvedUrl);
  const platform = config.platform;

  if (config.parser === "capture") {
    throw new Error(
      `${platform}链接已识别。该平台需要页面运行后才能拿到真实媒体地址，请点击“前往”打开链接并播放视频，软件会自动捕获到下载列表。`
    );
  }

  if (config.parser === "ytdlp") {
    return parseWithYtDlp(page.resolvedUrl, platform, page.cookie);
  }

  const candidates = collectVideoCandidates(page.html, page.resolvedUrl);
  const videoUrl = await selectPlayableCandidate(candidates, page.resolvedUrl);

  if (!videoUrl) {
    try {
      return await parseWithYtDlp(page.resolvedUrl, platform, page.cookie);
    } catch (err) {
      throw new Error(
        `${platform}视频解析失败：页面中未找到可下载的视频地址。${
          err?.message || "请先在内置浏览器中打开并播放后重试。"
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
