import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function blockedRefineryCorridor(replayVersion = 8) {
  const game = new Game({ seed: 481516, difficulty: 'normal', victoryMode: 'elimination' });
  game.replayVersion = replayVersion;
  game.units = [];
  game._createBuilding('enemy', 'refinery', 51, 12, 1);
  game.credits.enemy = 0;
  const harvesters = [[43.2, 20.7], [43.4, 20.1], [43.8, 20.5]].map(([x, y]) => {
    const unit = game._createUnit('enemy', 'harvester', x, y, { type: 'harvest' });
    unit.cargo = 700;
    unit._harvestPhase = 'return';
    return unit;
  });
  return { game, harvesters };
}

test('v8 harvesters reserve distinct reachable refinery approaches and unload through a congested corridor', () => {
  const { game, harvesters } = blockedRefineryCorridor();
  for (const unit of harvesters) game._updateHarvester(unit, 0.1);
  const approaches = harvesters.map(unit => `${unit._unloadApproach.x},${unit._unloadApproach.y}`);
  assert.equal(new Set(approaches).size, harvesters.length);

  for (let step = 0; step < 3000 && game.credits.enemy < 2100; step++) {
    game.time += 0.1;
    for (const unit of harvesters) game._updateHarvester(unit, 0.1);
    game._resolveUnitSeparation();
  }
  assert.equal(game.credits.enemy, 2100, 'each 700 crystal cargo unloads');
  assert.ok(harvesters.some(unit => unit.cargo === 0), 'completed unloads release their cargo');
});

test('v7 harvesters keep their historical refinery center order without dock reservations', () => {
  const { game, harvesters } = blockedRefineryCorridor(7);
  game._updateHarvester(harvesters[0], 0.1);
  assert.equal(harvesters[0]._unloadApproach, null);
  assert.equal(harvesters[0]._unloadRefineryId, null,
    'the historical path does not reserve the unload slot before arrival');
});

test('a lower-id returner cannot block the harvester already unloading at that refinery', () => {
  const { game, harvesters } = blockedRefineryCorridor();
  for (const unit of harvesters) game._updateHarvester(unit, 0.1);
  const [lowerId, , dockOwner] = harvesters;
  const refinery = game.getEntity(dockOwner._unloadRefineryId);
  lowerId._unloadRefineryId = refinery.id;
  lowerId._unloadApproach = { x: lowerId._unloadApproach.x, y: lowerId._unloadApproach.y };
  dockOwner.x = dockOwner._unloadApproach.x;
  dockOwner.y = dockOwner._unloadApproach.y;
  dockOwner._unloadRemaining = 0.05;
  refinery._unloadHarvesterId = dockOwner.id;

  game._updateHarvester(dockOwner, 0.1);

  assert.equal(game.credits.enemy, 700, 'the dock owner completes its deposit');
  assert.equal(dockOwner.cargo, 0);
  assert.equal(dockOwner._unloadRemaining, 0);
});

test('v8 autonomous harvesters can pass through each other while legacy units still separate', () => {
  const { game, harvesters } = blockedRefineryCorridor(8);
  const [a, b] = harvesters;
  a.x = 20; a.y = 20;
  b.x = 20.1; b.y = 20;
  a._harvestPhase = b._harvestPhase = 'field';
  a.order = b.order = { type: 'harvest' };
  game._resolveUnitSeparation();
  assert.ok(Math.abs(a.x - 20) < 1e-9 && Math.abs(b.x - 20.1) < 1e-9,
    'v8 lets same-owner automated harvesters share a narrow route');

  const legacy = blockedRefineryCorridor(7);
  legacy.harvesters[0].x = 20; legacy.harvesters[0].y = 20;
  legacy.harvesters[1].x = 20.1; legacy.harvesters[1].y = 20;
  legacy.harvesters[0]._harvestPhase = legacy.harvesters[1]._harvestPhase = 'field';
  legacy.harvesters[0].order = legacy.harvesters[1].order = { type: 'harvest' };
  legacy.game._resolveUnitSeparation();
  assert.notEqual(legacy.harvesters[0].x, 20, 'v7 retains historical separation');
});
