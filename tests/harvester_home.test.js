import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, HARVESTER_HOME_RULES_VERSION, UNIT_DEFS } from '../src/game/engine.js';

function arena(replayVersion = null) {
  const game = new Game({ seed: 771, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  const near = game._createBuilding('player', 'refinery', 10, 10, 1);
  const far = game._createBuilding('player', 'refinery', 36, 10, 1);
  const unit = game._createUnit('player', 'harvester', 13.5, 12.5, { type: 'harvest', x: 8, y: 8 });
  return { game, near, far, unit };
}

test('home command validates exact owned completed refinery and leaves state untouched on invalid ids', () => {
  const { game, near, far, unit } = arena();
  const enemy = game._createBuilding('enemy', 'refinery', 50, 10, 1);
  const unfinished = game._createBuilding('player', 'refinery', 20, 10, 0.5);
  unit.cargo = 40;
  unit._unloadRefineryId = near.id;
  unit._unloadApproach = { x: 10.5, y: 9.5 };
  game.select(unit.id);
  for (const id of [enemy.id, unfinished.id, `${far.id}x`, 2]) {
    const before = { home: unit.homeRefineryId, dock: unit._unloadRefineryId,
      order: structuredClone(unit.order), phase: unit._harvestPhase };
    assert.equal(game.issueAssignRefinery(id).ok, false);
    assert.deepEqual({ home: unit.homeRefineryId, dock: unit._unloadRefineryId,
      order: unit.order, phase: unit._harvestPhase }, before);
  }
  assert.equal(HARVESTER_HOME_RULES_VERSION, 77);
});

test('assigning a home targets it ahead of a nearer refinery and remains selected when its dock is busy', () => {
  const { game, near, far, unit } = arena();
  game.select(unit.id);
  assert.deepEqual(game.issueAssignRefinery(far.id), { ok: true });
  const dock = game._findHarvesterDock(unit);
  assert.equal(dock.refinery.id, far.id);
  unit._unloadRefineryId = far.id;
  unit._unloadApproach = { ...dock.approach };
  const second = game._createUnit('player', 'harvester', 14.5, 12.5, { type: 'harvest' });
  second.homeRefineryId = far.id;
  const secondDock = game._findHarvesterDock(second);
  assert.equal(secondDock.refinery.id, far.id);
  assert.notDeepEqual(secondDock.approach, unit._unloadApproach);
  assert.equal(near.owner, 'player');
});

test('loaded assignment returns current cargo and preserves the field through repeated deliveries', () => {
  const { game, near, far, unit } = arena();
  unit.x = far.x + 1.5; unit.y = far.y + 1.5;
  unit.cargo = 160;
  unit._harvestTile = { x: 8, y: 8 };
  game.select(unit.id);
  assert.equal(game.issueAssignRefinery(far.id).ok, true);
  assert.equal(unit._harvestPhase, 'return');
  assert.deepEqual(unit.order, { type: 'harvest', x: 8, y: 8 });
  for (let tick = 0; tick < 40 && unit.cargo > 0; tick++) game._updateHarvester(unit, 0.1);
  assert.equal(unit.cargo, 0);
  assert.deepEqual(unit._harvestTile, { x: 8, y: 8 });
  assert.deepEqual(unit.order, { type: 'harvest', x: 8, y: 8 });
  assert.ok(game.credits.player >= 160);

  unit.cargo = 95; unit._harvestPhase = 'return'; unit.x = far.x + 1.5; unit.y = far.y + 1.5;
  for (let tick = 0; tick < 40 && unit.cargo > 0; tick++) game._updateHarvester(unit, 0.1);
  assert.equal(unit.cargo, 0);
  assert.deepEqual(unit._harvestTile, { x: 8, y: 8 });
  assert.ok(game.credits.player >= 255);
  assert.equal(near.owner, 'player');
});

test('offline home falls back without forgetting, then capture clears the assignment', () => {
  const { game, near, far, unit } = arena();
  game.select(unit.id);
  game.issueAssignRefinery(far.id);
  far.powerStandby = true;
  let dock = game._findHarvesterDock(unit);
  assert.equal(dock.refinery.id, near.id);
  assert.equal(unit.homeRefineryId, far.id);
  far.powerStandby = false;
  unit._unloadRefineryId = null; unit._unloadApproach = null;
  dock = game._findHarvesterDock(unit);
  assert.equal(dock.refinery.id, far.id);
  far.owner = 'enemy';
  unit._harvestPhase = 'return'; unit.cargo = 20;
  game._updateHarvester(unit, 0.1);
  assert.equal(unit.homeRefineryId, null);
});

test('powered-off home uses an alternate dock, and waits then resumes when it is the only refinery', () => {
  const { game, near, far, unit } = arena();
  game.select(unit.id);
  game.issueAssignRefinery(far.id);
  far.powered = false;
  unit.cargo = 120; unit._harvestPhase = 'return';
  for (let tick = 0; tick < 400 && unit.cargo > 0; tick++) game._updateHarvester(unit, 0.1);
  assert.equal(unit.cargo, 0);
  assert.equal(unit.homeRefineryId, far.id);
  assert.equal(near._unloadHarvesterId, null);

  near.hp = 0;
  unit.cargo = 55; unit._harvestPhase = 'return';
  for (let tick = 0; tick < 12; tick++) game._updateHarvester(unit, 0.1);
  assert.equal(unit.cargo, 55);
  assert.equal(unit._harvestPhase, 'return');
  assert.equal(unit.order.type, 'harvest');
  far.powered = true;
  for (let tick = 0; tick < 400 && unit.cargo > 0; tick++) game._updateHarvester(unit, 0.1);
  assert.equal(unit.cargo, 0);
  assert.equal(unit.homeRefineryId, far.id);
});

test('null restores automatic routing and manual orders keep the remembered home', () => {
  const { game, near, far, unit } = arena();
  game.select(unit.id);
  game.issueAssignRefinery(far.id);
  assert.equal(unit.homeRefineryId, far.id);
  unit.order = { type: 'move', x: 20, y: 20 };
  assert.equal(unit.homeRefineryId, far.id);
  game.issueAssignRefinery(null);
  assert.equal(unit.homeRefineryId, null);
  unit.order = { type: 'harvest' }; unit._harvestPhase = 'return'; unit.cargo = 10;
  const dock = game._findHarvesterDock(unit);
  assert.equal(dock.refinery.id, near.id);
  assert.equal(UNIT_DEFS.harvester.capacity, 700);
});

test('markerless v76 saves pin to v76 and strip foreign or unsupported home ids', () => {
  const { game, far, unit } = arena();
  unit.homeRefineryId = far.id;
  const save = JSON.parse(game.serialize());
  delete save.harvesterHomeRulesVersion;
  save.replayVersion = null;
  const loaded = Game.deserialize(save);
  assert.equal(loaded.replayVersion, 76);
  assert.equal(loaded.units[0].homeRefineryId, null);
  loaded.select(loaded.units[0].id);
  assert.equal(loaded.issueAssignRefinery(far.id).ok, false);

  save.harvesterHomeRulesVersion = HARVESTER_HOME_RULES_VERSION;
  save.replayVersion = null;
  save.units[0].homeRefineryId = 'foreign-refinery-id';
  const normalized = Game.deserialize(save);
  assert.equal(normalized.replayVersion, null);
  assert.equal(normalized.units[0].homeRefineryId, null);
});
