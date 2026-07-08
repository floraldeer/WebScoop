import { get } from 'axios';
import { app, dialog, shell } from 'electron';
import semver from 'semver';
import fs from 'fs';
import {getDecryptionArray} from './decrypt';
import {Transform, PassThrough } from 'stream';

function checkUpdate(
  packageUrl = 'https://raw.githubusercontent.com/lecepin/electron-react-tpl/master/package.json',
  downloadUrl = 'https://github.com/lecepin/electron-react-tpl/releases',
) {
  get(packageUrl)
    .then(({ data }) => {
      if (semver.gt(data?.version, app.getVersion())) {
        const result = dialog.showMessageBoxSync({
          message: '发现新版本，是否更新？',
          type: 'question',
          cancelId: 1,
          defaultId: 0,
          buttons: ['进入新版本下载页面', '取消'],
        });

        if (result === 0 && downloadUrl) {
          shell.openExternal(downloadUrl);
        }
      }
    })
    .catch(err => {});
}



function xorTransform(decryptionArray) {
  let processedBytes = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      if (processedBytes < decryptionArray.length) {
        let remaining = Math.min(decryptionArray.length - processedBytes, chunk.length);
        for (let i = 0; i < remaining; i++) {
          chunk[i] = chunk[i] ^ decryptionArray[processedBytes + i];
        }
        processedBytes += remaining;
      }
      this.push(chunk);
      callback();
    }
  });
}

function downloadFile(url, decodeKey, fullFileName, progressCallback, options = {}) {
  const { noDecrypt = false, referer = '' } = options;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (referer) {
    headers['Referer'] = referer;
    headers['Origin'] = referer.split('/').slice(0, 3).join('/');
  }

  return get(url, {
    responseType: 'stream',
    headers,
  }).then(({ data, headers: respHeaders }) => {
    let currentLen = 0;
    const totalLen = respHeaders['content-length'];

    return new Promise((resolve, reject) => {
      data.on('data', ({ length }) => {
        currentLen += length;
        progressCallback?.(Math.round((currentLen / totalLen) * 100));
      });

      data.on('error', err => reject(err));

      const outputStream = fs.createWriteStream(fullFileName);
      outputStream.on('finish', () => {
        resolve({
          fullFileName,
          totalLen,
        });
      });
      outputStream.on('error', err => reject(err));

      if (noDecrypt || !decodeKey) {
        data.pipe(outputStream);
      } else {
        const xorStream = xorTransform(getDecryptionArray(decodeKey));
        data.pipe(xorStream).pipe(outputStream);
      }
    });
  });
}

export { checkUpdate, downloadFile };
