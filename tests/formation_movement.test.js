import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 90210 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function squad(game, type = 'rifle') {
  return [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]]
    .map(([x, y]) => game._createUnit('player', type, x, y));
}

for (const command of ['move', 'forceMove', 'attackMove']) {
  test(`${command} assigns distinct, layout preserving destinations and persists them`, () => {
    const game = arena();
    const units = squad(game);
    game.select(units.map(u => u.id).reverse());
    const issue = command === 'forceMove' ? game.issueForceMove(30.5, 25.5)
      : game.issueMove(30.5, 25.5, command === 'attackMove');
    assert.deepEqual(issue, { ok: true });
    const slots = units.map(u => [u.order.x, u.order.y]);
    assert.equal(new Set(slots.map(p => p.join(','))).size, units.length);
    assert.ok(slots[0][0] < slots[1][0] && slots[0][1] < slots[2][1],
      'left/right and front/back formation relationships remain');
    for (const u of units) {
      assert.equal(u.order.type, command === 'forceMove' ? 'forceMove' : 'move');
      assert.equal(!!u.order.attackMove, command === 'attackMove');
      assert.equal(game._isPassable(Math.floor(u.order.x), Math.floor(u.order.y)), true);
    }
    const loaded = Game.deserialize(game.serialize());
    assert.deepEqual(units.map(u => loaded.getEntity(u.id).order), units.map(u => u.order));
    const repeat = arena();
    const repeatedUnits = squad(repeat);
    repeat.select(repeatedUnits.map(u => u.id));
    if (command === 'forceMove') repeat.issueForceMove(30.5, 25.5);
    else repeat.issueMove(30.5, 25.5, command === 'attackMove');
    assert.deepEqual(repeatedUnits.map(u => [u.order.x, u.order.y]), slots,
      'selection order does not affect destination assignment');
  });
}

test('ground slots avoid obstacles, buildings, stationary units and unreachable regions', () => {
  const game = arena();
  const units = squad(game);
  // This wall divides the map; the click lies beyond it.
  for (let y = 0; y < game.height; y++) game.terrain[y][20].walkable = false;
  game._createBuilding('enemy', 'power', 17, 24, 1);
  const blocker = game._createUnit('enemy', 'rifle', 19.5, 23.5);
  game.select(units.map(u => u.id));
  assert.deepEqual(game.issueMove(19.5, 24.5), { ok: true });
  const slots = units.map(u => [u.order.x, u.order.y]);
  assert.equal(new Set(slots.map(p => p.join(','))).size, 4);
  for (const [x, y] of slots) {
    assert.ok(x < 20, 'slot stays in reachable side of wall');
    assert.equal(game._isPassable(Math.floor(x), Math.floor(y)), true);
    assert.ok(Math.hypot(x - blocker.x, y - blocker.y) > 0.7);
    assert.ok(game._findPath(units[0].x, units[0].y, x, y).length > 0);
  }
});

test('mixed ground and air units use their own passability and retain single-unit precision', () => {
  const game = arena();
  const ground = game._createUnit('player', 'rifle', 10.5, 10.5);
  const air = game._createUnit('player', 'orca', 12.5, 10.5);
  for (let y = 18; y <= 24; y++) for (let x = 28; x <= 34; x++) game.terrain[y][x].walkable = false;
  game.select([ground.id, air.id]);
  assert.deepEqual(game.issueForceMove(31.5, 21.5), { ok: true });
  assert.equal(game._isPassable(Math.floor(ground.order.x), Math.floor(ground.order.y)), true);
  assert.ok(air.order.x >= 28 && air.order.x <= 35 && air.order.y >= 18 && air.order.y <= 25,
    'aircraft may take a slot above blocked terrain');
  assert.ok(Math.hypot(ground.order.x - air.order.x, ground.order.y - air.order.y) >= 0.65);
  game.select(ground.id);
  game.issueMove(25.2, 26.8);
  assert.deepEqual([ground.order.x, ground.order.y], [25.2, 26.8]);
});

test('large squads reuse a single ground connectivity scan and keep unique slots', () => {
  const game = arena();
  const movers = [];
  for (let y = 7; y < 15; y++) for (let x = 7; x < 15; x++)
    movers.push(game._createUnit('player', 'rifle', x + 0.5, y + 0.5));
  for (let y = 20; y < 36; y++) for (let x = 40; x < 56; x++)
    game._createUnit('enemy', 'rifle', x + 0.5, y + 0.5);
  const passable = game._isPassable.bind(game);
  let passabilityChecks = 0;
  game._isPassable = (x, y) => { passabilityChecks++; return passable(x, y); };
  game.select(movers.map(u => u.id));
  assert.deepEqual(game.issueForceMove(45.5, 28.5), { ok: true });
  assert.ok(passabilityChecks <= game.width * game.height + 10,
    'connectivity is computed once for the squad, rather than once per unit');
  const slots = movers.map(u => `${u.order.x},${u.order.y}`);
  assert.equal(new Set(slots).size, movers.length);
  for (const u of movers) assert.equal(passable(Math.floor(u.order.x), Math.floor(u.order.y)), true);
});
