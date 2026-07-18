import path from 'path';
import isDev from 'electron-is-dev';
import url from 'url';
import os from 'os';
import { app } from 'electron';

const APP_PATH = app.getAppPath();
// 对于一些 shell 去执行的文件，asar 目录下无法使用。配合 extraResources
const EXECUTABLE_PATH = path.join(
  APP_PATH.indexOf('app.asar') > -1
    ? APP_PATH.substring(0, APP_PATH.indexOf('app.asar'))
    : APP_PATH,
  'public',
);
const HOME_PATH = path.join(os.homedir(), '.webscoop');
const CERT_PATH = path.join(HOME_PATH, 'cert');

export default {
  APP_START_URL: isDev
    ? 'http://localhost:3000'
    : url.format({
        pathname: path.join(APP_PATH, './build/index.html'),
        protocol: 'file:',
        slashes: true,
      }),
  IS_DEV: isDev,
  EXECUTABLE_PATH,
  HOME_PATH,
  CERT_PATH,
  CERT_PRIVATE_PATH: path.join(CERT_PATH, 'private.pem'),
  CERT_PUBLIC_PATH: path.join(CERT_PATH, 'public.pem'),
  CERT_IDENTITY_PATH: path.join(CERT_PATH, 'identity.json'),
  LEGACY_CERT_COMMON_NAME: 'lecepin-2022-05-19',
  INSTALL_CERT_FLAG: path.join(HOME_PATH, './installed.lock'),
  PROXY_STATE_PATH: path.join(HOME_PATH, 'proxy-state.json'),
  PRELOAD_PATH: path.join(APP_PATH, 'build-electron', 'preload.js'),
  APP_CN_NAME: '拾海',
  APP_EN_NAME: 'WebScoop',
  REGEDIT_VBS_PATH: path.join(EXECUTABLE_PATH, './regedit-vbs'),
  OPEN_SSL_BIN_PATH: path.join(EXECUTABLE_PATH, './openssl/openssl.exe'),
  OPEN_SSL_CNF_PATH: path.join(EXECUTABLE_PATH, './openssl/openssl.cnf'),
};
