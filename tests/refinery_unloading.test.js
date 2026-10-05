import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS } from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 9021 });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  const refinery = game._createBuilding('player', 'refinery', 10, 10, 1);
  return { game, refinery };
}

function atDock(game, refinery, cargo) {
  const center = game._entityCenter(refinery);
  const unit = game._createUnit('player', 'harvester', center.x, center.y, { type: 'harvest' });
  unit.cargo = cargo;
  unit._harvestPhase = 'return';
  return unit;
}

function advanceHarvesters(game, seconds) {
  for (let i = 0; i < Math.round(seconds * 10); i++)
    for (const unit of game.units) if (unit.hp > 0) game._updateHarvester(unit, 0.1);
}

test('return cargo validates selected loaded harvesters and cashes out a partial load', () => {
  const { game, refinery } = arena();
  const unit = atDock(game, refinery, UNIT_DEFS.harvester.capacity * 0.2);
  game.select(unit.id);
  assert.deepEqual(game.issueReturnCargo(), { ok: true });
  assert.deepEqual(unit.order, { type: 'harvest' });
  assert.equal(unit._harvestPhase, 'return');
  assert.equal(game.events.at(-1).order, 'returnCargo');
  assert.deepEqual(game.events.at(-1).ids, [unit.id]);
  advanceHarvesters(game, 0.6);
  assert.equal(unit.cargo, 0);
  assert.equal(game.issueReturnCargo().ok, false, 'empty cargo cannot be sent to return');
  assert.equal(game.credits.player, 3800 + UNIT_DEFS.harvester.capacity * 0.2);
});

test('Return Cargo rejects loaded harvesters when no completed friendly refinery exists', () => {
  const { game } = arena();
  game.buildings = [];
  const unit = game._createUnit('player', 'harvester', 10.5, 10.5, { type: 'harvest' });
  unit.cargo = 50;
  game.select(unit.id);
  assert.deepEqual(game.issueReturnCargo(), { ok: false, reason: 'A completed refinery is required.' });
  assert.equal(unit._harvestPhase, undefined);
  assert.deepEqual(unit.order, { type: 'harvest' });
});

test('harvesters queue at a shared refinery and unload in deterministic turns', () => {
  const { game, refinery } = arena();
  const capacity = UNIT_DEFS.harvester.capacity;
  const first = atDock(game, refinery, capacity);
  const second = atDock(game, refinery, capacity);
  advanceHarvesters(game, 2.5);
  assert.equal(game.credits.player, 3800 + capacity);
  assert.equal(first.cargo, 0);
  assert.equal(second.cargo, capacity);
  assert.equal(refinery._unloadHarvesterId, second.id);
  advanceHarvesters(game, 2.5);
  assert.equal(game.credits.player, 3800 + capacity * 2);
  assert.equal(second.cargo, 0);
});

test('separate refineries unload simultaneously', () => {
  const { game, refinery } = arena();
  const otherRefinery = game._createBuilding('player', 'refinery', 30, 10, 1);
  const capacity = UNIT_DEFS.harvester.capacity;
  const first = atDock(game, refinery, capacity);
  const second = atDock(game, otherRefinery, capacity);
  advanceHarvesters(game, 2.5);
  assert.equal(first.cargo, 0);
  assert.equal(second.cargo, 0);
  assert.equal(game.credits.player, 3800 + capacity * 2);
});

test('destroyed dock releases its queue and reroutes a returning harvester', () => {
  const { game, refinery } = arena();
  const otherRefinery = game._createBuilding('player', 'refinery', 30, 10, 1);
  const capacity = UNIT_DEFS.harvester.capacity;
  const second = atDock(game, refinery, capacity);
  advanceHarvesters(game, 0.5);
  refinery.hp = 0;
  const center = game._entityCenter(otherRefinery);
  second.x = center.x; second.y = center.y;
  game._updateHarvester(second, 0.1);
  assert.equal(second.cargo, capacity);
  assert.equal(second._unloadRefineryId, otherRefinery.id);
  advanceHarvesters(game, 2.5);
  assert.equal(second.cargo, 0);
});

test('unloading progress and refinery ownership survive save and load', () => {
  const { game, refinery } = arena();
  const unit = atDock(game, refinery, UNIT_DEFS.harvester.capacity);
  game._updateHarvester(unit, 0.7);
  const loaded = Game.deserialize(game.serialize());
  const loadedUnit = loaded.getEntity(unit.id);
  const loadedRefinery = loaded.getEntity(refinery.id);
  assert.equal(loadedRefinery._unloadHarvesterId, unit.id);
  assert.ok(loadedUnit._unloadProgress > 0 && loadedUnit._unloadProgress < 1);
  advanceHarvesters(loaded, 1.8);
  assert.equal(loadedUnit.cargo, 0);
  assert.equal(loaded.credits.player, 3800 + UNIT_DEFS.harvester.capacity);
});

test('stopping a harvester mid-unload releases the bay for the next harvester', () => {
  const { game, refinery } = arena();
  const capacity = UNIT_DEFS.harvester.capacity;
  const first = atDock(game, refinery, capacity);
  const second = atDock(game, refinery, capacity);
  game._updateHarvester(first, 0.5);
  assert.equal(refinery._unloadHarvesterId, first.id);
  game.select(first.id);
  assert.deepEqual(game.issueStop(), { ok: true });
  assert.equal(refinery._unloadHarvesterId, null);
  assert.equal(first._unloadRefineryId, null);
  game._updateHarvester(second, 0.1);
  assert.equal(refinery._unloadHarvesterId, second.id);
});

test('explicit Harvest cancels a partial return and resumes gathering', () => {
  const { game, refinery } = arena();
  const unit = atDock(game, refinery, UNIT_DEFS.harvester.capacity * 0.4);
  game._updateHarvester(unit, 0.5);
  game.select(unit.id);
  assert.deepEqual(game.issueHarvest(), { ok: true });
  assert.equal(refinery._unloadHarvesterId, null);
  assert.equal(unit._harvestPhase, 'field');
  assert.equal(unit.cargo, UNIT_DEFS.harvester.capacity * 0.4);
});

test('right-clicking crystal cancels a partial return and selects that field', () => {
  const { game, refinery } = arena();
  const unit = atDock(game, refinery, UNIT_DEFS.harvester.capacity * 0.4);
  game._updateHarvester(unit, 0.5);
  const tile = game.terrain[20][20];
  tile.resource = 500; tile.type = 'crystal';
  game.select(unit.id);
  assert.deepEqual(game.issueMove(20.5, 20.5), { ok: true });
  assert.equal(refinery._unloadHarvesterId, null);
  assert.equal(unit._harvestPhase, 'field');
  assert.deepEqual(unit._harvestTile, { x: 20, y: 20 });
  assert.equal(unit.cargo, UNIT_DEFS.harvester.capacity * 0.4);
});
