import { BrowserWindow, session } from 'electron';
import log from 'electron-log';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getCurrentProxyPort } from './proxyServer';
import { resolveWechatPlayableUrl } from './wechatFinder';

// 微信官方视频号 web 播放页只认电脑客户端 UA（Windows/Mac 微信内嵌 XWeb），
// 用 iPhone Safari + MicroMessenger UA 打开只会拿到"扫码/二维码引导"页。
// 尾部的 MicroMessenger/WindowsWechat 段是关键，缺失则被判为普通 Chrome、要求扫码。
const WX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 ' +
  'MicroMessenger/7.0.1 WindowsWechat(0x63090c33) XWEB/13947';

// 视频号 SPA 会检测 window.WeixinJSBridge / __wxjs_environment；缺任一个就会 bail out。
const PRELOAD_STUB = `
try {
  Object.defineProperty(window, '__wxjs_environment', { value: 'miniprogram', configurable: true });
} catch(e) {}
try {
  if (!window.WeixinJSBridge) {
    window.WeixinJSBridge = {
      invoke: function(name, params, cb) { try { cb && cb({ err_msg: name + ':ok' }); } catch(e) {} },
      on: function() {}, off: function() {}, call: function() {},
    };
  }
  if (!window.WeixinJSBridgeData) window.WeixinJSBridgeData = {};
  document.addEventListener('DOMContentLoaded', function() {
    try { document.dispatchEvent(new Event('WeixinJSBridgeReady')); } catch(e) {}
  });
} catch(e) {}
try { console.log('[wxpreload] stub ready ua=' + navigator.userAgent.slice(0, 80)); } catch(e) {}
`;

// channels.weixin.qq.com 登录首页：桌面 UA 才会弹出 QR 码，否则直接卡在移动端引导。
const LOGIN_PAGE = 'https://channels.weixin.qq.com/login.html';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let win = null;
let preloadPath = null;

function ensurePreload() {
  if (preloadPath && fs.existsSync(preloadPath)) return preloadPath;
  const p = path.join(os.tmpdir(), 'webscoop-wx-preload.js');
  fs.writeFileSync(p, PRELOAD_STUB, 'utf8');
  preloadPath = p;
  return p;
}

// 判定 channels.weixin.qq.com 是否已登录：cookie 中含 sessionid/wxuin/pass_ticket 任一即算已登录。
async function isLoggedIn(ses) {
  try {
    const cookies = await ses.cookies.get({ domain: '.weixin.qq.com' });
    return cookies.some((c) =>
      /^(sessionid|wxuin|pass_ticket|slave_user|data_ticket)$/i.test(c.name) && c.value
    );
  } catch (e) {
    return false;
  }
}

async function collectWechatCookies(ses) {
  try {
    const cookies = await ses.cookies.get({ domain: '.weixin.qq.com' });
    return cookies.map((c) => c.name + '=' + c.value).join('; ');
  } catch (e) {
    return '';
  }
}

// 把原始短链改造成能实际播放的电脑网页版 URL。
// 登录后，只有 /web/pages/feed?exportId=... 才会真正渲染播放器并拉视频流；
// /finder-preview/pages/sph?id=... 无论登录与否都是二维码引导页。
async function resolvePlayableUrl(inputUrl, ses) {
  if (!inputUrl) return 'https://channels.weixin.qq.com/';
  const cookieHeader = await collectWechatCookies(ses);
  try {
    const resolved = await resolveWechatPlayableUrl(inputUrl, { cookieHeader });
    if (resolved && resolved.playableUrl) {
      log.info('[wxwin] resolved playableUrl=' + resolved.playableUrl.slice(0, 160));
      return resolved.playableUrl;
    }
  } catch (err) {
    log.warn('[wxwin] resolvePlayableUrl fail:', String(err && err.message || err));
  }
  return inputUrl;
}

export async function openWechatBrowser(url) {
  const port = getCurrentProxyPort();
  if (!port) throw new Error('本地代理尚未启动，请稍后重试');

  const wantedTarget = url && /^https?:/i.test(url) ? url : 'https://channels.weixin.qq.com/';

  const ses = session.fromPartition('persist:wechat-scoop');
  await ses.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}` });
  ses.setCertificateVerifyProc((_req, cb) => cb(0));

  const loggedIn = await isLoggedIn(ses);
  // 未登录：桌面 UA 打开登录页，让用户扫码；登录成功后触发 tryPostLoginRedirect 再切 UA。
  // 已登录：先把短链换成 /web/pages/feed?exportId=... 真播放页，再用 WindowsWechat UA 打开。
  const initialTarget = loggedIn ? await resolvePlayableUrl(wantedTarget, ses) : LOGIN_PAGE;
  const initialUA = loggedIn ? WX_UA : DESKTOP_UA;
  ses.setUserAgent(initialUA);

  log.info('[wxwin] open loggedIn=' + loggedIn, 'wanted=' + wantedTarget, 'initial=' + initialTarget);

  if (win && !win.isDestroyed()) {
    win.focus();
    win.loadURL(initialTarget, { userAgent: initialUA });
    return;
  }

  const preload = ensurePreload();

  win = new BrowserWindow({
    width: 460,
    height: 900,
    title: loggedIn ? '视频号' : '视频号 - 请扫码登录',
    webPreferences: {
      session: ses,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      preload,
    },
  });

  const wc = win.webContents;

  wc.on('did-start-loading', () => log.info('[wxwin] start-loading'));
  wc.on('did-navigate', (_e, u, code) => log.info('[wxwin] did-navigate', code, u));
  wc.on('did-navigate-in-page', (_e, u) => log.info('[wxwin] navigate-in-page', u));
  wc.on('dom-ready', () => log.info('[wxwin] dom-ready', wc.getURL()));
  wc.on('did-finish-load', () => log.info('[wxwin] did-finish-load', wc.getURL()));
  wc.on('did-fail-load', (_e, code, desc, u) => log.warn('[wxwin] load-fail', code, desc, u));
  wc.on('render-process-gone', (_e, details) => log.warn('[wxwin] render-gone', JSON.stringify(details)));
  wc.on('console-message', (_e, level, msg) => {
    if (msg && msg.length) log.info('[wxwin][console]', level, (msg + '').slice(0, 500));
  });

  // 登录成功探测：URL 从 login.html 跳走 / 有 sessionid cookie 时，
  // 立即用 wechatFinder 把 wantedTarget 转成能播放的 /web/pages/feed 页并切 UA 载入。
  const tryPostLoginRedirect = async () => {
    if (!win || win.isDestroyed()) return;
    const curUrl = wc.getURL();
    if (!/login\.html/i.test(curUrl)) return;
    const nowLoggedIn = await isLoggedIn(ses);
    if (!nowLoggedIn) return;
    const playableUrl = await resolvePlayableUrl(wantedTarget, ses);
    log.info('[wxwin] login-detected, redirecting to', playableUrl);
    ses.setUserAgent(WX_UA);
    win.setTitle('视频号');
    win.loadURL(playableUrl, { userAgent: WX_UA });
  };
  wc.on('did-navigate', tryPostLoginRedirect);
  wc.on('did-navigate-in-page', tryPostLoginRedirect);
  ses.cookies.on('changed', tryPostLoginRedirect);

  win.on('closed', () => { win = null; });

  // DevTools 仅在环境变量 DEBUG_WX=1 时开启，避免正式使用时吓到用户
  if (process.env.DEBUG_WX === '1') {
    wc.openDevTools({ mode: 'detach' });
  }

  win.loadURL(initialTarget, { userAgent: initialUA });
}
