import fs from 'fs';
import path from 'path';

jest.mock('../../electron/const', () => {
  const fsMod = require('fs');
  const osMod = require('os');
  const pathMod = require('path');
  const home = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'webscoop-settings-test-'));
  return {
    __esModule: true,
    default: { HOME_PATH: home },
  };
});

import { getSettings, updateSettings } from '../../electron/appSettings';
import CONFIG from '../../electron/const';

describe('appSettings', () => {
  afterAll(() => {
    fs.rmSync(CONFIG.HOME_PATH, { recursive: true, force: true });
  });

  test('returns defaults before any write', () => {
    expect(getSettings()).toEqual({ downloadDir: '' });
  });

  test('persists and merges updates', () => {
    const next = updateSettings({ downloadDir: '/tmp/videos' });
    expect(next.downloadDir).toBe('/tmp/videos');
    expect(getSettings().downloadDir).toBe('/tmp/videos');
    expect(fs.existsSync(path.join(CONFIG.HOME_PATH, 'settings.json'))).toBe(true);
  });
});
