import axios from 'axios';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const PLATFORM_CONFIGS = [
  {
    platform: '小红书',
    hosts: ['xiaohongshu.com', 'xhslink.com', 'xhscdn.com', 'xhsslink.com'],
  },
  {
    platform: '抖音',
    hosts: ['douyin.com', 'iesdouyin.com', 'douyinvod.com', 'bytecdn.cn', 'byteimg.com'],
  },
  {
    platform: '快手',
    hosts: ['kuaishou.com', 'gifshow.com', 'ksapisrv.com', 'ksurl.cn', 'chenzhongtech.com'],
  },
];

function extractFirstUrl(input = '') {
  const match = String(input).match(/https?:\/\/[^\s"'<>，。]+/i);
  if (match) return match[0];
  const text = String(input).trim();
  if (/^[\w.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return text;
}

function detectPlatform(url) {
  const { hostname } = new URL(url);
  const host = hostname.toLowerCase();
  const config = PLATFORM_CONFIGS.find(item => item.hosts.some(domain => host.includes(domain)));
  if (!config) {
    throw new Error('暂不支持该平台链接，请粘贴小红书、抖音或快手分享链接');
  }
  return config.platform;
}

function normalizeUrl(url, baseUrl) {
  if (!url) return '';
  let value = String(url)
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
  if (value.startsWith('//')) value = `https:${value}`;
  if (value.startsWith('/')) value = new URL(value, baseUrl).toString();
  return value;
}

function decodeHtmlText(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/');
}

function collectVideoCandidates(html, baseUrl) {
  const decoded = decodeHtmlText(html);
  const candidates = [];
  const patterns = [
    /https?:\/\/[^"'\\\s<>]+?(?:\.mp4|video_id|playwm|play|tos-[^"'\\\s<>]+)[^"'\\\s<>]*/gi,
    /"(?:masterUrl|backupUrl|mainUrl|url|playAddr|srcNoMark|photoUrl|videoUrl)"\s*:\s*"([^"]+)"/gi,
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(decoded))) {
      const raw = match[1] || match[0];
      const url = normalizeUrl(raw, baseUrl);
      if (/^https?:\/\//i.test(url) && !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
        candidates.push(url);
      }
    }
  });

  return [...new Set(candidates)].sort((a, b) => scoreVideoUrl(b) - scoreVideoUrl(a));
}

function scoreVideoUrl(url) {
  let score = 0;
  if (/\.mp4(\?|$)/i.test(url)) score += 10;
  if (/watermark|playwm/i.test(url)) score -= 6;
  if (/douyinvod|bytecdn|xhscdn|kuaishou|gifshow|ksapisrv|videocdn/i.test(url)) score += 4;
  if (/h264|hevc|main|master|origin|backup/i.test(url)) score += 2;
  return score;
}

function isLikelyVideoUrl(url) {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url) ||
    /douyinvod|bytecdn|xhscdn|kuaishou|gifshow|ksapisrv|videocdn|tos-/i.test(url);
}

async function validateVideoUrl(url, referer) {
  if (!isLikelyVideoUrl(url)) return false;
  const headers = {
    ...DEFAULT_HEADERS,
    Referer: referer,
    Range: 'bytes=0-1',
  };
  try {
    const response = await axios.get(url, {
      maxRedirects: 5,
      timeout: 15000,
      responseType: 'stream',
      headers,
      validateStatus: status => status >= 200 && status < 400,
    });
    response.data?.destroy?.();
    const contentType = response.headers?.['content-type'] || '';
    const resolvedUrl = response.request?.res?.responseUrl || url;
    return contentType.includes('video/') || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(resolvedUrl);
  } catch (e) {
    return false;
  }
}

async function selectPlayableCandidate(candidates, referer) {
  for (const url of candidates.slice(0, 10)) {
    if (await validateVideoUrl(url, referer)) {
      return url;
    }
  }
  return candidates.find(isLikelyVideoUrl) || '';
}

function extractTitle(html, platform) {
  const decoded = decodeHtmlText(html);
  const titleMatch = decoded.match(/<title[^>]*>([^<]+)<\/title>/i);
  const ogTitleMatch = decoded.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const rawTitle = ogTitleMatch?.[1] || titleMatch?.[1] || `${platform}视频`;
  return rawTitle
    .replace(/ - 小红书$/, '')
    .replace(/ - 抖音$/, '')
    .replace(/ - 快手$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || `${platform}视频`;
}

function extractAuthor(html) {
  const decoded = decodeHtmlText(html);
  const authorMatch =
    decoded.match(/"nickname"\s*:\s*"([^"]+)"/i) ||
    decoded.match(/"authorName"\s*:\s*"([^"]+)"/i) ||
    decoded.match(/"name"\s*:\s*"([^"]+)"/i);
  return authorMatch?.[1] || '';
}

async function fetchResolvedPage(inputUrl) {
  const url = extractFirstUrl(inputUrl);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('请输入有效的视频分享链接');
  }
  const response = await axios.get(url, {
    maxRedirects: 10,
    timeout: 20000,
    validateStatus: status => status >= 200 && status < 400,
    headers: DEFAULT_HEADERS,
  });
  const resolvedUrl = response.request?.res?.responseUrl || url;
  return {
    resolvedUrl,
    html: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
  };
}

export async function parsePlatformVideo(inputUrl) {
  const { resolvedUrl, html } = await fetchResolvedPage(inputUrl);
  const platform = detectPlatform(resolvedUrl);
  const candidates = collectVideoCandidates(html, resolvedUrl);
  const videoUrl = await selectPlayableCandidate(candidates, resolvedUrl);

  if (!videoUrl) {
    throw new Error(`${platform}视频解析失败：页面中未找到可下载的视频地址，可能需要登录或平台风控限制`);
  }

  return {
    url: videoUrl,
    size: 0,
    description: extractTitle(html, platform),
    decode_key: '',
    hd_url: null,
    uploader: extractAuthor(html),
    platform,
    referer: resolvedUrl,
    noDecrypt: true,
    sourceUrl: resolvedUrl,
  };
}
