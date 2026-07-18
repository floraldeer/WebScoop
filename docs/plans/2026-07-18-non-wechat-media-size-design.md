# 非视频号平台媒体大小探测设计

## 问题

小红书和快手专用页面解析器能提取可下载 URL，但返回结果把 `size` 固定为 `0`，因此列表显示“未知”。现有候选校验已经使用 `Range: bytes=0-1` 请求媒体，只验证类型而没有读取响应中的总长度。

## 方案

扩展非微信平台的媒体 URL 检查结果，从标准响应头读取大小：

- 优先解析 `Content-Range` 的总长度，例如 `bytes 0-1/12345678`。
- 对返回完整资源的 `200` 响应读取 `Content-Length`。
- 兼容对象存储常见的 `x-file-size`、`x-content-length` 和 `x-oss-object-size`。
- `206` 响应没有总长度时不把分块的 `Content-Length` 误认为完整文件大小。

小红书拿到专用解析 URL 后执行一次现有 Range 探测，把获得的大小写入解析结果。快手页面会在 `window.INIT_STATE` 的 `photo.manifest.adaptationSet[].representation[]` 中返回精确 `fileSize`，因此快手优先用 `JSON.parse` 读取结构化页面状态，并按 `mainMvUrls[0]` 的 URL 路径匹配对应 representation；页面字段缺失时再使用 Range 探测。两种探测都失败仍返回原 URL 和 `size: 0`，不阻断下载。

## 隔离边界

改动仅位于 `electron/platformParsers.js` 的 page parser 路径。微信视频号配置使用 `parser: "capture"`，在进入页面解析和大小探测前已经返回，因此不会调用新增逻辑，也不修改 `proxyServer.js`、`wechatCaptureCoordinator.js`、`decodeKey` 或下载解密代码。
