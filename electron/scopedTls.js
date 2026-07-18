import https from 'https';

const PATCH_MARK = Symbol.for('webscoop.scopedTlsPatch');

export function isRelaxedTlsHost(hostname = '') {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return (
    host === 'qq.com' ||
    host.endsWith('.qq.com') ||
    host === 'weixin.qq.com' ||
    host.endsWith('.weixin.qq.com') ||
    host === 'qpic.cn' ||
    host.endsWith('.qpic.cn') ||
    host === 'weixinbridge.com' ||
    host.endsWith('.weixinbridge.com')
  );
}

function getRequestHostname(input, options) {
  const optionHost = options?.hostname || options?.host;
  if (optionHost) return String(optionHost).split(':')[0];
  if (typeof input === 'string' || input instanceof URL) {
    try {
      return new URL(input).hostname;
    } catch (e) {
      return '';
    }
  }
  return String(input?.hostname || input?.host || '').split(':')[0];
}

export function installScopedTlsRelaxation() {
  if (https[PATCH_MARK]) return;
  const originalRequest = https.request;

  https.request = function scopedRequest(input, options, callback) {
    const hostname = getRequestHostname(input, typeof options === 'object' ? options : undefined);
    if (!isRelaxedTlsHost(hostname)) {
      return originalRequest.apply(this, arguments);
    }

    if (typeof input === 'object' && !(input instanceof URL)) {
      return originalRequest.call(
        this,
        { ...input, rejectUnauthorized: false },
        typeof options === 'function' ? options : callback,
      );
    }
    if (typeof options === 'function' || options === undefined) {
      return originalRequest.call(this, input, { rejectUnauthorized: false }, options);
    }
    return originalRequest.call(this, input, { ...options, rejectUnauthorized: false }, callback);
  };
  https[PATCH_MARK] = true;
}
