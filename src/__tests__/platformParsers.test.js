jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('electron', () => ({
  app: { isPackaged: false },
  session: {
    defaultSession: {
      cookies: {
        get: jest.fn().mockResolvedValue([]),
      },
    },
  },
}));

import axios from 'axios';
import {
  buildQqMusicAudioUrl,
  buildQqMusicVkeyPayload,
  extractQqMusicSongIdentity,
  getMediaSizeFromHeaders,
  parseKuaishouInitialState,
  parsePlatformVideo,
  selectQqMusicAudio,
} from '../../electron/platformParsers';

describe('platform parser media size', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('uses the total length from a range response', () => {
    expect(
      getMediaSizeFromHeaders(
        {
          'content-range': 'bytes 0-1/12345678',
          'content-length': '2',
        },
        206,
      ),
    ).toBe(12345678);
  });

  test('uses content length for a full response', () => {
    expect(getMediaSizeFromHeaders({ 'content-length': '7654321' }, 200)).toBe(7654321);
  });

  test('does not treat a partial content length as total size', () => {
    expect(getMediaSizeFromHeaders({ 'content-length': '2' }, 206)).toBe(0);
  });

  test('supports object storage size headers', () => {
    expect(getMediaSizeFromHeaders({ 'x-oss-object-size': '9988776' }, 206)).toBe(9988776);
  });

  test('keeps WeChat URLs on the capture-only path', async () => {
    await expect(parsePlatformVideo('https://weixin.qq.com/sph/protected-path')).rejects.toThrow(
      '需要页面运行后才能拿到真实媒体地址',
    );
  });

  test('reads the matching Kuaishou representation size from INIT_STATE', () => {
    const html = `<script>window.INIT_STATE = ${JSON.stringify({
      cache: {
        photo: {
          caption: '测试视频',
          userName: '测试作者',
          share_info: 'photoId=abc123',
          mainMvUrls: [{ url: 'https://mov.example.com/path/video.mp4?token=main' }],
          manifest: {
            adaptationSet: [
              {
                representation: [
                  {
                    url: 'https://cdn.example.com/path/video.mp4?token=cdn',
                    fileSize: 5922303,
                  },
                  {
                    url: 'https://cdn.example.com/path/video-h265.mp4',
                    fileSize: 3358847,
                  },
                ],
              },
            ],
          },
        },
      },
    })}</script>`;

    expect(parseKuaishouInitialState(html, 'https://m.gifshow.com/fw/photo/abc123')).toEqual({
      videoUrl: 'https://mov.example.com/path/video.mp4?token=main',
      title: '测试视频',
      size: 5922303,
      uploader: '测试作者',
    });
  });

  test('extracts QQ Music songid from playsong links', () => {
    expect(
      extractQqMusicSongIdentity(
        'https://i.y.qq.com/v8/playsong.html?songid=724394&songtype=0#webchat_redirect',
      ),
    ).toEqual({
      songid: '724394',
      songmid: '',
      songtype: 0,
    });
  });

  test('extracts QQ Music songid from songDetail paths', () => {
    expect(
      extractQqMusicSongIdentity(
        'https://y.qq.com/n/ryqq_v2/songDetail/724394?ADTAG=h5_play_song&songtype=0',
      ),
    ).toEqual({
      songid: '724394',
      songmid: '',
      songtype: 0,
    });
  });

  test('builds QQ Music audio URL from vkey purl', () => {
    expect(
      buildQqMusicAudioUrl({
        req_0: {
          data: {
            sip: ['http://aqqmusic.tc.qq.com/'],
            midurlinfo: [
              {
                purl: 'C400002ucvcB2rA3n4.m4a?guid=1535153710&vkey=abc&uin=0&fromtag=3',
              },
            ],
          },
        },
      }),
    ).toBe(
      'http://aqqmusic.tc.qq.com/C400002ucvcB2rA3n4.m4a?guid=1535153710&vkey=abc&uin=0&fromtag=3',
    );
  });

  test('returns empty QQ Music audio URL when vkey purl is unavailable', () => {
    expect(
      buildQqMusicAudioUrl({
        req_0: {
          data: {
            sip: ['http://aqqmusic.tc.qq.com/'],
            midurlinfo: [{ purl: '', result: 104003 }],
          },
        },
      }),
    ).toBe('');
  });

  test('builds current QQ Music vkey payload for the full audio file', () => {
    const payload = buildQqMusicVkeyPayload(
      {
        mid: '000t7dhP0tQaSi',
        type: 0,
        file: {
          media_mid: '002ucvcB2rA3n4',
          size_flac: 26772996,
          size_320mp3: 8538987,
          size_128mp3: 3415683,
          size_192aac: 5175940,
          size_96aac: 2608668,
        },
      },
      '',
      false,
      'test-guid',
    );

    expect(payload).toMatchObject({
      comm: {
        ct: 24,
        cv: 4747474,
        platform: 'yqq.json',
        uin: 0,
      },
      req_0: {
        module: 'music.vkey.GetVkey',
        method: 'UrlGetVkey',
        param: {
          guid: 'test-guid',
          filename: [
            'F000002ucvcB2rA3n4.flac',
            'M800002ucvcB2rA3n4.mp3',
            'M500002ucvcB2rA3n4.mp3',
            'C600002ucvcB2rA3n4.m4a',
            'C400002ucvcB2rA3n4.m4a',
          ],
        },
      },
    });
    expect(payload.req_0.param.songmid).toEqual(Array(5).fill('000t7dhP0tQaSi'));
    expect(payload.req_0.param.songtype).toEqual(Array(5).fill(0));
  });

  test('builds current QQ Music vkey payload for the official preview file', () => {
    expect(
      buildQqMusicVkeyPayload(
        {
          mid: '000t7dhP0tQaSi',
          type: 0,
          file: { media_mid: '002ucvcB2rA3n4' },
        },
        '',
        true,
        'preview-guid',
      ).req_0.param,
    ).toMatchObject({
      guid: 'preview-guid',
      filename: ['RS02002ucvcB2rA3n4.mp3'],
    });
  });

  test('uses QQ Music login cookies in the vkey payload', () => {
    const payload = buildQqMusicVkeyPayload(
      {
        mid: '000t7dhP0tQaSi',
        type: 0,
        file: { media_mid: '002ucvcB2rA3n4' },
      },
      'uin=o123456; qm_keyst=Q_H_L_test',
      false,
      'login-guid',
    );

    expect(payload.comm).toMatchObject({
      uin: 123456,
      g_tk: 1926538631,
      g_tk_new_20200303: 1926538631,
    });
    expect(payload.req_0.param.uin).toBe('123456');
  });

  test('selects QQ Music FLAC when the account can access lossless audio', () => {
    expect(
      selectQqMusicAudio(
        {
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [
                {
                  filename: 'F000002ucvcB2rA3n4.flac',
                  purl: 'F000002ucvcB2rA3n4.flac?vkey=flac',
                  result: 0,
                },
              ],
            },
          },
        },
        {
          mid: '000t7dhP0tQaSi',
          file: { media_mid: '002ucvcB2rA3n4', size_flac: 26772996 },
        },
        false,
      ),
    ).toMatchObject({
      url: 'https://isure.stream.qqmusic.qq.com/F000002ucvcB2rA3n4.flac?vkey=flac',
      filename: 'F000002ucvcB2rA3n4.flac',
      extension: '.flac',
      quality: 'FLAC 无损',
      size: 26772996,
      isPreview: false,
    });
  });

  test('falls back to QQ Music MP3 320K when FLAC is unauthorized', () => {
    expect(
      selectQqMusicAudio(
        {
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [
                {
                  filename: 'F000002ucvcB2rA3n4.flac',
                  purl: '',
                  result: 104003,
                },
                {
                  filename: 'M800002ucvcB2rA3n4.mp3',
                  purl: 'M800002ucvcB2rA3n4.mp3?vkey=mp3',
                  result: 0,
                },
              ],
            },
          },
        },
        {
          mid: '000t7dhP0tQaSi',
          file: {
            media_mid: '002ucvcB2rA3n4',
            size_flac: 26772996,
            size_320mp3: 8538987,
          },
        },
        false,
      ),
    ).toMatchObject({
      filename: 'M800002ucvcB2rA3n4.mp3',
      extension: '.mp3',
      quality: 'MP3 320K',
      size: 8538987,
      isPreview: false,
    });
  });

  test('falls back to a labeled QQ Music preview when full audio is unauthorized', async () => {
    axios.get
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: [
            {
              mid: '000t7dhP0tQaSi',
              type: 0,
              title: '爱情买卖',
              singer: [{ name: '慕容晓晓' }],
              file: {
                media_mid: '002ucvcB2rA3n4',
                size_try: 960887,
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { destroy: jest.fn() },
        headers: {
          'content-type': 'audio/mpeg',
          'content-range': 'bytes 0-1/960887',
        },
        status: 206,
        request: {
          res: {
            responseUrl: 'https://isure.stream.qqmusic.qq.com/RS02002ucvcB2rA3n4.mp3?vkey=preview',
          },
        },
      });
    axios.post
      .mockResolvedValueOnce({
        data: {
          req_0: {
            data: {
              midurlinfo: [{ filename: 'C400002ucvcB2rA3n4.m4a', purl: '', result: 104003 }],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          req_0: {
            data: {
              sip: ['https://isure.stream.qqmusic.qq.com/'],
              midurlinfo: [
                {
                  filename: 'RS02002ucvcB2rA3n4.mp3',
                  purl: 'RS02002ucvcB2rA3n4.mp3?vkey=preview',
                  result: 0,
                },
              ],
            },
          },
        },
      });

    await expect(
      parsePlatformVideo(
        'https://i.y.qq.com/v8/playsong.html?songid=724394&songtype=0#webchat_redirect',
      ),
    ).resolves.toMatchObject({
      url: 'https://isure.stream.qqmusic.qq.com/RS02002ucvcB2rA3n4.mp3?vkey=preview',
      description: '【试听】爱情买卖 - 慕容晓晓',
      platform: 'QQ音乐',
      extension: '.mp3',
      quality: '官方试听',
      isPreview: true,
      size: 960887,
    });
  });
});
