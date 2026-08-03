import { getMediaSourceQuality, getPreferredMediaUrl, hasDistinctHdSource } from '../mediaSource';

describe('preferred media source', () => {
  test('prefers an HD URL when available', () => {
    expect(getPreferredMediaUrl({ url: 'https://cdn/normal', hdUrl: 'https://cdn/hd' })).toBe(
      'https://cdn/hd',
    );
  });

  test('falls back to the normal URL', () => {
    expect(getPreferredMediaUrl({ url: 'https://cdn/normal', hdUrl: '' })).toBe(
      'https://cdn/normal',
    );
  });

  test('recognizes a distinct HD source', () => {
    expect(hasDistinctHdSource({ url: 'https://cdn/normal', hdUrl: 'https://cdn/hd' })).toBe(true);
  });

  test('does not mark the same URL as an independent HD source', () => {
    expect(hasDistinctHdSource({ url: 'https://cdn/video', hdUrl: 'https://cdn/video' })).toBe(
      false,
    );
  });

  test('derives HD quality from a distinct HD URL', () => {
    expect(
      getMediaSourceQuality({
        platform: '微信视频号',
        url: 'https://cdn/normal',
        hdUrl: 'https://cdn/hd',
      }),
    ).toBe('hd');
  });

  test('keeps highest available quality for a single WeChat source', () => {
    expect(
      getMediaSourceQuality({
        platform: '微信视频号',
        url: 'https://cdn/only',
        sourceQuality: 'best_available',
      }),
    ).toBe('best_available');
  });

  test('does not label unrelated platform sources', () => {
    expect(
      getMediaSourceQuality({
        platform: '抖音',
        url: 'https://cdn/only',
        sourceQuality: 'best_available',
      }),
    ).toBe('');
  });
});
