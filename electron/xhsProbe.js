// 独立诊断脚本：抓一条小红书 note，打印所有可能的视频 URL 候选（masterUrl / backupUrls / originVideoKey）。
// 使用：node --experimental-vm-modules electron/xhsProbe.js "<url>"
// 只 log，不改主流程。
const axios = require('axios');

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function decodeHtmlText(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/');
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node electron/xhsProbe.js "<xhs url>"');
    process.exit(1);
  }
  console.log('[xhsProbe] fetching', url);
  const resp = await axios.get(url, {
    maxRedirects: 10,
    timeout: 20000,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: DEFAULT_HEADERS,
  });
  const resolvedUrl = resp.request?.res?.responseUrl || url;
  const raw = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  const html = decodeHtmlText(raw);
  console.log('[xhsProbe] status=', resp.status, 'len=', raw.length, 'resolved=', resolvedUrl);

  const hits = (label, re, group = 1) => {
    const set = new Set();
    let m;
    while ((m = re.exec(html))) set.add(m[group] || m[0]);
    console.log(`\n===== ${label} (${set.size}) =====`);
    [...set].forEach((v) => console.log(v));
    return [...set];
  };

  hits('masterUrl', /"masterUrl"\s*:\s*"([^"]+)"/g);
  hits('backupUrls (raw array)', /"backupUrls"\s*:\s*\[[^\]]*\]/g, 0);
  hits('originVideoKey', /"originVideoKey"\s*:\s*"([^"]+)"/g);
  hits('videoId', /"videoId"\s*:\s*"([^"]+)"/g);
  hits('h264 masterUrl block', /"h264"\s*:\s*\[[^\]]{0,2000}?\]/g, 0);
  hits('sns-video / xhscdn mp4', /https?:\/\/[^"'\s]+?(?:sns-video[^"'\s]*|xhscdn[^"'\s]*)\.mp4[^"'\s]*/gi, 0);

  const wm = html.match(/watermark[^"]*/gi) || [];
  console.log('\n===== watermark occurrences =====', wm.length);
  wm.slice(0, 5).forEach((v) => console.log(v.slice(0, 200)));
}

main().catch((e) => {
  console.error('[xhsProbe][err]', e && e.message || e);
  process.exit(2);
});
