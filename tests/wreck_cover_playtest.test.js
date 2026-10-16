import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { playWreckCoverEncounter, runWreckCoverPlaytest } from '../scripts/wreck-cover-playtest.js';

test('ordinary vehicle destruction and Engineer salvage preserve the intended cover counters', () => {
  for (const row of runWreckCoverPlaytest()) {
    const protectedShot = ['frontal-rifle', 'frontal-cannon'].includes(row.id);
    assert.equal(row.damageRatio, protectedShot ? .8 : 1, row.id);
    assert.equal(row.sheltered.coverImpacts, protectedShot ? 1 : 0, row.id);
    assert.equal(row.exposed.wreckRetained, false, 'the real salvage channel removed the cover');
    assert.equal(row.sheltered.wreckRetained, true);
  }
});

test('a live wreck encounter saves and continues identically through a subsequent projectile impact', () => {
  const { game, target } = playWreckCoverEncounter();
  const resumed = Game.deserialize(game.serialize());
  assert.deepEqual(resumed.wrecks, game.wrecks);
  const initialHp = target.hp;
  for (let tick = 0; tick < 60; tick++) { game.update(1/30); resumed.update(1/30); }
  assert.ok(target.hp < initialHp, 'a further ordinary shot arrived after recovery');
  // Normalize the older recommission fields that deserialization supplies as defaults.
  const expected = Game.deserialize(game.serialize());
  for (const key of ['units', 'buildings', 'wrecks', 'effects', 'time', 'credits', 'status'])
    assert.deepEqual(resumed[key], expected[key], key);
});
