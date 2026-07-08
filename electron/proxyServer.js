import fs from "fs";
import hoxy from "hoxy";
import getPort from "get-port";
import log from "electron-log";
import { app, session } from "electron";
import CONFIG from "./const";
import { setProxy, closeProxy } from "./setProxy";
import { getPlatformFromHostname } from "./platformParsers";

if (process.platform === "win32") {
  process.env.OPENSSL_BIN = CONFIG.OPEN_SSL_BIN_PATH;
  process.env.OPENSSL_CONF = CONFIG.OPEN_SSL_CNF_PATH;
}

const WVDS_DEBUG = process.env.WVDS_DEBUG !== undefined;

const injection_html = `
<script type="text/javascript" src="//res.wx.qq.com/t/wx_fed/finder/web/web-finder/res/js/wvds.inject.js"></script>
`;

const WVDS_INJECT_SCRIPT = `
(function() {
  'use strict';
  if (window.__wvds_injected) return;
  window.__wvds_injected = true;

  var RECEIVER_URL = 'https://aaaa.com';
  var capturedSet = {};

  function debugLog() {
    if (!${WVDS_DEBUG}) return;
    console.log.apply(console, ['[WVDS]'].concat(Array.prototype.slice.call(arguments)));
  }

  function sendVideoData(data) {
    if (!data || !data.url) return;
    var desc = (data.description || '未命名视频').trim();
    var keyBase = desc + '|' + (data.size || 0);
    if (capturedSet[keyBase]) {
      if (data.hd_url && !capturedSet[keyBase + '|hd']) {
        capturedSet[keyBase + '|hd'] = true;
      } else {
        debugLog('duplicate, skip:', desc);
        return;
      }
    }
    capturedSet[keyBase] = true;
    if (data.decode_key) capturedSet['dk|' + data.decode_key] = true;
    debugLog('capture video:', desc, data.size);
    try {
      fetch(RECEIVER_URL, {
        method: 'POST',
        mode: 'no-cors',
        cache: 'no-cache',
        body: JSON.stringify(data),
      }).catch(function(e) { debugLog('send error:', e); });
    } catch(e) {
      debugLog('send fail:', e);
    }
  }

  function extractVideoFromObject(obj, depth) {
    if (!obj || depth > 8) return;
    if (typeof obj !== 'object') return;

    try {
      if (obj.object && obj.object.object_desc && obj.object.object_desc.media) {
        var media = obj.object.object_desc.media[0];
        if (media && media.url) {
          var desc = obj.object.object_desc.description || '未命名视频';
          var nickname = obj.object.nickname || '';
          sendVideoData({
            decode_key: media.decode_key || media.decodeKey,
            url: media.url + (media.url_token || media.urlToken || ''),
            hd_url: media.hd_url ? media.hd_url + (media.hd_url_token || media.hdUrlToken || '') : null,
            size: media.file_size || media.fileSize || 0,
            description: desc.trim ? desc.trim() : desc,
            uploader: nickname,
          });
        }
        return;
      }

      if (obj.objectDesc && obj.objectDesc.media) {
        var media2 = obj.objectDesc.media[0];
        if (media2 && media2.url) {
          var desc2 = obj.objectDesc.description || '未命名视频';
          var nickname2 = obj.nickname || '';
          sendVideoData({
            decode_key: media2.decodeKey || media2.decode_key,
            url: media2.url + (media2.urlToken || media2.url_token || ''),
            hd_url: media2.hdUrl ? media2.hdUrl + (media2.hdUrlToken || media2.hd_url_token || '') : null,
            size: media2.fileSize || media2.file_size || 0,
            description: desc2.trim ? desc2.trim() : desc2,
            uploader: nickname2,
          });
        }
        return;
      }
    } catch(e) { debugLog('extract error:', e); }

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
          debugLog('invoke callback:', cmdName, res && res.err_msg);
          if (res) {
            tryParseAndExtract(res);
            if (res.jsapi_resp && res.jsapi_resp.resp_json) {
              tryParseAndExtract(res.jsapi_resp.resp_json);
            }
          }
          return origCb.apply(this, arguments);
        };
      }
      return origInvoke.apply(this, args);
    };
    window.WeixinJSBridge.invoke.__wvds_hooked = true;
    debugLog('WeixinJSBridge.invoke hooked');
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
              debugLog('fetch response:', urlStr.substring(0, 100));
              tryParseAndExtract(text);
            }).catch(function(){});
          }
        } catch(e) {}
        return response;
      });
    };
    window.fetch.__wvds_hooked = true;
    debugLog('fetch hooked');
  }

  function hookXHR() {
    if (XMLHttpRequest.prototype.__wvds_hooked) return;
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    var xhrUrlMap = {};

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
            debugLog('xhr response:', url.substring(0, 100));
            tryParseAndExtract(self.responseText || self.response);
          }
        } catch(e) {}
      });
      return origSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__wvds_hooked = true;
    debugLog('xhr hooked');
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

  debugLog('WVDS injected');
})();
`;

export async function startServer({ win, setProxyErrorCallback = (f) => f }) {
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
        const webviewProxyRules = `http=127.0.0.1:${port};https=127.0.0.1:${port}`;
        session
          .fromPartition("persist:wvds")
          .setProxy({ proxyRules: webviewProxyRules })
          .catch((err) => log.log("set webview proxy err", err));
        setProxy("127.0.0.1", port)
          .then(() => resolve())
          .catch((err) => {
            setProxyErrorCallback(err);
            reject("设置代理失败");
          });
      })
      .on("error", (err) => {
        log.log("proxy err", err);
      });

    function sendCapture(data) {
      console.log(
        "video captured:",
        data.description,
        data.platform || "wechat"
      );
      win?.webContents?.send?.("VIDEO_CAPTURE", data);
    }

    proxy.intercept(
      {
        phase: "request",
        hostname: "aaaa.com",
        as: "json",
      },
      (req, res) => {
        if (req.json) {
          sendCapture(req.json);
        }
        res.string = "ok";
        res.statusCode = 200;
      }
    );

    function injectScriptToHtml(html) {
      var scriptTag = "<script>" + WVDS_INJECT_SCRIPT + "</script>";
      if (html.indexOf("</body>") !== -1) {
        return html.replace("</body>", scriptTag + "</body>");
      }
      if (html.indexOf("</html>") !== -1) {
        return html.replace("</html>", scriptTag + "</html>");
      }
      return html + scriptTag;
    }

    function isVideoRequest(url, contentType) {
      var ct = (contentType || "").toLowerCase();
      var u = (url || "").split("?")[0].toLowerCase();
      if (ct.indexOf("video/") !== -1) return true;
      if (
        ct.indexOf("octet-stream") !== -1 &&
        /\.(mp4|webm|mov|m4v|flv|mkv)(\?|$)/.test(u)
      )
        return true;
      if (/\.(mp4|webm|mov|m4v|flv|mkv)(\?|$)/.test(u)) return true;
      return false;
    }

    var reqReferers = {};
    proxy.intercept({ phase: "request" }, (req) => {
      var fullUrl = req.fullUrl || req.url;
      var ref = req.headers["referer"] || req.headers["origin"] || "";
      if (ref) {
        reqReferers[fullUrl] = ref;
      }
    });

    proxy.intercept({ phase: "response" }, (req, res) => {
      var fullUrl = req.fullUrl || req.url;
      var contentType = res.headers["content-type"] || "";
      var contentLength = res.headers["content-length"];
      var hostname = (req.hostname || "").toLowerCase();

      if (hostname.indexOf("aaaa.com") !== -1) return;
      if (
        hostname.indexOf("weixin") !== -1 ||
        hostname.indexOf("qq.com") !== -1 ||
        hostname.indexOf("qpic.cn") !== -1
      )
        return;
      if (!isVideoRequest(fullUrl, contentType)) return;

      var mediaKey = fullUrl.split("?")[0];
      if (capturedMedia[mediaKey]) return;

      var fileSize = contentLength ? parseInt(contentLength) : 0;
      if (fileSize > 0 && fileSize < 100000) return;

      capturedMedia[mediaKey] = true;
      var platform = getPlatformFromHostname(hostname);
      var referer =
        reqReferers[fullUrl] ||
        req.headers["referer"] ||
        req.headers["origin"] ||
        "";
      var desc = platform ? platform + "视频" : "网络视频";
      if (!platform && hostname) {
        var parts = hostname.split(".");
        if (parts.length >= 2) desc = parts[parts.length - 2] + "视频";
      }

      console.log(
        "capture media:",
        fullUrl.substring(0, 100),
        contentType,
        fileSize
      );
      sendCapture({
        url: fullUrl,
        size: fileSize,
        description: desc,
        decode_key: "",
        hd_url: null,
        uploader: "",
        platform: platform,
        referer: referer,
        noDecrypt: true,
      });
    });

    proxy.intercept(
      {
        phase: "response",
        hostname: "channels.weixin.qq.com",
        as: "string",
      },
      (req, res) => {
        var contentType = res.headers["content-type"] || "";
        var body = res.string || "";
        if (req.url.includes("/web/pages/feed")) {
          res.string = body.includes("</body>")
            ? body.replace("</body>", injection_html + "\n</body>")
            : body + injection_html;
          res.statusCode = 200;
          console.log("inject feed:", req.url, res.string.length);
          return;
        }
        if (
          contentType.indexOf("text/html") === -1 &&
          contentType.indexOf("application/xhtml") === -1
        )
          return;
        var isHtml =
          body.trim().indexOf("<") === 0 &&
          (body.indexOf("<html") !== -1 ||
            body.indexOf("<!DOCTYPE") !== -1 ||
            body.indexOf("<body") !== -1);
        if (isHtml) {
          res.string = injectScriptToHtml(body);
          console.log("inject html:", req.url);
        }
      }
    );

    proxy.intercept(
      {
        phase: "response",
        hostname: "res.wx.qq.com",
        as: "string",
      },
      (req, res) => {
        var contentType = res.headers["content-type"] || "";
        if (req.url.includes("wvds.inject.js")) {
          res.string = WVDS_INJECT_SCRIPT;
          res.statusCode = 200;
          console.log("serve wvds.inject.js:", req.url);
          return;
        }
        if (
          contentType.indexOf("javascript") !== -1 ||
          req.url.indexOf(".js") !== -1
        ) {
          if (
            req.url.indexOf("polyfills") !== -1 ||
            req.url.indexOf("main.") !== -1 ||
            req.url.indexOf("runtime") !== -1 ||
            req.url.indexOf("vendor") !== -1 ||
            req.url.indexOf("bundle") !== -1 ||
            req.url.indexOf("app") !== -1 ||
            req.url.indexOf("feed.") !== -1 ||
            req.url.indexOf("finder") !== -1 ||
            req.url.indexOf("merlin") !== -1
          ) {
            res.string = res.string + "\n;" + WVDS_INJECT_SCRIPT;
            console.log("inject js:", req.url);
          }
        }
      }
    );
  });
}

app.on("before-quit", async (e) => {
  e.preventDefault();
  try {
    await closeProxy();
    console.log("close proxy success");
  } catch (error) {}

  app.exit();
});
