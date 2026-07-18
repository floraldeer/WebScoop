import { useState, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { Button, Progress, Alert, Input, Space, Typography, Tag, Tooltip, message } from 'antd';
import {
  ClearOutlined,
  LinkOutlined,
  VideoCameraOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  CloseCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import fsm from './fsm';
import { supportedPlatformText, WECHAT_URL_REGEX } from './constants';
import { LoadingScreen, UninitScreen, ServiceFailedScreen } from './components/InitScreen';
import CaptureTable from './components/CaptureTable';
import SettingsDrawer from './components/SettingsDrawer';

import './App.less';
const { Text, Paragraph } = Typography;
const electronAPI = window.webscoop;

function App() {
  const [state, send] = useMachine(fsm);
  const { captureList, currentUrl, downloadProgress, downloadQueue } = state.context;
  const [inputUrl, setInputUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const cancelDownload = useCallback(() => {
    electronAPI.invoke('invoke_取消下载').catch(() => {});
  }, []);

  const openInWechat = useCallback(async (url, target = {}) => {
    try {
      await electronAPI.invoke('invoke_在微信中打开', {
        url,
        description: target.description || '',
        uploader: target.uploader || '',
        shortUri: target.shortUri || '',
        dynamicExportId: target.dynamicExportId || '',
      });
      message.info('链接已复制并唤起微信，请粘贴发送后打开视频并播放');
      return true;
    } catch (err) {
      message.error(err?.message || '唤起桌面微信失败');
      return false;
    }
  }, []);

  const handleParseVideo = useCallback(() => {
    const url = inputUrl.trim();
    if (!url) {
      message.warning(`请输入 ${supportedPlatformText} 视频链接`);
      return;
    }
    // 视频号：先拿元信息并创建占位项，再把链接复制到桌面微信。
    // 用户在真实微信中打开并播放后，主进程 hoxy 会捕获媒体地址和解密键并自动合并占位项。
    if (WECHAT_URL_REGEX.test(url)) {
      setIsParsing(true);
      electronAPI
        .invoke('invoke_解析视频号短链', url)
        .then((data) => {
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
          // 匿名 API 只有元数据没 videoUrl：先在列表里插一张信息卡占位。
          // 用户在桌面微信中播放后，hoxy 拦截到真 videoUrl 会自动合并到这张卡上。
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
          return openInWechat(url, data);
        })
        .catch((err) => {
          message.warning((err?.message || '视频号短链解析失败') + '，请在微信中打开并播放');
          openInWechat(url);
        })
        .finally(() => {
          setIsParsing(false);
        });
      return;
    }
    setIsParsing(true);
    electronAPI
      .invoke('invoke_解析平台视频', url)
      .then((data) => {
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
      })
      .catch((err) => {
        message.error(err?.message || '视频解析失败，请换一个链接重试');
      })
      .finally(() => {
        setIsParsing(false);
      });
  }, [inputUrl, openInWechat, send]);

  const openInBrowser = useCallback(() => {
    const url = inputUrl.trim();
    if (!url) {
      message.warning('请先粘贴视频分享链接');
      return;
    }
    // 视频号交给真实桌面微信打开；其他平台继续使用系统浏览器。
    if (WECHAT_URL_REGEX.test(url)) {
      openInWechat(url);
      return;
    }
    electronAPI.invoke('invoke_打开外部链接', url).catch(() => message.error('打开链接失败'));
  }, [inputUrl, openInWechat]);

  const clearInputUrl = useCallback(() => {
    setInputUrl('');
  }, []);

  const openDownloadDir = useCallback(() => {
    electronAPI
      .invoke('invoke_打开视频目录')
      .catch(() => message.error('打开视频目录失败，请先下载一个视频'));
  }, []);

  const redownload = useCallback(
    (record) => {
      const { url, decodeKey, hdUrl, description, noDecrypt, referer } = record;
      send({
        type: 'e_下载',
        url: hdUrl || url,
        decodeKey,
        description,
        noDecrypt,
        referer,
      });
    },
    [send],
  );

  const isDownloading = state.matches('初始化完成.下载.下载中');

  return (
    <div className="App">
      {state.matches('检测初始化') ? <LoadingScreen /> : null}

      {state.matches('初始化完成') ? (
        <div className="App-inited">
          <div className="App-inited-header">
            <div className="App-inited-header-top">
              <div className="App-inited-brand">
                <LinkOutlined className="App-inited-brand-icon" />
                <div className="App-inited-brand-copy">
                  <span className="App-inited-brand-title">WebScoop · 拾海</span>
                  <Text type="secondary" className="App-inited-brand-slogan">
                    弱水三千，掬海一寸，收纳万千。
                  </Text>
                </div>
                <Tag color="purple" className="brand-tag">
                  多平台
                </Tag>
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
                  placeholder="粘贴视频分享链接后点【解析下载】"
                  prefix={<LinkOutlined style={{ color: '#94a3b8' }} />}
                  suffix={
                    inputUrl ? (
                      <Tooltip title="一键清除地址">
                        <CloseCircleOutlined
                          className="address-clear-icon"
                          onClick={clearInputUrl}
                        />
                      </Tooltip>
                    ) : (
                      <span />
                    )
                  }
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
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
                打开链接
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
              <Tooltip title="设置">
                <Button
                  onClick={() => setSettingsOpen(true)}
                  icon={<SettingOutlined />}
                  className="App-inited-go-btn"
                />
              </Tooltip>
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
                    <b>
                      抖音 / 小红书 / 快手 / B站 / YouTube / X / TikTok / Instagram / Facebook /
                      Vimeo / 微博：
                    </b>
                    直接把视频分享链接粘贴到上方输入框，点【解析下载】即可。
                  </Paragraph>
                  <Paragraph style={{ margin: '8px 0 0 0' }}>
                    <b>微信视频号：</b>
                    粘贴分享链接后点【解析下载】，程序会复制链接并唤起桌面微信；
                    在微信中粘贴发送、打开并播放该视频，视频源会自动补齐到下方列表。
                  </Paragraph>
                </div>
              }
            />

            <div className="App-inited-list">
              <div className="App-inited-list-header">
                <div className="App-inited-list-title">
                  <VideoCameraOutlined style={{ color: '#4f46e5', marginRight: 8 }} />
                  <Text strong style={{ fontSize: 14 }}>
                    已捕获视频
                  </Text>
                </div>
                <Space size={8}>
                  <Tag
                    color={captureList.length > 0 ? '#4f46e5' : 'default'}
                    style={{ borderRadius: 12, margin: 0 }}
                  >
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
                <CaptureTable
                  captureList={captureList}
                  downloadQueue={downloadQueue}
                  currentUrl={currentUrl}
                  isDownloading={isDownloading}
                  send={send}
                  openInWechat={openInWechat}
                  redownload={redownload}
                />
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
                    可继续浏览、解析和捕获视频
                    {downloadQueue.length ? `，队列 ${downloadQueue.length} 条` : ''}
                  </div>
                </div>
                <Button size="small" onClick={cancelDownload} icon={<CloseCircleOutlined />}>
                  取消
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {state.matches('未初始化') ? <UninitScreen state={state} send={send} /> : null}

      {state.matches('开启服务失败') ? <ServiceFailedScreen send={send} /> : null}
    </div>
  );
}

export default App;
