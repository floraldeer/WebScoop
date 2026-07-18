import fs from 'fs';

jest.mock('../../electron/const', () => {
  const fsMod = require('fs');
  const osMod = require('os');
  const pathMod = require('path');
  const home = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'webscoop-history-test-'));
  return {
    __esModule: true,
    default: { HOME_PATH: home },
  };
});

import { getHistory, addHistoryRecord, clearHistory } from '../../electron/downloadHistory';
import CONFIG from '../../electron/const';

describe('downloadHistory', () => {
  afterAll(() => {
    fs.rmSync(CONFIG.HOME_PATH, { recursive: true, force: true });
  });

  test('starts empty', () => {
    expect(getHistory()).toEqual([]);
  });

  test('prepends new records with a timestamp', () => {
    addHistoryRecord({
      fullFileName: '/a/1.mp4',
      description: '视频1',
      platform: '抖音',
      size: 10,
    });
    addHistoryRecord({ fullFileName: '/a/2.mp4', description: '视频2' });
    const all = getHistory();
    expect(all).toHaveLength(2);
    expect(all[0].description).toBe('视频2');
    expect(all[1]).toMatchObject({ fullFileName: '/a/1.mp4', platform: '抖音', size: 10 });
    expect(typeof all[0].downloadedAt).toBe('string');
  });

  test('clears history', () => {
    clearHistory();
    expect(getHistory()).toEqual([]);
  });
});
