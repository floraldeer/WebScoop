import { useEffect, useState, useCallback } from 'react';
import { Drawer, Button, Typography, Divider, List, Empty, Space, Popconfirm, message } from 'antd';
import { FolderOpenOutlined, DeleteOutlined, FileTextOutlined } from '@ant-design/icons';
import prettyBytes from 'pretty-bytes';

const { Text, Title } = Typography;
const electronAPI = window.webscoop;

export default function SettingsDrawer({ open, onClose }) {
  const [settings, setSettings] = useState({ downloadDir: '' });
  const [history, setHistory] = useState([]);

  const reload = useCallback(() => {
    electronAPI
      .invoke('invoke_获取设置')
      .then(setSettings)
      .catch(() => {});
    electronAPI
      .invoke('invoke_下载历史')
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const patchSettings = useCallback((patch) => {
    electronAPI
      .invoke('invoke_更新设置', patch)
      .then(setSettings)
      .catch(() => message.error('保存设置失败'));
  }, []);

  const chooseDir = useCallback(() => {
    electronAPI
      .invoke('invoke_选择下载位置')
      .then((dir) => dir && patchSettings({ downloadDir: dir }))
      .catch(() => {});
  }, [patchSettings]);

  const clearHistory = useCallback(() => {
    electronAPI
      .invoke('invoke_清空下载历史')
      .then(() => setHistory([]))
      .catch(() => {});
  }, []);

  const openLogs = useCallback(() => {
    electronAPI.invoke('invoke_打开日志目录').catch(() => message.error('打开日志目录失败'));
  }, []);

  const clearCert = useCallback(() => {
    electronAPI
      .invoke('invoke_清理证书与缓存')
      .then(() => message.success('已清理证书与缓存，并恢复系统代理。请重启应用重新初始化'))
      .catch(() => message.error('清理失败'));
  }, []);

  return (
    <Drawer title="设置" placement="right" width={420} open={open} onClose={onClose}>
      <Title level={5}>下载</Title>
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
          默认下载目录
        </Text>
        <Space.Compact style={{ width: '100%' }}>
          <Button icon={<FolderOpenOutlined />} onClick={chooseDir}>
            选择目录
          </Button>
          <Text
            ellipsis={{ tooltip: settings.downloadDir }}
            style={{ flex: 1, lineHeight: '32px', paddingLeft: 8 }}
          >
            {settings.downloadDir || '未设置（每次下载时选择）'}
          </Text>
        </Space.Compact>
      </div>

      <Divider />
      <Title level={5}>维护</Title>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button icon={<FileTextOutlined />} onClick={openLogs} block>
          打开日志目录
        </Button>
        <Popconfirm
          title="确认清理？"
          description="将停止代理、恢复系统代理设置，并删除本机根证书。下次启动需重新初始化。"
          onConfirm={clearCert}
          okText="确认"
          cancelText="取消"
        >
          <Button danger icon={<DeleteOutlined />} block>
            清理证书与缓存并恢复系统代理
          </Button>
        </Popconfirm>
      </Space>

      <Divider />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={5} style={{ margin: 0 }}>
          下载历史
        </Title>
        <Button size="small" type="text" onClick={clearHistory} disabled={history.length === 0}>
          清空
        </Button>
      </div>
      {history.length === 0 ? (
        <Empty description="暂无下载记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={history}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <Text ellipsis={{ tooltip: item.description }} style={{ fontSize: 13 }}>
                    {item.platform ? `[${item.platform}] ` : ''}
                    {item.description || '未命名视频'}
                  </Text>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {item.size ? prettyBytes(+item.size) + ' · ' : ''}
                    {new Date(item.downloadedAt).toLocaleString()}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Drawer>
  );
}
