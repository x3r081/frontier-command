import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 4081 });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function advanceUnit(game, unit, seconds) {
  for (let i = 0; i < seconds * 10; i++) game._updateUnit(unit, 0.1);
}

test('guard holds an anchor, pursues a nearby threat, then returns', () => {
  const game = arena();
  const guard = game._createUnit('player', 'rifle', 20.5, 20.5);
  const intruder = game._createUnit('enemy', 'engineer', 25.5, 20.5);
  guard.cooldown = 100;
  game.select(guard.id);
  assert.deepEqual(game.issueGuard(), { ok: true });
  assert.deepEqual(guard.order, { type: 'guard', x: 20.5, y: 20.5 });

  advanceUnit(game, guard, 2);
  assert.ok(guard.x > 20.8, 'guard moves to engage a threat near its anchor');
  intruder.x = 40.5;
  advanceUnit(game, guard, 4);
  assert.ok(Math.hypot(guard.x - 20.5, guard.y - 20.5) < 0.5, 'guard returns to its anchor');
  assert.equal(guard.order.type, 'guard');
});

test('patrol repeatedly travels between its own anchor and the selected point', () => {
  const game = arena();
  const patrol = game._createUnit('player', 'rifle', 20.5, 20.5);
  game.select(patrol.id);
  assert.equal(game.issuePatrol(-1, 20).ok, false);
  assert.deepEqual(patrol.order, { type: 'idle' });
  assert.deepEqual(game.issuePatrol(25.5, 20.5), { ok: true });
  assert.equal(patrol.order.leg, 1);
  advanceUnit(game, patrol, 4);
  assert.equal(patrol.order.leg, 0, 'unit reverses at the selected point');
  advanceUnit(game, patrol, 4);
  assert.equal(patrol.order.leg, 1, 'unit reverses again at its anchor');
  assert.equal(patrol.order.type, 'patrol');
});

test('patrol rejects an unreachable endpoint without replacing the prior order', () => {
  const game = arena();
  const patrol = game._createUnit('player', 'rifle', 20.5, 20.5);
  for (let y = 0; y < game.height; y++) game.terrain[y][23].walkable = false;
  game.select(patrol.id);
  assert.equal(game.issuePatrol(30.5, 20.5).ok, false);
  assert.deepEqual(patrol.order, { type: 'idle' });
});

test('scatter spreads units away from visible local threats using reachable tiles', () => {
  const game = arena();
  const first = game._createUnit('player', 'rifle', 20.5, 20.5);
  const second = game._createUnit('player', 'rifle', 20.5, 21.5);
  const threat = game._createUnit('enemy', 'rifle', 23.5, 20.5);
  for (let y = 10; y < 32; y++) game.terrain[y][18].walkable = false;
  game.select([first.id, second.id]);
  assert.deepEqual(game.issueScatter(), { ok: true });
  const destinations = [first.order, second.order];
  for (const [i, u] of [first, second].entries()) {
    const target = destinations[i];
    assert.equal(target.type, 'scatter');
    assert.ok(Math.hypot(target.x - threat.x, target.y - threat.y) >
      Math.hypot(u.x - threat.x, u.y - threat.y), 'scatter destination is farther from threat');
    assert.ok(game._isPassable(Math.floor(target.x), Math.floor(target.y)));
    assert.ok(game._findPath(u.x, u.y, target.x, target.y).length > 0);
  }
  assert.ok(Math.hypot(destinations[0].x - destinations[1].x,
    destinations[0].y - destinations[1].y) > 1, 'destinations are separated');
  advanceUnit(game, first, 6);
  assert.equal(first.order.type, 'idle', 'scatter completes as a one-time move');
});

test('new commands honor commandOwner even when selection belongs to another owner', () => {
  const game = arena();
  const player = game._createUnit('player', 'rifle', 20.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 30.5, 20.5);
  game.select(player.id);
  game.commandOwner = 'enemy';
  for (const command of [() => game.issueGuard(), () => game.issuePatrol(34.5, 20.5),
    () => game.issueScatter()]) assert.equal(command().ok, false);
  assert.deepEqual(player.order, { type: 'idle' });
  game.select(enemy.id);
  assert.deepEqual(game.issueGuard(), { ok: true });
  assert.deepEqual(game.issuePatrol(34.5, 20.5), { ok: true });
  assert.deepEqual(game.issueScatter(), { ok: true });
  assert.equal(game.events.at(-1).order, 'scatter');
  assert.deepEqual(game.events.at(-1).ids, [enemy.id]);
  assert.deepEqual(player.order, { type: 'idle' });
});

test('scatter leaves trapped units on their current order and reports only assigned units', () => {
  const game = arena();
  const trapped = game._createUnit('player', 'rifle', 10.5, 10.5);
  const free = game._createUnit('player', 'rifle', 20.5, 20.5);
  for (let y = 9; y <= 11; y++) for (let x = 9; x <= 11; x++)
    if (x !== 10 || y !== 10) game.terrain[y][x].walkable = false;
  game.select([trapped.id, free.id]);
  assert.deepEqual(game.issueScatter(), { ok: true });
  assert.deepEqual(trapped.order, { type: 'idle' });
  assert.equal(free.order.type, 'scatter');
  assert.deepEqual(game.events.at(-1).ids, [free.id]);
});

test('guard, patrol, and scatter orders persist across save and load', () => {
  const game = arena();
  const guard = game._createUnit('player', 'rifle', 10.5, 10.5);
  const patrol = game._createUnit('player', 'rifle', 20.5, 20.5);
  const scatter = game._createUnit('player', 'rifle', 30.5, 30.5);
  game.select(guard.id); game.issueGuard();
  game.select(patrol.id); game.issuePatrol(25.5, 20.5);
  game.select(scatter.id); game.issueScatter();
  const loaded = Game.deserialize(game.serialize());
  for (const original of [guard, patrol, scatter])
    assert.deepEqual(loaded.getEntity(original.id).order, original.order);
  const loadedPatrol = loaded.getEntity(patrol.id);
  advanceUnit(loaded, loadedPatrol, 4);
  assert.equal(loadedPatrol.order.type, 'patrol');
  assert.equal(loadedPatrol.order.leg, 0);
});
