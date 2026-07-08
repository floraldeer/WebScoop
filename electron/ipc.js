import { ipcMain, dialog } from 'electron';
import log from 'electron-log';
import { throttle } from 'lodash';
import axios from 'axios';
import { startServer } from './proxyServer';
import { installCert, checkCertInstalled } from './cert';
import { downloadFile } from './utils';
import { parsePlatformVideo } from './platformParsers';

let win;

export default function initIPC() {
  ipcMain.handle('invoke_初始化信息', async (event, arg) => {
    return checkCertInstalled();
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
}

export function setWin(w) {
  win = w;
}
