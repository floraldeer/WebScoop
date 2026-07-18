import { get } from 'axios';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import { getDecryptionArray } from './decrypt';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

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
    },
  });
}

function getAvailableFilePath(directory, baseName, extension = '.mp4') {
  let index = 0;
  let candidate;
  do {
    const suffix = index ? ` (${index})` : '';
    candidate = path.join(directory, `${baseName}${suffix}${extension}`);
    index++;
  } while (fs.existsSync(candidate));
  return candidate;
}

const isRetriableError = (error) => {
  if (error?.__aborted) return false;
  const code = String(error?.code || '');
  const status = error?.response?.status;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code))
    return true;
  // 5xx / 429 视为临时故障，可重试
  if (status && (status >= 500 || status === 429)) return true;
  return false;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadOnce(url, decodeKey, fullFileName, progressCallback, options, signal) {
  const { noDecrypt = false, referer = '' } = options;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  if (referer) {
    headers['Referer'] = referer;
    try {
      headers['Origin'] = new URL(referer).origin;
    } catch (e) {}
  }

  let data;
  let outputStream;
  let fileCreated = false;
  try {
    const response = await get(url, {
      responseType: 'stream',
      headers,
      signal,
    });
    data = response.data;
    const respHeaders = response.headers;
    let currentLen = 0;
    const totalLen = Number(respHeaders['content-length'] || 0);
    const progressStream = new Transform({
      transform(chunk, encoding, callback) {
        currentLen += chunk.length;
        if (totalLen > 0) {
          progressCallback?.(Math.min(100, Math.round((currentLen / totalLen) * 100)));
        }
        callback(null, chunk);
      },
    });
    const fileHandle = await fs.promises.open(fullFileName, 'wx', 0o644);
    fileCreated = true;
    outputStream = fileHandle.createWriteStream();
    const streams = [data, progressStream];
    if (!noDecrypt && decodeKey) {
      streams.push(xorTransform(getDecryptionArray(decodeKey)));
    }
    streams.push(outputStream);
    await pipeline(...streams, { signal });
    return {
      fullFileName,
      totalLen,
    };
  } catch (error) {
    data?.destroy?.();
    outputStream?.destroy?.();
    if (fileCreated) {
      await fs.promises.unlink(fullFileName).catch(() => {});
    }
    if (signal?.aborted) error.__aborted = true;
    throw error;
  }
}

// 带有限重试的下载：网络类临时故障最多重试 maxRetries 次；支持 AbortSignal 取消。
async function downloadFile(url, decodeKey, fullFileName, progressCallback, options = {}) {
  const { maxRetries = 2, signal } = options;
  let attempt = 0;
  for (;;) {
    try {
      return await downloadOnce(url, decodeKey, fullFileName, progressCallback, options, signal);
    } catch (error) {
      if (signal?.aborted || error?.__aborted) throw error;
      if (attempt >= maxRetries || !isRetriableError(error)) throw error;
      attempt += 1;
      log.info(
        `[download] retry ${attempt}/${maxRetries} after error:`,
        String(error?.message || error),
      );
      await delay(800 * attempt);
    }
  }
}

export { downloadFile, getAvailableFilePath };
