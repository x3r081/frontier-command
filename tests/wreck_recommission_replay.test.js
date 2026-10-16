import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS, WRECK_RECOMMISSION_RULES_VERSION } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: SKIRMISH_MAPS[0].id, victoryMode: 'elimination' };

function advance(game, clock, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
  }
}

function command(game, method, ...args) {
  const result = game[method](...args);
  assert.equal(result.ok, true, `${method}: ${result.reason || 'command rejected'}`);
  return result;
}

function publicState(game) {
  return {
    units: game.units.map(unit => ({ id: unit.id, owner: unit.owner, defId: unit.defId,
      x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp, veterancy: unit.veterancy,
      xp: unit.xp, promotion: unit.promotion, recommissioned: unit._recommissioned === true,
      order: unit.order })),
    buildings: game.buildings.map(building => ({ id: building.id, owner: building.owner,
      defId: building.defId, hp: building.hp, progress: building.progress, powered: building.powered,
      standby: building.powerStandby === true, queue: building.queue })),
    credits: game.credits,
    power: game.power,
    wrecks: game.wrecks,
    status: game.status,
    winner: game.winner,
    time: game.time,
  };
}

test('a recorded v72 solo run restores a paid friendly-fire wreck deterministically at 30 Hz', () => {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');

  // Pay for the Engineer, the Recon Buggy, and the Field Workshop through
  // public gameplay commands. Wait for the Workshop to finish before placing.
  command(game, 'startConstruction', 'serviceBay');
  command(game, 'queueUnit', 'engineer', barracks.id);
  command(game, 'queueUnit', 'buggy', factory.id);
  while (!game.construction.ready) advance(game, clock);

  // The original rifles occupy this legal seed-24 build footprint, so move
  // them through the recorded command path before placing the Workshop.
  const rifles = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle');
  game.select(rifles.map(unit => unit.id));
  command(game, 'issueMove', 9.5, 37.5);
  advance(game, clock, 100);
  command(game, 'issueBuild', 'serviceBay', 13, 37);
  const workshop = game.buildings.find(building => building.owner === 'player' && building.defId === 'serviceBay');
  command(game, 'setBuildingPower', workshop.id, true);

  const striker = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  const buggy = game.units.find(unit => unit.owner === 'player' && unit.defId === 'buggy');
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  assert.ok(striker && buggy && engineer, 'the paid units and opening Striker are present');
  game.select(striker.id);
  command(game, 'issueForceFire', buggy.x, buggy.y);
  for (let i = 0; i < 30 * 40 && !game.wrecks.some(wreck => wreck.restoreDefId === 'buggy'); i++)
    advance(game, clock);
  const wreck = game.wrecks.find(item => item.restoreDefId === 'buggy');
  assert.ok(wreck, 'the opening Striker created a real buggy wreck');
  assert.equal(workshop.powerStandby, true, 'the Workshop stayed on standby during friendly fire');

  game.select(striker.id);
  command(game, 'issueStop');
  command(game, 'setBuildingPower', workshop.id, false);
  game.select(engineer.id);
  command(game, 'issueRecommissionWreck', wreck.id);
  let restored = null;
  for (let i = 0; i < 30 * 25 && !restored; i++) {
    advance(game, clock);
    restored = game.units.find(unit => unit._recommissioned === true);
  }
  assert.ok(restored, 'the Engineer completed restoration after reaching the wreck');
  assert.equal(game.wrecks.some(item => item.id === wreck.id), false);
  assert.equal(game.events.some(event => event.type === 'wreckRecommissioned' && event.id === wreck.id), true);
  assert.equal(striker.order.type, 'idle', 'the Striker was stopped after the wreck was created');
  assert.equal(workshop.powerStandby, false, 'the Workshop was restored before recommissioning');

  advance(game, clock, 30 * 4);
  recorder.dispose();
  assert.ok(recorder.commands.some(item => item.method === 'issueRecommissionWreck'));
  assert.ok(recorder.commands.some(item => item.method === 'setBuildingPower' && item.args[1] === true));
  assert.ok(recorder.commands.some(item => item.method === 'setBuildingPower' && item.args[1] === false));
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks,
    WRECK_RECOMMISSION_RULES_VERSION), true);

  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks,
    WRECK_RECOMMISSION_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(publicState(playback.game), publicState(game),
    'recorded playback reproduces restored units, economy, power, wrecks, and end state');
});

test('archived versions and malformed or unknown recommission commands are rejected', () => {
  const archivedCommand = { tick: 0, sequence: 0, method: 'issueRecommissionWreck',
    args: ['wreck1'], selectedIds: [] };
  assert.throws(() => createSoloPlayback(envelope, [archivedCommand], 1,
    WRECK_RECOMMISSION_RULES_VERSION - 1), /vehicle recommissioning requires replay version 72/i);
  assert.throws(() => validateSoloReplay(envelope, [{ ...archivedCommand, args: ['wreck0'] }], 1,
    WRECK_RECOMMISSION_RULES_VERSION), /invalid solo command/i);
  assert.throws(() => createSoloPlayback(envelope, [archivedCommand], 1,
    WRECK_RECOMMISSION_RULES_VERSION).step(1), /replay command failed/i,
  'a well-shaped command with a nonexistent wreck ID fails during playback');
});
