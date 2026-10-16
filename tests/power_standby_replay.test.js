import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };

function advance(game, clock, ticks) {
  for (let tick = 0; tick < ticks; tick++) { game.update(SOLO_STEP_SECONDS); clock.completedTicks++; }
}

function economyView(game) {
  return {
    credits: game.credits,
    power: game.power,
    buildings: game.buildings.map(building => ({ id: building.id, owner: building.owner,
      defId: building.defId, hp: building.hp, queue: building.queue, powered: building.powered,
      standby: building.powerStandby === true })),
    units: game.units.map(unit => ({ id: unit.id, owner: unit.owner, defId: unit.defId,
      x: unit.x, y: unit.y, hp: unit.hp, cargo: unit.cargo, order: unit.order })),
  };
}

test('power standby records a paid production pause and restores it deterministically', () => {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId });
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const initialRifles = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle').length;
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  assert.equal(game.queueUnit('rifle', barracks.id).ok, true);
  advance(game, clock, 30);
  const paidProgress = barracks.queue[0].progress;
  assert.ok(paidProgress > 0);
  assert.equal(game.setBuildingPower(barracks.id, true).ok, true);
  advance(game, clock, 90);
  assert.equal(barracks.queue[0].progress, paidProgress, 'the paid job stays paused rather than restarting or finishing');
  assert.equal(game.setBuildingPower(barracks.id, false).ok, true);
  advance(game, clock, 210);
  assert.equal(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle').length, initialRifles + 1);
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => command.method), ['queueUnit', 'setBuildingPower', 'setBuildingPower']);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 71);
  playback.step(clock.completedTicks);
  assert.deepEqual(economyView(playback.game), economyView(game));
});

test('archived playback rejects power routing and malformed booleans while ordinary v70 playback remains valid', () => {
  const command = { tick: 0, sequence: 0, method: 'setBuildingPower', args: ['b4', true], selectedIds: [] };
  assert.throws(() => createSoloPlayback(envelope, [command], 1, 70), /power routing requires replay version 71/i);
  assert.throws(() => validateSoloReplay(envelope, [{ ...command, args: ['b4', 'false'] }], 1, 71), /invalid solo command/i);
  const old = createSoloPlayback(envelope, [], 2, 70);
  old.step(2);
  assert.equal(old.game.replayVersion, 70);
  assert.ok(old.game.buildings.every(building => !building.powerStandby));
});
