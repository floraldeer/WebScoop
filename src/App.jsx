import { useState, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { Table, Button, Progress, Alert, Input, Space, Typography, Tag, Tooltip, message } from 'antd';
import { shell, ipcRenderer } from 'electron';
import {
  DownloadOutlined,
  EyeOutlined,
  ClearOutlined,
  FormatPainterOutlined,
  RedoOutlined,
  LinkOutlined,
  StarOutlined,
  LoadingOutlined,
  VideoCameraOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import fsm from './fsm';

import './App.less';
const { Text, Title, Paragraph } = Typography;

const platformColors = {
  '微信视频号': '#07c160',
  '抖音': '#000000',
  '快手': '#ff4906',
  '小红书': '#fe2c55',
  'B站': '#00a1d6',
  'YouTube': '#ff0000',
  'X': '#111827',
  'TikTok': '#25f4ee',
  'Instagram': '#c13584',
  'Facebook': '#1877f2',
  'Vimeo': '#1ab7ea',
  '微博': '#e6162d',
};

const supportedPlatformText = '视频号、抖音、小红书、快手、B站、YouTube、X、TikTok、Instagram、Facebook、Vimeo、微博';

function App() {
  const [state, send] = useMachine(fsm);
  const { captureList, currentUrl, downloadProgress, downloadQueue } = state.context;
  const [inputUrl, setInputUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  const handleParseVideo = useCallback(() => {
    const url = inputUrl.trim();
    if (!url) {
      message.warning(`请输入 ${supportedPlatformText} 视频链接`);
      return;
    }
    // 视频号：先直接命中 finder-preview API 拿元信息 + 可能的 videoUrl（登录态下有机会返回），
    // 同时兜底打开内嵌浏览器让用户扫码登录后能在小窗里播放，主进程 hoxy 会自动挖到真视频链接。
    if (/(^|\/\/|\.)weixin\.qq\.com|finder\.video\.qq\.com/i.test(url)) {
      setIsParsing(true);
      ipcRenderer.invoke('invoke_解析视频号短链', url).then((data) => {
        if (data.hasVideo && data.videoUrl) {
          send({
            type: 'e_视频捕获',
            url: data.videoUrl,
            size: 0,
            description: data.description,
            decodeKey: '',
            hdUrl: null,
            uploader: data.uploader,
            platform: '微信视频号',
            referer: data.referer,
            noDecrypt: true,
            coverUrl: data.coverUrl,
            shareUrl: url,
          });
          message.success('视频号解析成功，已加入下载列表');
          return;
        }
        // 匿名 API 只有元数据没 videoUrl：先在列表里插一张"信息卡"占位，
        // 再打开内嵌浏览器让用户扫码。扫码后 hoxy 拦截到真 videoUrl 会自动合并到这张卡上。
        if (data.description || data.uploader || data.coverUrl) {
          send({
            type: 'e_视频捕获',
            url: '',
            size: 0,
            description: data.description || '视频号视频',
            decodeKey: '',
            hdUrl: null,
            uploader: data.uploader,
            platform: '微信视频号',
            referer: data.referer,
            noDecrypt: true,
            coverUrl: data.coverUrl,
            shareUrl: url,
            infoOnly: true,
          });
        }
        return ipcRenderer.invoke('invoke_打开视频号浏览器', url);
      }).catch((err) => {
        message.warning((err?.message || '视频号短链解析失败') + '，正在打开内嵌浏览器...');
        ipcRenderer.invoke('invoke_打开视频号浏览器', url).catch(() => {});
      }).finally(() => {
        setIsParsing(false);
      });
      return;
    }
    setIsParsing(true);
    ipcRenderer.invoke('invoke_解析平台视频', url).then((data) => {
      send({
        type: 'e_视频捕获',
        url: data.url,
        size: data.size,
        description: data.description,
        decodeKey: data.decode_key,
        hdUrl: data.hd_url,
        uploader: data.uploader,
        platform: data.platform,
        referer: data.referer,
        noDecrypt: data.noDecrypt,
      });
      message.success(`${data.platform}视频解析成功，已加入下载列表`);
    }).catch((err) => {
      message.error(err?.message || '视频解析失败，请换一个链接重试');
    }).finally(() => {
      setIsParsing(false);
    });
  }, [inputUrl, send]);

  const openInBrowser = useCallback(() => {
    const url = inputUrl.trim() || 'https://channels.weixin.qq.com/';
    // 视频号必须走内嵌浏览器（伪装微信 UA + 强制本地代理）；其他平台直接扔给系统浏览器即可。
    // 兼容 weixin.qq.com/sph/... 等短链形态；空输入也走内嵌浏览器打开首页。
    if (/(^|\/\/|\.)weixin\.qq\.com|finder\.video\.qq\.com/i.test(url) || !inputUrl.trim()) {
      ipcRenderer.invoke('invoke_打开视频号浏览器', url)
        .catch((err) => message.error(err?.message || '打开视频号浏览器失败'));
      return;
    }
    shell.openExternal(url);
  }, [inputUrl]);

  const clearInputUrl = useCallback(() => {
    setInputUrl('');
  }, []);

  const openDownloadDir = useCallback(() => {
    ipcRenderer.invoke('invoke_打开视频目录')
      .catch(() => message.error('打开视频目录失败，请先下载一个视频'));
  }, []);

  const redownload = useCallback((record) => {
    const { url, decodeKey, hdUrl, description, noDecrypt, referer } = record;
    send({
      type: 'e_下载',
      url: hdUrl || url,
      decodeKey,
      description,
      noDecrypt,
      referer,
    });
  }, [send]);

  const isDownloading = state.matches('初始化完成.下载.下载中');

  return (
    <div className="App">
      {state.matches('检测初始化') ? (
        <div className="App-loading">
          <div className="App-loading-spinner">
            <LoadingOutlined style={{ fontSize: 48, color: '#4f46e5' }} />
          </div>
          <div className="App-loading-text">正在初始化...</div>
        </div>
      ) : null}

      {state.matches('初始化完成') ? (
        <div className="App-inited">
          <div className="App-inited-header">
            <div className="App-inited-header-top">
              <div className="App-inited-brand">
                <LinkOutlined className="App-inited-brand-icon" />
                <div className="App-inited-brand-copy">
                  <span className="App-inited-brand-title">WebScoop · 拾海</span>
                  <Text type="secondary" className="App-inited-brand-slogan">弱水三千，掬海一寸，收纳万千。</Text>
                </div>
                <Tag color="purple" className="brand-tag">多平台</Tag>
              </div>
              <div className="App-inited-tips">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  支持 {supportedPlatformText}
                </Text>
              </div>
            </div>

            <div className="App-inited-toolbar">
              <div className="App-inited-addressbar">
                <Input
                  placeholder={`粘贴视频分享链接后点【解析下载】，或点【浏览器打开】播放视频号自动捕获`}
                  prefix={<LinkOutlined style={{ color: '#94a3b8' }} />}
                  suffix={
                    inputUrl ? (
                      <Tooltip title="一键清除地址">
                        <CloseCircleOutlined
                          className="address-clear-icon"
                          onClick={clearInputUrl}
                        />
                      </Tooltip>
                    ) : <span />
                  }
                  value={inputUrl}
                  onChange={e => setInputUrl(e.target.value)}
                  onPressEnter={handleParseVideo}
                  className="address-input"
                  bordered={false}
                />
              </div>

              <Button
                onClick={openInBrowser}
                icon={<ExportOutlined />}
                className="App-inited-go-btn"
              >
                浏览器打开
              </Button>
              <Button
                onClick={openDownloadDir}
                icon={<FolderOpenOutlined />}
                className="App-inited-go-btn"
              >
                打开目录
              </Button>
              <Button
                type="primary"
                onClick={handleParseVideo}
                loading={isParsing}
                className="App-inited-parse-btn"
              >
                解析下载
              </Button>
            </div>
          </div>

          <div className="App-inited-content App-inited-content-full">
            <Alert
              type="info"
              showIcon
              className="App-inited-guide"
              message="使用说明"
              description={
                <div>
                  <Paragraph style={{ margin: 0 }}>
                    <b>抖音 / 小红书 / 快手 / B站 / YouTube / X / TikTok / Instagram / Facebook / Vimeo / 微博：</b>
                    直接把视频分享链接粘贴到上方输入框，点【解析下载】即可。
                  </Paragraph>
                  <Paragraph style={{ margin: '8px 0 0 0' }}>
                    <b>微信视频号：</b>
                    点【浏览器打开】用内置微信视频号播放器打开并播放视频；
                    内置播放器已伪装微信身份并强制走本地代理，播放到的视频会自动捕获到下方列表。
                  </Paragraph>
                </div>
              }
            />

            <div className="App-inited-list">
              <div className="App-inited-list-header">
                <div className="App-inited-list-title">
                  <VideoCameraOutlined style={{ color: '#4f46e5', marginRight: 8 }} />
                  <Text strong style={{ fontSize: 14 }}>已捕获视频</Text>
                </div>
                <Space size={8}>
                  <Tag color={captureList.length > 0 ? '#4f46e5' : 'default'} style={{ borderRadius: 12, margin: 0 }}>
                    {captureList.length} 个
                  </Tag>
                  <Button
                    icon={<ClearOutlined />}
                    size="small"
                    type="text"
                    onClick={() => send('e_清空捕获记录')}
                    disabled={captureList.length === 0}
                  >
                    清空
                  </Button>
                </Space>
              </div>
              <div className="App-inited-list-table">
                {captureList.length === 0 ? (
                  <div className="App-inited-empty">
                    <VideoCameraOutlined className="App-inited-empty-icon" />
                    <div className="App-inited-empty-text">粘贴链接解析，或在浏览器播放视频后自动捕获</div>
                    <div className="App-inited-empty-hint">支持 {supportedPlatformText}</div>
                  </div>
                ) : (
                  <Table
                    size="middle"
                    dataSource={captureList}
                    rowKey={(record) => (record.hdUrl || record.url || record.shareUrl || record.description) + '|' + (record.decodeKey || '')}
                    showHeader={false}
                    columns={[
                      {
                        dataIndex: 'description',
                        key: 'description',
                        render: (value, record) => (
                          <div className="video-item-title">
                            <div className="video-item-name">
                              {record.platform && (
                                <Tag
                                  color={platformColors[record.platform] || 'default'}
                                  className="platform-tag"
                                >
                                  {record.platform}
                                </Tag>
                              )}
                              <Text ellipsis={{ tooltip: value }} style={{ fontSize: 13, flex: 1 }}>
                                {value}
                              </Text>
                              {record.hdUrl && (
                                <Tooltip title="高清版本">
                                  <Tag color="success" icon={<StarOutlined />} className="hd-tag">HD</Tag>
                                </Tooltip>
                              )}
                              {record.infoOnly && (
                                <Tooltip title="视频号短链未登录，只拿到元信息；扫码登录后自动补齐视频源">
                                  <Tag color="warning" icon={<ExclamationCircleOutlined />} className="hd-tag">待登录</Tag>
                                </Tooltip>
                              )}
                            </div>
                            {record.uploader && (
                              <Text type="secondary" style={{ fontSize: 11 }} className="video-item-author">
                                @{record.uploader}
                              </Text>
                            )}
                            {record.capturedAt && (
                              <Text type="secondary" style={{ fontSize: 11 }} className="video-item-captured-at">
                                捕获于 {record.capturedAt}
                              </Text>
                            )}
                          </div>
                        ),
                        ellipsis: true,
                      },
                      {
                        dataIndex: 'prettySize',
                        key: 'prettySize',
                        width: 80,
                        align: 'right',
                        render: (value) => (
                          <Text type="secondary" style={{ fontSize: 12 }}>{value}</Text>
                        ),
                      },
                      {
                        key: 'action',
                        width: 104,
                        align: 'center',
                        render: (_, record) => {
                          const { url, decodeKey, hdUrl, description, fullFileName, noDecrypt, referer, infoOnly, shareUrl } = record;
                          const downloadUrl = hdUrl || url;
                          const isCurrentDownload = isDownloading && currentUrl === downloadUrl;
                          const isQueued = downloadQueue.some(item => item.url === downloadUrl);
                          if (infoOnly) {
                            return (
                              <Tooltip title="打开内嵌浏览器扫码登录后自动捕获">
                                <Button
                                  icon={<ExportOutlined />}
                                  type="primary"
                                  ghost
                                  onClick={() => {
                                    ipcRenderer.invoke('invoke_打开视频号浏览器', shareUrl || 'https://channels.weixin.qq.com/')
                                      .catch((err) => message.error(err?.message || '打开视频号浏览器失败'));
                                  }}
                                  size="small"
                                  className="download-btn"
                                >
                                  扫码登录
                                </Button>
                              </Tooltip>
                            );
                          }
                          return fullFileName ? (
                            <Space size={4} direction="vertical" style={{ width: '100%' }}>
                              <Tooltip title="打开文件位置">
                                <Button
                                  icon={<EyeOutlined />}
                                  type="default"
                                  onClick={() => shell.openPath(fullFileName)}
                                  size="small"
                                  className="view-btn"
                                  block
                                >
                                  查看
                                </Button>
                              </Tooltip>
                              <Tooltip title="文件已删除？重新下载">
                                <Button
                                  icon={<RedoOutlined />}
                                  type="link"
                                  onClick={() => redownload(record)}
                                  loading={isCurrentDownload}
                                  size="small"
                                  className="redownload-btn"
                                  block
                                >
                                  {isQueued ? '排队中' : '再次下载'}
                                </Button>
                              </Tooltip>
                            </Space>
                          ) : (
                            <Button
                              icon={<DownloadOutlined />}
                              type="primary"
                              onClick={() => {
                                send({
                                  type: 'e_下载',
                                  url: downloadUrl,
                                  decodeKey: decodeKey,
                                  description: description,
                                  noDecrypt,
                                  referer,
                                });
                              }}
                              loading={isCurrentDownload}
                              size="small"
                              className="download-btn"
                            >
                              {isQueued ? '排队中' : '下载'}
                            </Button>
                          );
                        },
                      },
                    ]}
                    pagination={false}
                  />
                )}
              </div>
            </div>
          </div>

          {isDownloading ? (
            <div className="App-inited-download">
              <div className="App-inited-download-content">
                <div className="App-inited-download-ring">
                  <Progress
                    type="circle"
                    percent={downloadProgress}
                    width={56}
                    strokeColor={{ '0%': '#6366f1', '100%': '#4f46e5' }}
                    format={(percent) => `${percent}%`}
                  />
                </div>
                <div className="App-inited-download-copy">
                  <div className="App-inited-download-text">后台下载中...</div>
                  <div className="App-inited-download-hint">
                    可继续浏览、解析和捕获视频{downloadQueue.length ? `，队列 ${downloadQueue.length} 条` : ''}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.matches('未初始化') ? (
        <div className="App-uninit">
          <div className="App-uninit-card">
            <div className="App-uninit-icon-wrap">
              <VideoCameraOutlined className="App-uninit-icon" />
            </div>
            <Title level={3} style={{ textAlign: 'center', margin: '16px 0 8px', fontWeight: 600 }}>WebScoop · 拾海</Title>
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 8, fontSize: 14 }}>弱水三千，掬海一寸，收纳万千。</Text>
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 20, fontSize: 13 }}>多平台链接解析 / 播放自动捕获 / 无水印优先下载</Text>
            <Alert
              message="首次使用需要初始化证书"
              description="本工具通过本地代理方式捕获网络中的视频流，需要安装根证书以支持 HTTPS 解析。证书仅存储在本地，不会上传任何数据。"
              type="info"
              showIcon
              closable={false}
              style={{ marginBottom: 28, textAlign: 'left', borderRadius: 10 }}
            />
            <div className="App-uninit-actions">
              <Button
                size="large"
                onClick={() => send('e_开始初始化')}
                type="primary"
                icon={<FormatPainterOutlined />}
                className="init-btn"
                block
              >
                一键初始化
              </Button>
              <Button size="large" onClick={() => send('e_重新检测')} icon={<RedoOutlined />} block>
                重新检测
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {state.matches('开启服务失败') ? (
        <div className="App-uninit">
          <div className="App-uninit-card">
            <div className="App-uninit-icon-wrap" style={{ background: 'linear-gradient(135deg, #fef2f2, #fee2e2)' }}>
              <ExclamationCircleOutlined className="App-uninit-icon" style={{ color: '#ef4444' }} />
            </div>
            <Title level={3} style={{ textAlign: 'center', margin: '16px 0 8px', fontWeight: 600 }}>代理服务启动失败</Title>
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>请检查系统网络权限或代理端口是否被占用</Text>
            <Button size="large" onClick={() => send('e_重试')} type="primary" block className="init-btn">
              重试
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
