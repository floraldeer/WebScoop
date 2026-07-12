import fs from 'fs';
import hoxy from 'hoxy';
import getPort from 'get-port';
import log from 'electron-log';
import { app } from 'electron';
import CONFIG from './const';
import { setProxy, closeProxy } from './setProxy';

if (process.platform === 'win32') {
  process.env.OPENSSL_BIN = CONFIG.OPEN_SSL_BIN_PATH;
  process.env.OPENSSL_CONF = CONFIG.OPEN_SSL_CNF_PATH;
}

// 我们本身就是本机 MITM 代理，需要对上游忽略证书链问题（微信/腾讯家的中间证书
// 在 Node 默认 ca bundle 里会报 self signed certificate in certificate chain，
// 导致 hoxy 上游握手失败、response 阶段 intercept 全部不触发，页面白屏）。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// electron-log 落盘：macOS ~/Library/Logs/webscoop/main.log
const BUILD_TAG = '2.2.6';
const DEBUG_WX = process.env.DEBUG_WX === '1';
try {
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  log.transports.file.maxSize = 20 * 1024 * 1024;
  const filePath = log.transports.file.getFile ? log.transports.file.getFile().path : '(unknown)';
  log.info('======== WVDS boot build=' + BUILD_TAG + ' pid=' + process.pid + ' debugWx=' + DEBUG_WX + ' ========');
  log.info('log file=' + filePath);
} catch (e) {}

function info(tag, ...args) {
  try { log.info('[' + tag + ']', ...args); } catch (e) {}
  try { console.log('[' + tag + ']', ...args); } catch (e) {}
}

// 只在 DEBUG_WX=1 时打，避免每分钟几百行的静态资源明细刷屏正式包
function debug(tag, ...args) {
  if (!DEBUG_WX) return;
  info(tag, ...args);
}

const injection_html = `
<script type="text/javascript" src="//res.wx.qq.com/t/wx_fed/finder/web/web-finder/res/js/wvds.inject.js"></script>
`;

// 注入到页面里的脚本：hook fetch/XHR/WeixinJSBridge，把 JSON 里的视频信息发到 aaaa.com
// 只有真正被播放器加载/播放过的视频才推给主窗口——避免打开个人主页就把整个 feed 列表全部推入。
const WVDS_INJECT_SCRIPT = `
(function() {
  'use strict';
  if (window.__wvds_injected) return;
  window.__wvds_injected = true;

  var RECEIVER_URL = 'https://aaaa.com';
  var LOG_URL = 'https://wvds-log.aaaa.com';
  var capturedSet = {};

  // 待推候选池：finderH5ExtTransfer 一次能吐一整页的 media 对象，我们全部先记下 encfilekey/decode_key，
  // 但**不推**给主进程；等 <video> 元素真的开始加载/播放某个 URL 时，再从池里按 encfilekey 匹配"这条正在放的"推出去。
  // 这样个人主页刷新时只有当前 hover 播放的那条才进列表，不会一次性 20 条全冒。
  var pendingByKey = {};

  function wlog(tag, payload) {
    try {
      fetch(LOG_URL, {
        method: 'POST', mode: 'no-cors', cache: 'no-cache',
        body: JSON.stringify({ tag: tag, url: location.href.slice(0, 200), payload: payload })
      });
    } catch(e) {}
    try { console.log('[WVDS]', tag, payload); } catch(e) {}
  }

  wlog('inject-boot', { ua: navigator.userAgent.slice(0, 120) });

  function extractEncKey(u) {
    if (!u) return '';
    var m = String(u).match(/[?&]encfilekey=([^&#]+)/);
    return m ? m[1] : '';
  }

  function actuallySend(data) {
    if (!data || !data.url) return;
    var desc = (data.description || '未命名视频').trim();
    var keyBase = desc + '|' + (data.decode_key || '');
    if (capturedSet[keyBase]) return;
    capturedSet[keyBase] = true;
    var out = {
      url: data.url,
      hd_url: data.hd_url,
      size: data.size,
      description: desc,
      decode_key: data.decode_key,
      uploader: data.uploader,
    };
    wlog('capture', { desc: desc, size: out.size, hasKey: !!out.decode_key, url: (out.url || '').slice(0, 160) });
    try {
      fetch(RECEIVER_URL, {
        method: 'POST', mode: 'no-cors', cache: 'no-cache',
        body: JSON.stringify(out),
      });
    } catch(e) {}
  }

  // 只入池、不外发；等到 <video> 播这条时 flushByEncKey 再发
  // stashCandidate 记录的是"这条视频所有可能的 encfilekey"，因为 <video>.currentSrc 可能命中 SD/HD/spec 任一档。
  function stashCandidate(data) {
    if (!data || !data.url) return;
    var keys = [];
    var k1 = extractEncKey(data.url);
    var k2 = extractEncKey(data.hd_url);
    if (k1) keys.push(k1);
    if (k2 && k2 !== k1) keys.push(k2);
    if (data._extraKeys && data._extraKeys.length) {
      for (var i = 0; i < data._extraKeys.length; i++) {
        var ek = data._extraKeys[i];
        if (ek && keys.indexOf(ek) === -1) keys.push(ek);
      }
    }
    if (!keys.length) return;
    for (var j = 0; j < keys.length; j++) pendingByKey[keys[j]] = data;
    wlog('stash', { keys: keys.length, key0: keys[0].slice(0, 40), desc: (data.description || '').slice(0, 40), hasKey: !!data.decode_key });
  }

  function flushByEncKey(key) {
    if (!key) return;
    var data = pendingByKey[key];
    if (!data) { wlog('flush-miss', { key: key.slice(0, 40) }); return; }
    delete pendingByKey[key];
    actuallySend(data);
  }

  // 主入口：extractVideoFromObject 会调这个 —— 只入池，播放器触发时才推
  function sendVideoData(data) {
    stashCandidate(data);
  }

  function extractVideoFromObject(obj, depth) {
    if (!obj || depth > 10) return;
    if (typeof obj !== 'object') return;

    // finderH5ExtTransfer 响应真实结构：
    //   { BaseResponse, object:[ { id, nickname, username, object_desc:{ description, media:[{url,decode_key,fileSize,url_token,spec_video[]}] } } ] }
    // 所以拿到"任何"带 object_desc.media[] / objectDesc.media[] 的对象都要抽出来，
    // 而不是要求祖先叫 object。之前只匹配 obj.object.object_desc，遇到数组时匹配不上。
    try {
      var mediaArr = null;
      var descText = '';
      var nickname = '';
      if (obj.object_desc && obj.object_desc.media) {
        mediaArr = obj.object_desc.media;
        descText = obj.object_desc.description || '';
        nickname = obj.nickname || obj.username || '';
      } else if (obj.objectDesc && obj.objectDesc.media) {
        mediaArr = obj.objectDesc.media;
        descText = obj.objectDesc.description || '';
        nickname = obj.nickname || obj.username || '';
      }
      if (mediaArr && mediaArr.length) {
        var media = mediaArr[0];
        var mediaUrl = media.url || media.Url || '';
        var urlToken = media.url_token || media.urlToken || '';
        var hdUrl = '';
        var hdToken = '';
        var extraKeys = [];
        // spec_video[] 里通常有多档，选 file_size 最大的当 hd，同时把每一档的 encfilekey 收集起来，
        // 因为播放器最终真正读的可能是任意一档（HD/SD/自适应），任何一档命中都要能 flush 到同一条卡片。
        var spec = media.spec_video || media.specVideo || media.spec_videos || [];
        if (spec && spec.length) {
          var best = spec[0];
          for (var si = 0; si < spec.length; si++) {
            var uu = spec[si].url || spec[si].Url || '';
            var ekk = extractEncKey(uu);
            if (ekk) extraKeys.push(ekk);
            if ((spec[si].file_size || spec[si].fileSize || 0) > (best.file_size || best.fileSize || 0)) best = spec[si];
          }
          hdUrl = best.url || best.Url || mediaUrl;
          hdToken = best.url_token || best.urlToken || urlToken;
        } else if (media.hd_url || media.hdUrl) {
          hdUrl = media.hd_url || media.hdUrl;
          hdToken = media.hd_url_token || media.hdUrlToken || urlToken;
        }
        var payload = {
          decode_key: media.decode_key || media.decodeKey || '',
          url: mediaUrl + urlToken,
          hd_url: hdUrl ? hdUrl + hdToken : null,
          size: media.file_size || media.fileSize || 0,
          description: (descText || '未命名视频').toString().trim().slice(0, 120) || '未命名视频',
          uploader: nickname,
          _extraKeys: extraKeys,
        };
        // 有 decode_key 才推给主进程；没 key 的裸 CDN URL 下载出来是加密字节
        if (payload.url && payload.decode_key) {
          sendVideoData(payload);
        } else {
          wlog('media-hit-nokey', { desc: payload.description.slice(0, 40), hasUrl: !!payload.url, hasKey: !!payload.decode_key });
        }
      }
      // 新版 finder-preview 扁平结构（少见但保留）
      var flatUrl = obj.videoUrl || obj.VideoUrl || obj.h264Url || obj.h265Url;
      if (typeof flatUrl === 'string' && flatUrl.indexOf('http') === 0 && (obj.decode_key || obj.decodeKey)) {
        sendVideoData({
          decode_key: obj.decodeKey || obj.decode_key || '',
          url: flatUrl + (obj.urlToken || obj.url_token || ''),
          hd_url: null,
          size: obj.fileSize || obj.file_size || 0,
          description: (obj.description || obj.desc || '未命名视频').toString().trim(),
          uploader: obj.nickname || obj.nickName || obj.username || '',
        });
      }
    } catch(e) {}

    // 数组/对象继续深挖
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      for (var i = 0; i < obj.length; i++) extractVideoFromObject(obj[i], depth + 1);
      return;
    }
    for (var k in obj) {
      if (obj[k] && typeof obj[k] === 'object') {
        extractVideoFromObject(obj[k], depth + 1);
      }
    }
  }

  function tryParseAndExtract(text) {
    if (!text) return;
    if (typeof text !== 'string') {
      try { extractVideoFromObject(text, 0); } catch(e) {}
      return;
    }
    try {
      var json = JSON.parse(text);
      extractVideoFromObject(json, 0);
    } catch(e) {
      var startIdx = text.indexOf('{');
      var endIdx = text.lastIndexOf('}');
      if (startIdx >= 0 && endIdx > startIdx) {
        try {
          var json2 = JSON.parse(text.substring(startIdx, endIdx + 1));
          extractVideoFromObject(json2, 0);
        } catch(e2) {}
      }
    }
  }

  function hookWeixinJSBridge() {
    if (!window.WeixinJSBridge) return false;
    var origInvoke = window.WeixinJSBridge.invoke;
    if (!origInvoke || origInvoke.__wvds_hooked) return false;

    window.WeixinJSBridge.invoke = function(cmdName) {
      var args = Array.prototype.slice.call(arguments);
      if (args.length >= 3 && typeof args[2] === 'function') {
        var origCb = args[2];
        args[2] = function(res) {
          try {
            wlog('bridge-cb', { cmd: cmdName, hasResp: !!res, respKeys: res && typeof res === 'object' ? Object.keys(res).slice(0, 8) : null });
            if (res) {
              tryParseAndExtract(res);
              if (res.jsapi_resp && res.jsapi_resp.resp_json) {
                var rj = res.jsapi_resp.resp_json + '';
                // 只对 finderH5ExtTransfer 的大响应体细分析：整体 sample 加长到 1600，帮助日志验证
                wlog('bridge-jsapi', { cmd: cmdName, len: rj.length, hasKey: rj.indexOf('decode_key') !== -1, sample: rj.slice(0, 1600) });
                tryParseAndExtract(rj);
              }
            }
          } catch(e) {}
          return origCb.apply(this, arguments);
        };
      }
      return origInvoke.apply(this, args);
    };
    window.WeixinJSBridge.invoke.__wvds_hooked = true;
    wlog('bridge-hooked');
    return true;
  }

  function hookFetch() {
    if (window.fetch.__wvds_hooked) return;
    var origFetch = window.fetch;
    window.fetch = function() {
      var url = arguments[0];
      var urlStr = typeof url === 'string' ? url : (url && url.url) || '';
      return origFetch.apply(this, arguments).then(function(response) {
        try {
          if (urlStr.indexOf('finder') !== -1 || urlStr.indexOf('feed') !== -1 || urlStr.indexOf('channels') !== -1) {
            var clone = response.clone();
            clone.text().then(function(text) {
              wlog('fetch-resp', { url: urlStr.slice(0, 160), len: text.length });
              tryParseAndExtract(text);
            }).catch(function(){});
          }
        } catch(e) {}
        return response;
      });
    };
    window.fetch.__wvds_hooked = true;
    wlog('fetch-hooked');
  }

  function hookXHR() {
    if (XMLHttpRequest.prototype.__wvds_hooked) return;
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this.__wvds_url = url;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
      var self = this;
      var url = this.__wvds_url || '';
      this.addEventListener('load', function() {
        try {
          if (url.indexOf('finder') !== -1 || url.indexOf('feed') !== -1 || url.indexOf('channels') !== -1) {
            wlog('xhr-resp', { url: (url + '').slice(0, 160), len: (self.responseText || '').length });
            tryParseAndExtract(self.responseText || self.response);
          }
        } catch(e) {}
      });
      return origSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__wvds_hooked = true;
    wlog('xhr-hooked');
  }

  function tryInitHooks() {
    hookFetch();
    hookXHR();
    hookWeixinJSBridge();
    hookVideoElements();
  }

  // 观察 <video> 元素的 src / loadstart / play：任何一个 src 里带 encfilekey，
  // 就把候选池中对应那条推给主进程。这样只有正在真正播放/加载的视频才会进下载列表。
  function hookVideoElements() {
    if (window.__wvds_video_hooked) return;
    window.__wvds_video_hooked = true;

    function bindOne(v) {
      if (!v || v.__wvds_bound) return;
      v.__wvds_bound = true;
      // 视频号 SPA 换视频时通常复用同一个 <video>，只改 currentSrc；有的路径不重派 loadstart。
      // 因此除了播放事件外，还监听 emptied/ratechange/durationchange/timeupdate，以及用
      // MutationObserver 观察 src 属性变化：任何一个能"感知到当前正在放的是哪一条 encfilekey"
      // 的信号都触发一次 flushByEncKey，配合去重保证同一条不会重复推。
      function tryFlush() {
        try {
          var src = v.currentSrc || v.src || '';
          var k = extractEncKey(src);
          if (k) flushByEncKey(k);
        } catch(e) {}
      }
      var events = ['loadstart', 'loadedmetadata', 'play', 'playing', 'canplay', 'emptied', 'durationchange', 'ratechange', 'timeupdate'];
      events.forEach(function(ev) {
        v.addEventListener(ev, tryFlush, true);
      });
      try {
        var vmo = new MutationObserver(tryFlush);
        vmo.observe(v, { attributes: true, attributeFilter: ['src'] });
      } catch(e) {}
      tryFlush();
    }

    function scan() {
      try {
        var list = document.querySelectorAll('video');
        for (var i = 0; i < list.length; i++) bindOne(list[i]);
      } catch(e) {}
    }
    scan();
    setInterval(scan, 1500);

    try {
      var mo = new MutationObserver(function() { scan(); });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch(e) {}
    wlog('video-hooked');
  }

  tryInitHooks();

  var bridgeInterval = setInterval(function() {
    if (window.WeixinJSBridge && !window.WeixinJSBridge.invoke.__wvds_hooked) {
      hookWeixinJSBridge();
    }
  }, 1000);
  setTimeout(function() { clearInterval(bridgeInterval); }, 30000);

  if (document.addEventListener) {
    document.addEventListener('WeixinJSBridgeReady', function() {
      hookWeixinJSBridge();
    }, false);
  }
})();
`;

let currentProxyPort = 0;
export function getCurrentProxyPort() { return currentProxyPort; }

export async function startServer({ win, setProxyErrorCallback = f => f }) {
  const port = await getPort();
  currentProxyPort = port;
  const capturedMedia = {};

  info('proxy', 'starting on port', port, 'buildTag=' + BUILD_TAG);

  // 心跳：每 10 秒打一次流量统计，用于诊断"系统代理是否收到流量"。
  // 正式包噪音大，仅在 DEBUG_WX=1 时输出；有报错时统一走 info。
  const stat = { total: 0, wxHtml: 0, media: 0, cdnHit: 0, injected: 0, injectionsSent: 0 };
  setInterval(() => {
    debug('heartbeat', JSON.stringify(stat));
  }, 10000);

  return new Promise(async (resolve, reject) => {
    const proxy = hoxy
      .createServer({
        certAuthority: {
          key: fs.readFileSync(CONFIG.CERT_PRIVATE_PATH),
          cert: fs.readFileSync(CONFIG.CERT_PUBLIC_PATH),
        },
      })
      .listen(port, () => {
        setProxy('127.0.0.1', port)
          .then(() => {
            info('proxy', 'system proxy set 127.0.0.1:' + port);
            resolve();
          })
          .catch((err) => {
            info('proxy', 'setProxy failed', String(err));
            setProxyErrorCallback(err);
            reject('设置代理失败');
          });
      })
      .on('error', err => {
        info('proxy-err', String(err && err.message || err));
      });

    function sendCapture(data) {
      info('capture-emit', { desc: data.description, platform: data.platform || 'wechat', size: data.size, hasKey: !!data.decode_key, url: (data.url || '').slice(0, 160) });
      win?.webContents?.send?.('VIDEO_CAPTURE', data);
    }

    // === 注入脚本回传的视频数据接收器 ===
    proxy.intercept(
      { phase: 'request', hostname: 'aaaa.com', as: 'json' },
      (req, res) => {
        try {
          if (req.json) {
            const d = req.json;
            sendCapture({
              url: d.url,
              size: d.size || 0,
              description: d.description || '微信视频号视频',
              decode_key: d.decode_key || '',
              hd_url: d.hd_url || null,
              uploader: d.uploader || '',
              platform: '微信视频号',
              referer: 'https://channels.weixin.qq.com/',
              noDecrypt: !d.decode_key,
            });
          }
        } catch (err) {
          info('aaaa-intercept-err', String(err && err.message || err));
        }
        res.string = 'ok';
        res.statusCode = 200;
      },
    );

    // === 注入脚本的诊断日志回传通道，主进程日志能看到浏览器内脚本发生的一切 ===
    proxy.intercept(
      { phase: 'request', hostname: 'wvds-log.aaaa.com', as: 'json' },
      (req, res) => {
        try {
          const p = req.json || {};
          info('WVDS', p.tag, JSON.stringify({ url: p.url, payload: p.payload }).slice(0, 800));
        } catch (e) {}
        res.string = 'ok';
        res.statusCode = 200;
      },
    );

    function injectScriptToHtml(html) {
      const scriptTag = '<script>' + WVDS_INJECT_SCRIPT + '</script>';
      if (html.indexOf('</body>') !== -1) return html.replace('</body>', scriptTag + '</body>');
      if (html.indexOf('</html>') !== -1) return html.replace('</html>', scriptTag + '</html>');
      return html + scriptTag;
    }

    function getPlatformFromUrl(hostname) {
      const hn = (hostname || '').toLowerCase();
      if (hn.indexOf('douyin') !== -1 || hn.indexOf('iesdouyin') !== -1 || hn.indexOf('bytecdn') !== -1 || hn.indexOf('douyinvod') !== -1 || hn.indexOf('byteimg') !== -1) return '抖音';
      if (hn.indexOf('kuaishou') !== -1 || hn.indexOf('ksapisrv') !== -1 || hn.indexOf('gifshow') !== -1 || hn.indexOf('ksurl') !== -1 || hn.indexOf('ksyungslb') !== -1) return '快手';
      if (hn.indexOf('xiaohongshu') !== -1 || hn.indexOf('xhscdn') !== -1 || hn.indexOf('xhsslink') !== -1) return '小红书';
      if (hn.indexOf('bilibili') !== -1 || hn.indexOf('bilivideo') !== -1 || hn.indexOf('hdslb') !== -1) return 'B站';
      if (hn.indexOf('weixin') !== -1 || hn.indexOf('qq.com') !== -1 || hn.indexOf('qpic.cn') !== -1) return '微信视频号';
      if (hn.indexOf('miaopai') !== -1 || hn.indexOf('weibo') !== -1 || hn.indexOf('sinaimg') !== -1) return '微博';
      if (hn.indexOf('youku') !== -1 || hn.indexOf('tudou') !== -1 || hn.indexOf('cibntv') !== -1) return '优酷';
      return '';
    }

    function isVideoRequest(url, contentType) {
      const ct = String(contentType || '').toLowerCase();
      const u = String(url || '').split('?')[0].toLowerCase();
      if (!u) return false;
      if (ct.indexOf('video/') !== -1) return true;
      if (ct.indexOf('octet-stream') !== -1 && /\.(mp4|webm|mov|m4v|flv|mkv)(\?|$)/.test(u)) return true;
      if (/\.(mp4|webm|mov|m4v|flv|mkv)(\?|$)/.test(u)) return true;
      // 视频号 CDN 明文 HTTP，无扩展名，走 stodownload
      if (/finder\.video\.qq\.com/i.test(u) && /stodownload/i.test(u)) return true;
      return false;
    }

    // 拼装完整 URL：hoxy 的 req.fullUrl 是一个方法而不是属性，直接读会拿到函数引用 —— 
    // 前几天 wx-req 里打出来的 "url" 是 hoxy 内部函数源码的原因就是这个。用 req.fullUrl() 调用。
    function buildFullUrl(req) {
      try {
        if (typeof req.fullUrl === 'function') return String(req.fullUrl() || '');
      } catch (e) {}
      const proto = req.protocol || 'https:';
      const host = req.hostname || '';
      const path = req.url || '';
      if (!host) return path;
      return proto + '//' + host + path;
    }

    const reqReferers = {};
    proxy.intercept({ phase: 'request' }, (req) => {
      try {
        const fullUrl = buildFullUrl(req);
        const headers = req.headers || {};
        const ref = headers['referer'] || headers['origin'] || '';
        if (ref) reqReferers[fullUrl] = ref;
        // 视频号相关请求都强制关掉 br，让 hoxy 能解压 HTML/JSON
        const hostname = (req.hostname || '').toLowerCase();
        if (hostname.indexOf('channels.weixin.qq.com') !== -1 || hostname.indexOf('res.wx.qq.com') !== -1) {
          const ae = (headers['accept-encoding'] || '').toString();
          if (ae.indexOf('br') !== -1) {
            req.headers['accept-encoding'] = ae.replace(/br,?\s*/gi, '').trim() || 'gzip, deflate';
          }
        }
      } catch (err) {
        info('req-intercept-err', String(err && err.message || err));
      }
    });

    // === 流量统计 + 全流量 tap ===
    // 之前这里没有 try/catch，一旦 res.headers 为空或某个字段类型异常就会抛，
    // 恰好又被主进程 process.on('uncaughtException') 静默 —— 表现就是 wxHtml++ 跑了、
    // 后面所有 info('wx-req'...) 全丢失。加上 try/catch 之后，报错也会被打出来。
    proxy.intercept({ phase: 'response' }, (req, res) => {
      try {
        const hostname = (req.hostname || '').toLowerCase();
        if (/aaaa\.com$/.test(hostname)) return;
        stat.total++;
        const isWxHost = /channels\.weixin\.qq\.com|res\.wx\.qq\.com/i.test(hostname);
        if (isWxHost) stat.wxHtml++;
        const headers = res.headers || {};
        const ct = String(headers['content-type'] || '').toLowerCase();
        const url = buildFullUrl(req).slice(0, 220);
        if (isWxHost) debug('wx-req', hostname + ' ct=' + (ct || '-') + ' ' + url);
        if (/\.(js|css|woff2?|ttf|png|jpg|jpeg|gif|webp|svg|ico|map)(\?|$)/i.test(req.url || '')) return;
        const looksMedia =
          ct.indexOf('video/') !== -1 ||
          ct.indexOf('audio/') !== -1 ||
          ct.indexOf('octet-stream') !== -1 ||
          ct.indexOf('mpegurl') !== -1 ||
          /(mp4|webm|m3u8|ts|flv|stodownload)/i.test(req.url || '');
        if (looksMedia) {
          stat.media++;
          info('resp-tap-media', hostname, ct, 'len=' + (headers['content-length'] || ''), url);
          return;
        }
        if (isWxHost) debug('resp-wx', hostname, ct, url.slice(0, 180));
      } catch (err) {
        info('resp-tap-err', String(err && err.message || err));
      }
    });

    // === 视频号 SPA 数据接口全量 dump（登录态下是否返回真视频 URL，看这里就够） ===
    // 拦 /finder-preview/api/feed/get_feed_info 和 /web/api/feed/get_feed_info 的响应体，
    // 把整包 JSON 打到主进程日志里，让扫码登录后能一眼判断"web 端是否还发 videoUrl"。
    // 注意：hoxy 对同一个 hostname + phase + as 只跑第一个匹配的拦截器，
    // 因此这段逻辑必须合并进下面那个 HTML 注入拦截器，不能独立注册。

    // === 通用视频流拦截（抖音/B 站/YouTube 等直接 CDN 抓字节） ===
    proxy.intercept({ phase: 'response' }, (req, res) => {
      try {
        const fullUrl = buildFullUrl(req);
        const headers = res.headers || {};
        const contentType = headers['content-type'] || '';
        const contentLength = headers['content-length'];
        const hostname = (req.hostname || '').toLowerCase();
        if (!fullUrl || !hostname) return;

        // 视频号 CDN (finder.video.qq.com/stodownload) 内容是 XOR 加密的，且是 HTTP Range 分块 (256KB)，
        // 直接把 CDN URL 推给 UI 会导致：
        //   1) 下载文件是加密字节，播放器打不开
        //   2) content-length 只有单块 262144 字节，UI 显示的大小错乱
        //   3) 一次播放会请求几十个不同 Range，UI 里冒出一堆假捕获抢标题
        // 视频号的正确路径是通过注入脚本从 finderH5ExtTransfer 响应里挖 media.decode_key + media.url。
        // 所以这里对视频号 CDN 只留 debug 日志，不推 UI。
        if (/(^|\.)finder\.video\.qq\.com$/i.test(hostname)) {
          debug('finder-cdn-skip', hostname, 'ct=' + contentType, 'len=' + (contentLength || ''), fullUrl.slice(0, 180));
          return;
        }
        if (hostname.indexOf('weixin') !== -1 || hostname.indexOf('qpic.cn') !== -1) return;
        if (!isVideoRequest(fullUrl, contentType)) return;

        const mediaKey = fullUrl.split('?')[0] || fullUrl;
        if (capturedMedia[mediaKey]) return;

        const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
        if (fileSize > 0 && fileSize < 100000) return;

        capturedMedia[mediaKey] = true;
        stat.cdnHit++;
        const platform = getPlatformFromUrl(hostname);
        const reqHeaders = req.headers || {};
        const referer = reqReferers[fullUrl] || reqHeaders['referer'] || reqHeaders['origin'] || '';
        let desc = platform ? (platform + '视频') : '网络视频';
        if (!platform && hostname) {
          const parts = hostname.split('.');
          if (parts.length >= 2) desc = parts[parts.length - 2] + '视频';
        }

        info('cdn-hit', { url: fullUrl.slice(0, 180), ct: contentType, size: fileSize, platform });
        sendCapture({
          url: fullUrl,
          size: fileSize,
          description: desc,
          decode_key: '',
          hd_url: null,
          uploader: '',
          platform,
          referer,
          noDecrypt: true,
        });
      } catch (err) {
        info('cdn-intercept-err', String(err && err.message || err));
      }
    });

    // === 视频号 HTML 注入 + get_feed_info 响应体 dump（合并到一个 as:'string' 拦截器里）===
    proxy.intercept(
      { phase: 'response', hostname: 'channels.weixin.qq.com', as: 'string' },
      (req, res) => {
        try {
          const contentType = (res.headers && res.headers['content-type']) || '';
          const body = res.string || '';
          const url = req.url || '';

          // 分支 1：get_feed_info / getPageInfo / get_object_page_info 等 feed API 响应，
          // 只做 dump + 挖真视频（media[].url + decode_key）。/finder-preview/api 和 /web/api 都要覆盖。
          if (/\/api\/feed\/get_feed_info|\/web\/api\/feed\/get_feed_info|\/web\/api\/(get_page_info|get_object_by_id|object_info)/i.test(url)) {
            info('feed-api', url.slice(0, 200), 'len=' + body.length, 'hasKey=' + (body.indexOf('decode_key') !== -1 || body.indexOf('decodeKey') !== -1));
            debug('feed-api-body', body.slice(0, 4000));
            let json;
            try { json = JSON.parse(body); } catch (e) { info('feed-api-parse-err', String(e && e.message || e)); return; }
            // 递归找带 decode_key 的 media 对象；有 decode_key 才推 UI，否则加密视频下载无用
            const hits = [];
            const walkMedia = (node, meta, depth) => {
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
                    hd_url: (m.hd_url || m.hdUrl) ? (m.hd_url || m.hdUrl) + (m.hd_url_token || m.hdUrlToken || '') : null,
                    decode_key: dk,
                    size: m.file_size || m.fileSize || 0,
                    description: (localDesc || '微信视频号视频').toString().trim().slice(0, 120),
                    uploader: localUploader || '',
                  });
                }
              }
              if (Array.isArray(node)) {
                for (const it of node) walkMedia(it, { description: localDesc, uploader: localUploader }, depth + 1);
                return;
              }
              for (const k in node) {
                if (node[k] && typeof node[k] === 'object') {
                  walkMedia(node[k], { description: localDesc, uploader: localUploader }, depth + 1);
                }
              }
            };
            walkMedia(json, { description: '', uploader: '' }, 0);
            if (hits.length) {
              info('feed-api-video-hit', 'count=' + hits.length + ' first=' + hits[0].url.slice(0, 120));
              // 注意：这里不再全量 sendCapture。一次 finderH5ExtTransfer 响应能返回整页 20+ 条 media，
              // 全部推给 UI 会导致个人主页一打开就冒 20 条卡片。真正的入口是注入脚本 (WVDS_INJECT_SCRIPT)：
              // 只有 <video> 元素真的在加载/播放某条 encfilekey 时才 flush 到 UI。
              // 若日后需要"侵入式全量入列表"，通过 DEBUG_WX 或额外开关再开。
            } else {
              info('feed-api-video-miss', 'no {media,decode_key} in response');
            }
            return;
          }

          // 分支 2：视频号播放页 HTML 注入
          // 视频号播放页有多套路径：
          //   /web/pages/feed        —— 电脑网页版视频号播放页（登录态真播放，主流通道）
          //   /finder-preview/pages/sph —— 桌面/移动微信分享短链落地页（未登录二维码引导）
          //   /finder/... /feed/...  —— 其他 feed 页面
          const isFeedPage = /\/web\/pages\/feed|\/finder-preview\/pages\/sph|\/finder\/|\/feed\//i.test(url);
          if (isFeedPage) {
            res.string = body.includes('</body>')
              ? body.replace('</body>', injection_html + '\n</body>')
              : body + injection_html;
            res.statusCode = 200;
            stat.injected++;
            info('inject-feed', url.slice(0, 180), 'len=' + res.string.length);
            return;
          }
          if (contentType.indexOf('text/html') === -1 && contentType.indexOf('application/xhtml') === -1) return;
          const isHtml = body.trim().indexOf('<') === 0 &&
            (body.indexOf('<html') !== -1 || body.indexOf('<!DOCTYPE') !== -1 || body.indexOf('<body') !== -1);
          if (isHtml) {
            res.string = injectScriptToHtml(body);
            stat.injected++;
            debug('inject-html', url.slice(0, 180));
          }
        } catch (err) {
          info('channels-intercept-err', String(err && err.message || err));
        }
      },
    );

    // === res.wx.qq.com：主 JS bundle 里追加脚本，兜底 HTML 注入未生效的情况 ===
    proxy.intercept(
      { phase: 'response', hostname: 'res.wx.qq.com', as: 'string' },
      (req, res) => {
        try {
          const contentType = (res.headers && res.headers['content-type']) || '';
          if (req.url && req.url.includes('wvds.inject.js')) {
            res.string = WVDS_INJECT_SCRIPT;
            res.statusCode = 200;
            stat.injectionsSent++;
            info('serve-wvds-js', req.url.slice(0, 160));
            return;
          }
          if (contentType.indexOf('javascript') !== -1 || (req.url && req.url.indexOf('.js') !== -1)) {
            if (req.url && (
              req.url.indexOf('polyfills') !== -1 ||
              req.url.indexOf('main.') !== -1 ||
              req.url.indexOf('runtime') !== -1 ||
              req.url.indexOf('vendor') !== -1 ||
              req.url.indexOf('bundle') !== -1 ||
              req.url.indexOf('finder') !== -1 ||
              /\/app[.-]/i.test(req.url)
            )) {
              res.string = (res.string || '') + '\n;' + WVDS_INJECT_SCRIPT;
              stat.injectionsSent++;
              debug('inject-js', req.url.slice(0, 180));
            }
          }
        } catch (err) {
          info('reswx-intercept-err', String(err && err.message || err));
        }
      },
    );
  });
}

app.on('before-quit', async e => {
  e.preventDefault();
  try {
    await closeProxy();
    info('proxy', 'close proxy success');
  } catch (error) {}
  app.exit();
});
