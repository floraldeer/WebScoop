import { extractFirstHttpUrl } from '../constants';

describe('clipboard URL extraction', () => {
  test('extracts a URL from platform share text', () => {
    expect(extractFirstHttpUrl('复制打开 https://v.douyin.com/example/ 查看视频')).toBe(
      'https://v.douyin.com/example/',
    );
  });

  test('removes trailing share punctuation', () => {
    expect(extractFirstHttpUrl('链接：https://youtu.be/example。')).toBe(
      'https://youtu.be/example',
    );
  });

  test('rejects text without an HTTP URL', () => {
    expect(extractFirstHttpUrl('没有链接')).toBe('');
    expect(extractFirstHttpUrl('file:///tmp/video.mp4')).toBe('');
  });
});
