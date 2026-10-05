import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, SAVE_SLOTS_KEY, listSaveSlots, getSaveSlot, writeSaveSlot, deleteSaveSlot } from '../src/game/saveSlots.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('migrates the former single save into slot 1 without changing its snapshot', () => {
  const storage = new MemoryStorage();
  const legacy = { game: { mapId: 'shard-valley', entities: [{ id: 4 }] }, simulationTick: 812, groups: { 1: [4] }, mode: 'campaign', doctrineId: 'rapid', fieldOrderId: 'hold', carryoverId: 'signal' };
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  const slots = listSaveSlots(storage);
  assert.deepEqual(slots['1'].data, legacy);
  assert.equal(slots['1'].savedAt > 0, true);
  assert.equal(slots['2'], null);
  assert.equal(slots['3'], null);
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.ok(storage.getItem(SAVE_SLOTS_KEY));
});

test('three slots keep independent payloads and support replacement and deletion', () => {
  const storage = new MemoryStorage();
  let clock = 100;
  writeSaveSlot(1, { gameSeconds: 61, doctrineId: 'standard' }, { scenario: 'First Harvest' }, storage, () => clock++);
  writeSaveSlot(2, { gameSeconds: 92, map: 'shard-valley' }, {}, storage, () => clock++);
  writeSaveSlot(3, { gameSeconds: 120, groups: { 2: [8] } }, {}, storage, () => clock++);
  assert.equal(getSaveSlot(1, storage).data.doctrineId, 'standard');
  assert.equal(getSaveSlot(2, storage).data.map, 'shard-valley');
  assert.deepEqual(getSaveSlot(3, storage).data.groups, { 2: [8] });
  writeSaveSlot(2, { replacement: true }, {}, storage, () => clock++);
  assert.deepEqual(getSaveSlot(2, storage).data, { replacement: true });
  assert.equal(deleteSaveSlot(1, storage), true);
  assert.equal(getSaveSlot(1, storage), null);
  assert.equal(deleteSaveSlot(1, storage), false);
  assert.deepEqual(getSaveSlot(3, storage).data.groups, { 2: [8] });
});

test('rejects invalid slot writes and ignores malformed legacy data', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, '{bad json');
  assert.equal(listSaveSlots(storage)['1'], null);
  assert.throws(() => writeSaveSlot(4, {}, {}, storage), RangeError);
  assert.equal(deleteSaveSlot(0, storage), false);
});

test('an emptied slot archive does not revive a stale legacy save', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_SLOTS_KEY, JSON.stringify({ 1: null, 2: null, 3: null }));
  storage.setItem(SAVE_KEY, JSON.stringify({ game: { mapId: 'shard-valley' } }));
  assert.deepEqual(listSaveSlots(storage), { 1: null, 2: null, 3: null });
  assert.equal(storage.getItem(SAVE_KEY) !== null, true);
});
