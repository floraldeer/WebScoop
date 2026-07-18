import { dialog } from 'electron';
import log from 'electron-log';
import isDev from 'electron-is-dev';
// electron-updater 是 CommonJS 且带 __esModule 标记，webpack 打包后默认导出为 undefined，
// 必须用命名导入拿 autoUpdater。
import { autoUpdater } from 'electron-updater';

// 使用 electron-updater 做真正的自动更新（下载 + 退出时安装）。
// 需要 electron-builder 打包时生成 latest.yml / latest-mac.yml 并随 Release 发布。
export function initAutoUpdater() {
  if (isDev) {
    log.info('[updater] skipped in dev');
    return;
  }
  if (!autoUpdater) {
    log.info('[updater] autoUpdater unavailable, skipped');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  // 不自动强制安装，交由用户在提示框里确认后再安装，避免打断正在进行的下载/捕获。
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    log.info('[updater] error:', String((err && err.message) || err));
  });
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update available:', info?.version);
  });
  autoUpdater.on('update-not-available', () => {
    log.info('[updater] no update');
  });
  autoUpdater.on('update-downloaded', async (info) => {
    log.info('[updater] downloaded:', info?.version);
    const result = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['立即重启并更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      message: `新版本 ${info?.version || ''} 已下载完成`,
      detail: '是否立即重启应用完成更新？',
    });
    if (result === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    log.info('[updater] check failed:', String((err && err.message) || err));
  });
}
