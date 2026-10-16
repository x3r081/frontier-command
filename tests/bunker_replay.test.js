import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GARRISON_RULES_VERSION } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };

function advance(game, clock, ticks) {
  for (let i = 0; i < ticks; i++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
  }
}

function stateView(game) {
  return {
    units: game.units,
    buildings: game.buildings,
    credits: game.credits,
    terrain: game.terrain,
    effects: game.effects,
    time: game.time,
    status: game.status,
  };
}

test('Field Bunker build, garrison, and evacuation commands replay the same paid battle state', () => {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId, replayVersion: GARRISON_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const rifles = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle');
  const startCredits = game.credits.player;

  assert.equal(game.startConstruction('bunker').ok, true);
  assert.equal(game.queueUnit('rocket', barracks.id).ok, true);
  assert.equal(game.credits.player, startCredits - game.buildingDefs.bunker.cost - game.unitDefs.rocket.cost);

  // Choose a real revealed, connected site beside the forward factory using
  // the public placement validator, then wait for ordinary construction.
  let site = null;
  for (let y = 30; y < 40 && !site; y++) for (let x = 14; x < 24 && !site; x++)
    if (game.canPlaceBuilding('bunker', x, y).ok) site = { x, y };
  assert.ok(site, 'seeded map has a legal forward site');
  advance(game, clock, 20 * 30);
  assert.equal(game.construction?.ready, true);
  const placed = game.issueBuild('bunker', site.x, site.y);
  assert.equal(placed.ok, true);
  const bunker = game.getEntity(placed.id);

  // The ordinary barracks job and two opening rifles supply the three crew.
  for (let i = 0; i < 90 * 30 && !game.units.some(unit => unit.owner === 'player' && unit.defId === 'rocket'); i++)
    advance(game, clock, 1);
  const rocket = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rocket' && unit.hp > 0);
  assert.ok(rocket, 'the paid rocket crew member completed');
  game.select([rifles[0].id, rifles[1].id, rocket.id]);
  assert.equal(game.issueGarrison(bunker.id).ok, true);
  for (let i = 0; i < 20 * 30 && bunker.garrisonIds.length < 3; i++) advance(game, clock, 1);
  assert.equal(bunker.garrisonIds.length, 3, 'the three selected armed infantry board the bunker');
  game.select(bunker.id);
  assert.equal(game.issueEvacuateGarrison(bunker.id).ok, true);
  advance(game, clock, 3 * 30);

  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => command.method), [
    'startConstruction', 'queueUnit', 'issueBuild', 'issueGarrison', 'issueEvacuateGarrison',
  ]);
  assert.deepEqual(recorder.commands[2].args, ['bunker', site.x, site.y]);
  assert.deepEqual(recorder.commands[3].selectedIds, [rifles[0].id, rifles[1].id, rocket.id]);
  assert.deepEqual(recorder.commands[4].selectedIds, [bunker.id]);
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, GARRISON_RULES_VERSION), true);

  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, GARRISON_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(stateView(playback.game), stateView(game));
});

test('Field Bunker commands are gated from v78 and malformed public args are rejected', () => {
  const buildingId = 'b5';
  const oldCommands = [
    ['startConstruction', ['bunker']],
    ['issueBuild', ['bunker', 21, 34]],
    ['issueGarrison', [buildingId]],
    ['issueEvacuateGarrison', [buildingId]],
  ];
  for (const [method, args] of oldCommands) {
    const command = { tick: 0, sequence: 0, method, args, selectedIds: [] };
    assert.throws(() => createSoloPlayback(envelope, [command], 1, 78), /Field Bunkers require replay version 79/i,
      `${method} must not be interpreted by a v78 replay`);
  }

  const malformed = [
    ['startConstruction', []],
    ['startConstruction', ['unknownBuilding']],
    ['issueBuild', ['bunker', '21', 34]],
    ['issueBuild', ['bunker', 21, 34, 'extra']],
    ['issueGarrison', []],
    ['issueGarrison', [buildingId, 'extra']],
    ['issueEvacuateGarrison', [buildingId, 'extra']],
  ];
  for (const [method, args] of malformed) {
    const command = { tick: 0, sequence: 0, method, args, selectedIds: [] };
    assert.throws(() => validateSoloReplay(envelope, [command], 1, GARRISON_RULES_VERSION), /invalid solo command/i,
      `${method} rejects malformed args ${JSON.stringify(args)}`);
  }
});
