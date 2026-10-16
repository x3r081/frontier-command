import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, WORKSHOP_SERVICE_RELIABILITY_RULES_VERSION } from '../src/game/engine.js';

function workshopGame(replayVersion = WORKSHOP_SERVICE_RELIABILITY_RULES_VERSION) {
  const game = new Game({ seed: 9101, mode: 'skirmish', difficulty: 'normal', replayVersion });
  const workshop = game._createBuilding('player', 'serviceBay', 24, 20, 1);
  game._refreshPower();
  game.credits.player = 1000;
  return { game, workshop };
}

function serviceSelected(game, workshop, units) {
  game.select(units.map(unit => unit.id));
  return game.issueServiceAtWorkshop(workshop.id);
}

test('repeated v91 service orders retain and restore the original resume order', () => {
  const { game, workshop } = workshopGame();
  const tank = game._createUnit('player', 'lightTank', 17.5, 21.5);
  tank.hp -= 40;
  tank.order = { type: 'attack', targetId: 'p9', pursuit: true };
  assert.equal(serviceSelected(game, workshop, [tank]).ok, true);
  assert.deepEqual(tank.order.resumeOrder, { type: 'attack', targetId: 'p9', pursuit: true });
  assert.equal(serviceSelected(game, workshop, [tank]).ok, true);
  assert.deepEqual(tank.order.resumeOrder, { type: 'attack', targetId: 'p9', pursuit: true },
    'reissuing service does not nest a previous service order');
  tank.hp = tank.maxHp;
  game._updateServiceOrder(tank, 1 / 30);
  assert.deepEqual(tank.order, { type: 'attack', targetId: 'p9', pursuit: true });
});

test('a multi-vehicle service order reserves distinct reachable workshop approach points', () => {
  const { game, workshop } = workshopGame();
  const tanks = [
    game._createUnit('player', 'lightTank', 5.5, 20.5),
    game._createUnit('player', 'buggy', 5.5, 20.5),
    game._createUnit('player', 'lightTank', 5.5, 20.5),
  ];
  for (const tank of tanks) tank.hp -= 40;
  assert.equal(serviceSelected(game, workshop, tanks).ok, true);
  const points = tanks.map(tank => `${tank.order.x},${tank.order.y}`);
  assert.equal(new Set(points).size, tanks.length);
  for (const tank of tanks) {
    assert.ok(game._findPath(tank.x, tank.y, tank.order.x, tank.order.y).length > 0,
      `${tank.id} retains a reachable approach`);
    assert.ok(game._distanceToEntity(tank.order.x, tank.order.y, workshop) <= 2.1);
  }
  for (let tick = 0; tick < 300; tick++) game.update(1 / 30);
  assert.ok(tanks.every(tank => tank.order.type === 'service'),
    'more than eight seconds of steady travel does not exhaust the stalled-route retries');
  for (let tick = 0; tick < 180; tick++) game.update(1 / 30);
  assert.ok(tanks.every(tank => tank.hp > tank.maxHp - 40), 'the spaced vehicles enter workshop range and receive paid repair');
});

test('a newly blocked approach triggers bounded replanning to another clear workshop side', () => {
  const { game, workshop } = workshopGame();
  const tank = game._createUnit('player', 'lightTank', 17.5, 21.5);
  tank.hp -= 60;
  assert.equal(serviceSelected(game, workshop, [tank]).ok, true);
  const oldPoint = { x: tank.order.x, y: tank.order.y };
  game._createBuilding('player', 'wall', Math.floor(oldPoint.x), Math.floor(oldPoint.y), 1);
  const moveUnit = game._moveUnit.bind(game);
  game._moveUnit = (unit, ...args) => unit.id === tank.id ? false : moveUnit(unit, ...args);
  for (let tick = 0; tick < 90 && tank.order.type === 'service' &&
      tank.order.x === oldPoint.x && tank.order.y === oldPoint.y; tick++) game.update(1 / 30);
  assert.equal(tank.order.type, 'service');
  assert.notDeepEqual({ x: tank.order.x, y: tank.order.y }, oldPoint,
    'the stalled order selects a different reachable approach after movement is rejected');
  assert.ok(game._findPath(tank.x, tank.y, tank.order.x, tank.order.y).length > 0);
});

test('v90 and markerless saves keep the previous service routing policy', () => {
  const { game, workshop } = workshopGame(90);
  const tank = game._createUnit('player', 'lightTank', 17.5, 21.5);
  tank.hp -= 30;
  tank.order = { type: 'guard', x: 8.5, y: 8.5 };
  assert.equal(serviceSelected(game, workshop, [tank]).ok, true);
  assert.equal(tank._serviceLastX, undefined, 'v90 does not initialize v91 stall tracking');
  assert.equal(serviceSelected(game, workshop, [tank]).ok, true);
  assert.equal(tank.order.resumeOrder.type, 'service', 'v90 retains its prior repeated-order behavior');

  const markerless = JSON.parse(new Game({ seed: 9, mode: 'skirmish' }).serialize());
  markerless.replayVersion = null;
  delete markerless.workshopServiceReliabilityRulesVersion;
  const loaded = Game.deserialize(markerless);
  assert.equal(loaded.replayVersion, 90);
  assert.equal(loaded.workshopServiceReliabilityRulesVersion, WORKSHOP_SERVICE_RELIABILITY_RULES_VERSION);
});
