import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import CONFIG from './const';

const HISTORY_PATH = path.join(CONFIG.HOME_PATH, 'history.json');
const MAX_RECORDS = 500;

function readAll() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeAll(records) {
  try {
    fs.mkdirSync(CONFIG.HOME_PATH, { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(records.slice(0, MAX_RECORDS), null, 2));
  } catch (e) {
    log.error('[history] write failed:', String((e && e.message) || e));
  }
}

export function getHistory() {
  return readAll();
}

export function addHistoryRecord(record) {
  const records = readAll();
  records.unshift({
    fullFileName: record.fullFileName || '',
    description: record.description || '',
    platform: record.platform || '',
    size: record.size || 0,
    url: record.url || '',
    downloadedAt: new Date().toISOString(),
  });
  writeAll(records);
  return records;
}

export function clearHistory() {
  writeAll([]);
  return [];
}
