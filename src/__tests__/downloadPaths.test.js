import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { get } from 'axios';
import {
  downloadFile,
  findExistingFilePath,
  getAvailableFilePath,
  getPreferredFilePath,
  normalizeMediaExtension,
} from '../../electron/utils';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

describe('download file paths', () => {
  test('builds the preferred path used for duplicate checks', () => {
    expect(getPreferredFilePath('/downloads', '视频', '.mp4')).toBe('/downloads/视频.mp4');
    expect(getPreferredFilePath('/downloads', '歌曲', 'm4a')).toBe('/downloads/歌曲.m4a');
  });

  test('finds original and numbered duplicate files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webscoop-'));
    fs.writeFileSync(path.join(directory, '视频 (2).mp4'), 'duplicate');

    expect(findExistingFilePath(directory, '视频')).toBe(path.join(directory, '视频 (2).mp4'));
    expect(findExistingFilePath(directory, '其他')).toBe('');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('adds a numeric suffix instead of overwriting', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webscoop-'));
    const first = path.join(directory, '视频.mp4');
    const second = path.join(directory, '视频 (1).mp4');
    fs.writeFileSync(first, 'first');
    fs.writeFileSync(second, 'second');

    expect(getAvailableFilePath(directory, '视频')).toBe(path.join(directory, '视频 (2).mp4'));
    expect(fs.readFileSync(first, 'utf8')).toBe('first');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('uses a supported audio extension when reserving file names', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webscoop-'));
    const first = path.join(directory, '歌曲.m4a');
    fs.writeFileSync(first, 'first');

    expect(getAvailableFilePath(directory, '歌曲', '.m4a')).toBe(
      path.join(directory, '歌曲 (1).m4a'),
    );
    expect(normalizeMediaExtension('m4a')).toBe('.m4a');
    expect(normalizeMediaExtension('.exe')).toBe('.mp4');
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('removes the partial file when the response stream fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webscoop-'));
    const target = path.join(directory, 'failed.mp4');
    let started = false;
    const source = new Readable({
      read() {
        if (started) return;
        started = true;
        this.push(Buffer.from('partial'));
        setTimeout(() => this.destroy(new Error('network failed')), 0);
      },
    });
    get.mockResolvedValue({
      data: source,
      headers: { 'content-length': '100' },
    });

    await expect(downloadFile('https://example.com/video.mp4', '', target)).rejects.toThrow(
      'network failed',
    );
    expect(fs.existsSync(target)).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
