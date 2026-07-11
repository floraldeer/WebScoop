import { createMachine, actions } from 'xstate';
import { ipcRenderer } from 'electron';
import prettyBytes from 'pretty-bytes';
import { message } from 'antd';

export default createMachine(
  {
    id: '视频下载工具',
    context: {
      captureList: [],
      currentUrl: '',
      savePath: '',
      downloadProgress: 0,
      decodeKey: '',
      description: '',
      noDecrypt: false,
      referer: '',
    },
    initial: '检测初始化',
    states: {
      检测初始化: {
        id: '检测初始化',
        invoke: {
          src: 'invoke_初始化信息',
        },
        on: {
          e_初始化完成: {
            target: '初始化完成',
          },
          e_未初始化: {
            target: '未初始化',
          },
        },
      },
      未初始化: {
        initial: '空闲',
        on: {
          e_重新检测: {
            target: '检测初始化',
          },
        },
        states: {
          空闲: {
            on: {
              e_开始初始化: {
                target: '开始初始化',
              },
            },
          },
          开始初始化: {
            invoke: {
              src: 'invoke_开始初始化',
            },
          },
        },
      },

      初始化完成: {
        initial: '空闲',
        id: '初始化完成',
        invoke: {
          src: 'invoke_启动服务',
        },
        on: {
          e_视频捕获: {
            actions: 'action_视频捕获',
          },
          e_开启服务失败: {
            target: '开启服务失败',
          },
          e_清空捕获记录: {
            actions: 'action_清空捕获记录',
          },
        },
        states: {
          空闲: {
            on: {
              e_下载: {
                actions: 'action_设置当前地址',
                target: '下载',
              },
            },
          },
          下载: {
            initial: '选择位置',
            states: {
              选择位置: {
                on: {
                  e_确认位置: { actions: 'action_存储下载位置', target: '下载中' },
                  e_取消: { target: '#初始化完成.空闲' },
                },
                invoke: {
                  src: 'invoke_选择下载位置',
                },
              },
              下载中: {
                on: {
                  e_进度变化: {
                    actions: 'action_进度变化',
                  },
                  e_下载完成: {
                    target: '#初始化完成.空闲',
                    actions: 'action_下载完成',
                  },
                  e_下载失败: {
                    target: '#初始化完成.空闲',
                    actions: 'action_下载失败',
                  },
                },
                invoke: {
                  src: 'invoke_下载视频',
                },
              },
            },
          },
        },
      },
      开启服务失败: {
        on: {
          e_重试: {
            target: '初始化完成',
          },
        },
      },
    },
  },
  {
    services: {
      invoke_初始化信息: () => send => {
        ipcRenderer.invoke('invoke_初始化信息').then(data => {
          if (data === true) {
            send('e_初始化完成');
          } else {
            send('e_未初始化');
          }
        });
      },
      invoke_开始初始化: () => send => {
        ipcRenderer
          .invoke('invoke_开始初始化')
          .catch(() => {})
          .finally(() => send('e_重新检测'));
      },
      invoke_启动服务: () => send => {
        const fnDealVideoCapture = (eName, data) => {
          if (!data) return;
          const { url, size, description, decode_key, hd_url, uploader, platform, referer, noDecrypt, coverUrl, shareUrl, infoOnly } = data;
          send({
            type: 'e_视频捕获',
            url,
            size,
            description,
            decodeKey: decode_key,
            hdUrl: hd_url,
            uploader,
            platform,
            referer,
            noDecrypt,
            coverUrl,
            shareUrl,
            infoOnly,
          });
        };

        ipcRenderer
          .invoke('invoke_启动服务')
          .then(() => {
            ipcRenderer.on('VIDEO_CAPTURE', fnDealVideoCapture);
            message.success('微信视频号捕获服务已启动');
          })
          .catch(() => {
            send('e_开启服务失败');
          });

        return () => {
          ipcRenderer.removeListener('VIDEO_CAPTURE', fnDealVideoCapture);
        };
      },
      invoke_选择下载位置: () => send => {
        ipcRenderer
          .invoke('invoke_选择下载位置')
          .then(data => {
            send({ type: 'e_确认位置', data });
          })
          .catch(() => send('e_取消'));
      },
      invoke_下载视频:
        ({ currentUrl, savePath, decodeKey, description, noDecrypt, referer }) =>
        send => {
          let completed = false;
          ipcRenderer
            .invoke('invoke_下载视频', {
              url: currentUrl,
              decodeKey,
              savePath,
              description,
              noDecrypt,
              referer,
            })
            .then((result) => {
              if (completed) return;
              completed = true;
              if (result && result.fullFileName) {
                send({ type: 'e_下载完成', fullFileName: result.fullFileName, currentUrl });
              } else {
                send('e_下载失败');
              }
            })
            .catch((e) => {
              console.error('download error:', e);
              if (completed) return;
              completed = true;
              send('e_下载失败');
            });

          const onProgress = (event, arg) => {
            send({ type: 'e_进度变化', data: arg });
          };
          ipcRenderer.on('e_进度变化', onProgress);

          return () => {
            ipcRenderer.removeListener('e_进度变化', onProgress);
          };
        },
    },
    actions: {
      action_视频捕获: actions.assign(
        ({ captureList }, { url, size, description, decodeKey, hdUrl, uploader, platform, referer, noDecrypt, coverUrl, shareUrl, infoOnly }) => {
          // infoOnly=true 表示只有元信息（视频号短链未登录场景），无 url 也允许入列表，
          // 但要靠 shareUrl 作为唯一键，避免同一条视频号短链多次点解析时重复添加。
          const primaryKey = url || shareUrl;
          if (!primaryKey) return {};
          const newItem = {
            size: size || 0,
            url: url || '',
            hdUrl: hdUrl || null,
            prettySize: size ? prettyBytes(+size) : (infoOnly ? '待登录' : '未知'),
            description: description || '未命名视频',
            decodeKey: decodeKey || '',
            uploader: uploader || '',
            platform: platform || '',
            referer: referer || '',
            noDecrypt: !!noDecrypt,
            coverUrl: coverUrl || '',
            shareUrl: shareUrl || '',
            infoOnly: !!infoOnly,
          };
          // 视频号 CDN 所有视频同路径，靠稳定内容 id(encfilekey/filekey) 区分不同视频；
          // token/idx/adaptivelvl 是同一视频的时效/清晰度变体，去重时须忽略，
          // 否则同一视频不同来源(代理层/注入)或不同清晰度会变成"多个相同地址"。
          const sameVideo = (a, b) => {
            if (!a || !b) return false;
            if (a === b) return true;
            const idOf = (u) => {
              const qs = u.split('?')[1] || '';
              const m = qs.match(/(encfilekey|filekey)=[^&]+/gi);
              return m ? 'finder|' + m.join('&') : u;
            };
            return idOf(a) === idOf(b);
          };
          const isGenericWechatTitle = (title = '') => /^(微信视频号视频|视频号视频|网络视频|未命名视频)$/.test(String(title).trim());
          const existingIndex = captureList.findIndex(item => {
            const itemUrl = item.hdUrl || item.url;
            const newUrl = newItem.hdUrl || newItem.url;
            if (sameVideo(itemUrl, newUrl)) return true;
            if (sameVideo(item.url, newItem.url)) return true;
            if (hdUrl && item.hdUrl && sameVideo(item.hdUrl, hdUrl)) return true;
            if (decodeKey && item.decodeKey && item.decodeKey === decodeKey && item.description === newItem.description) return true;
            // infoOnly 占位卡与真视频合并：靠 shareUrl 或"同作者+同描述"识别
            if (item.shareUrl && newItem.shareUrl && item.shareUrl === newItem.shareUrl) return true;
            if (item.infoOnly && newItem.uploader && item.uploader && item.uploader === newItem.uploader && item.description === newItem.description) return true;
            return false;
          });
          if (existingIndex >= 0) {
            const existing = captureList[existingIndex];
            const shouldUpdateTitle =
              newItem.description &&
              !isGenericWechatTitle(newItem.description) &&
              isGenericWechatTitle(existing.description);
            const gainedRealUrl = existing.infoOnly && newItem.url;
            const shouldUpdate =
              gainedRealUrl ||
              (hdUrl && !existing.hdUrl) ||
              shouldUpdateTitle ||
              (newItem.uploader && !existing.uploader) ||
              ((newItem.size || 0) > (existing.size || 0));
            if (!shouldUpdate) return {};
            const updated = [...captureList];
            updated[existingIndex] = {
              ...existing,
              hdUrl: hdUrl || existing.hdUrl,
              size: newItem.size || existing.size,
              prettySize: newItem.size ? prettyBytes(+newItem.size) : existing.prettySize,
              url: newItem.url || existing.url,
              description: shouldUpdateTitle ? newItem.description : existing.description,
              uploader: newItem.uploader || existing.uploader,
              referer: newItem.referer || existing.referer,
              noDecrypt: existing.noDecrypt && newItem.noDecrypt,
              coverUrl: newItem.coverUrl || existing.coverUrl,
              shareUrl: newItem.shareUrl || existing.shareUrl,
              infoOnly: existing.infoOnly && !newItem.url,
            };
            if (gainedRealUrl) message.success(`视频号真链已捕获: ${updated[existingIndex].description}`);
            return { captureList: updated };
          }
          const platformTag = newItem.platform ? `[${newItem.platform}] ` : '';
          if (newItem.infoOnly) {
            message.info(`已识别视频号元信息: ${platformTag}${newItem.description}（扫码登录后自动补齐视频源）`);
          } else {
            message.success(`捕获到视频: ${platformTag}${newItem.description}`);
          }
          return {
            captureList: [newItem, ...captureList],
          };
        },
      ),
      action_清空捕获记录: actions.assign(() => {
        return { captureList: [] };
      }),
      action_设置当前地址: actions.assign((_, { url, decodeKey, description, noDecrypt, referer }) => {
        return {
          currentUrl: url,
          decodeKey: decodeKey || '',
          description: description || '',
          noDecrypt: !!noDecrypt,
          referer: referer || '',
        };
      }),
      action_存储下载位置: actions.assign((_, { data }) => {
        return { savePath: data };
      }),
      action_进度变化: actions.assign((_, { data }) => {
        return { downloadProgress: ~~data };
      }),
      action_下载完成: actions.assign(({ captureList }, { fullFileName, currentUrl }) => {
        message.success('下载完成');
        return {
          downloadProgress: 0,
          captureList: captureList.map(item => {
            if ((item.hdUrl || item.url) === currentUrl) {
              return { ...item, fullFileName };
            }
            return item;
          }),
        };
      }),
      action_下载失败: actions.assign(() => {
        message.error('下载失败，请重试');
        return { downloadProgress: 0 };
      }),
    },
  },
);
