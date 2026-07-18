import { createWechatCaptureCoordinator } from '../../electron/wechatCaptureCoordinator';

const candidate = (overrides = {}) => ({
  keys: ['media-key-1'],
  url: 'https://finder.video.qq.com/stodownload?encfilekey=media-key-1',
  decode_key: 'decode-key-1',
  description: '目标视频',
  uploader: '目标作者',
  objectId: 'object-1',
  current: true,
  ...overrides,
});

describe('wechat capture coordinator', () => {
  test('pairs a candidate followed by a media request', () => {
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
    });

    coordinator.addCandidate(candidate());
    expect(captures).toHaveLength(0);

    coordinator.markActive('media-key-1');
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      description: '目标视频',
      decode_key: 'decode-key-1',
    });
  });

  test('pairs a media request followed by a candidate from another page', () => {
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
    });

    coordinator.markActive('media-key-1');
    coordinator.addCandidate(candidate());

    expect(captures).toHaveLength(1);
  });

  test('only resolves a target with the matching current detail object', () => {
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
    });
    coordinator.setTarget({
      shareUrl: 'https://weixin.qq.com/sph/target',
      description: '目标视频',
      uploader: '目标作者',
    });

    coordinator.addCandidate(
      candidate({
        keys: ['neighbor-key'],
        decode_key: 'neighbor-decode-key',
        description: '相邻视频',
        objectId: 'neighbor-object',
      }),
    );
    coordinator.markActive('neighbor-key');
    coordinator.addCandidate(candidate({ current: false }));
    coordinator.markActive('media-key-1');
    expect(captures).toHaveLength(0);

    coordinator.addCandidate(candidate());
    expect(captures).toHaveLength(1);
    expect(captures[0].shareUrl).toBe('https://weixin.qq.com/sph/target');
  });

  test('does not emit twice for repeated range requests', () => {
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
    });

    coordinator.addCandidate(candidate());
    coordinator.markActive('media-key-1');
    coordinator.markActive('media-key-1');
    coordinator.addCandidate(candidate());

    expect(captures).toHaveLength(1);
  });

  test('restores generic capture after the completed target cooldown', () => {
    let time = 1000;
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
      now: () => time,
      completedTargetTtlMs: 100,
    });
    coordinator.setTarget({
      shareUrl: 'https://weixin.qq.com/sph/target',
      description: '目标视频',
      uploader: '目标作者',
    });
    coordinator.addCandidate(candidate());
    coordinator.markActive('media-key-1');

    coordinator.addCandidate(candidate({
      keys: ['neighbor-key'],
      decode_key: 'neighbor-decode-key',
      description: '相邻视频',
      objectId: 'neighbor-object',
    }));
    coordinator.markActive('neighbor-key');
    expect(captures).toHaveLength(1);

    time = 1200;
    coordinator.markActive('neighbor-key');
    expect(captures).toHaveLength(2);
  });

  test('does not bind an unidentified target to a stale candidate', () => {
    let time = 1000;
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
      now: () => time,
    });
    coordinator.addCandidate(candidate());

    time = 1100;
    coordinator.setTarget({ shareUrl: 'https://weixin.qq.com/sph/target' });
    coordinator.markActive('media-key-1');
    expect(captures).toHaveLength(0);

    coordinator.addCandidate(candidate());
    expect(captures).toHaveLength(1);
  });

  test('removes stale candidates and active requests', () => {
    let time = 1000;
    const captures = [];
    const coordinator = createWechatCaptureCoordinator({
      onCapture: data => captures.push(data),
      now: () => time,
      entryTtlMs: 100,
    });

    coordinator.addCandidate(candidate());
    time = 1200;
    coordinator.cleanup();
    coordinator.markActive('media-key-1');

    expect(captures).toHaveLength(0);
  });
});
