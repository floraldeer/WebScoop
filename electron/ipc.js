import fs from 'fs';
import { execFile } from 'child_process';
import { ipcMain, dialog, shell, app, clipboard } from 'electron';
import log from 'electron-log';
import { throttle } from 'lodash';
import axios from 'axios';
import CONFIG from './const';
import { startServer, setWechatCaptureTarget, shutdownServer } from './proxyServer';
import { installCert, checkCertInstalled, CERT_STATUS } from './cert';
import { downloadFile, getAvailableFilePath } from './utils';
import { parsePlatformVideo } from './platformParsers';
import { parseWechatShortLink } from './wechatFinder';
import { getHistory, addHistoryRecord, clearHistory } from './downloadHistory';
import { getSettings, updateSettings } from './appSettings';

let win;
let lastDownloadDir = '';
const downloadedFiles = new Set();
// 正在进行的下载：fullFileName -> AbortController，供"取消下载"使用。
const activeDownloads = new Map();

// 手动信任兜底：打开「钥匙串访问」应用本身，而不是打开 .pem。
// 打开 .pem 会弹出多余的「添加证书」框（证书其实早已在钥匙串里），且那里并不能设信任。
// 证书 CN 已复制到剪贴板，用户可在钥匙串里直接搜索、双击并设为「始终信任」。
function openKeychainAccess() {
  return new Promise((resolve) => {
    execFile('open', ['-b', 'com.apple.keychainaccess'], (error) => resolve(error));
  });
}

export default function initIPC() {
  ipcMain.handle('invoke_初始化信息', async (event, arg) => {
    return await checkCertInstalled();
  });

  ipcMain.handle('invoke_开始初始化', async (event, arg) => {
    const result = await installCert(false);
    // 正常路径下一键会弹原生授权框并直接把信任设好（trusted）。仅当授权后仍未验过时
    // （installed_untrusted，少见）才引导手动：复制 CN 并打开「钥匙串访问」让用户设为
    // 「始终信任」。取消授权则是 failed，不打扰、停在空闲页可再点一键。
    if (result.status === CERT_STATUS.INSTALLED_UNTRUSTED) {
      if (result.commonName) clipboard.writeText(result.commonName);
      if (process.platform === 'darwin') openKeychainAccess();
    }
    return result;
  });

  ipcMain.handle('invoke_打开钥匙串信任引导', async (event, commonName) => {
    if (commonName) clipboard.writeText(commonName);
    const error = await openKeychainAccess();
    if (error) throw new Error(String(error.message || error));
    return true;
  });

  ipcMain.handle('invoke_启动服务', async (event, arg) => {
    // 证书未受信时不启动系统代理：否则 HTTPS 会因不受信证书而全部握手失败，
    // 反而污染用户网络。这里作为兜底门禁（前端理论上已过初始化检测）。
    const trusted = await checkCertInstalled();
    if (!trusted) {
      throw new Error('根证书尚未被系统信任，无法启动代理服务');
    }
    return startServer({
      win: win,
      setProxyErrorCallback: (err) => {
        log.error('开启代理失败', err);
      },
    });
  });

  ipcMain.handle('invoke_选择下载位置', async (event, arg) => {
    const defaultPath = getSettings().downloadDir || lastDownloadDir || undefined;
    const result = dialog.showOpenDialogSync({
      title: '保存',
      properties: ['openDirectory'],
      defaultPath,
    });

    if (!result?.[0]) {
      throw new Error('取消');
    }

    return result?.[0];
  });

  ipcMain.handle('invoke_解析链接', async (event, inputUrl) => {
    let url = inputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      const resp = await axios.get(url, {
        maxRedirects: 10,
        validateStatus: () => true,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 MicroMessenger/3.8.7.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (resp.request && resp.request.res && resp.request.res.responseUrl) {
        return resp.request.res.responseUrl;
      }
      return url;
    } catch (e) {
      if (
        e.response &&
        e.response.request &&
        e.response.request.res &&
        e.response.request.res.responseUrl
      ) {
        return e.response.request.res.responseUrl;
      }
      return url;
    }
  });

  ipcMain.handle('invoke_在微信中打开', async (event, input) => {
    const target = typeof input === 'string' ? { url: input } : input || {};
    const url = String(target.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('视频号链接无效');
    }

    setWechatCaptureTarget({
      shareUrl: url,
      description: target.description || '',
      uploader: target.uploader || '',
      shortUri: target.shortUri || '',
      dynamicExportId: target.dynamicExportId || '',
    });
    clipboard.writeText(url);
    try {
      await shell.openExternal('weixin://');
      return { copied: true, launched: true };
    } catch (err) {
      log.error('launch desktop wechat failed:', err);
      throw new Error('链接已复制，但未能唤起桌面微信，请确认微信已安装');
    }
  });

  // 视频号短链直接调 API 拿元信息（作者/描述/封面+可能的视频 URL），
  // 拿不到 videoUrl 就返回元信息卡片让用户在 UI 里看到内容而不是白屏。
  ipcMain.handle('invoke_解析视频号短链', async (event, url) => {
    try {
      return await parseWechatShortLink(url);
    } catch (err) {
      log.error('parse wechat short link failed:', err);
      throw new Error(err?.message || '视频号短链解析失败');
    }
  });

  ipcMain.handle('invoke_解析平台视频', async (event, inputUrl) => {
    try {
      return await parsePlatformVideo(inputUrl);
    } catch (err) {
      log.error('parse platform video error:', err);
      throw new Error(err?.message || '视频解析失败，请确认链接是否有效');
    }
  });

  ipcMain.handle(
    'invoke_下载视频',
    async (
      event,
      { url, decodeKey, savePath, description, noDecrypt, referer, platform, size },
    ) => {
      const fileName =
        String(description || '')
          .replace(/[\\/:*?"<>|]/g, '')
          .trim()
          .slice(0, 160) || String(Date.now());
      const fullFileName = getAvailableFilePath(savePath, fileName);

      if (savePath) lastDownloadDir = savePath;

      const controller = new AbortController();
      activeDownloads.set(fullFileName, controller);

      return downloadFile(
        url,
        decodeKey,
        fullFileName,
        throttle((value) => win?.webContents?.send?.('e_进度变化', value), 200),
        { noDecrypt, referer, signal: controller.signal },
      )
        .then((result) => {
          downloadedFiles.add(result.fullFileName);
          addHistoryRecord({ fullFileName: result.fullFileName, description, platform, size, url });
          return result;
        })
        .catch((err) => {
          if (err?.__aborted) {
            log.info('download canceled:', fullFileName);
            const cancelErr = new Error('已取消下载');
            cancelErr.canceled = true;
            throw cancelErr;
          }
          log.error('download error:', err);
          throw err;
        })
        .finally(() => {
          activeDownloads.delete(fullFileName);
        });
    },
  );

  ipcMain.handle('invoke_取消下载', async () => {
    for (const controller of activeDownloads.values()) controller.abort();
    activeDownloads.clear();
    return true;
  });

  ipcMain.handle('invoke_下载历史', async () => getHistory());
  ipcMain.handle('invoke_清空下载历史', async () => clearHistory());

  ipcMain.handle('invoke_获取设置', async () => getSettings());
  ipcMain.handle('invoke_更新设置', async (_event, patch) => updateSettings(patch));

  // 清理证书与本地缓存：先恢复系统代理并停代理，再删除本机 CA 目录。
  ipcMain.handle('invoke_清理证书与缓存', async () => {
    await shutdownServer().catch(() => {});
    await fs.promises.rm(CONFIG.CERT_PATH, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(CONFIG.INSTALL_CERT_FLAG, { force: true }).catch(() => {});
    log.info('[maintenance] cert & cache cleared');
    return true;
  });

  ipcMain.handle('invoke_打开日志目录', async () => {
    const logFile = log.transports.file.getFile ? log.transports.file.getFile().path : '';
    const target = logFile ? require('path').dirname(logFile) : app.getPath('logs');
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return target;
  });

  // 打开视频存放目录：优先上次下载目录，否则回退系统下载目录
  ipcMain.handle('invoke_打开视频目录', async () => {
    const target = lastDownloadDir || app.getPath('downloads');
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return target;
  });

  ipcMain.handle('invoke_打开外部链接', async (_event, inputUrl) => {
    const url = new URL(String(inputUrl || ''));
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('只允许打开 HTTP(S) 链接');
    }
    await shell.openExternal(url.toString());
    return true;
  });

  ipcMain.handle('invoke_打开已下载文件', async (_event, fullFileName) => {
    if (!downloadedFiles.has(fullFileName)) {
      throw new Error('只能打开本次运行中已完成下载的文件');
    }
    const error = await shell.openPath(fullFileName);
    if (error) throw new Error(error);
    return true;
  });
}

export function setWin(w) {
  win = w;
}
