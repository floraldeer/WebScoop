// 独立诊断模块 —— 只在 DEBUG_WX=1 时挂载，其他现有逻辑零改动。
//
// 目标：
// 1) 验证"桌面版微信客户端刷视频号时，finder.video.qq.com CDN 流量是否会经过 hoxy"。已确认 YES。
// 2) 进一步抓桌面客户端到 channels.weixin.qq.com 的 API 响应体（尤其含 decode_key 的接口），
//    以此建立"URL(encfilekey) ↔ decode_key"的映射，供后续解密使用。
//
// 用法：在 proxyServer 启动 hoxy 之后调用 attachDesktopProbe(proxy)。
// 只做被动 log，不 send capture、不 drop 请求、不改 body。
import log from 'electron-log';

const enabled = () => process.env.DEBUG_WX === '1';

function short(s, n) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function extractEncKey(u) {
  if (!u) return '';
  const m = String(u).match(/[?&]encfilekey=([^&#]+)/);
  return m ? m[1] : '';
}

// 判断该请求是否来自桌面版微信客户端而非我们自己的小窗浏览器。
// 我们小窗 UA 里带 'MicroMessenger/7.0.1 WindowsWechat XWEB/13947'，
// 桌面 App 内嵌 XWEB 用 'Chrome/132.0' 且不带 MicroMessenger 标签，且 referer 是 channels.weixin.qq.com。
function isDesktopClientReq(headers) {
  const ua = String(headers['user-agent'] || '');
  if (/MicroMessenger|WindowsWechat|WebScoop/i.test(ua)) return false;
  return /Chrome\/\d+/.test(ua);
}

export function attachDesktopProbe(proxy) {
  if (!enabled()) return;
  if (!proxy || typeof proxy.intercept !== 'function') {
    log.warn('[wxdesk] proxy missing, skip');
    return;
  }

  const seenKeys = new Set();
  let seq = 0;

  // === finder CDN 请求阶段：log 来源指纹（Referer/Origin/UA）===
  proxy.intercept({ phase: 'request' }, (req) => {
    try {
      const host = (req.hostname || '').toLowerCase();
      if (!/(^|\.)finder\.video\.qq\.com$/i.test(host)) return;
      const url = (req.url || '');
      const headers = req.headers || {};
      const key = extractEncKey(url);
      const referer = short(headers['referer'] || '', 120);
      const ua = short(headers['user-agent'] || '', 100);
      const range = headers['range'] || '';
      seq++;
      const isPic = /picformat=|wxampicformat=/i.test(url);
      log.info('[wxdesk][req]',
        '#' + seq,
        (isPic ? 'kind=pic' : 'kind=video'),
        'method=' + (req.method || '?'),
        'range=' + range,
        'enckey=' + short(key, 40),
        'referer=' + (referer || '-'),
        'ua=' + (ua || '-'),
        'url=' + short(url, 160));
      if (key && !isPic && !seenKeys.has(key)) {
        seenKeys.add(key);
        log.info('[wxdesk][first-hit] new encfilekey=' + short(key, 60) + ' referer=' + (referer || '-'));
      }
    } catch (e) {
      log.warn('[wxdesk][req-err]', String(e && e.message || e));
    }
  });

  // === finder CDN 响应阶段：仅统计 content-length + status ===
  proxy.intercept({ phase: 'response' }, (req, res) => {
    try {
      const host = (req.hostname || '').toLowerCase();
      if (!/(^|\.)finder\.video\.qq\.com$/i.test(host)) return;
      const url = (req.url || '');
      const isPic = /picformat=|wxampicformat=/i.test(url);
      if (isPic) return;
      const h = res.headers || {};
      log.info('[wxdesk][resp]',
        'status=' + res.statusCode,
        'ct=' + (h['content-type'] || '-'),
        'len=' + (h['content-length'] || '-'),
        'ranges=' + (h['content-range'] || h['accept-ranges'] || '-'),
        'url=' + short(url, 140));
    } catch (e) {
      log.warn('[wxdesk][resp-err]', String(e && e.message || e));
    }
  });

  // === 桌面客户端可能调的 API 响应体 dump（UA 命中桌面 XWEB 即抓）===
  // 之前只抓 channels.weixin.qq.com，但桌面版视频号可能走别的 host（如 finder-api / szminorshort / long 等），
  // 这里放宽到 *.weixin.qq.com / *.qq.com（排除 finder.video.qq.com 字节流），
  // 用 UA 精确过滤"仅桌面 XWEB"，避开小窗自己的流量污染。
  // 静态资源（js/css/图片）和噪音接口（report-error/report-perf）跳过。
  proxy.intercept({ phase: 'response', as: 'buffer' }, (req, res) => {
    try {
      const host = (req.hostname || '').toLowerCase();
      if (!/\.(weixin\.qq\.com|qq\.com)$/i.test(host)) return;
      if (/(^|\.)finder\.video\.qq\.com$/i.test(host)) return; // 字节流已在上一段 log
      const url = (req.url || '');
      if (/\.(js|css|woff2?|ttf|png|jpg|jpeg|gif|webp|svg|ico|map)(\?|$)/i.test(url)) return;
      if (/\/(report-error|report-perf|report_log|log-report|badjs)/i.test(url)) return;
      if (!isDesktopClientReq(req.headers || {})) return;

      const h = res.headers || {};
      const ct = String(h['content-type'] || '');
      const isText = /json|text|xml|javascript/i.test(ct);
      const buf = res.buffer;
      const len = buf ? buf.length : 0;

      log.info('[wxdesk][api-meta]',
        'status=' + res.statusCode,
        'host=' + host,
        'ct=' + (ct || '-'),
        'len=' + len,
        'url=' + short(url, 200));

      if (isText && buf && len > 0 && len < 40000) {
        const body = buf.toString('utf8');
        const hasKey = /decode_?key/i.test(body);
        const hasMedia = /"media"|"mediaList"|"videoUrl"|"video_url"|encfilekey/i.test(body);
        log.info('[wxdesk][api-body]',
          'hasKey=' + hasKey,
          'hasMedia=' + hasMedia,
          'host=' + host,
          'url=' + short(url, 140),
          'body=' + short(body, 2500));
      } else if (isText && len >= 40000) {
        const head = buf.toString('utf8', 0, 1200);
        const tail = buf.toString('utf8', Math.max(0, len - 1200));
        log.info('[wxdesk][api-body-large]',
          'len=' + len,
          'host=' + host,
          'url=' + short(url, 140),
          'head=' + short(head, 1200),
          'tail=' + short(tail, 1200));
      }
    } catch (e) {
      log.warn('[wxdesk][api-err]', String(e && e.message || e));
    }
  });

  log.info('[wxdesk] desktop-wechat probe attached (DEBUG_WX=1)');
}
