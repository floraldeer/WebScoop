import { app, BrowserWindow, Menu, shell } from 'electron';
import log from 'electron-log';
import CONFIG from './const';
import initIPC, { setWin } from './ipc';
import { initAutoUpdater } from './autoUpdater';

app.commandLine.appendSwitch('--no-proxy-server');
// 之前把这两个事件全静默了，导致 hoxy intercept 里任何异常都会被"吃掉"，
// 主进程日志看不到任何 wx-req/feed-api 输出。改成打到 electron-log，保留原来的
// "app 不因未处理异常闪退"的语义，但让排错有迹可循。
process.on('uncaughtException', (err) => {
  try {
    log.error('[uncaughtException]', (err && err.stack) || err);
  } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
  try {
    log.error('[unhandledRejection]', (reason && reason.stack) || reason);
  } catch (e) {}
});

function createWindow() {
  Menu.setApplicationMenu(null);
  initAutoUpdater();

  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: CONFIG.PRELOAD_PATH,
      webSecurity: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  setWin(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const appBaseUrl = new URL('.', CONFIG.APP_START_URL).toString();
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(appBaseUrl)) event.preventDefault();
  });
  mainWindow.loadURL(CONFIG.APP_START_URL);
  CONFIG.IS_DEV && mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  initIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
