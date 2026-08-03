function normalizeMediaUrl(value) {
  return String(value || '').trim();
}

export function hasDistinctHdSource(media = {}) {
  const url = normalizeMediaUrl(media.url);
  const hdUrl = normalizeMediaUrl(media.hdUrl);
  return Boolean(hdUrl && hdUrl !== url);
}

export function getPreferredMediaUrl(media = {}) {
  return normalizeMediaUrl(media.hdUrl) || normalizeMediaUrl(media.url);
}

export function getMediaSourceQuality(media = {}) {
  if (media.platform !== '微信视频号') return '';
  if (hasDistinctHdSource(media) || media.sourceQuality === 'hd') return 'hd';
  return media.sourceQuality === 'best_available' ? 'best_available' : '';
}
