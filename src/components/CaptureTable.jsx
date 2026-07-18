import { Table, Button, Space, Typography, Tag, Tooltip, message } from 'antd';
import {
  DownloadOutlined,
  EyeOutlined,
  StarOutlined,
  RedoOutlined,
  VideoCameraOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { platformColors, supportedPlatformText } from '../constants';

const { Text } = Typography;
const electronAPI = window.webscoop;

function TitleCell({ value, record }) {
  return (
    <div className="video-item-title">
      <div className="video-item-name">
        {record.platform && (
          <Tag color={platformColors[record.platform] || 'default'} className="platform-tag">
            {record.platform}
          </Tag>
        )}
        <Text ellipsis={{ tooltip: value }} style={{ fontSize: 13, flex: 1 }}>
          {value}
        </Text>
        {record.hdUrl && (
          <Tooltip title="高清版本">
            <Tag color="success" icon={<StarOutlined />} className="hd-tag">
              HD
            </Tag>
          </Tooltip>
        )}
        {record.infoOnly && (
          <Tooltip title="请在桌面微信中打开并播放该视频，播放后自动补齐视频源">
            <Tag color="warning" icon={<ExclamationCircleOutlined />} className="hd-tag">
              待播放
            </Tag>
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
  );
}

export default function CaptureTable({
  captureList,
  downloadQueue,
  currentUrl,
  isDownloading,
  send,
  openInWechat,
  redownload,
}) {
  if (captureList.length === 0) {
    return (
      <div className="App-inited-empty">
        <VideoCameraOutlined className="App-inited-empty-icon" />
        <div className="App-inited-empty-text">粘贴链接解析，或在浏览器播放视频后自动捕获</div>
        <div className="App-inited-empty-hint">支持 {supportedPlatformText}</div>
      </div>
    );
  }

  const renderAction = (_, record) => {
    const {
      url,
      decodeKey,
      hdUrl,
      description,
      fullFileName,
      noDecrypt,
      referer,
      infoOnly,
      shareUrl,
    } = record;
    const downloadUrl = hdUrl || url;
    const isCurrentDownload = isDownloading && currentUrl === downloadUrl;
    const isQueued = downloadQueue.some((item) => item.url === downloadUrl);

    if (infoOnly) {
      return (
        <Tooltip title="复制链接并唤起桌面微信，打开播放后自动捕获">
          <Button
            icon={<ExportOutlined />}
            type="primary"
            ghost
            onClick={() => openInWechat(shareUrl || 'https://channels.weixin.qq.com/', record)}
            size="small"
            className="download-btn"
          >
            微信打开
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
            onClick={() =>
              electronAPI
                .invoke('invoke_打开已下载文件', fullFileName)
                .catch(() => message.error('打开文件失败'))
            }
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
            decodeKey,
            description,
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
  };

  return (
    <Table
      size="middle"
      dataSource={captureList}
      rowKey={(record) =>
        (record.hdUrl || record.url || record.shareUrl || record.description) +
        '|' +
        (record.decodeKey || '')
      }
      showHeader={false}
      columns={[
        {
          dataIndex: 'description',
          key: 'description',
          render: (value, record) => <TitleCell value={value} record={record} />,
          ellipsis: true,
        },
        {
          dataIndex: 'prettySize',
          key: 'prettySize',
          width: 80,
          align: 'right',
          render: (value) => (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {value}
            </Text>
          ),
        },
        {
          key: 'action',
          width: 104,
          align: 'center',
          render: renderAction,
        },
      ]}
      pagination={false}
    />
  );
}
