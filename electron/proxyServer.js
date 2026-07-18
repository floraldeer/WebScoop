import fs from 'fs';
import hoxy from 'hoxy';
import getPort from 'get-port';
import log from 'electron-log';
import { app } from 'electron';
import CONFIG from './const';
import { setProxy, closeProxy } from './setProxy';
import { createWechatCaptureCoordinator } from './wechatCaptureCoordinator';
import { installScopedTlsRelaxation } from './scopedTls';
import { ensureLocalCertificate } from './localCertificate';
import ExpiringMap from './expiringMap';
import { info, debug, DEBUG_WX } from './proxy/logger';
import {
  getPlatformFromUrl,
  isVideoRequest,
  buildFullUrl,
  injectScriptToHtml,
  walkFeedMedia,
} from './proxy/mediaMatchers';
import { WVDS_INJECT_SCRIPT, injection_html } from './inject/wvdsInjectScript';

if (process.platform === 'win32') {
  process.env.OPENSSL_BIN = CONFIG.OPEN_SSL_BIN_PATH;
  process.env.OPENSSL_CONF = CONFIG.OPEN_SSL_CNF_PATH;
}

// 微信/Tencent 的部分上游链不被 Node CA bundle 接受，只对这些域名放宽校验。
installScopedTlsRelaxation();

// 版本号取自 electron-builder 打包进来的 app 版本，避免与 package.json 漂移。
const BUILD_TAG = (() => {
  try {
    return app.getVersion();
  } catch (e) {
    return 'dev';
  }
})();
try {
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  log.transports.file.maxSize = 20 * 1024 * 1024;
  const filePath = log.transports.file.getFile ? log.transports.file.getFile().path : '(unknown)';
  log.info(
    '======== WVDS boot build=' +
      BUILD_TAG +
      ' pid=' +
      process.pid +
      ' debugWx=' +
      DEBUG_WX +
      ' ========',
  );
  log.info('log file=' + filePath);
} catch (e) {}

let currentProxyPort = 0;
let currentWechatCaptureCoordinator = null;
let pendingWechatCaptureTarget = null;
let currentProxy = null;
let currentWin = null;
let startPromise = null;
let heartbeatTimer = null;

export function setWechatCaptureTarget(target) {
  pendingWechatCaptureTarget = target || null;
  if (currentWechatCaptureCoordinator)
    currentWechatCaptureCoordinator.setTarget(pendingWechatCaptureTarget);
}

function closeHoxyProxy(proxy) {
  const close = (server) =>
    new Promise((resolve) => {
      if (!server?.listening) return resolve();
      try {
        server.close(() => resolve());
      } catch (e) {
        resolve();
      }
    });
  return Promise.all([close(proxy?._server), close(proxy?._tlsSpoofingServer)]);
}

export async function shutdownServer() {
  await closeProxy().catch(() => {});
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const proxy = currentProxy;
  currentProxy = null;
  currentProxyPort = 0;
  currentWechatCaptureCoordinator = null;
  startPromise = null;
  if (proxy) await closeHoxyProxy(proxy);
}

export async function startServer({ win, setProxyErrorCallback = (f) => f }) {
  currentWin = win;
  if (currentProxy && currentProxyPort) return currentProxyPort;
  if (startPromise) return startPromise;
  startPromise = createProxyServer({ setProxyErrorCallback });
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

async function createProxyServer({ setProxyErrorCallback }) {
  await ensureLocalCertificate();
  const port = await getPort();
  currentProxyPort = port;
  const capturedMedia = new ExpiringMap({
    ttlMs: 30 * 60 * 1000,
    maxSize: 5000,
  });

  info('proxy', 'starting on port', port, 'buildTag=' + BUILD_TAG);

  // 心跳：每 10 秒打一次流量统计，用于诊断"系统代理是否收到流量"。
  // 正式包噪音大，仅在 DEBUG_WX=1 时输出；有报错时统一走 info。
  const stat = { total: 0, wxHtml: 0, media: 0, cdnHit: 0, injected: 0, injectionsSent: 0 };
  heartbeatTimer = setInterval(() => {
    debug('heartbeat', JSON.stringify(stat));
  }, 10000);

  return new Promise((resolve, reject) => {
    let settled = false;
    const proxy = hoxy.createServer({
      certAuthority: {
        key: fs.readFileSync(CONFIG.CERT_PRIVATE_PATH),
        cert: fs.readFileSync(CONFIG.CERT_PUBLIC_PATH),
      },
    });
    currentProxy = proxy;

    const failStart = async (error) => {
      if (settled) return;
      settled = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      currentProxy = null;
      currentProxyPort = 0;
      await closeHoxyProxy(proxy);
      reject(error);
    };

    proxy.on('error', (err) => {
      info('proxy-err', String((err && err.message) || err));
      failStart(err);
    });
    proxy.listen(port, () => {
      setProxy('127.0.0.1', port)
        .then(() => {
          if (settled) return;
          settled = true;
          info('proxy', 'system proxy set 127.0.0.1:' + port);
          resolve(port);
        })
        .catch((err) => {
          info('proxy', 'setProxy failed', String(err));
          setProxyErrorCallback(err);
          failStart(new Error('设置代理失败'));
        });
    });

    function sendCapture(data) {
      info('capture-emit', {
        desc: data.description,
        platform: data.platform || 'wechat',
        size: data.size,
        hasKey: !!data.decode_key,
        url: (data.url || '').slice(0, 160),
      });
      if (currentWin && !currentWin.isDestroyed()) {
        currentWin.webContents?.send?.('VIDEO_CAPTURE', data);
      }
    }

    currentWechatCaptureCoordinator = createWechatCaptureCoordinator({
      onCapture: (data) =>
        sendCapture({
          ...data,
          size: data.size || 0,
          description: data.description || '微信视频号视频',
          hd_url: data.hd_url || null,
          uploader: data.uploader || '',
          platform: '微信视频号',
          referer: 'https://channels.weixin.qq.com/',
          noDecrypt: false,
        }),
    });
    if (pendingWechatCaptureTarget)
      currentWechatCaptureCoordinator.setTarget(pendingWechatCaptureTarget);

    // === 注入脚本回传的微信媒体候选 ===
    proxy.intercept({ phase: 'request', hostname: 'aaaa.com', as: 'json' }, (req, res) => {
      try {
        if (req.json) {
          const d = req.json;
          if (d.event === 'candidate') {
            currentWechatCaptureCoordinator.addCandidate(d.candidate);
          } else {
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
        }
      } catch (err) {
        info('aaaa-intercept-err', String((err && err.message) || err));
      }
      res.string = 'ok';
      res.statusCode = 200;
    });

    // === 注入脚本的诊断日志回传通道，主进程日志能看到浏览器内脚本发生的一切 ===
    proxy.intercept({ phase: 'request', hostname: 'wvds-log.aaaa.com', as: 'json' }, (req, res) => {
      try {
        const p = req.json || {};
        info('WVDS', p.tag, JSON.stringify({ url: p.url, payload: p.payload }).slice(0, 800));
      } catch (e) {}
      res.string = 'ok';
      res.statusCode = 200;
    });

    const reqReferers = new ExpiringMap({
      ttlMs: 5 * 60 * 1000,
      maxSize: 5000,
    });
    proxy.intercept({ phase: 'request' }, (req) => {
      try {
        const fullUrl = buildFullUrl(req);
        const headers = req.headers || {};
        const ref = headers['referer'] || headers['origin'] || '';
        if (ref) reqReferers.set(fullUrl, ref);
        const hostname = (req.hostname || '').toLowerCase();
        if (/(^|\.)finder\.video\.qq\.com$/i.test(hostname)) {
          const mediaKey = new URL(fullUrl).searchParams.get('encfilekey');
          if (mediaKey) currentWechatCaptureCoordinator.markActive(mediaKey);
        }
        // 视频号相关请求都强制关掉 br，让 hoxy 能解压 HTML/JSON
        if (
          hostname.indexOf('channels.weixin.qq.com') !== -1 ||
          hostname.indexOf('res.wx.qq.com') !== -1
        ) {
          const ae = (headers['accept-encoding'] || '').toString();
          if (ae.indexOf('br') !== -1) {
            req.headers['accept-encoding'] = ae.replace(/br,?\s*/gi, '').trim() || 'gzip, deflate';
          }
        }
      } catch (err) {
        info('req-intercept-err', String((err && err.message) || err));
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
        if (/\.(js|css|woff2?|ttf|png|jpg|jpeg|gif|webp|svg|ico|map)(\?|$)/i.test(req.url || ''))
          return;
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
        info('resp-tap-err', String((err && err.message) || err));
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
          debug(
            'finder-cdn-skip',
            hostname,
            'ct=' + contentType,
            'len=' + (contentLength || ''),
            fullUrl.slice(0, 180),
          );
          return;
        }
        if (hostname.indexOf('weixin') !== -1 || hostname.indexOf('qpic.cn') !== -1) return;
        if (!isVideoRequest(fullUrl, contentType)) return;

        const mediaKey = fullUrl.split('?')[0] || fullUrl;
        if (capturedMedia.has(mediaKey)) return;

        const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
        if (fileSize > 0 && fileSize < 100000) return;

        capturedMedia.set(mediaKey, true);
        stat.cdnHit++;
        const platform = getPlatformFromUrl(hostname);
        const reqHeaders = req.headers || {};
        const referer =
          reqReferers.get(fullUrl) || reqHeaders['referer'] || reqHeaders['origin'] || '';
        reqReferers.delete(fullUrl);
        let desc = platform ? platform + '视频' : '网络视频';
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
        info('cdn-intercept-err', String((err && err.message) || err));
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
          if (
            /\/api\/feed\/get_feed_info|\/web\/api\/feed\/get_feed_info|\/web\/api\/(get_page_info|get_object_by_id|object_info)/i.test(
              url,
            )
          ) {
            info(
              'feed-api',
              url.slice(0, 200),
              'len=' + body.length,
              'hasKey=' + (body.indexOf('decode_key') !== -1 || body.indexOf('decodeKey') !== -1),
            );
            debug('feed-api-body', body.slice(0, 4000));
            let json;
            try {
              json = JSON.parse(body);
            } catch (e) {
              info('feed-api-parse-err', String((e && e.message) || e));
              return;
            }
            // 递归找带 decode_key 的 media 对象；有 decode_key 才推 UI，否则加密视频下载无用
            const hits = walkFeedMedia(json);
            if (hits.length) {
              info(
                'feed-api-video-hit',
                'count=' + hits.length + ' first=' + hits[0].url.slice(0, 120),
              );
              // 注意：这里不再全量 sendCapture。一次 finderH5ExtTransfer 响应能返回整页 20+ 条 media，
              // 全部推给 UI 会导致个人主页一打开就冒 20 条卡片。注入脚本只上报候选，
              // 由主进程在 finder CDN 请求真正出现时完成全局配对。
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
          const isFeedPage =
            /\/web\/pages\/feed|\/finder-preview\/pages\/sph|\/finder\/|\/feed\//i.test(url);
          if (isFeedPage) {
            res.string = body.includes('</body>')
              ? body.replace('</body>', injection_html + '\n</body>')
              : body + injection_html;
            res.statusCode = 200;
            stat.injected++;
            info('inject-feed', url.slice(0, 180), 'len=' + res.string.length);
            return;
          }
          if (
            contentType.indexOf('text/html') === -1 &&
            contentType.indexOf('application/xhtml') === -1
          )
            return;
          const isHtml =
            body.trim().indexOf('<') === 0 &&
            (body.indexOf('<html') !== -1 ||
              body.indexOf('<!DOCTYPE') !== -1 ||
              body.indexOf('<body') !== -1);
          if (isHtml) {
            res.string = injectScriptToHtml(body);
            stat.injected++;
            debug('inject-html', url.slice(0, 180));
          }
        } catch (err) {
          info('channels-intercept-err', String((err && err.message) || err));
        }
      },
    );

    // === res.wx.qq.com：主 JS bundle 里追加脚本，兜底 HTML 注入未生效的情况 ===
    proxy.intercept({ phase: 'response', hostname: 'res.wx.qq.com', as: 'string' }, (req, res) => {
      try {
        const contentType = (res.headers && res.headers['content-type']) || '';
        if (req.url && req.url.includes('wvds.inject.js')) {
          res.string = WVDS_INJECT_SCRIPT;
          res.statusCode = 200;
          stat.injectionsSent++;
          info('serve-wvds-js', req.url.slice(0, 160));
          return;
        }
        if (
          contentType.indexOf('javascript') !== -1 ||
          (req.url && req.url.indexOf('.js') !== -1)
        ) {
          if (
            req.url &&
            (req.url.indexOf('polyfills') !== -1 ||
              req.url.indexOf('main.') !== -1 ||
              req.url.indexOf('runtime') !== -1 ||
              req.url.indexOf('vendor') !== -1 ||
              req.url.indexOf('bundle') !== -1 ||
              req.url.indexOf('finder') !== -1 ||
              /\/app[.-]/i.test(req.url))
          ) {
            res.string = (res.string || '') + '\n;' + WVDS_INJECT_SCRIPT;
            stat.injectionsSent++;
            debug('inject-js', req.url.slice(0, 180));
          }
        }
      } catch (err) {
        info('reswx-intercept-err', String((err && err.message) || err));
      }
    });
  });
}

let quitCleanupStarted = false;
app.on('before-quit', async (e) => {
  if (quitCleanupStarted) return;
  e.preventDefault();
  quitCleanupStarted = true;
  try {
    await shutdownServer();
    info('proxy', 'close proxy success');
  } catch (error) {}
  app.exit();
});
