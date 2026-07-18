// 视频号页面注入脚本。抽离自 proxyServer.js 以便单独维护与测试。
// 注入脚本只负责在页面内提取"候选媒体"（media.url + decode_key），
// 候选与真实播放请求由主进程 wechatCaptureCoordinator 做全局配对，
// 避免多 WebView / 多清晰度导致的状态割裂与重复入列表。

// 通过一个外链 <script> 拉取注入脚本；该 URL 被 hoxy 拦截后返回 WVDS_INJECT_SCRIPT。
export const injection_html = `
<script type="text/javascript" src="//res.wx.qq.com/t/wx_fed/finder/web/web-finder/res/js/wvds.inject.js"></script>
`;

export const WVDS_INJECT_SCRIPT = `
(function() {
  'use strict';
  if (window.__wvds_injected) return;
  window.__wvds_injected = true;

  var RECEIVER_URL = 'https://aaaa.com';
  var LOG_URL = 'https://wvds-log.aaaa.com';
  var reportedCandidates = {};

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

  function reportCandidate(data) {
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
    var reportKey = (data.objectId || data.decode_key || keys[0]) + '|' + (data.current ? 'current' : 'list') + '|' + data.url;
    if (reportedCandidates[reportKey]) return;
    reportedCandidates[reportKey] = true;
    data.keys = keys;
    delete data._extraKeys;
    wlog('candidate', {
      keys: keys.length,
      key0: keys[0].slice(0, 40),
      desc: (data.description || '').slice(0, 40),
      current: !!data.current,
    });
    try {
      fetch(RECEIVER_URL, {
        method: 'POST', mode: 'no-cors', cache: 'no-cache',
        body: JSON.stringify({ event: 'candidate', candidate: data }),
      });
    } catch(e) {}
  }

  function extractVideoFromObject(obj, depth, current) {
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
        // 因为播放器最终真正读的可能是任意一档（HD/SD/自适应），任何一档命中都要能关联到同一条卡片。
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
          objectId: obj.id || obj.object_id || '',
          current: !!current,
          _extraKeys: extraKeys,
        };
        // 有 decode_key 才推给主进程；没 key 的裸 CDN URL 下载出来是加密字节
        if (payload.url && payload.decode_key) {
          reportCandidate(payload);
        } else {
          wlog('media-hit-nokey', { desc: payload.description.slice(0, 40), hasUrl: !!payload.url, hasKey: !!payload.decode_key });
        }
      }
      // 新版 finder-preview 扁平结构（少见但保留）
      var flatUrl = obj.videoUrl || obj.VideoUrl || obj.h264Url || obj.h265Url;
      if (typeof flatUrl === 'string' && flatUrl.indexOf('http') === 0 && (obj.decode_key || obj.decodeKey)) {
        reportCandidate({
          decode_key: obj.decodeKey || obj.decode_key || '',
          url: flatUrl + (obj.urlToken || obj.url_token || ''),
          hd_url: null,
          size: obj.fileSize || obj.file_size || 0,
          description: (obj.description || obj.desc || '未命名视频').toString().trim(),
          uploader: obj.nickname || obj.nickName || obj.username || '',
          objectId: obj.id || obj.object_id || '',
          current: !!current,
        });
      }
    } catch(e) {}

    // 数组/对象继续深挖
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      for (var i = 0; i < obj.length; i++) extractVideoFromObject(obj[i], depth + 1, false);
      return;
    }
    for (var k in obj) {
      if (obj[k] && typeof obj[k] === 'object') {
        var childIsCurrent = !!current ||
          (depth === 0 && (k === 'object' || k === 'feedObject') &&
            Object.prototype.toString.call(obj[k]) !== '[object Array]');
        extractVideoFromObject(obj[k], depth + 1, childIsCurrent);
      }
    }
  }

  function tryParseAndExtract(text) {
    if (!text) return;
    if (typeof text !== 'string') {
      try { extractVideoFromObject(text, 0, false); } catch(e) {}
      return;
    }
    try {
      var json = JSON.parse(text);
      extractVideoFromObject(json, 0, false);
    } catch(e) {
      var startIdx = text.indexOf('{');
      var endIdx = text.lastIndexOf('}');
      if (startIdx >= 0 && endIdx > startIdx) {
        try {
          var json2 = JSON.parse(text.substring(startIdx, endIdx + 1));
          extractVideoFromObject(json2, 0, false);
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
