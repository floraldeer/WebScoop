import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import CONFIG from './const';

const SETTINGS_PATH = path.join(CONFIG.HOME_PATH, 'settings.json');

const DEFAULT_SETTINGS = {
  downloadDir: '',
};

export function getSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSettings(patch) {
  const next = { ...getSettings(), ...(patch || {}) };
  try {
    fs.mkdirSync(CONFIG.HOME_PATH, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  } catch (e) {
    log.error('[settings] write failed:', String((e && e.message) || e));
  }
  return next;
}
