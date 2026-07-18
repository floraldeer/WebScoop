import fs from 'fs';
import { execFile } from 'child_process';
import regedit from 'regedit';
import CONFIG from './const';
import { parseMacNetworkServices, parseMacProxyState } from './proxyState';

const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

regedit.setExternalVBSLocation(CONFIG.REGEDIT_VBS_PATH);

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
      } else {
        resolve(String(stdout || ''));
      }
    });
  });
}

async function readProxySnapshot() {
  try {
    return JSON.parse(await fs.promises.readFile(CONFIG.PROXY_STATE_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function writeProxySnapshot(snapshot) {
  await fs.promises.mkdir(CONFIG.HOME_PATH, { recursive: true, mode: 0o700 });
  const tempPath = `${CONFIG.PROXY_STATE_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tempPath, CONFIG.PROXY_STATE_PATH);
}

async function deleteProxySnapshot() {
  await fs.promises.unlink(CONFIG.PROXY_STATE_PATH).catch(() => {});
}

async function getMacProxyState(network, secure) {
  const command = secure ? '-getsecurewebproxy' : '-getwebproxy';
  return parseMacProxyState(await execFileAsync('networksetup', [command, network]));
}

async function setMacProxyState(network, secure, state) {
  const setCommand = secure ? '-setsecurewebproxy' : '-setwebproxy';
  const stateCommand = secure ? '-setsecurewebproxystate' : '-setwebproxystate';
  if (state.server && state.port) {
    await execFileAsync('networksetup', [setCommand, network, state.server, String(state.port)]);
  }
  await execFileAsync('networksetup', [stateCommand, network, state.enabled ? 'on' : 'off']);
}

function isOwnedProxy(state, applied) {
  return (
    !!state?.enabled &&
    state.server === applied?.host &&
    Number(state.port) === Number(applied?.port)
  );
}

async function getMacAvailableNetworks() {
  const services = parseMacNetworkServices(
    await execFileAsync('networksetup', ['-listallnetworkservices']),
  );
  const available = [];
  for (const network of services) {
    try {
      const info = await execFileAsync('networksetup', ['-getinfo', network]);
      if (/^IP address:\s*(?!none\b)\S+/im.test(info)) available.push(network);
    } catch (e) {}
  }
  return available;
}

async function restoreMacSnapshot(snapshot) {
  const failedNetworks = [];
  for (const [network, original] of Object.entries(snapshot.services || {})) {
    let currentWeb;
    let currentSecure;
    try {
      currentWeb = await getMacProxyState(network, false);
      currentSecure = await getMacProxyState(network, true);
    } catch (e) {
      failedNetworks.push(network);
      continue;
    }
    if (isOwnedProxy(currentWeb, snapshot.applied)) {
      await setMacProxyState(network, false, original.web);
    }
    if (isOwnedProxy(currentSecure, snapshot.applied)) {
      await setMacProxyState(network, true, original.secure);
    }
  }
  if (failedNetworks.length) {
    throw new Error(`以下网络服务的代理状态恢复失败：${failedNetworks.join('、')}`);
  }
  await deleteProxySnapshot();
}

async function getWindowsProxyState() {
  const result = await regedit.promisified.list(REGISTRY_KEY);
  const values = result[REGISTRY_KEY]?.values || {};
  return {
    proxyEnable: values.ProxyEnable || null,
    proxyServer: values.ProxyServer || null,
  };
}

async function restoreWindowsSnapshot(snapshot) {
  const current = await getWindowsProxyState().catch(() => null);
  if (
    current?.proxyEnable?.value !== 1 ||
    current?.proxyServer?.value !== `${snapshot.applied.host}:${snapshot.applied.port}`
  ) {
    await deleteProxySnapshot();
    return;
  }

  const values = {};
  if (snapshot.original.proxyEnable) {
    values.ProxyEnable = snapshot.original.proxyEnable;
  }
  if (snapshot.original.proxyServer) {
    values.ProxyServer = snapshot.original.proxyServer;
  }
  if (Object.keys(values).length) {
    await regedit.promisified.putValue({ [REGISTRY_KEY]: values });
  }
  const deleteValues = [];
  if (!snapshot.original.proxyEnable) {
    deleteValues.push(`${REGISTRY_KEY}\\ProxyEnable`);
  }
  if (!snapshot.original.proxyServer) {
    deleteValues.push(`${REGISTRY_KEY}\\ProxyServer`);
  }
  if (deleteValues.length) {
    await regedit.promisified.deleteValue(deleteValues);
  }
  await deleteProxySnapshot();
}

async function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.platform === 'darwin') {
    await restoreMacSnapshot(snapshot);
  } else if (snapshot.platform === 'win32') {
    await restoreWindowsSnapshot(snapshot);
  }
}

async function restoreStaleSnapshot() {
  await restoreSnapshot(await readProxySnapshot());
}

export async function setProxy(host, port) {
  await restoreStaleSnapshot();

  if (process.platform === 'darwin') {
    const networks = await getMacAvailableNetworks();
    if (!networks.length) throw new Error('未找到可用网络服务');

    const services = {};
    for (const network of networks) {
      services[network] = {
        web: await getMacProxyState(network, false),
        secure: await getMacProxyState(network, true),
      };
    }
    const snapshot = {
      version: 1,
      platform: 'darwin',
      applied: { host, port },
      services,
    };
    await writeProxySnapshot(snapshot);
    try {
      for (const network of networks) {
        const state = { enabled: true, server: host, port };
        await setMacProxyState(network, false, state);
        await setMacProxyState(network, true, state);
      }
    } catch (error) {
      await restoreMacSnapshot(snapshot);
      throw error;
    }
    return networks;
  }

  if (process.platform === 'win32') {
    const original = await getWindowsProxyState();
    const snapshot = {
      version: 1,
      platform: 'win32',
      applied: { host, port },
      original,
    };
    await writeProxySnapshot(snapshot);
    try {
      await regedit.promisified.putValue({
        [REGISTRY_KEY]: {
          ProxyServer: {
            value: `${host}:${port}`,
            type: 'REG_SZ',
          },
          ProxyEnable: {
            value: 1,
            type: 'REG_DWORD',
          },
        },
      });
    } catch (error) {
      await restoreWindowsSnapshot(snapshot);
      throw error;
    }
    return true;
  }

  throw new Error(`暂不支持 ${process.platform} 系统代理`);
}

export async function closeProxy() {
  await restoreSnapshot(await readProxySnapshot());
}
