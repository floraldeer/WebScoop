import { Button, Alert, Typography } from 'antd';
import {
  FormatPainterOutlined,
  RedoOutlined,
  LoadingOutlined,
  VideoCameraOutlined,
  ExclamationCircleOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { CERT_COMMON_NAME_PREFIX } from '../constants';

const { Text, Title } = Typography;
const electronAPI = window.webscoop;

export function LoadingScreen() {
  return (
    <div className="App-loading">
      <div className="App-loading-spinner">
        <LoadingOutlined style={{ fontSize: 48, color: '#4f46e5' }} />
      </div>
      <div className="App-loading-text">正在初始化...</div>
    </div>
  );
}

export function UninitScreen({ state, send }) {
  const installing = state.matches('未初始化.开始初始化');
  // 用 context 标记，避免「重试自动信任」进入开始初始化时界面闪回首次初始化文案
  const needsManualTrust =
    state.matches('未初始化.需要手动信任') || !!state.context.needsManualTrustGuide;
  const certName = state.context.certCommonName || CERT_COMMON_NAME_PREFIX;
  return (
    <div className="App-uninit">
      <div className="App-uninit-card">
        <div className="App-uninit-icon-wrap">
          <VideoCameraOutlined className="App-uninit-icon" />
        </div>
        <Title level={3} style={{ textAlign: 'center', margin: '16px 0 8px', fontWeight: 600 }}>
          WebScoop · 拾海
        </Title>
        <Text
          type="secondary"
          style={{ display: 'block', textAlign: 'center', marginBottom: 8, fontSize: 14 }}
        >
          弱水三千，掬海一寸，收纳万千。
        </Text>
        <Text
          type="secondary"
          style={{ display: 'block', textAlign: 'center', marginBottom: 20, fontSize: 13 }}
        >
          多平台链接解析 / 播放自动捕获 / 无水印优先下载
        </Text>
        {needsManualTrust ? (
          <Alert
            message="还差最后一步：把证书设为「始终信任」"
            description={
              <span>
                优先点下方 <b>「重试自动信任」</b>，在弹出的系统授权框输入本机登录密码即可。
                若仍不行，就手动来：已为你打开「钥匙串访问」并复制证书名称，找到名为
                <b> {certName} </b>
                的证书，双击它，展开「信任」，把「使用此证书时」改为
                <b>「始终信任」</b>，关闭窗口输入密码，再点「我已手动信任，重新检测」。
              </span>
            }
            type="warning"
            showIcon
            closable={false}
            style={{ marginBottom: 28, textAlign: 'left', borderRadius: 10 }}
          />
        ) : (
          <Alert
            message="首次使用需要初始化证书"
            description="本工具通过本地代理方式捕获网络中的视频流，需要为本机根证书开启系统信任以支持 HTTPS 解析。点「一键初始化」后会弹出系统授权框，输入本机登录密码允许即可。证书仅存储在本地，不会上传任何数据。"
            type="info"
            showIcon
            closable={false}
            style={{ marginBottom: 28, textAlign: 'left', borderRadius: 10 }}
          />
        )}
        <div className="App-uninit-actions">
          {needsManualTrust ? (
            <>
              <Button
                size="large"
                onClick={() => send('e_开始初始化')}
                type="primary"
                icon={<FormatPainterOutlined />}
                className="init-btn"
                loading={installing}
                block
              >
                重试自动信任
              </Button>
              <Button size="large" onClick={() => send('e_重新检测')} icon={<RedoOutlined />} block>
                我已手动信任，重新检测
              </Button>
              <Button
                size="large"
                onClick={() =>
                  electronAPI.invoke('invoke_打开钥匙串信任引导', certName).catch(() => {})
                }
                icon={<FolderOpenOutlined />}
                block
              >
                打开钥匙串访问手动信任
              </Button>
            </>
          ) : (
            <>
              <Button
                size="large"
                onClick={() => send('e_开始初始化')}
                type="primary"
                icon={<FormatPainterOutlined />}
                className="init-btn"
                loading={installing}
                block
              >
                一键初始化
              </Button>
              <Button size="large" onClick={() => send('e_重新检测')} icon={<RedoOutlined />} block>
                重新检测
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ServiceFailedScreen({ send }) {
  return (
    <div className="App-uninit">
      <div className="App-uninit-card">
        <div
          className="App-uninit-icon-wrap"
          style={{ background: 'linear-gradient(135deg, #fef2f2, #fee2e2)' }}
        >
          <ExclamationCircleOutlined className="App-uninit-icon" style={{ color: '#ef4444' }} />
        </div>
        <Title level={3} style={{ textAlign: 'center', margin: '16px 0 8px', fontWeight: 600 }}>
          代理服务启动失败
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          请检查系统网络权限或代理端口是否被占用
        </Text>
        <Button
          size="large"
          onClick={() => send('e_重试')}
          type="primary"
          block
          className="init-btn"
        >
          重试
        </Button>
      </div>
    </div>
  );
}
