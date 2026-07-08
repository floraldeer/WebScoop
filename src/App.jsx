import { useState, useRef, useEffect, useCallback } from 'react';
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
  HomeOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  LoadingOutlined,
  VideoCameraOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import fsm from './fsm';

import './App.less';
const { Text, Title } = Typography;

const platformColors = {
  '微信视频号': '#07c160',
  '抖音': '#000000',
  '快手': '#ff4906',
  '小红书': '#fe2c55',
  'B站': '#00a1d6',
};

function App() {
  const [state, send] = useMachine(fsm);
  const { captureList, downloadProgress } = state.context;
  const [inputUrl, setInputUrl] = useState('');
  const [webviewUrl, setWebviewUrl] = useState('https://channels.weixin.qq.com/');
  const [addressBarUrl, setAddressBarUrl] = useState('https://channels.weixin.qq.com/');
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const webviewRef = useRef(null);

  const loadUrl = useCallback((rawUrl) => {
    let url = rawUrl.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    setIsResolving(true);
    ipcRenderer.invoke('invoke_解析链接', url).then((realUrl) => {
      setWebviewUrl(realUrl);
      setAddressBarUrl(realUrl);
      setIsLoading(true);
      setIsResolving(false);
    }).catch(() => {
      setWebviewUrl(url);
      setAddressBarUrl(url);
      setIsLoading(true);
      setIsResolving(false);
    });
  }, []);

  const handleLoadUrl = useCallback(() => {
    if (!inputUrl.trim()) {
      message.warning('请输入链接地址');
      return;
    }
    loadUrl(inputUrl.trim());
  }, [inputUrl, loadUrl]);

  const handleParseVideo = useCallback(() => {
    const url = (inputUrl || addressBarUrl || '').trim();
    if (!url) {
      message.warning('请输入小红书、抖音或快手视频链接');
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
  }, [addressBarUrl, inputUrl, send]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter') {
      handleLoadUrl();
    }
  }, [handleLoadUrl]);

  const goHome = useCallback(() => {
    loadUrl('https://channels.weixin.qq.com/');
  }, [loadUrl]);

  const goBack = useCallback(() => {
    if (webviewRef.current?.canGoBack()) {
      webviewRef.current.goBack();
    }
  }, []);

  const goForward = useCallback(() => {
    if (webviewRef.current?.canGoForward()) {
      webviewRef.current.goForward();
    }
  }, []);

  const reload = useCallback(() => {
    webviewRef.current?.reload();
    setIsLoading(true);
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const handleStartLoad = () => setIsLoading(true);
    const handleStopLoad = () => {
      setIsLoading(false);
      try {
        const currentUrl = wv.getURL();
        if (currentUrl && currentUrl !== 'about:blank') {
          setAddressBarUrl(currentUrl);
        }
      } catch (e) {}
    };
    const handleDidNavigate = (e) => {
      if (e.url) {
        setAddressBarUrl(e.url);
      }
    };
    const handleDidNavigateInPage = (e) => {
      if (e.isMainFrame && e.url) {
        setAddressBarUrl(e.url);
      }
    };
    const handleNewWindow = (e) => {
      e.preventDefault();
      if (e.url) {
        loadUrl(e.url);
      }
    };
    const handleDomReady = () => {
      setIsLoading(false);
    };

    wv.addEventListener('did-start-loading', handleStartLoad);
    wv.addEventListener('did-stop-loading', handleStopLoad);
    wv.addEventListener('did-navigate', handleDidNavigate);
    wv.addEventListener('did-navigate-in-page', handleDidNavigateInPage);
    wv.addEventListener('new-window', handleNewWindow);
    wv.addEventListener('dom-ready', handleDomReady);

    return () => {
      wv.removeEventListener('did-start-loading', handleStartLoad);
      wv.removeEventListener('did-stop-loading', handleStopLoad);
      wv.removeEventListener('did-navigate', handleDidNavigate);
      wv.removeEventListener('did-navigate-in-page', handleDidNavigateInPage);
      wv.removeEventListener('new-window', handleNewWindow);
      wv.removeEventListener('dom-ready', handleDomReady);
    };
  }, [loadUrl]);

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
                <VideoCameraOutlined className="App-inited-brand-icon" />
                <span className="App-inited-brand-title">视频下载器</span>
                <Tag color="purple" className="brand-tag">多平台</Tag>
              </div>
              <div className="App-inited-tips">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  💡 视频号在微信中播放自动捕获；小红书/抖音/快手请粘贴链接后点解析下载
                </Text>
              </div>
            </div>

            <div className="App-inited-toolbar">
              <div className="App-inited-nav">
                <Button.Group>
                  <Button icon={<ArrowLeftOutlined />} size="middle" onClick={goBack} title="后退" className="nav-btn" />
                  <Button icon={<ArrowRightOutlined />} size="middle" onClick={goForward} title="前进" className="nav-btn" />
                  <Button icon={<ReloadOutlined spin={isLoading} />} size="middle" onClick={reload} title="刷新" className="nav-btn" />
                  <Button icon={<HomeOutlined />} size="middle" onClick={goHome} title="视频号首页" className="nav-btn" />
                </Button.Group>
              </div>

              <div className="App-inited-addressbar">
                <Input
                  placeholder="粘贴小红书/抖音/快手分享链接后点解析下载，或打开视频号页面辅助浏览"
                  prefix={isResolving ? <LoadingOutlined /> : <LinkOutlined style={{ color: '#94a3b8' }} />}
                  value={addressBarUrl}
                  onChange={e => { setAddressBarUrl(e.target.value); setInputUrl(e.target.value); }}
                  onKeyDown={handleKeyPress}
                  onPressEnter={handleLoadUrl}
                  className="address-input"
                  bordered={false}
                />
              </div>

              <Button
                type="primary"
                onClick={handleLoadUrl}
                loading={isResolving}
                className="App-inited-go-btn"
              >
                前往
              </Button>
              <Button
                onClick={handleParseVideo}
                loading={isParsing}
                className="App-inited-parse-btn"
              >
                解析下载
              </Button>
            </div>
          </div>

          <div className="App-inited-content">
            <div className="App-inited-browser">
              <webview
                ref={webviewRef}
                id="wvds-webview"
                src={webviewUrl}
                useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                allowpopups
                plugins
                partition="persist:wvds"
              />
              {isLoading && (
                <div className="App-inited-browser-loading">
                  <LoadingOutlined style={{ fontSize: 22, color: '#4f46e5' }} />
                </div>
              )}
            </div>

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
                    <div className="App-inited-empty-text">微信视频号播放后自动捕获</div>
                    <div className="App-inited-empty-hint">小红书、抖音、快手请粘贴分享链接并点击解析下载</div>
                  </div>
                ) : (
                  <Table
                    size="middle"
                    dataSource={captureList}
                    rowKey={(record) => (record.hdUrl || record.url) + '|' + (record.decodeKey || '')}
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
                            </div>
                            {record.uploader && (
                              <Text type="secondary" style={{ fontSize: 11 }} className="video-item-author">
                                @{record.uploader}
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
                        width: 88,
                        align: 'center',
                        render: (_, record) => {
                          const { url, decodeKey, hdUrl, description, fullFileName, noDecrypt, referer } = record;
                          return fullFileName ? (
                            <Tooltip title="打开文件位置">
                              <Button
                                icon={<EyeOutlined />}
                                type="default"
                                onClick={() => shell.openPath(fullFileName)}
                                size="small"
                                className="view-btn"
                              >
                                查看
                              </Button>
                            </Tooltip>
                          ) : (
                            <Button
                              icon={<DownloadOutlined />}
                              type="primary"
                              onClick={() => {
                                const downloadUrl = hdUrl || url;
                                send({
                                  type: 'e_下载',
                                  url: downloadUrl,
                                  decodeKey: decodeKey,
                                  description: description,
                                  noDecrypt,
                                  referer,
                                });
                              }}
                              size="small"
                              className="download-btn"
                            >
                              下载
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
                    width={88}
                    strokeColor={{ '0%': '#6366f1', '100%': '#4f46e5' }}
                    format={(percent) => `${percent}%`}
                  />
                </div>
                <div className="App-inited-download-text">正在下载视频...</div>
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
            <Title level={3} style={{ textAlign: 'center', margin: '16px 0 8px', fontWeight: 600 }}>视频下载器</Title>
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 20, fontSize: 14 }}>微信视频号捕获 / 抖音、快手、小红书链接解析</Text>
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
