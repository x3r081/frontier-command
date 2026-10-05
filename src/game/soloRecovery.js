export const SOLO_RECOVERY_KEY = 'frontier-command-solo-recovery-v1';
export const SOLO_RECOVERY_MAX_CHARS = 2_000_000;

function isSoloCheckpoint(data) {
  if (!data || typeof data !== 'object' || !['campaign', 'skirmish'].includes(data.mode) ||
      typeof data.game !== 'string' || data.game.length === 0 ||
      !Number.isSafeInteger(data.simulationTick) || data.simulationTick < 0) return false;
  try {
    const game = JSON.parse(data.game);
    return game && typeof game === 'object' && game.status === 'playing' && game.mode === data.mode;
  } catch { return false; }
}

export function loadSoloRecovery(storage) {
  try {
    storage ??= globalThis.sessionStorage;
    const raw = storage?.getItem(SOLO_RECOVERY_KEY);
    if (!raw || raw.length > SOLO_RECOVERY_MAX_CHARS) return null;
    const record = JSON.parse(raw);
    return record?.version === 1 && Number.isFinite(record.savedAt) && isSoloCheckpoint(record.data)
      ? record : null;
  } catch { return null; }
}

export function saveSoloRecovery(data, storage, now = Date.now) {
  if (!isSoloCheckpoint(data)) return false;
  try {
    storage ??= globalThis.sessionStorage;
    if (!storage) return false;
    const raw = JSON.stringify({ version: 1, savedAt: now(), data });
    if (raw.length > SOLO_RECOVERY_MAX_CHARS) return false;
    storage?.setItem(SOLO_RECOVERY_KEY, raw);
    return true;
  } catch { return false; }
}

export function clearSoloRecovery(storage) {
  try { storage ??= globalThis.sessionStorage; storage?.removeItem(SOLO_RECOVERY_KEY); return !!storage; }
  catch { return false; }
}
