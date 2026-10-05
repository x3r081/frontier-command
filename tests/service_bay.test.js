import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_DEFS, Game } from '../src/game/engine.js';

const addWorkshop = (game, owner = 'player', x = 20, y = 20) => {
  const bay = game._createBuilding(owner, 'serviceBay', x, y, 1);
  game._refreshPower();
  return bay;
};

test('Field Workshop repairs nearby friendly ground vehicles at the priced rate', () => {
  const game = new Game({ seed: 71 });
  const bay = addWorkshop(game);
  assert.deepEqual(
    [BUILDING_DEFS.serviceBay.w, BUILDING_DEFS.serviceBay.h, BUILDING_DEFS.serviceBay.cost,
      BUILDING_DEFS.serviceBay.buildTime, BUILDING_DEFS.serviceBay.health,
      BUILDING_DEFS.serviceBay.sight, BUILDING_DEFS.serviceBay.power],
    [2, 2, 1150, 25, 700, 5, -30]);
  assert.deepEqual(BUILDING_DEFS.serviceBay.requires, ['factory']);
  assert.equal(bay.powered, true);

  const nearbyLight = game._createUnit('player', 'buggy', 23, 21);
  const nearbyHeavy = game._createUnit('player', 'lightTank', 21, 23);
  const infantry = game._createUnit('player', 'rifle', 25.5, 20.5);
  const aircraft = game._createUnit('player', 'orca', 21, 21);
  const enemyVehicle = game._createUnit('enemy', 'buggy', 21, 21);
  const distantVehicle = game._createUnit('player', 'buggy', 24.6, 21);
  const fullHealth = game._createUnit('player', 'buggy', 21, 21);
  const carrier = game._createUnit('player', 'apc', 21, 22);
  const embarkedVehicle = game._createUnit('player', 'buggy', 21, 21);
  embarkedVehicle.embarkedIn = carrier.id;
  for (const unit of [nearbyLight, nearbyHeavy, infantry, aircraft, enemyVehicle, distantVehicle, embarkedVehicle])
    unit.hp = unit.maxHp - 40;
  game.credits.player = 1000;
  game._updateBuildings(0.25);

  assert.equal(nearbyLight.hp, nearbyLight.maxHp - 37.25);
  assert.equal(nearbyHeavy.hp, nearbyHeavy.maxHp - 37.25);
  assert.equal(game.credits.player, 997.25);
  for (const unit of [infantry, aircraft, enemyVehicle, distantVehicle, fullHealth, embarkedVehicle])
    assert.equal(unit.hp, unit.maxHp - (unit === fullHealth ? 0 : 40), `${unit.defId} is not eligible`);
});

test('Field Workshop stops when unpowered or out of credits and caps repair by both limits', () => {
  const game = new Game({ seed: 72 });
  const bay = addWorkshop(game);
  const vehicle = game._createUnit('player', 'buggy', 21, 21);
  vehicle.hp = vehicle.maxHp - 100;
  game.credits.player = 5.5;

  bay.powered = false;
  game._updateBuildings(1);
  assert.equal(vehicle.hp, vehicle.maxHp - 100);
  assert.equal(game.credits.player, 5.5);

  bay.powered = true;
  game._updateBuildings(1);
  assert.equal(vehicle.hp, vehicle.maxHp - 89);
  assert.equal(game.credits.player, 0);
  game._updateBuildings(1);
  assert.equal(vehicle.hp, vehicle.maxHp - 89);

  game.credits.player = 100;
  vehicle.hp = vehicle.maxHp - 3;
  game._updateBuildings(1);
  assert.equal(vehicle.hp, vehicle.maxHp);
  assert.equal(game.credits.player, 98.5);
});

test('capturing a Field Workshop transfers its repair effect and save/load preserves service state', () => {
  const game = new Game({ seed: 73 });
  const bay = addWorkshop(game, 'enemy', 20, 20);
  bay.hp = bay.maxHp * 0.7;
  const captureEngineer = game._createUnit('player', 'engineer', 20.5, 20.5,
    { type: 'engineer', targetId: bay.id });
  game._updateUnit(captureEngineer, 0.1);
  assert.equal(bay.owner, 'player');

  const playerVehicle = game._createUnit('player', 'buggy', 21, 21);
  const enemyVehicle = game._createUnit('enemy', 'buggy', 21, 21);
  playerVehicle.hp -= 20;
  enemyVehicle.hp -= 20;
  game.credits.player = 300;
  const loaded = Game.deserialize(game.serialize());
  loaded._updateBuildings(1);
  assert.equal(loaded.getEntity(playerVehicle.id).hp, playerVehicle.hp + 11);
  assert.equal(loaded.getEntity(enemyVehicle.id).hp, enemyVehicle.hp);
  assert.equal(loaded.credits.player, 294.5);
});

test('AI builds at most one Field Workshop when damaged armor and surplus credits justify it', () => {
  const game = new Game({ seed: 74, difficulty: 'normal' });
  const extraStructures = ['radar', 'tech', game.enemyFaction === 'aegis' ? 'aaTower' : 'sam',
    'helipad', game.enemyFaction === 'aegis' ? 'guardTower' : 'obelisk', 'turret', 'turret',
    'refinery', game.enemyFaction === 'aegis' ? 'superweapon' : 'warhead'];
  for (const defId of extraStructures) game._createBuilding('enemy', defId, 0, 0, 1);
  game._createUnit('enemy', 'apc', 46.5, 20.5);
  const damagedTank = game._createUnit('enemy', 'lightTank', 45.5, 20.5);
  damagedTank.hp -= 100;
  game._refreshPower();
  game.power.enemy.ratio = 1;
  game.credits.enemy = 5000;

  game._aiTick();
  const bay = game.buildings.find(b => b.owner === 'enemy' && b.defId === 'serviceBay');
  assert.ok(bay, 'AI starts construction with a damaged vehicle and surplus credits');
  assert.equal(game.buildings.filter(b => b.owner === 'enemy' && b.defId === 'serviceBay').length, 1);
  bay.progress = 1;
  game.credits.enemy = 5000;
  game._aiTick();
  assert.equal(game.buildings.filter(b => b.owner === 'enemy' && b.defId === 'serviceBay').length, 1);
});

test('explicit service order waits on power and credits, fully repairs, then restores its prior order', () => {
  const game = new Game({ seed: 75 });
  const bay = addWorkshop(game);
  const vehicle = game._createUnit('player', 'lightTank', 21, 21);
  vehicle.hp -= 80;
  vehicle.order = { type: 'guard', x: 12.5, y: 12.5 };
  game.select(vehicle.id);
  game.commandOwner = 'player';
  assert.deepEqual(game.issueServiceAtWorkshop(bay.id), { ok: true });
  assert.equal(vehicle.order.type, 'service');
  assert.deepEqual(vehicle.order.resumeOrder, { type: 'guard', x: 12.5, y: 12.5 });

  game.credits.player = 0;
  game._updateBuildings(0.25);
  game._updateUnit(vehicle, 0.25);
  assert.equal(vehicle.hp, vehicle.maxHp - 80);
  assert.equal(vehicle.order.type, 'service');
  assert.equal(vehicle._serviceWaiting, 'credits');

  game.credits.player = 100;
  for (let i = 0; i < 40 && vehicle.order.type === 'service'; i++) {
    game._updateBuildings(0.25);
    game._updateUnit(vehicle, 0.25);
  }
  assert.equal(vehicle.hp, vehicle.maxHp);
  assert.deepEqual(vehicle.order, { type: 'guard', x: 12.5, y: 12.5 });
});

test('service orders validate the workshop and unit, pause while unpowered, and restore after bay loss', () => {
  const game = new Game({ seed: 75 });
  const bay = addWorkshop(game);
  const vehicle = game._createUnit('player', 'buggy', 21, 21);
  vehicle.hp -= 30;
  const infantry = game._createUnit('player', 'rifle', 21, 21);
  const enemyBay = addWorkshop(game, 'enemy', 30, 20);
  game.select(vehicle.id);
  assert.match(game.issueServiceAtWorkshop('missing').reason, /completed friendly Field Workshop/);
  assert.match(game.issueServiceAtWorkshop(enemyBay.id).reason, /completed friendly Field Workshop/);
  game.select(infantry.id);
  assert.match(game.issueServiceAtWorkshop(bay.id).reason, /damaged ground vehicle/);

  game.select(vehicle.id);
  vehicle.order = { type: 'move', x: 25.5, y: 21.5 };
  assert.equal(game.issueServiceAtWorkshop(bay.id).ok, true);
  bay.powered = false;
  game._updateUnit(vehicle, 0.25);
  assert.equal(vehicle.order.type, 'service');
  bay.hp = 0;
  game._updateUnit(vehicle, 0.25);
  assert.deepEqual(vehicle.order, { type: 'move', x: 25.5, y: 21.5 });
});

test('distant service command travels, repairs on normal updates, and survives a mid-service save/load', () => {
  const game = new Game({ seed: 77, mode: 'multiplayer' });
  const bay = addWorkshop(game, 'player', 20, 20);
  const vehicle = game._createUnit('player', 'lightTank', 29.5, 25.5);
  vehicle.hp -= 90;
  game.select(vehicle.id);
  assert.equal(game.issuePatrol(35.5, 30.5).ok, true);
  const previousOrder = structuredClone(vehicle.order);
  assert.equal(game.issueServiceAtWorkshop(bay.id).ok, true);
  const destination = { x: vehicle.order.x, y: vehicle.order.y };
  const startDistance = Math.hypot(vehicle.x - destination.x, vehicle.y - destination.y);

  const dt = 1 / 30;
  for (let i = 0; i < 24; i++) game.update(dt);
  assert.ok(Math.hypot(vehicle.x - destination.x, vehicle.y - destination.y) < startDistance,
    'vehicle moves toward the selected Workshop through Game.update');
  assert.equal(vehicle.order.type, 'service');

  const loaded = Game.deserialize(game.serialize());
  const loadedVehicle = loaded.getEntity(vehicle.id);
  assert.deepEqual(loadedVehicle.order, vehicle.order);
  assert.deepEqual(loadedVehicle.path, vehicle.path);
  for (let i = 0; i < 900 && vehicle.order.type === 'service'; i++) {
    game.update(dt);
    loaded.update(dt);
    assert.deepEqual(loadedVehicle.order, vehicle.order);
    assert.deepEqual(loadedVehicle.path, vehicle.path);
    assert.equal(loadedVehicle.x, vehicle.x);
    assert.equal(loadedVehicle.y, vehicle.y);
    assert.equal(loadedVehicle.hp, vehicle.hp);
    assert.equal(loaded.credits.player, game.credits.player);
  }
  assert.equal(vehicle.hp, vehicle.maxHp);
  assert.deepEqual(vehicle.order, previousOrder);
  assert.deepEqual(loadedVehicle.order, previousOrder);
});
