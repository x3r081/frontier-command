import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS, INFANTRY_DIG_IN_RULES_VERSION } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';
import { runInfantryDigInPlaytest } from '../scripts/infantry-dig-in-playtest.js';

const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: SKIRMISH_MAPS[0].id, victoryMode: 'elimination' };

test('real projectile impacts preserve frontal protection and its flank and explosive counters', () => {
  const cases = runInfantryDigInPlaytest();
  for (const row of cases) assert.equal(row.damageRatio,
    ['frontal-rifle', 'frontal-cannon'].includes(row.id) ? .8 : 1, row.id);
});

test('paid mixed infantry Dig In and interrupted movement replay exactly at 30 Hz', () => {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId, replayVersion: 74 });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const advance = ticks => {
    for (let i = 0; i < ticks; i++) {
      game.update(SOLO_STEP_SECONDS);
      clock.completedTicks++;
    }
  };
  assert.equal(game.queueUnit('rocket').ok, true);
  advance(30 * 10);
  const infantry = game.units.filter(unit => unit.owner === 'player' && ['rifle', 'rocket'].includes(unit.defId));
  assert.ok(infantry.some(unit => unit.defId === 'rocket'), 'the paid Rocket Trooper was produced');
  game.select(infantry.map(unit => unit.id));
  assert.equal(game.issueDigIn(25.5, 30.5).ok, true);
  advance(30 * 3);
  const saved = Game.deserialize(game.serialize());
  assert.deepEqual(saved.getEntity(infantry[0].id).order, infantry[0].order);
  assert.equal(game.issueMove(15.5, 36.5, false, true).ok, true,
    'a queued move interrupts the static stance under the existing queue policy');
  advance(30 * 5);
  recorder.dispose();
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 74);
  playback.step(clock.completedTicks);
  const state = value => ({ units: value.units, buildings: value.buildings, credits: value.credits,
    time: value.time, effects: value.effects, status: value.status, wrecks: value.wrecks });
  assert.deepEqual(state(playback.game), state(game));
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, 74), true);
  assert.throws(() => createSoloPlayback(envelope, recorder.commands, clock.completedTicks,
    INFANTRY_DIG_IN_RULES_VERSION - 1), /Dig In requires replay version 74/);
});
