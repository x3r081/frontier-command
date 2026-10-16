import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };

function advance(game, clock, ticks) {
  for (let tick = 0; tick < ticks; tick++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
  }
}

function stateView(game, barracksId) {
  const barracks = game.getEntity(barracksId);
  return {
    credits: game.credits,
    queue: barracks.queue,
    repeatUnitDefId: barracks.repeatUnitDefId,
    units: game.units,
    buildings: game.buildings,
    terrain: game.terrain,
    effects: game.effects,
    time: game.time,
    status: game.status,
  };
}

test('automatic rifle training records only intent changes and replays paid insertions exactly', () => {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId });
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const startingRifles = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle').length;
  const startingCredits = game.credits.player;
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);

  assert.equal(game.setProductionRepeat(barracks.id, 'rifle').ok, true);
  game.update(SOLO_STEP_SECONDS);
  clock.completedTicks++;
  assert.equal(barracks.queue.length, 1, 'ordinary simulation update creates and pays for the first automatic job');
  assert.equal(game.credits.player, startingCredits - game.unitDefs.rifle.cost);

  // Let the first rifle complete. The ordinary update loop then pays for the next one.
  advance(game, clock, 160);
  assert.equal(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle').length, startingRifles + 1);
  assert.equal(barracks.queue.length, 1);
  assert.equal(barracks.queue[0].defId, 'rifle');
  assert.ok(barracks.queue[0].progress > 0, 'the second automatic job has begun and is paid');
  assert.equal(game.credits.player, startingCredits - game.unitDefs.rifle.cost * 2);

  const paidProgress = barracks.queue[0].progress;
  const paidCredits = game.credits.player;
  assert.equal(game.setProductionRepeat(barracks.id, null).ok, true);
  assert.equal(barracks.repeatUnitDefId, null);
  assert.equal(barracks.queue.length, 1, 'disabling repeat preserves the current paid job');
  assert.equal(barracks.queue[0].progress, paidProgress);
  assert.equal(game.credits.player, paidCredits);
  advance(game, clock, 160);
  assert.equal(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle').length, startingRifles + 2);
  assert.equal(barracks.queue.length, 0, 'no third job starts after the repeat intent is cleared');

  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => command.method), ['setProductionRepeat', 'setProductionRepeat']);
  assert.deepEqual(recorder.commands.map(command => command.args), [[barracks.id, 'rifle'], [barracks.id, null]]);
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, 78), true);

  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 78);
  playback.step(clock.completedTicks);
  assert.deepEqual(stateView(playback.game, barracks.id), stateView(game, barracks.id));
});

test('automatic training commands are rejected for v77 playback and malformed arguments', () => {
  const command = { tick: 0, sequence: 0, method: 'setProductionRepeat', args: ['b4', 'rifle'], selectedIds: [] };
  assert.throws(() => createSoloPlayback(envelope, [command], 1, 77), /automatic training requires replay version 78/i);

  for (const args of [[], ['b0', 'rifle'], ['b4', false], ['b4', 'unknownUnit'], ['b4', 'rifle', null]]) {
    assert.throws(() => validateSoloReplay(envelope, [{ ...command, args }], 1, 78), /invalid solo command/i);
  }
  assert.equal(validateSoloReplay(envelope, [{ ...command, args: ['b4'] }], 1, 78), true);
  assert.equal(validateSoloReplay(envelope, [{ ...command, args: ['b4', null] }], 1, 78), true);
});
