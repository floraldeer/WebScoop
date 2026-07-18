import { contextBridge, ipcRenderer } from 'electron';

const INVOKE_CHANNELS = new Set([
  'invoke_初始化信息',
  'invoke_开始初始化',
  'invoke_打开钥匙串信任引导',
  'invoke_启动服务',
  'invoke_选择下载位置',
  'invoke_解析链接',
  'invoke_在微信中打开',
  'invoke_解析视频号短链',
  'invoke_解析平台视频',
  'invoke_下载视频',
  'invoke_取消下载',
  'invoke_下载历史',
  'invoke_清空下载历史',
  'invoke_获取设置',
  'invoke_更新设置',
  'invoke_清理证书与缓存',
  'invoke_打开日志目录',
  'invoke_打开视频目录',
  'invoke_打开外部链接',
  'invoke_打开已下载文件',
]);

const EVENT_CHANNELS = new Set(['VIDEO_CAPTURE', 'e_进度变化']);

contextBridge.exposeInMainWorld('webscoop', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel is not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!EVENT_CHANNELS.has(channel) || typeof listener !== 'function') {
      throw new Error(`IPC event is not allowed: ${channel}`);
    }
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
