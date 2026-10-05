import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS } from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 7345, mode: 'multiplayer' });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function advance(game, seconds) {
  for (let i = 0; i < seconds * 10; i++) {
    for (const unit of game.units) game._updateUnit(unit, 0.1);
    for (const unit of game.units) if (unit.embarkedIn) {
      const carrier = game.getEntity(unit.embarkedIn);
      if (carrier?.hp > 0) { unit.x = carrier.x; unit.y = carrier.y; }
    }
  }
}

test('APC is a shared factory unit with three infantry seats', () => {
  assert.equal(UNIT_DEFS.apc.producer, 'factory');
  assert.equal(UNIT_DEFS.apc.faction, 'all');
  assert.equal(UNIT_DEFS.apc.capacity, 3);
  assert.equal(UNIT_DEFS.apc.weapon, null);
});

test('Airlift Dropship is a powered Helipad transport with implicit radar access', () => {
  const game = arena();
  const helipad = game._createBuilding('player', 'helipad', 5, 5);
  game.buildings = [helipad];
  game.radar.player = false;
  assert.equal(UNIT_DEFS.dropship.name, 'Airlift Dropship');
  assert.equal(UNIT_DEFS.dropship.producer, 'helipad');
  assert.equal(UNIT_DEFS.dropship.role, 'transport');
  assert.equal(UNIT_DEFS.dropship.capacity, 4);
  assert.equal(UNIT_DEFS.dropship.flying, true);
  assert.equal(UNIT_DEFS.dropship.weapon, null);
  assert.equal(game.canQueueUnit('dropship').ok, true);
  assert.equal(game.queueUnit('dropship').ok, true);
  helipad.powered = false;
  assert.equal(game.canQueueUnit('dropship').ok, false);
});

test('dropship flies across impassable terrain, boards and unloads on passable ground', () => {
  const game = arena();
  const ship = game._createUnit('player', 'dropship', 12.5, 12.5);
  const passengers = Array.from({ length: 4 }, (_, i) => game._createUnit('player', 'rifle', 12.5 + i * 0.1, 12.5));
  game.select(passengers.map(u => u.id));
  assert.equal(game.issueBoard(ship.id).ok, true);
  advance(game, 2);
  assert.equal(ship.passengerIds.length, 4);
  for (let y = 10; y <= 21; y++) for (let x = 10; x <= 22; x++) {
    game.terrain[y][x].walkable = false;
    game.terrain[y][x].type = 'water';
  }
  ship.order = { type: 'move', x: 18.5, y: 18.5 };
  advance(game, 3);
  assert.ok(ship.x > 17, 'flight crosses the water patch while carrying infantry');
  assert.equal(game._isPassable(Math.floor(ship.x), Math.floor(ship.y)), false);
  const invalid = game.issueUnload(18.5, 18.5);
  assert.equal(invalid.ok, false, 'cannot intentionally unload over water');
  game.terrain[24][24].walkable = true;
  game.terrain[24][24].type = 'sand';
  game.select(ship.id);
  assert.equal(game.issueUnload(24.5, 24.5).ok, true);
  advance(game, 5);
  assert.equal(ship.passengerIds.length, 0);
  assert.ok(passengers.every(u => !u.embarkedIn && game._isPassable(Math.floor(u.x), Math.floor(u.y))));
});

test('dropship uses its clear landing tile on an isolated island and keeps extra passengers aboard', () => {
  const game = arena();
  const ship = game._createUnit('player', 'dropship', 12.5, 12.5);
  const passengers = Array.from({ length: 2 }, (_, i) => game._createUnit('player', 'rifle', 12.5 + i * 0.1, 12.5));
  game.select(passengers.map(u => u.id));
  assert.equal(game.issueBoard(ship.id).ok, true);
  advance(game, 1);
  assert.equal(ship.passengerIds.length, 2);
  for (const row of game.terrain) for (const tile of row) {
    tile.walkable = false; tile.type = 'water';
  }
  const landingX = 24, landingY = 24;
  game.terrain[landingY][landingX].walkable = true;
  game.terrain[landingY][landingX].type = 'sand';
  game.select(ship.id);
  assert.equal(game.issueUnload(landingX + 0.5, landingY + 0.5).ok, true);
  ship.x = landingX + 0.5; ship.y = landingY + 0.5;
  game._updateUnit(ship, 0.1);
  assert.equal(game._isPassable(Math.floor(passengers[0].x), Math.floor(passengers[0].y)), true);
  assert.equal(passengers[0].embarkedIn, null);
  assert.equal(passengers[1].embarkedIn, ship.id, 'no legal second slot exists, so the extra passenger stays aboard');
  assert.deepEqual(ship.passengerIds, [passengers[1].id]);
});

test('dropship transport ownership and passenger state survive deterministic save/load', () => {
  const game = arena();
  const ship = game._createUnit('player', 'dropship', 20.5, 20.5);
  const passenger = game._createUnit('player', 'engineer', 20.7, 20.5);
  game.select(passenger.id);
  assert.equal(game.issueBoard(ship.id).ok, true);
  advance(game, 0.2);
  const loaded = Game.deserialize(game.serialize());
  const loadedShip = loaded.getEntity(ship.id), loadedPassenger = loaded.getEntity(passenger.id);
  assert.equal(loadedShip.defId, 'dropship');
  assert.equal(loadedShip.owner, 'player');
  assert.equal(loadedPassenger.embarkedIn, loadedShip.id);
  assert.deepEqual(loadedShip.passengerIds, [loadedPassenger.id]);
  game.time += 0.1; loaded.time += 0.1;
  game._updateUnit(ship, 0.1); loaded._updateUnit(loadedShip, 0.1);
  assert.deepEqual(loaded.events, game.events);
  assert.deepEqual([loadedShip.x, loadedShip.y, loadedPassenger.x, loadedPassenger.y],
    [ship.x, ship.y, passenger.x, passenger.y]);
});

test('destroyed dropship ejects nearby survivors and kills passengers when no ground is reachable', () => {
  const game = arena();
  const ship = game._createUnit('player', 'dropship', 20.5, 20.5);
  const passenger = game._createUnit('player', 'rifle', 20.6, 20.5);
  game.select(passenger.id); game.issueBoard(ship.id); advance(game, 0.2);
  game._applyDamage(ship, 2000, 'explosive', 'enemy');
  assert.equal(passenger.embarkedIn, null);
  assert.equal(passenger.hp, UNIT_DEFS.rifle.health * 0.5);
  const doomedShip = game._createUnit('player', 'dropship', 30.5, 30.5);
  const doomed = game._createUnit('player', 'rifle', 30.6, 30.5);
  game.select(doomed.id); game.issueBoard(doomedShip.id); advance(game, 0.2);
  for (let y = 26; y <= 34; y++) for (let x = 26; x <= 34; x++) game.terrain[y][x].walkable = false;
  game._applyDamage(doomedShip, 2000, 'explosive', 'enemy');
  assert.equal(doomed.hp, 0);
  assert.equal(doomed.embarkedIn, null);
});

test('board approaches a moving carrier; passengers cannot be selected or damaged', () => {
  const game = arena();
  const carrier = game._createUnit('player', 'apc', 18.5, 18.5);
  const infantry = game._createUnit('player', 'rifle', 14.5, 18.5);
  const enemy = game._createUnit('enemy', 'rifle', 35.5, 35.5);
  game.select(infantry.id);
  assert.deepEqual(game.issueBoard(carrier.id), { ok: true });
  carrier.order = { type: 'move', x: 22.5, y: 18.5 };
  advance(game, 9);
  assert.equal(infantry.embarkedIn, carrier.id);
  assert.deepEqual(carrier.passengerIds, [infantry.id]);
  assert.deepEqual(game.select(infantry.id).ids, []);
  assert.equal(game.isVisible(infantry, 'enemy'), false);
  const hp = infantry.hp;
  game._applyDamage(infantry, 999, 'explosive', 'enemy', enemy.id);
  game._damageArea(carrier.x, carrier.y, 2, 50, 'explosive', 'enemy', enemy.id);
  assert.equal(infantry.hp, hp);
});

test('capacity reservation, invalid owner and dead carrier reject without replacing orders', () => {
  const game = arena();
  const carrier = game._createUnit('player', 'apc', 20.5, 20.5);
  const infantry = Array.from({ length: 4 }, (_, i) => game._createUnit('player', 'rifle', 15.5, 15.5 + i));
  game.select(infantry.slice(0, 3).map(u => u.id));
  assert.equal(game.issueBoard(carrier.id).ok, true);
  game.select(infantry[3].id);
  assert.equal(game.issueBoard(carrier.id).ok, false);
  assert.equal(infantry[3].order.type, 'idle');
  game.commandOwner = 'enemy';
  assert.equal(game.issueBoard(carrier.id).ok, false);
  game.commandOwner = 'player';
  carrier.hp = 0;
  assert.equal(game.issueBoard(carrier.id).ok, false);
});

test('unload moves to destination and uses distinct nearby passable tiles', () => {
  const game = arena();
  const carrier = game._createUnit('player', 'apc', 15.5, 15.5);
  const passengers = Array.from({ length: 3 }, (_, i) => game._createUnit('player', 'rifle', 15.5 + i * 0.2, 15.5));
  game.select(passengers.map(u => u.id));
  assert.equal(game.issueBoard(carrier.id).ok, true);
  advance(game, 2);
  assert.equal(carrier.passengerIds.length, 3);
  game.terrain[20][21].walkable = false;
  game.select(carrier.id);
  assert.equal(game.issueUnload(20.5, 20.5).ok, true);
  advance(game, 10);
  assert.equal(carrier.order.type, 'idle');
  assert.deepEqual(carrier.passengerIds, []);
  assert.equal(new Set(passengers.map(u => `${u.x},${u.y}`)).size, 3);
  for (const u of passengers) {
    assert.equal(u.embarkedIn, null);
    assert.equal(game._isPassable(Math.floor(u.x), Math.floor(u.y)), true);
  }
});

test('destroying carrier ejects survivors with damage and save restores active transport', () => {
  const game = arena();
  const carrier = game._createUnit('player', 'apc', 20.5, 20.5);
  const passenger = game._createUnit('player', 'engineer', 20.7, 20.5);
  game.select(passenger.id);
  game.issueBoard(carrier.id);
  advance(game, 0.2);
  const restored = Game.deserialize(game.serialize());
  const loadedCarrier = restored.getEntity(carrier.id);
  const loadedPassenger = restored.getEntity(passenger.id);
  assert.equal(loadedPassenger.embarkedIn, loadedCarrier.id);
  assert.deepEqual(loadedCarrier.passengerIds, [loadedPassenger.id]);
  restored._applyDamage(loadedCarrier, 2000, 'explosive', 'enemy');
  assert.equal(loadedPassenger.embarkedIn, null);
  assert.equal(loadedPassenger.hp, passenger.hp * 0.5);
  assert.equal(restored._isPassable(Math.floor(loadedPassenger.x), Math.floor(loadedPassenger.y)), true);
});

test('carrier-killing splash does not hit newly ejected passengers a second time', () => {
  const game = arena();
  const carrier = game._createUnit('player', 'apc', 20.5, 20.5);
  const passenger = game._createUnit('player', 'rifle', 20.7, 20.5);
  game.select(passenger.id);
  game.issueBoard(carrier.id);
  advance(game, 0.2);
  game._damageArea(carrier.x, carrier.y, 2, 2000, 'explosive', 'enemy', null);
  assert.equal(carrier.hp, 0);
  assert.equal(passenger.embarkedIn, null);
  assert.equal(passenger.hp, UNIT_DEFS.rifle.health * 0.5);
});
