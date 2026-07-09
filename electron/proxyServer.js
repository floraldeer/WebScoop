import fs from 'fs';
import hoxy from 'hoxy';
import getPort from 'get-port';
import log from 'electron-log';
import { app } from 'electron';
import CONFIG from './const';
import { setProxy, closeProxy } from './setProxy';
import { getPlatformFromHostname } from './platformParsers';

if (process.platform === 'win32') {
  process.env.OPENSSL_BIN = CONFIG.OPEN_SSL_BIN_PATH;
  process.env.OPENSSL_CONF = CONFIG.OPEN_SSL_CNF_PATH;
}

const WVDS_DEBUG = process.env.WVDS_DEBUG !== undefined;

const injection_html = `
<script type="text/javascript" src="//res.wx.qq.com/t/wx_fed/finder/web/web-finder/res/js/wvds.inject.js"></script>
`;

// 视频号注入：三重捕获
// 1. hook WeixinJSBridge.invoke（老 SPA 路径）
// 2. hook window.fetch（新 SPA 走 fetch 拿 feed 数据）
// 3. hook XMLHttpRequest（部分接口走 XHR）
// 三条链路共用同一个 extractMedia 函数，从 object_desc.media 中拿 decode_key + url_token
const injection_script = `
(function() {
  if (window.wvds !== undefined) return;
  window.wvds = true;
  ${WVDS_DEBUG ? 'document.body && (document.body.style.border = "2px solid #0000FF");' : ''}
  function debug_wvds(msg) {
    ${WVDS_DEBUG ? 'console.log("[WVDS]", msg);' : ''}
  }
  var receiver_url = "https://aaaa.com";
  var sent_keys = {};
  function post_video(video_data) {
    var dedup_key = (video_data.decode_key || "") + "|" + (video_data.url || "").split("?")[0];
    if (sent_keys[dedup_key]) return;
    sent_keys[dedup_key] = true;
    debug_wvds("post video: " + video_data.description);
    fetch(receiver_url, { method: "POST", mode: "no-cors", body: JSON.stringify(video_data) });
  }
  function extract_media_from_object(obj) {
    try {
      var container = obj && obj.object ? obj.object : obj;
      if (!container) return;
      var desc = container.object_desc || container.objectDesc;
      if (!desc) return;
      var media_list = desc.media || desc.mediaList || [];
      if (!media_list || !media_list.length) return;
      var media = media_list[0];
      var url = media.url || media.videoUrl || media.h264Url || media.h265Url;
      if (!url) return;
      var url_token = media.url_token || media.urlToken || "";
      var description = (desc.description || "").trim() || "微信视频号视频";
      post_video({
        decode_key: media.decode_key || media.decodeKey || "",
        url: url + url_token,
        size: media.file_size || media.fileSize || 0,
        description: description,
        uploader: container.nickname || container.username || "",
        platform: "微信视频号",
      });
    } catch (e) {
      debug_wvds("extract err: " + e.message);
    }
  }
  function scan_json(data) {
    if (!data) return;
    try {
      // 递归找带 object_desc.media 的节点
      if (typeof data === "object") {
        if (data.object && data.object.object_desc) extract_media_from_object(data);
        if (data.object_desc) extract_media_from_object({ object: data });
        // finder feed 接口通常在 data.feed.object 或 data.list[i].object
        if (data.feed) scan_json(data.feed);
        if (Array.isArray(data.list)) data.list.forEach(scan_json);
        if (Array.isArray(data.objectList)) data.objectList.forEach(scan_json);
        if (data.data) scan_json(data.data);
        if (data.object) extract_media_from_object(data);
      }
    } catch (e) {}
  }
  // 1) WeixinJSBridge.invoke hook
  function bridge_response(response) {
    if (!response || !response["err_msg"] || !response["err_msg"].includes("H5ExtTransfer:ok")) return;
    try {
      var value = JSON.parse(response["jsapi_resp"]["resp_json"]);
      scan_json(value);
    } catch (e) {}
  }
  function wrap_bridge(origin) {
    return function() {
      if (arguments.length == 3) {
        var original_callback = arguments[2];
        arguments[2] = function() {
          if (arguments.length == 1) bridge_response(arguments[0]);
          return original_callback && original_callback.apply(this, arguments);
        };
      }
      return origin.apply(this, arguments);
    };
  }
  function try_hook_bridge() {
    if (window.WeixinJSBridge && window.WeixinJSBridge.invoke && !window.WeixinJSBridge.__wvds) {
      window.WeixinJSBridge.invoke = wrap_bridge(window.WeixinJSBridge.invoke);
      window.WeixinJSBridge.__wvds = true;
      debug_wvds("bridge hooked");
    }
  }
  try_hook_bridge();
  document.addEventListener("WeixinJSBridgeReady", try_hook_bridge, false);
  setInterval(try_hook_bridge, 2000);
  // 2) fetch hook
  if (window.fetch && !window.fetch.__wvds) {
    var original_fetch = window.fetch;
    window.fetch = function(input, init) {
      var url_str = typeof input === "string" ? input : (input && input.url) || "";
      var p = original_fetch.apply(this, arguments);
      if (/finder|channels\\.weixin\\.qq\\.com\\/cgi-bin|feed|merlin/i.test(url_str)) {
        p.then(function(resp) {
          try {
            resp.clone().json().then(scan_json, function(){});
          } catch (e) {}
        }, function(){});
      }
      return p;
    };
    window.fetch.__wvds = true;
    debug_wvds("fetch hooked");
  }
  // 3) XHR hook
  if (window.XMLHttpRequest && !window.XMLHttpRequest.prototype.__wvds) {
    var original_open = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url) {
      this.__wvds_url = url || "";
      return original_open.apply(this, arguments);
    };
    var original_send = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function() {
      var xhr = this;
      var url = xhr.__wvds_url || "";
      if (/finder|channels\\.weixin\\.qq\\.com\\/cgi-bin|feed|merlin/i.test(url)) {
        xhr.addEventListener("load", function() {
          try {
            var text = xhr.responseText;
            if (text && text.length && text.charAt(0) === "{") scan_json(JSON.parse(text));
          } catch (e) {}
        });
      }
      return original_send.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.__wvds = true;
    debug_wvds("xhr hooked");
  }
  // 4) 兜底：扫描页面上出现过的 <video src>
  setInterval(function() {
    document.querySelectorAll("video[src]").forEach(function(v) {
      var src = v.src || "";
      if (/^https?:/.test(src) && sent_keys[src.split("?")[0]] === undefined) {
        // 视频号自己的 <video> 是 blob:；只有非 blob 时才可能是外链，正常不触发
      }
    });
  }, 3000);
  debug_wvds("WVDS inited");
})();
`;

export async function startServer({ win, setProxyErrorCallback = f => f }) {
  const port = await getPort();
  const capturedMedia = {};

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
          .then(() => resolve())
          .catch(err => {
            setProxyErrorCallback(err);
            reject('设置代理失败');
          });
      })
      .on('error', err => {
        log.log('proxy err', err);
      });

    function sendCapture(data) {
      console.log('video captured:', data.description, data.platform || 'wechat');
      win?.webContents?.send?.('VIDEO_CAPTURE', data);
    }

    // 视频号回传接口：注入脚本从 JSBridge 抓到数据后 POST 到这里
    proxy.intercept(
      {
        phase: 'request',
        hostname: 'aaaa.com',
        as: 'json',
      },
      (req, res) => {
        console.log('request(aaaa.com):', req.json);
        res.string = 'ok';
        res.statusCode = 200;
        if (req.json) sendCapture(req.json);
      },
    );

    // 通用媒体响应拦截：抓抖音/B站/快手/小红书等平台在浏览器里播放时的 mp4 流。
    // 微信/QQ 域走上面的 JSBridge 专用链路，跳过。
    proxy.intercept({ phase: 'response' }, (req, res) => {
      const hostname = (req.hostname || '').toLowerCase();
      if (hostname.indexOf('aaaa.com') !== -1) return;
      if (
        hostname.indexOf('weixin') !== -1 ||
        hostname.indexOf('qq.com') !== -1 ||
        hostname.indexOf('qpic.cn') !== -1
      )
        return;

      const contentType = (res.headers['content-type'] || '').toLowerCase();
      const contentLength = res.headers['content-length'];
      const fullUrl = req.fullUrl || req.url;
      const urlNoQuery = (fullUrl || '').split('?')[0].toLowerCase();

      // 视频判定：
      // 1) Content-Type 带 video/
      // 2) URL 后缀是常见视频扩展名
      // 3) URL 命中已知媒体 CDN 域名（xhscdn/sns-video/gifshow/kuaishou-cdn 等）
      const knownMediaHost = /xhscdn|xhsslink|sns-video|douyinvod|bytecdn|byteimg|kuaishou-cdn|chenzhongtech|gifshow|ksurl\.cn|ksapisrv|bilivideo|hdslb|googlevideo|weibocdn|akamaized|tiktokcdn|cdninstagram|fbcdn|vimeocdn/i;
      const looksLikeVideo =
        contentType.indexOf('video/') !== -1 ||
        /\.(mp4|webm|mov|m4v|flv|mkv|m3u8|ts)(\?|$)/.test(urlNoQuery) ||
        (knownMediaHost.test(hostname) && /\.(mp4|webm|mov|m4v|flv|mkv|m3u8|ts)/.test(urlNoQuery));
      if (!looksLikeVideo) return;
      // 排除封面/预览类图片、缩略图
      if (/\.(jpg|jpeg|png|webp|gif|ico)(\?|$)/.test(urlNoQuery)) return;

      // 去重 key 用不含 query 的 URL，避免 range 请求重复上报
      const key = urlNoQuery;
      if (capturedMedia[key]) return;
      // 小视频（如封面短片、preview）过滤：完整长度 < 30KB 且是明确图片时忽略
      const fileSize = contentLength ? parseInt(contentLength) : 0;
      // 只在 content-length 明确且 < 30KB 且不是 m3u8/ts 时跳过
      if (fileSize > 0 && fileSize < 30000 && !/\.(m3u8|ts)/.test(urlNoQuery)) return;
      capturedMedia[key] = true;

      const platform = getPlatformFromHostname(hostname);
      const referer = req.headers['referer'] || req.headers['origin'] || '';
      const desc = platform ? platform + '视频' : '网络视频';

      console.log('capture media:', fullUrl.substring(0, 120), contentType, fileSize);
      sendCapture({
        url: fullUrl,
        size: fileSize,
        description: desc,
        decode_key: '',
        hd_url: null,
        uploader: '',
        platform: platform,
        referer: referer,
        noDecrypt: true,
      });
    });

    // 视频号 HTML 页面注入 script 标签（任何 channels.weixin.qq.com HTML 都注入）
    proxy.intercept(
      {
        phase: 'response',
        hostname: 'channels.weixin.qq.com',
        as: 'string',
      },
      (req, res) => {
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (ct.indexOf('text/html') === -1) return;
        if (res.string && res.string.indexOf('wvds.inject.js') !== -1) return;
        res.string = (res.string || '').replace('</body>', injection_html + '\n</body>');
        console.log('inject[channels.weixin.qq.com]:', req.url);
      },
    );

    // 强制视频号 HTML/JS 请求不使用 Brotli 压缩，确保 hoxy 能解压注入
    proxy.intercept(
      {
        phase: 'request',
        hostname: 'channels.weixin.qq.com',
      },
      (req) => {
        const ae = (req.headers['accept-encoding'] || '').toString();
        if (ae.indexOf('br') !== -1) {
          req.headers['accept-encoding'] = ae.replace(/br,?\s*/gi, '').trim() || 'gzip, deflate';
        }
      },
    );

    // 提供 wvds.inject.js 内容
    proxy.intercept(
      {
        phase: 'response',
        hostname: 'res.wx.qq.com',
        as: 'string',
      },
      (req, res) => {
        if (req.url.includes('wvds.inject.js')) {
          console.log('serve wvds.inject.js:', req.url);
          res.string = injection_script;
          res.statusCode = 200;
          return;
        }
        if (req.url.includes('polyfills.publish')) {
          res.string = res.string + '\n' + injection_script;
        }
      },
    );
  });
}

app.on('before-quit', async e => {
  e.preventDefault();
  try {
    await closeProxy();
    console.log('close proxy success');
  } catch (error) {}
  app.exit();
});
