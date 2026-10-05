import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, replaySoloRun } from '../src/game/replay.js';

function gameWithBridges(seed = 719) {
  return new Game({ mode: 'skirmish', mapId: 'delta-crossing', seed, difficulty: 'easy' });
}

test('Delta bridges are public attack targets and destroyed spans close only ground routes', () => {
  const game = gameWithBridges();
  const [bridge, otherBridge] = game.bridges;
  assert.equal(game.bridges.length, 2);
  assert.equal(game.getEntity(bridge.id), bridge);
  assert.equal(bridge.hp, bridge.maxHp);
  for (let y = bridge.y; y < bridge.y + bridge.h; y++) for (let x = bridge.x; x < bridge.x + bridge.w; x++)
    assert.equal(game._isPassable(x, y), true);

  const source = { x: bridge.x + 1.5, y: bridge.y - 2 + 0.5 };
  const destination = { x: bridge.x + 1.5, y: bridge.y + bridge.h + 1.5 };
  const openPath = game._findPath(source.x, source.y, destination.x, destination.y);
  assert.ok(openPath.some(point => Math.floor(point.x) === bridge.x + 1));

  game.useCommandAbility('scan', bridge.x + 1.5, bridge.y + 1.5);
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  tank.x = bridge.x - 2 + 0.5;
  tank.y = bridge.y - 1 + 0.5;
  tank.cooldown = 0;
  game.select(tank.id);
  assert.equal(game.issueAttack(bridge.id).ok, true);
  assert.equal(tank.order.targetId, bridge.id);
  const before = bridge.hp;
  game.update(0.5);
  assert.ok(bridge.hp < before, 'the targeted projectile damages the bridge');

  for (let i = 0; i < 120 && !bridge.destroyed; i++) game.update(0.5);
  assert.equal(bridge.hp, 0);
  assert.equal(bridge.destroyed, true);
  for (let y = bridge.y; y < bridge.y + bridge.h; y++) for (let x = bridge.x; x < bridge.x + bridge.w; x++)
    assert.equal(game._isPassable(x, y), false);
  const closedPath = game._findPath(source.x, source.y, destination.x, destination.y);
  assert.ok(closedPath.length > 0, 'the other crossing keeps the map connected');
  assert.equal(closedPath.some(point => Math.floor(point.x) >= bridge.x &&
    Math.floor(point.x) < bridge.x + bridge.w && Math.floor(point.y) >= bridge.y &&
    Math.floor(point.y) < bridge.y + bridge.h), false);
  assert.equal(game._isPassable(bridge.x, bridge.y), false);
  assert.equal(game._findPath(source.x, source.y, destination.x, destination.y).some(point =>
    Math.floor(point.x) >= otherBridge.x && Math.floor(point.x) < otherBridge.x + otherBridge.w), true);
  const airlift = game._createUnit('player', 'dropship', bridge.x + 1.5, bridge.y - 1);
  game._moveUnit(airlift, bridge.x + 1.5, bridge.y + bridge.h + 1, 3);
  assert.ok(airlift.y > bridge.y + bridge.h, 'aircraft cross a destroyed span without a ground path');
});

test('jam recovery skips path searches across disconnected Delta banks and resumes after a bridge repair', () => {
  const game = gameWithBridges();
  game.units = [];
  const unit = game._createUnit('player', 'rifle', 30.5, 18.5,
    { type: 'move', x: 30.5, y: 28.5 });
  const order = { ...unit.order };
  for (const bridge of game.bridges) game._applyDamage(bridge, bridge.maxHp, 'ion', 'enemy');
  assert.equal(game._findPath(unit.x, unit.y, order.x, order.y).length, 0,
    'both destroyed spans disconnect the unit from its destination');

  let pathSearches = 0;
  const findPath = game._findPath.bind(game);
  game._findPath = (...args) => { pathSearches++; return findPath(...args); };
  for (let step = 0; step < 80; step++) {
    const before = new Map([[unit.id, { x: unit.x, y: unit.y }]]);
    game._updateMovementJams(before, 0.1);
  }
  assert.equal(pathSearches, 0, 'unreachable jam checks do not start local path searches');
  assert.ok(unit._jamSeconds >= 2, 'the original jam timer remains ready when a bridge reopens');
  assert.deepEqual(unit.order, order, 'the move order remains available for a later repair');

  const repairedBridge = game.bridges[0];
  repairedBridge.hp = repairedBridge.maxHp;
  repairedBridge.destroyed = false;
  repairedBridge._dead = false;
  game._setBridgePassability(repairedBridge, true);
  assert.ok(findPath(unit.x, unit.y, order.x, order.y).length > 0,
    'repair reconnects the route across the channel');
  pathSearches = 0;
  game._updateMovementJams(new Map([[unit.id, { x: unit.x, y: unit.y }]]), 0.1);
  assert.ok(pathSearches > 0, 'jam recovery resumes local route searches after topology reconnects');
  assert.deepEqual(unit.order, order);
});

test('engineers repair destroyed spans and bridge state survives save/load', () => {
  const game = gameWithBridges(720);
  const bridge = game.bridges[0];
  game.useCommandAbility('scan', bridge.x + 1.5, bridge.y + 1.5);
  game._applyDamage(bridge, bridge.maxHp, 'ion', 'enemy');
  assert.equal(bridge.destroyed, true, 'a repaired bridge can be destroyed again');
  const engineer = game._createUnit('player', 'engineer', bridge.x - 0.5, bridge.y - 0.5);
  game.select(engineer.id);
  assert.equal(game.issueEngineer(bridge.id).ok, true);
  assert.equal(engineer.order.type, 'engineer');
  for (let i = 0; i < 180 && bridge.destroyed; i++) game.update(0.1);
  assert.equal(bridge.destroyed, false);
  assert.equal(bridge.hp, bridge.maxHp);
  assert.equal(engineer.hp > 0, true, 'bridge repair does not consume the engineer');
  assert.equal(engineer.order.type, 'idle');
  assert.equal(game._isPassable(bridge.x, bridge.y), true);

  game._applyDamage(bridge, bridge.maxHp, 'ion', 'enemy');
  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(restored.bridges, game.bridges);
  assert.equal(restored._isPassable(bridge.x, bridge.y), false);
});

test('Delta bridge attack and repair orders replay deterministically', () => {
  const seed = 721;
  const game = gameWithBridges(seed);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  const bridge = game.bridges[0];
  assert.equal(game.useCommandAbility('scan', bridge.x + 1.5, bridge.y + 1.5).ok, true);
  game.select(tank.id);
  assert.equal(game.issueAttack(bridge.id).ok, true);
  clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  recorder.dispose();

  const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed, scenarioId: 'delta-crossing' };
  const replay = replaySoloRun(envelope, recorder.commands, clock.completedTicks);
  assert.deepEqual(replay.game.bridges, game.bridges);
  assert.equal(replay.game.units.find(unit => unit.id === tank.id).order.targetId, bridge.id);
});

test('only Delta Crossing skirmish or multiplayer creates destructible bridges', () => {
  assert.equal(new Game({ mapId: 'shard-valley' }).bridges.length, 0);
  assert.equal(new Game({ mapId: 'twin-passes' }).bridges.length, 0);
  assert.equal(new Game({ mapId: 'delta-crossing', mode: 'multiplayer' }).bridges.length, 2);
});

test('demolishing neutral infrastructure does not award combat veterancy', () => {
  const game = gameWithBridges(722);
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  const bridge = game.bridges[0];
  const xp = tank.xp;
  game._applyDamage(bridge, bridge.maxHp, 'ion', 'player', tank.id);
  assert.equal(bridge.destroyed, true);
  assert.equal(tank.xp, xp);
  assert.equal(tank.kills, 0);
});

test('a collapsing span takes ground forces with it while aircraft remain airborne', () => {
  const game = gameWithBridges(724);
  const bridge = game.bridges[0];
  const enemy = game._createUnit('enemy', 'rifle', bridge.x + 1.5, bridge.y + 1.5);
  const ally = game._createUnit('player', 'rifle', bridge.x + 1.5, bridge.y + 2.5);
  const aircraft = game._createUnit('player', 'dropship', bridge.x + 1.5, bridge.y + 1.5);
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  const killsBefore = game.kills.player;

  game._applyDamage(bridge, bridge.maxHp, 'ion', 'player', tank.id);
  assert.equal(enemy.hp, 0);
  assert.equal(ally.hp, 0);
  assert.ok(aircraft.hp > 0);
  assert.equal(game.kills.player, killsBefore + 1);
  assert.equal(game._isPassable(bridge.x + 1, bridge.y + 1), false);
});

test('an opening-position demolition order completes after a tactical scan expires', () => {
  const game = gameWithBridges(719);
  const bridge = game.bridges[0];
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  const collapses = [];
  game.onEvent = event => { if (event.type === 'bridgeDestroyed') collapses.push(event); };

  assert.equal(game.useCommandAbility('scan', bridge.x + 1.5, bridge.y + 1.5).ok, true);
  game.select(tank.id);
  assert.equal(game.issueAttack(bridge.id).ok, true);
  for (let i = 0; i < 350 && !bridge.destroyed; i++) game.update(0.2);

  assert.equal(bridge.destroyed, true);
  assert.ok(game.time > 11, 'the temporary scan expired before demolition');
  assert.equal(game.isVisible(bridge), false, 'the player needs new vision to see the wreck');
  assert.equal(collapses.length, 1);
  assert.equal(collapses[0].attackerOwner, 'player', 'own demolition can be confirmed without enemy intel');
});

test('older Delta saves gain intact bridges without changing their unit IDs', () => {
  const original = gameWithBridges(723);
  const legacy = JSON.parse(original.serialize());
  delete legacy.bridges;
  for (const row of legacy.terrain) for (const tile of row) if (tile.bridgeId) {
    tile.type = 'sand';
    tile.walkable = true;
    tile.buildable = true;
    delete tile.bridgeId;
  }
  const restored = Game.deserialize(legacy);
  assert.equal(restored.bridges.length, 2);
  assert.deepEqual(restored.units, original.units);
  assert.equal(restored.terrain[22][20].type, 'bridge');
  assert.equal(restored._isPassable(20, 22), true);
});
