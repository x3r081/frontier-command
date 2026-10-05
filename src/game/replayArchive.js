import { validateSoloReplay, SOLO_REPLAY_VERSION } from './replay.js';

export const SOLO_REPLAY_ARCHIVE_KEY = 'frontier-command-replay-archive-v1';
export const SOLO_REPLAY_ARCHIVE_LIMIT = 10;
export const PENDING_SOLO_SUBMISSION_KEY = 'frontier-command-pending-solo-submission-v1';
const LEGACY_REPLAY_KEY = 'frontier-command-last-replay-v1';

function replayKey(replay) {
  // Replay payloads are JSON data. Sorting object keys makes equivalent payloads
  // compare equal even when they were serialized with different key order.
  const stable = value => Array.isArray(value) ? value.map(stable) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  try { return JSON.stringify(stable(replay)); } catch { return null; }
}

function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 160; }

// The run ticket and profile identity are safe to persist; the bearer token is
// deliberately owned only by NetworkClient and never written here.
export function loadPendingSoloSubmission(storage = localStorage) {
  try {
    const pending = JSON.parse(storage.getItem(PENDING_SOLO_SUBMISSION_KEY) || 'null');
    if (!pending || !validId(pending.runId) || !validId(pending.profileId) ||
        !validId(pending.replayId) || !Number.isFinite(pending.createdAt)) return null;
    return { runId: pending.runId, profileId: pending.profileId, replayId: pending.replayId, createdAt: pending.createdAt,
      terminalReason: typeof pending.terminalReason === 'string' && pending.terminalReason.length <= 240 ? pending.terminalReason : '' };
  } catch { return null; }
}

export function savePendingSoloSubmission(pending, storage = localStorage) {
  if (!pending || !validId(pending.runId) || !validId(pending.profileId) || !validId(pending.replayId))
    throw new Error('Cannot save an invalid pending solo submission.');
  const value = { runId: pending.runId, profileId: pending.profileId, replayId: pending.replayId,
    createdAt: Number.isFinite(pending.createdAt) ? pending.createdAt : Date.now(),
    terminalReason: typeof pending.terminalReason === 'string' ? pending.terminalReason.slice(0, 240) : '' };
  storage.setItem(PENDING_SOLO_SUBMISSION_KEY, JSON.stringify(value));
  return value;
}

export function clearPendingSoloSubmission(storage = localStorage) {
  storage.removeItem(PENDING_SOLO_SUBMISSION_KEY);
}

function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  try { return JSON.parse(JSON.stringify(metadata)); } catch { return {}; }
}

function validReplay(replay, validate = validateSoloReplay) {
  try {
    if (!Number.isInteger(replay?.version) || replay.version < 1 || replay.version > SOLO_REPLAY_VERSION) return false;
    validate(replay.envelope, replay.commands, replay.completedTicks);
    return true;
  } catch { return false; }
}

function readArchive(storage, validate) {
  try {
    const saved = JSON.parse(storage.getItem(SOLO_REPLAY_ARCHIVE_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    const ids = new Set();
    const replays = new Set();
    return saved.filter(item => {
      if (!item || !validId(item.id) || ids.has(item.id) || !validReplay(item.replay, validate)) return false;
      const key = replayKey(item.replay);
      if (!key || replays.has(key)) return false;
      ids.add(item.id);
      replays.add(key);
      item.metadata = cleanMetadata(item.metadata);
      if (!Number.isFinite(item.savedAt)) item.savedAt = Number.isFinite(item.metadata.savedAt) ? item.metadata.savedAt : 0;
      return true;
    }).slice(0, SOLO_REPLAY_ARCHIVE_LIMIT);
  } catch { return []; }
}

function writeArchive(storage, entries) {
  storage.setItem(SOLO_REPLAY_ARCHIVE_KEY, JSON.stringify(entries.slice(0, SOLO_REPLAY_ARCHIVE_LIMIT)));
}

function boundedWithPendingReplay(entries, storage) {
  const bounded = entries.slice(0, SOLO_REPLAY_ARCHIVE_LIMIT);
  const pendingId = loadPendingSoloSubmission(storage)?.replayId;
  if (pendingId && !bounded.some(entry => entry.id === pendingId)) {
    const pending = entries.find(entry => entry.id === pendingId);
    if (pending && bounded.length === SOLO_REPLAY_ARCHIVE_LIMIT) bounded[bounded.length - 1] = pending;
  }
  return bounded;
}

export function loadSoloReplayArchive(storage = localStorage, validate = validateSoloReplay) {
  const entries = readArchive(storage, validate);
  let migrated = false;
  let legacyPresent = false;
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_REPLAY_KEY) || 'null');
    if (validReplay(legacy, validate)) {
      legacyPresent = true;
      if (!entries.some(entry => replayKey(entry.replay) === replayKey(legacy))) {
        const startedAt = Number.isFinite(legacy.envelope?.startedAt) ? legacy.envelope.startedAt : Date.now();
        entries.unshift({ id: `legacy-${startedAt}`, savedAt: startedAt, metadata: {}, replay: legacy });
        migrated = true;
      }
    }
  } catch { /* Keep the archive usable when the legacy key is malformed. */ }
  const bounded = boundedWithPendingReplay(entries, storage);
  if (legacyPresent || migrated || bounded.length !== entries.length) {
    // Keep the legacy copy until the archive write succeeds. Once copied, remove
    // the old key so deleting the archive entry cannot resurrect it on next load.
    try {
      writeArchive(storage, bounded);
      if (legacyPresent) {
        try { storage.removeItem(LEGACY_REPLAY_KEY); } catch { /* The archive copy is safe; dedupe prevents duplicate migration. */ }
      }
    } catch { /* A quota failure must leave the old archive and legacy source intact. */
    }
  }
  return bounded;
}

export function addSoloReplayToArchive(replay, metadata = {}, storage = localStorage, validate = validateSoloReplay) {
  if (!validReplay(replay, validate)) throw new Error('Cannot archive an invalid solo replay.');
  const entries = readArchive(storage, validate);
  metadata = cleanMetadata(metadata);
  const id = validId(metadata.id) ? metadata.id : `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const savedAt = Number.isFinite(metadata.savedAt) ? metadata.savedAt : Date.now();
  metadata = { ...metadata, id, savedAt };
  const key = replayKey(replay);
  const entry = { id, savedAt, metadata, replay };
  const next = [entry, ...entries.filter(item => item.id !== id && replayKey(item.replay) !== key)];
  writeArchive(storage, boundedWithPendingReplay(next, storage));
  return entry;
}

export function deleteSoloReplayFromArchive(id, storage = localStorage, validate = validateSoloReplay) {
  const entries = readArchive(storage, validate);
  let legacyPresent = false;
  try {
    const candidate = JSON.parse(storage.getItem(LEGACY_REPLAY_KEY) || 'null');
    if (validReplay(candidate, validate)) {
      legacyPresent = true;
      if (!entries.some(entry => replayKey(entry.replay) === replayKey(candidate))) {
        const startedAt = Number.isFinite(candidate.envelope?.startedAt) ? candidate.envelope.startedAt : Date.now();
        entries.unshift({ id: `legacy-${startedAt}`, savedAt: startedAt, metadata: {}, replay: candidate });
      }
    }
  } catch { /* Ignore malformed legacy data. */ }
  const remaining = entries.filter(entry => entry.id !== id);
  writeArchive(storage, remaining);
  // A transient migration entry can be deleted before quota allows it to be
  // copied into the archive. Remove its source only after the delete is saved.
  if (legacyPresent) storage.removeItem(LEGACY_REPLAY_KEY);
  return remaining;
}
