import test from 'node:test';
import assert from 'node:assert/strict';
import { addSoloReplayToArchive, deleteSoloReplayFromArchive, loadSoloReplayArchive,
  SOLO_REPLAY_ARCHIVE_KEY, SOLO_REPLAY_ARCHIVE_LIMIT, PENDING_SOLO_SUBMISSION_KEY,
  loadPendingSoloSubmission, savePendingSoloSubmission, clearPendingSoloSubmission } from '../src/game/replayArchive.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const validate = (envelope, commands, ticks) => {
  if (!envelope || !Array.isArray(commands) || !Number.isSafeInteger(ticks) || ticks < 1) throw new Error('invalid');
};
function replay(n, version = 1) {
  return { version, envelope: { mode: 'skirmish', startedAt: n }, commands: [{ n }], completedTicks: n };
}

test('migrates a valid legacy replay once and rejects malformed entries', () => {
  const storage = new MemoryStorage();
  const legacy = replay(3);
  storage.setItem('frontier-command-last-replay-v1', JSON.stringify(legacy));
  storage.setItem(SOLO_REPLAY_ARCHIVE_KEY, JSON.stringify([{ id: 'bad', replay: { ...legacy, completedTicks: 0 } }]));
  const entries = loadSoloReplayArchive(storage, validate);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].replay, legacy);
  assert.equal(storage.getItem('frontier-command-last-replay-v1'), null);
  assert.equal(loadSoloReplayArchive(storage, validate).length, 1);
});

test('deleting a migrated replay does not resurrect it from the legacy key', () => {
  const storage = new MemoryStorage();
  storage.setItem('frontier-command-last-replay-v1', JSON.stringify(replay(7)));
  const [entry] = loadSoloReplayArchive(storage, validate);
  assert.equal(deleteSoloReplayFromArchive(entry.id, storage, validate).length, 0);
  assert.deepEqual(loadSoloReplayArchive(storage, validate), []);
});

test('deduplicates equivalent valid replays and replaces malformed metadata and IDs safely', () => {
  const storage = new MemoryStorage();
  const original = replay(8);
  addSoloReplayToArchive(original, { id: 'first' }, storage, validate);
  const reordered = { completedTicks: 8, commands: [{ n: 8 }], envelope: { startedAt: 8, mode: 'skirmish' }, version: 1 };
  const duplicate = addSoloReplayToArchive(reordered, { id: ['bad'], savedAt: Infinity }, storage, validate);
  assert.notEqual(duplicate.id, 'first');
  assert.equal(loadSoloReplayArchive(storage, validate).length, 1);
  assert.equal(loadSoloReplayArchive(storage, validate)[0].id, duplicate.id);
  const saved = JSON.parse(storage.getItem(SOLO_REPLAY_ARCHIVE_KEY));
  saved.push({ id: {}, replay: original }, { id: 'first', replay: original });
  storage.setItem(SOLO_REPLAY_ARCHIVE_KEY, JSON.stringify(saved));
  assert.equal(loadSoloReplayArchive(storage, validate).length, 1);
});

test('keeps the legacy replay when quota prevents migration and preserves the prior archive on write failure', () => {
  const storage = new MemoryStorage();
  const legacy = replay(9);
  storage.setItem('frontier-command-last-replay-v1', JSON.stringify(legacy));
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === SOLO_REPLAY_ARCHIVE_KEY) throw new Error('quota exceeded');
    setItem(key, value);
  };
  assert.deepEqual(loadSoloReplayArchive(storage, validate).map(entry => entry.replay), [legacy]);
  assert.equal(storage.getItem('frontier-command-last-replay-v1'), JSON.stringify(legacy));
  storage.setItem = setItem;
  loadSoloReplayArchive(storage, validate);
  const before = storage.getItem(SOLO_REPLAY_ARCHIVE_KEY);
  storage.setItem = () => { throw new Error('quota exceeded'); };
  assert.throws(() => addSoloReplayToArchive(replay(10), {}, storage, validate), /quota/i);
  assert.equal(storage.getItem(SOLO_REPLAY_ARCHIVE_KEY), before);
});

test('deletes a transient legacy replay only after the archive accepts the deletion', () => {
  const storage = new MemoryStorage();
  const legacy = replay(11);
  storage.setItem('frontier-command-last-replay-v1', JSON.stringify(legacy));
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === SOLO_REPLAY_ARCHIVE_KEY) throw new Error('quota exceeded');
    setItem(key, value);
  };
  const [transient] = loadSoloReplayArchive(storage, validate);
  assert.throws(() => deleteSoloReplayFromArchive(transient.id, storage, validate), /quota/i);
  assert.equal(storage.getItem('frontier-command-last-replay-v1'), JSON.stringify(legacy));
  storage.setItem = setItem;
  assert.deepEqual(deleteSoloReplayFromArchive(transient.id, storage, validate), []);
  assert.equal(storage.getItem('frontier-command-last-replay-v1'), null);
  assert.deepEqual(loadSoloReplayArchive(storage, validate), []);
});

test('keeps only the latest bounded archive entries and deletes one entry by id', () => {
  const storage = new MemoryStorage();
  for (let n = 1; n <= SOLO_REPLAY_ARCHIVE_LIMIT + 2; n++) {
    addSoloReplayToArchive(replay(n), { id: `r${n}`, savedAt: n }, storage, validate);
  }
  let entries = loadSoloReplayArchive(storage, validate);
  assert.equal(entries.length, SOLO_REPLAY_ARCHIVE_LIMIT);
  assert.equal(entries[0].id, `r${SOLO_REPLAY_ARCHIVE_LIMIT + 2}`);
  entries = deleteSoloReplayFromArchive('r5', storage, validate);
  assert.equal(entries.length, SOLO_REPLAY_ARCHIVE_LIMIT - 1);
  assert.equal(entries.some(entry => entry.id === 'r5'), false);
});

test('accepts older replay versions and rejects future versions', () => {
  const storage = new MemoryStorage();
  addSoloReplayToArchive(replay(4, 3), { id: 'old' }, storage, validate);
  assert.equal(loadSoloReplayArchive(storage, validate)[0].id, 'old');
  assert.throws(() => addSoloReplayToArchive(replay(5, 999), {}, storage, validate), /invalid solo replay/i);
});

test('persists only bounded pending ticket identity and clears it after acceptance', () => {
  const storage = new MemoryStorage();
  const pending = { runId: 'run-1', profileId: 'commander-1', replayId: 'replay-1', createdAt: 123 };
  assert.deepEqual(savePendingSoloSubmission(pending, storage), { ...pending, terminalReason: '' });
  assert.deepEqual(loadPendingSoloSubmission(storage), { ...pending, terminalReason: '' });
  assert.equal(storage.getItem(PENDING_SOLO_SUBMISSION_KEY).includes('token'), false);
  assert.throws(() => savePendingSoloSubmission({ ...pending, runId: 'x'.repeat(161) }, storage));
  clearPendingSoloSubmission(storage);
  assert.equal(loadPendingSoloSubmission(storage), null);
});

test('keeps the replay for a pending ranked result when later local battles fill the archive', () => {
  const storage = new MemoryStorage();
  addSoloReplayToArchive(replay(1), { id: 'pending-replay' }, storage, validate);
  savePendingSoloSubmission({ runId: 'run-1', profileId: 'commander-1', replayId: 'pending-replay' }, storage);
  for (let n = 2; n <= SOLO_REPLAY_ARCHIVE_LIMIT + 3; n++)
    addSoloReplayToArchive(replay(n), { id: `r${n}` }, storage, validate);
  const entries = loadSoloReplayArchive(storage, validate);
  assert.equal(entries.length, SOLO_REPLAY_ARCHIVE_LIMIT);
  assert.equal(entries.at(-1).id, 'pending-replay');
  assert.equal(entries[0].id, `r${SOLO_REPLAY_ARCHIVE_LIMIT + 3}`);
});
