import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { get } from 'axios';
import { downloadFile, getAvailableFilePath } from '../../electron/utils';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

describe('download file paths', () => {
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
