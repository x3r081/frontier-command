import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, TARGET_PRIORITY_OPTIONS, TARGET_PRIORITY_RULES_VERSION } from '../src/game/engine.js';

function arena(replayVersion = TARGET_PRIORITY_RULES_VERSION) {
  const game = new Game({ seed: 8201, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function firedAt(game, source, expectedId) {
  source.cooldown = 0;
  game._updateUnit(source, 0.1);
  const shot = game.effects.filter(effect => effect.type === 'projectile' && effect.sourceId === source.id).at(-1);
  assert.ok(shot, 'unit should fire at an eligible target');
  assert.equal(shot.targetId, expectedId);
}

test('target priority prefers its category among visible eligible targets while auto keeps nearest scoring', () => {
  const game = arena();
  const shooter = game._createUnit('player', 'buggy', 20.5, 20.5);
  const infantry = game._createUnit('enemy', 'rifle', 22.5, 20.5);
  const vehicle = game._createUnit('enemy', 'lightTank', 23.5, 20.5);

  firedAt(game, shooter, infantry.id);
  shooter.cooldown = 0;
  game.select(shooter.id);
  shooter.order = { type: 'guard', x: shooter.x, y: shooter.y };
  assert.deepEqual(game.issueSetTargetPriority('vehicles'), { ok: true, priority: 'vehicles' });
  assert.deepEqual(shooter.order, { type: 'guard', x: shooter.x, y: shooter.y },
    'setting priority should not replace a movement/combat order');
  firedAt(game, shooter, vehicle.id);

  const structureHunter = game._createUnit('player', 'buggy', 20.5, 25.5);
  const closeVehicle = game._createUnit('enemy', 'lightTank', 21.5, 25.5);
  const structure = game._createBuilding('enemy', 'power', 23, 25, 1);
  game.select(structureHunter.id);
  assert.equal(game.issueSetTargetPriority('structures').ok, true);
  firedAt(game, structureHunter, structure.id);
  assert.equal(closeVehicle.hp, closeVehicle.maxHp);
});

test('a blocked preferred target does not starve a clear ordinary shot', () => {
  const game = arena();
  const shooter = game._createUnit('player', 'buggy', 20.5, 20.5);
  const blockedVehicle = game._createUnit('enemy', 'lightTank', 23.5, 20.5);
  const clearInfantry = game._createUnit('enemy', 'rifle', 20.5, 22.5);
  game.terrain[20][22].type = 'rock';
  game.select(shooter.id);
  assert.equal(game.issueSetTargetPriority('vehicles').ok, true);
  firedAt(game, shooter, clearInfantry.id);
  assert.equal(blockedVehicle.hp, blockedVehicle.maxHp);
});

test('priority acquisition ignores a matching target outside current vision', () => {
  const game = arena();
  const shooter = game._createUnit('player', 'buggy', 20.5, 20.5);
  const hiddenVehicle = game._createUnit('enemy', 'lightTank', 23.5, 20.5);
  const visibleInfantry = game._createUnit('enemy', 'rifle', 21.5, 20.5);
  game.fog[20][23] = 1;
  game.select(shooter.id);
  assert.equal(game.issueSetTargetPriority('vehicles').ok, true);
  firedAt(game, shooter, visibleInfantry.id);
  assert.equal(hiddenVehicle.hp, hiddenVehicle.maxHp);
});

test('priority respects the guard leash and lets defensive units fire at in-range alternatives', () => {
  const guardGame = arena();
  const guard = guardGame._createUnit('player', 'buggy', 20.5, 20.5);
  const beyondLeash = guardGame._createUnit('enemy', 'lightTank', 26.5, 20.5);
  const withinLeashInfantry = guardGame._createUnit('enemy', 'rifle', 24.5, 20.5);
  guardGame.select(guard.id);
  assert.equal(guardGame.issueSetTargetPriority('vehicles').ok, true);
  guard.order = { type: 'guard', x: guard.x, y: guard.y };
  firedAt(guardGame, guard, withinLeashInfantry.id);
  assert.equal(beyondLeash.hp, beyondLeash.maxHp);

  const defensiveGame = arena();
  const defender = defensiveGame._createUnit('player', 'buggy', 20.5, 20.5);
  const preferredBeyondRange = defensiveGame._createUnit('enemy', 'lightTank', 26, 20.5);
  const closeInfantry = defensiveGame._createUnit('enemy', 'rifle', 23, 20.5);
  defensiveGame.select(defender.id);
  assert.equal(defensiveGame.issueSetTargetPriority('vehicles').ok, true);
  assert.equal(defensiveGame.issueSetStance('defensive').ok, true);
  firedAt(defensiveGame, defender, closeInfantry.id);
  assert.equal(preferredBeyondRange.hp, preferredBeyondRange.maxHp);
});

test('target priority validates selection, round-trips, and pins markerless v81 saves to auto', () => {
  assert.deepEqual(TARGET_PRIORITY_OPTIONS, ['auto', 'infantry', 'vehicles', 'aircraft', 'structures']);
  const game = arena();
  const buggy = game._createUnit('player', 'buggy', 20.5, 20.5);
  const harvester = game._createUnit('player', 'harvester', 21.5, 20.5);
  const enemy = game._createUnit('enemy', 'buggy', 24.5, 20.5);

  game.select(harvester.id);
  assert.equal(game.issueSetTargetPriority('aircraft').ok, false, 'unarmed units cannot set priorities');
  game.select(buggy.id);
  assert.equal(game.issueSetTargetPriority('invalid').ok, false);
  game.commandOwner = 'enemy';
  assert.equal(game.issueSetTargetPriority('vehicles').ok, false, 'stale foreign selection cannot be commanded');
  game.commandOwner = null;
  game.select(buggy.id);
  assert.equal(game.issueSetTargetPriority('aircraft').ok, true);
  assert.equal(buggy.targetPriority, 'aircraft');
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.getEntity(buggy.id).targetPriority, 'aircraft');

  const legacy = JSON.parse(game.serialize());
  delete legacy.replayVersion;
  delete legacy.targetPriorityRulesVersion;
  delete legacy.units.find(unit => unit.id === buggy.id).targetPriority;
  const oldLoaded = Game.deserialize(legacy);
  assert.equal(oldLoaded.replayVersion, TARGET_PRIORITY_RULES_VERSION - 1);
  assert.equal(oldLoaded.getEntity(buggy.id).targetPriority, 'auto');

  const oldRules = arena(TARGET_PRIORITY_RULES_VERSION - 1);
  const oldBuggy = oldRules._createUnit('player', 'buggy', 20.5, 20.5);
  oldRules.select(oldBuggy.id);
  assert.equal(oldRules.issueSetTargetPriority('infantry').ok, false);
  assert.equal(oldBuggy.targetPriority, 'auto');
  assert.equal(enemy.owner, 'enemy');
});
