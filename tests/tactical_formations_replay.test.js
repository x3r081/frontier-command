import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: SKIRMISH_MAPS[0].id, victoryMode: 'elimination' };

test('formation orders and queued turns replay the opening force exactly at 30 Hz', () => {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId, replayVersion: 76 });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const advance = ticks => {
    for (let i = 0; i < ticks; i++) {
      game.update(SOLO_STEP_SECONDS);
      clock.completedTicks++;
    }
  };
  const units = game.units.filter(unit => unit.owner === 'player' &&
    ['rifle', 'scout', 'lightTank'].includes(unit.defId));
  game.select(units.map(unit => unit.id));
  assert.equal(game.issueFormationMove(16.5, 32.5, 'screen', 'forceMove', false, true).ok, true);
  assert.equal(game.issueFormationMove(23.5, 32.5, 'column', 'move', true, true).ok, true);
  advance(30 * 12);
  game.select(units.map(unit => unit.id));
  assert.equal(game.issueFormationMove(20.5, 27.5, 'line', 'attackMove').ok, true);
  advance(30 * 3);
  recorder.dispose();
  assert.equal(recorder.commands.length, 3);
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, 76), true);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 76);
  playback.step(clock.completedTicks);
  const state = value => ({ units: value.units, buildings: value.buildings, credits: value.credits,
    time: value.time, effects: value.effects, wrecks: value.wrecks, status: value.status });
  assert.deepEqual(state(playback.game), state(game));
});

test('legacy and malformed formation replay commands are rejected', () => {
  const command = { tick: 0, sequence: 0, method: 'issueFormationMove',
    args: [16.5, 32.5, 'screen', 'move', false, true], selectedIds: [] };
  assert.throws(() => createSoloPlayback(envelope, [command], 1, 75), /formations require replay version 76/i);
  for (const args of [
    [16.5, 32.5, 'unknown'], [16.5, 32.5, 'screen', 'reverse'],
    [16.5, 32.5, 'screen', 'move', 'true'], [16.5, 32.5, 'screen', 'move', false, 1],
    ['16.5', 32.5, 'line'],
  ]) assert.throws(() => validateSoloReplay(envelope, [{ ...command, args }], 1, 76), /invalid solo command/i);
});
