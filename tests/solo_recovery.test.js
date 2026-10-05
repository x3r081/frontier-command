import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSoloRecovery, loadSoloRecovery, saveSoloRecovery,
  SOLO_RECOVERY_KEY, SOLO_RECOVERY_MAX_CHARS } from '../src/game/soloRecovery.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const checkpoint = (mode = 'skirmish') => ({
  game: JSON.stringify({ mode, status: 'playing', time: 20 }),
  mode,
  simulationTick: 600,
});

test('solo recovery stores one bounded versioned snapshot and clears it explicitly', () => {
  const storage = new MemoryStorage();
  assert.equal(saveSoloRecovery(checkpoint(), storage, () => 1234), true);
  const recovery = loadSoloRecovery(storage);
  assert.equal(recovery.version, 1);
  assert.equal(recovery.savedAt, 1234);
  assert.deepEqual(recovery.data, checkpoint());
  assert.equal(storage.values.has(SOLO_RECOVERY_KEY), true);
  assert.equal(clearSoloRecovery(storage), true);
  assert.equal(loadSoloRecovery(storage), null);
});

test('solo recovery rejects multiplayer, terminal, malformed, and oversized checkpoints', () => {
  const storage = new MemoryStorage();
  assert.equal(saveSoloRecovery(checkpoint('multiplayer'), storage), false);
  assert.equal(saveSoloRecovery({ ...checkpoint(), mode: 'campaign' }, storage), false);
  assert.equal(saveSoloRecovery({ ...checkpoint(), game: '{"mode":"skirmish","status":"victory"}' }, storage), false);
  assert.equal(saveSoloRecovery({ ...checkpoint(), game: 'not-json' }, storage), false);
  assert.equal(saveSoloRecovery({ ...checkpoint(), game: ' '.repeat(SOLO_RECOVERY_MAX_CHARS) }, storage), false);
  assert.equal(loadSoloRecovery(storage), null);
  storage.setItem(SOLO_RECOVERY_KEY, '{bad');
  assert.equal(loadSoloRecovery(storage), null);
});

test('storage quota errors do not interrupt solo play and malformed records are ignored', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(saveSoloRecovery(checkpoint(), broken), false);
  assert.equal(loadSoloRecovery(broken), null);
  assert.equal(clearSoloRecovery(broken), false);
});
