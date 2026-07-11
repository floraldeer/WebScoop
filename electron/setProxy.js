import { exec } from 'child_process';
import regedit from 'regedit';
import CONFIG from './const';

regedit.setExternalVBSLocation(CONFIG.REGEDIT_VBS_PATH);

export async function setProxy(host, port) {
  if (process.platform === 'darwin') {
    const networks = await getMacAvailableNetworks();

    if (networks.length === 0) {
      throw 'no network';
    }

    // 视频号视频流走 http://finder.video.qq.com（明文 HTTP），因此必须同时设置
    // HTTP 代理(-setwebproxy) 和 HTTPS 代理(-setsecurewebproxy)，都指向本地 hoxy 端口，
    // 否则大量 HTTP 视频请求会绕过代理导致抓不到（"看了很多只抓到少数"的根因）。
    const run = (cmd) =>
      new Promise((resolve, reject) => {
        exec(cmd, (error) => (error ? reject(null) : resolve(true)));
      });

    return Promise.all(
      networks.map(async (network) => {
        await run(`networksetup -setwebproxy "${network}" ${host} ${port}`);
        await run(`networksetup -setsecurewebproxy "${network}" ${host} ${port}`);
        return network;
      }),
    );
  } else {
    const valuesToPut = {
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings': {
        ProxyServer: {
          value: `${host}:${port}`,
          type: 'REG_SZ',
        },
        ProxyEnable: {
          value: 1,
          type: 'REG_DWORD',
        },
      },
    };
    return regedit.promisified.putValue(valuesToPut);
  }
}

export async function closeProxy() {
  if (process.platform === 'darwin') {
    const networks = await getMacAvailableNetworks();

    if (networks.length === 0) {
      throw 'no network';
    }

    // 关闭时必须同时关掉 HTTP 与 HTTPS 代理，否则退出后用户网络仍被劫持到已失效端口。
    const run = (cmd) =>
      new Promise((resolve) => {
        exec(cmd, () => resolve(true));
      });

    return Promise.all(
      networks.map(async (network) => {
        await run(`networksetup -setwebproxystate "${network}" off`);
        await run(`networksetup -setsecurewebproxystate "${network}" off`);
        return network;
      }),
    );
  } else {
    const valuesToPut = {
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings': {
        ProxyEnable: {
          value: 0,
          type: 'REG_DWORD',
        },
      },
    };
    return regedit.promisified.putValue(valuesToPut);
  }
}

function getMacAvailableNetworks() {
  return new Promise((resolve, reject) => {
    exec('networksetup -listallnetworkservices', (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        Promise.all(
          stdout
            .toString()
            .split('\n')
            .map(network => {
              return new Promise(resolve => {
                exec(
                  `networksetup getinfo "${network}" | grep "^IP address:\\s\\d"`,
                  (error, stdout) => {
                    if (error) {
                      resolve(null);
                    } else {
                      resolve(stdout ? network : null);
                    }
                  },
                );
              });
            }),
        ).then(networks => {
          resolve(networks.filter(Boolean));
        });
      }
    });
  });
}
