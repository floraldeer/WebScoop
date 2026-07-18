const DEFAULT_ENTRY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TARGET_TTL_MS = 10 * 60 * 1000;
const DEFAULT_COMPLETED_TARGET_TTL_MS = 15 * 1000;
const DEFAULT_CAPTURE_TTL_MS = 30 * 60 * 1000;

const normalizeText = value =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeKey = value => {
  const key = String(value || '').trim();
  if (!key) return '';
  try {
    return decodeURIComponent(key);
  } catch (e) {
    return key;
  }
};

const isGenericDescription = value => /^(微信视频号视频|视频号视频|网络视频|未命名视频)$/.test(normalizeText(value));

export function createWechatCaptureCoordinator({
  onCapture,
  now = Date.now,
  entryTtlMs = DEFAULT_ENTRY_TTL_MS,
  targetTtlMs = DEFAULT_TARGET_TTL_MS,
  completedTargetTtlMs = DEFAULT_COMPLETED_TARGET_TTL_MS,
  captureTtlMs = DEFAULT_CAPTURE_TTL_MS,
} = {}) {
  const candidates = new Map();
  const activeKeys = new Map();
  const captured = new Map();
  let target = null;
  let candidateSequence = 0;

  const cleanupMap = (map, ttl) => {
    const currentTime = now();
    for (const [key, value] of map) {
      if (currentTime - value.seenAt > ttl) map.delete(key);
    }
  };

  const cleanup = () => {
    cleanupMap(candidates, entryTtlMs);
    cleanupMap(activeKeys, entryTtlMs);
    cleanupMap(captured, captureTtlMs);
    if (target && now() > target.expiresAt) target = null;
  };

  const matchesTarget = candidate => {
    if (!target) return true;
    if (target.completed || !candidate.current) return false;

    const targetUploader = normalizeText(target.uploader);
    const candidateUploader = normalizeText(candidate.uploader);
    const targetDescription = normalizeText(target.description);
    const hasStrongTargetIdentity = targetDescription && !isGenericDescription(targetDescription);
    if (!hasStrongTargetIdentity && candidate.sequence <= target.candidateSequence) return false;
    if (targetUploader && candidateUploader && targetUploader !== candidateUploader) return false;

    const candidateDescription = normalizeText(candidate.description);
    if (targetDescription && candidateDescription && !isGenericDescription(targetDescription) && !isGenericDescription(candidateDescription) && targetDescription !== candidateDescription) {
      return false;
    }
    return true;
  };

  const captureIdOf = candidate => normalizeText(candidate.decode_key) || normalizeText(candidate.objectId) || normalizeKey(candidate.keys && candidate.keys[0]);

  const tryCapture = candidate => {
    if (!candidate || !matchesTarget(candidate)) return false;
    const captureId = captureIdOf(candidate);
    if (!captureId || captured.has(captureId)) return false;

    captured.set(captureId, { seenAt: now() });
    const result = {
      ...candidate,
      shareUrl: target ? target.shareUrl : candidate.shareUrl || '',
    };
    if (target) {
      target.completed = true;
      target.expiresAt = now() + completedTargetTtlMs;
    }
    if (typeof onCapture === 'function') onCapture(result);
    return true;
  };

  const addCandidate = input => {
    cleanup();
    if (!input || !input.url || !input.decode_key) return false;
    const keys = Array.from(new Set((input.keys || []).map(normalizeKey).filter(Boolean)));
    if (!keys.length) return false;

    const candidate = { ...input, keys, seenAt: now(), sequence: ++candidateSequence };
    for (const key of keys) candidates.set(key, candidate);
    for (const key of keys) {
      if (activeKeys.has(key) && tryCapture(candidate)) return true;
    }
    return false;
  };

  const markActive = inputKey => {
    cleanup();
    const key = normalizeKey(inputKey);
    if (!key) return false;
    activeKeys.set(key, { seenAt: now() });
    return tryCapture(candidates.get(key));
  };

  const setTarget = input => {
    cleanup();
    if (!input || !input.shareUrl) {
      target = null;
      return;
    }
    target = {
      shareUrl: String(input.shareUrl),
      description: input.description || '',
      uploader: input.uploader || '',
      shortUri: input.shortUri || '',
      dynamicExportId: input.dynamicExportId || '',
      createdAt: now(),
      candidateSequence,
      expiresAt: now() + targetTtlMs,
      completed: false,
    };
    const targetDescription = normalizeText(target.description);
    if (targetDescription && !isGenericDescription(targetDescription)) {
      for (const candidate of candidates.values()) {
        if (candidate.keys.some(key => activeKeys.has(key)) && tryCapture(candidate)) break;
      }
    }
  };

  return {
    addCandidate,
    markActive,
    setTarget,
    cleanup,
  };
}
