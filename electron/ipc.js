import { ipcMain, dialog, shell, app, clipboard } from 'electron';
import log from 'electron-log';
import { throttle } from 'lodash';
import axios from 'axios';
import { startServer, setWechatCaptureTarget } from './proxyServer';
import { installCert, checkCertInstalled } from './cert';
import { downloadFile } from './utils';
import { parsePlatformVideo } from './platformParsers';
import { openWechatBrowser } from './wechatBrowser';
import { parseWechatShortLink } from './wechatFinder';

let win;
let lastDownloadDir = '';

export default function initIPC() {
  ipcMain.handle('invoke_初始化信息', async (event, arg) => {
    return await checkCertInstalled();
  });

  ipcMain.handle('invoke_开始初始化', (event, arg) => {
    return installCert(false);
  });

  ipcMain.handle('invoke_启动服务', async (event, arg) => {
    return startServer({
      win: win,
      setProxyErrorCallback: err => {
        console.log('开启代理失败', err);
      },
    });
  });

  ipcMain.handle('invoke_选择下载位置', async (event, arg) => {
    const result = dialog.showOpenDialogSync({ title: '保存', properties: ['openDirectory'] });

    if (!result?.[0]) {
      throw '取消';
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
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 MicroMessenger/3.8.7.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      if (resp.request && resp.request.res && resp.request.res.responseUrl) {
        return resp.request.res.responseUrl;
      }
      return url;
    } catch (e) {
      if (e.response && e.response.request && e.response.request.res && e.response.request.res.responseUrl) {
        return e.response.request.res.responseUrl;
      }
      return url;
    }
  });

  ipcMain.handle('invoke_打开视频号浏览器', async (event, url) => {
    try {
      await openWechatBrowser(url);
      return true;
    } catch (err) {
      log.error('open wechat browser failed:', err);
      throw new Error(err?.message || '打开视频号浏览器失败');
    }
  });

  ipcMain.handle('invoke_在微信中打开', async (event, input) => {
    const target = typeof input === 'string' ? { url: input } : (input || {});
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

  ipcMain.handle('invoke_下载视频', async (event, { url, decodeKey, savePath, description, noDecrypt, referer }) => {
    let fileName = description?.replaceAll?.(/\\|\/|:|\*|\?|"|<|>|\|/g, '') || Date.now();

    console.log('description:', description);
    console.log('fileName:', fileName);
    console.log('url:', url);
    console.log('noDecrypt:', noDecrypt);

    if (savePath) lastDownloadDir = savePath;

    return downloadFile(
      url,
      decodeKey,
      `${savePath}/${fileName}.mp4`,
      throttle(value => win?.webContents?.send?.('e_进度变化', value), 200),
      { noDecrypt, referer },
    ).catch(err => {
      console.error('download error:', err);
      throw err;
    });
  });

  // 打开视频存放目录：优先上次下载目录，否则回退系统下载目录
  ipcMain.handle('invoke_打开视频目录', async () => {
    const target = lastDownloadDir || app.getPath('downloads');
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return target;
  });
}

export function setWin(w) {
  win = w;
}
