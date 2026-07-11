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

// 把原始短链改造成能实际播放的电脑网页版 URL 的逻辑，改由 resolveAndSwitch 在后台异步执行，
// 见文件底部 —— 之前是同步 await 才第一次 loadURL，一旦短链解析超时小窗就白屏。

export async function openWechatBrowser(url) {
  const port = getCurrentProxyPort();
  if (!port) throw new Error('本地代理尚未启动，请稍后重试');

  const wantedTarget = url && /^https?:/i.test(url) ? url : 'https://channels.weixin.qq.com/';

  const ses = session.fromPartition('persist:wechat-scoop');
  await ses.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}` });
  ses.setCertificateVerifyProc((_req, cb) => cb(0));

  const loggedIn = await isLoggedIn(ses);
  // 未登录：桌面 UA 直接打开登录页扫码；
  // 已登录：立刻用 wantedTarget（可能是 /sph/ 或已是 /web/pages/feed）打开，
  //   页面加载的**同时**在后台异步跑短链解析，拿到 exportId 再切到真播放页；
  //   —— 之前是同步 await resolvePlayableUrl 才第一次 loadURL，一旦短链解析慢就白屏。
  const initialTarget = loggedIn ? wantedTarget : LOGIN_PAGE;
  const initialUA = loggedIn ? WX_UA : DESKTOP_UA;
  ses.setUserAgent(initialUA);

  log.info('[wxwin] open loggedIn=' + loggedIn, 'wanted=' + wantedTarget, 'initial=' + initialTarget);

  if (win && !win.isDestroyed()) {
    // 窗口可能被最小化或被主窗口遮挡：restore + show + moveTop + focus 一起来才能保证前置
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();
    // 若目标 URL 变了才重新 loadURL；同 URL 时用户可能只想把窗口拉回前台，避免打断当前播放
    const curUrl = win.webContents?.getURL?.() || '';
    if (curUrl !== initialTarget) {
      win.loadURL(initialTarget, { userAgent: initialUA });
    }
    if (loggedIn) resolveAndSwitch(win, ses, wantedTarget);
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
  // 立即切成 WX_UA 并把 wantedTarget 换成能播放的 /web/pages/feed 页。
  // 加防重入锁 —— cookies.on('changed') 会连续触发几十次，之前每次都 loadURL 会把页面初始化打断。
  let postLoginDone = false;
  const tryPostLoginRedirect = async () => {
    if (postLoginDone) return;
    if (!win || win.isDestroyed()) return;
    const curUrl = wc.getURL();
    if (!/login\.html/i.test(curUrl)) return;
    const nowLoggedIn = await isLoggedIn(ses);
    if (!nowLoggedIn) return;
    postLoginDone = true;
    log.info('[wxwin] login-detected, switching UA and resolving playable URL');
    ses.setUserAgent(WX_UA);
    win.setTitle('视频号');
    // 先直接把 wantedTarget 塞进去（能立刻显示"加载中"给用户），再异步解析拿 exportId 后切真播放页
    win.loadURL(wantedTarget, { userAgent: WX_UA });
    resolveAndSwitch(win, ses, wantedTarget);
  };
  wc.on('did-navigate', tryPostLoginRedirect);
  wc.on('did-navigate-in-page', tryPostLoginRedirect);
  ses.cookies.on('changed', tryPostLoginRedirect);

  win.on('closed', () => { win = null; });

  if (process.env.DEBUG_WX === '1') {
    wc.openDevTools({ mode: 'detach' });
  }

  win.loadURL(initialTarget, { userAgent: initialUA });
  // 已登录场景：后台异步解析短链，避免同步 await 卡住首次 loadURL
  if (loggedIn) resolveAndSwitch(win, ses, wantedTarget);
}

// 异步把 wantedTarget（可能是短链或 /sph/）解析成真播放页 /web/pages/feed?exportId=...，
// 拿到就切一次 loadURL；解析失败或超时就保持当前页不动。
async function resolveAndSwitch(targetWin, ses, wantedTarget) {
  try {
    if (!/weixin\.qq\.com/i.test(wantedTarget)) return;
    if (/\/web\/pages\/feed/i.test(wantedTarget)) return;
    const cookieHeader = await collectWechatCookies(ses);
    const resolved = await Promise.race([
      resolveWechatPlayableUrl(wantedTarget, { cookieHeader }),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!resolved || !resolved.playableUrl) return;
    if (resolved.playableUrl === wantedTarget) return;
    if (!targetWin || targetWin.isDestroyed()) return;
    log.info('[wxwin] resolved playableUrl=' + resolved.playableUrl.slice(0, 160));
    targetWin.loadURL(resolved.playableUrl, { userAgent: WX_UA });
  } catch (err) {
    log.warn('[wxwin] resolveAndSwitch fail:', String(err && err.message || err));
  }
}
