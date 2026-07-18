import log from 'electron-log';

// DEBUG_WX=1 时才输出高频诊断日志（静态资源明细、心跳等），避免刷屏正式包。
export const DEBUG_WX = process.env.DEBUG_WX === '1';

export function info(tag, ...args) {
  try {
    log.info('[' + tag + ']', ...args);
  } catch (e) {}
  try {
    console.log('[' + tag + ']', ...args);
  } catch (e) {}
}

export function debug(tag, ...args) {
  if (!DEBUG_WX) return;
  info(tag, ...args);
}
