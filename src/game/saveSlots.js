export const SAVE_KEY = 'frontier-command-save-v1';
export const SAVE_SLOTS_KEY = 'frontier-command-save-slots-v1';
export const SAVE_SLOT_COUNT = 3;

const emptySlots = () => Object.fromEntries(Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => [String(index + 1), null]));

const slotId = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= SAVE_SLOT_COUNT
  ? String(Number(value)) : null;

function parse(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function readSlots(storage) {
  const parsed = parse(storage.getItem(SAVE_SLOTS_KEY));
  if (!parsed || typeof parsed !== 'object') return emptySlots();
  return Object.fromEntries(Array.from({ length: SAVE_SLOT_COUNT }, (_, index) => String(index + 1))
    .map(id => [id, parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : null]));
}

/** Migrate the former single-save key into slot 1, preserving its payload verbatim. */
export function migrateLegacySave(storage = localStorage, now = Date.now) {
  const slots = readSlots(storage);
  // An initialized archive, including one whose slots were deliberately cleared,
  // must never repopulate itself from a stale legacy key.
  const archive = parse(storage.getItem(SAVE_SLOTS_KEY));
  if (archive && !Array.isArray(archive)) return slots;
  const legacy = parse(storage.getItem(SAVE_KEY));
  if (!legacy) return slots;
  slots['1'] = { data: legacy, savedAt: now() };
  storage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
  storage.removeItem(SAVE_KEY);
  return slots;
}

export function listSaveSlots(storage = localStorage) {
  return migrateLegacySave(storage);
}

export function getSaveSlot(id, storage = localStorage) {
  const key = slotId(id);
  return key ? listSaveSlots(storage)[key] : null;
}

export function writeSaveSlot(id, data, metadata = {}, storage = localStorage, now = Date.now) {
  const key = slotId(id);
  if (!key) throw new RangeError('Save slot must be 1, 2, or 3');
  const slots = listSaveSlots(storage);
  slots[key] = { data, savedAt: now(), metadata: { ...metadata } };
  storage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
  return slots[key];
}

export function deleteSaveSlot(id, storage = localStorage) {
  const key = slotId(id);
  if (!key) return false;
  const slots = listSaveSlots(storage);
  if (!slots[key]) return false;
  slots[key] = null;
  storage.setItem(SAVE_SLOTS_KEY, JSON.stringify(slots));
  return true;
}
