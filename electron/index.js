import { app, BrowserWindow, Menu } from 'electron';
import CONFIG from './const';
import { checkUpdate } from './utils';
import initIPC, { setWin } from './ipc';

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

function createWindow() {
  Menu.setApplicationMenu(null);
  checkUpdate(
    'https://cdn.jsdelivr.net/gh/lecepin/WeChatVideoDownloader/package.json',
    'https://github.com/lecepin/WeChatVideoDownloader/releases',
  );

  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.session.setProxy({ proxyRules: 'direct://' });

  mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
  });

  setWin(mainWindow);
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

app.on('web-contents-created', (event, contents) => {
  contents.session.setProxy({ proxyRules: 'direct://' });
  contents.on('certificate-error', (event, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
  });
  contents.session.setCertificateVerifyProc((request, callback) => {
    callback(0);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
