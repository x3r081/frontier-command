import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS, TACTICAL_ELEVATION_RULES_VERSION } from '../src/game/engine.js';

test('authored vantage tiles are deterministic, walkable, and save with the map', () => {
  for (const map of SKIRMISH_MAPS) {
    const first = new Game({ seed: 8042, mapId: map.id });
    const second = new Game({ seed: 8042, mapId: map.id });
    const elevated = game => game.terrain.flatMap((row, y) => row.flatMap((tile, x) =>
      tile.elevation === 1 ? [{ x, y, walkable: tile.walkable }] : []));
    assert.ok(elevated(first).length > 0, `${map.id} has at least one vantage zone`);
    assert.ok(elevated(first).every(tile => tile.walkable), `${map.id} elevation does not change pathability`);
    assert.deepEqual(elevated(first), elevated(second));
    assert.deepEqual(Game.deserialize(first.serialize()).terrain, first.terrain);
  }
});

test('vantage gives ground units one sight and half a tile of range, including firing range', () => {
  const game = new Game({ seed: 412 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) tile.elevation = 0;
  const tank = game._createUnit('player', 'lightTank', 20.5, 20.5);
  const baseSight = game.unitDefs.lightTank.sight;
  const baseRange = game.unitDefs.lightTank.weapon.range;
  assert.equal(game._unitSight(tank, baseSight), baseSight);
  assert.equal(game._unitWeaponRange(tank, game.unitDefs.lightTank.weapon), baseRange);
  game.terrain[20][20].elevation = 1;
  assert.equal(game._unitSight(tank, baseSight), baseSight + 1);
  assert.equal(game._unitWeaponRange(tank, game.unitDefs.lightTank.weapon), baseRange + 0.5);
  for (const row of game.terrain) for (const tile of row) { tile.type = 'sand'; tile.walkable = true; }
  const target = game._createUnit('enemy', 'rifle', 26.2, 20.5);
  tank.order = { type: 'attack', targetId: target.id };
  tank.cooldown = 0;
  game._updateUnit(tank, 0.1);
  assert.ok(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === tank.id),
    'the added range permits a shot beyond the tank’s nominal reach');
  const aircraft = game._createUnit('player', 'orca', 22.5, 20.5);
  game.terrain[20][22].elevation = 1;
  assert.equal(game._unitSight(aircraft, game.unitDefs.orca.sight), game.unitDefs.orca.sight);
  assert.equal(game._unitWeaponRange(aircraft, game.unitDefs.orca.weapon), game.unitDefs.orca.weapon.range);
});

test('pre-v58 replays keep flat-ground bonuses disabled', () => {
  const game = new Game({ seed: 412, replayVersion: TACTICAL_ELEVATION_RULES_VERSION - 1 });
  game.units = []; game.buildings = []; game.relays = [];
  const tank = game._createUnit('player', 'lightTank', 20.5, 20.5);
  game.terrain[20][20].elevation = 1;
  assert.equal(game._unitOnVantage(tank), false);
  assert.equal(game._unitSight(tank, game.unitDefs.lightTank.sight), game.unitDefs.lightTank.sight);
  assert.equal(game._unitWeaponRange(tank, game.unitDefs.lightTank.weapon), game.unitDefs.lightTank.weapon.range);
});

test('Siege Director moves artillery to a nearby elevated firing tile for a visible defense', () => {
  const game = new Game({ seed: 412, aiCommanderProfileId: 'siege-director' });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.walkable = true; tile.buildable = true; tile.elevation = 0;
  }
  const artillery = game._createUnit('enemy', 'artillery', 20.5, 23.5);
  game._createUnit('enemy', 'scout', 29.5, 23.5);
  const turret = game._createBuilding('player', 'turret', 36, 23);
  game.terrain[24][27].elevation = 1;
  game._aiSiegeVisibleDefenses([artillery]);
  assert.equal(artillery._aiSiegeTarget, turret.id);
  assert.equal(artillery.order.type, 'move');
  assert.equal(artillery.order.aiSiegeVantage, true);
  assert.equal(artillery.order.x, 27.5);
  assert.equal(artillery.order.y, 24.5);

  const legacy = new Game({ seed: 412, aiCommanderProfileId: 'siege-director', replayVersion: 57 });
  legacy.units = []; legacy.buildings = []; legacy.relays = [];
  for (const row of legacy.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.walkable = true; tile.buildable = true; tile.elevation = 0;
  }
  const oldArtillery = legacy._createUnit('enemy', 'artillery', 20.5, 23.5);
  legacy._createUnit('enemy', 'scout', 29.5, 23.5);
  legacy._createBuilding('player', 'turret', 36, 23);
  legacy.terrain[24][27].elevation = 1;
  legacy._aiSiegeVisibleDefenses([oldArtillery]);
  assert.equal(oldArtillery.order.aiSiegeVantage, undefined);
});
