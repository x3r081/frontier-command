import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 4312 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function advance(game, units, seconds) {
  for (let i = 0; i < seconds * 10; i++) {
    game.time += 0.1;
    for (const unit of units) game._updateUnit(unit, 0.1);
    game._updateEffects(0.1);
  }
}

test('follow tracks a moving friendly unit with clearance and survives save/load', () => {
  const game = arena();
  const leader = game._createUnit('player', 'buggy', 20.5, 20.5);
  const follower = game._createUnit('player', 'rifle', 12.5, 20.5);
  game.select(follower.id);
  assert.deepEqual(game.issueFollow(leader.id), { ok: true });
  advance(game, [follower], 5);
  assert.ok(follower.x > 17, 'follower closes the gap');
  assert.ok(Math.hypot(follower.x - leader.x, follower.y - leader.y) > 0.65,
    'follower does not overlap its target');
  leader.x = 27.5;
  const loaded = Game.deserialize(game.serialize());
  const loadedFollower = loaded.getEntity(follower.id);
  assert.deepEqual(loadedFollower.order, { type: 'follow', targetId: leader.id });
  advance(loaded, [loadedFollower], 5);
  assert.ok(loadedFollower.x > 23, 'follower resumes tracking after load');
  loaded.getEntity(leader.id).hp = 0;
  advance(loaded, [loadedFollower], 0.1);
  assert.equal(loadedFollower.order.type, 'idle', 'lost target ends follow');
});

test('follow validates target and selected unit ownership without changing orders', () => {
  const game = arena();
  const player = game._createUnit('player', 'rifle', 10.5, 10.5);
  const enemy = game._createUnit('enemy', 'rifle', 12.5, 10.5);
  game.select(player.id);
  for (const id of ['missing', enemy.id, player.id]) assert.equal(game.issueFollow(id).ok, false);
  assert.deepEqual(player.order, { type: 'idle' });
  game.commandOwner = 'enemy';
  assert.equal(game.issueFollow(enemy.id).ok, false, 'stale selection cannot command player unit');
  game.select(enemy.id);
  assert.deepEqual(game.issueFollow(player.id).ok, false);
});

test('force fire uses cooldown, fixed aim and friendly splash', () => {
  const game = arena();
  const gunner = game._createUnit('player', 'artillery', 20.5, 20.5);
  const friend = game._createUnit('player', 'rifle', 25.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 25.6, 20.5);
  const point = { x: 25.5, y: 20.5 };
  game.select(gunner.id);
  gunner.cooldown = 0;
  assert.deepEqual(game.issueForceFire(point.x, point.y), { ok: true });
  game._updateUnit(gunner, 0.1);
  const projectile = game.effects.find(fx => fx.type === 'projectile');
  assert.ok(projectile);
  assert.deepEqual([projectile.tx, projectile.ty], [point.x, point.y]);
  assert.equal(projectile.targetId, null);
  assert.ok(gunner.cooldown > 3);
  game._updateEffects(1);
  assert.ok(friend.hp < friend.maxHp, 'friendly unit receives deliberate splash');
  assert.ok(enemy.hp < enemy.maxHp, 'enemy receives splash');
  assert.equal(gunner.order.type, 'forceFire', 'unit keeps firing until another order');
  assert.deepEqual(game.events.at(-1).ids, [gunner.id]);
});

test('force fire moves into range and can strike empty ground', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 10.5, 20.5);
  rifle.cooldown = 0;
  game.select(rifle.id);
  assert.deepEqual(game.issueForceFire(18.5, 20.5), { ok: true });
  const effectId = game._nextEffectId;
  advance(game, [rifle], 4);
  assert.ok(rifle.x > 13, 'unit moves into weapon range');
  assert.ok(game._nextEffectId > effectId, 'empty ground still receives projectiles');
  assert.equal(rifle.order.type, 'forceFire');
});

test('force fire direct impact can hit ground units and persists through save/load', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const friend = game._createUnit('player', 'engineer', 23.5, 20.5);
  game.select(rifle.id);
  assert.deepEqual(game.issueForceFire(friend.x, friend.y), { ok: true });
  const loaded = Game.deserialize(game.serialize());
  const loadedRifle = loaded.getEntity(rifle.id);
  loadedRifle.cooldown = 0;
  advance(loaded, [loadedRifle], 0.5);
  assert.ok(loaded.getEntity(friend.id).hp < friend.maxHp);
  assert.equal(loadedRifle.order.type, 'forceFire');
});

test('force fire validates coordinates, weapon capability and command owner', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const engineer = game._createUnit('player', 'engineer', 21.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 30.5, 20.5);
  game.select(rifle.id);
  for (const point of [[NaN, 2], [Infinity, 2], [-1, 2], [game.width, 2]])
    assert.equal(game.issueForceFire(...point).ok, false);
  assert.deepEqual(rifle.order, { type: 'idle' });
  game.select(engineer.id);
  assert.equal(game.issueForceFire(22.5, 20.5).ok, false);
  game.select(rifle.id);
  game.commandOwner = 'enemy';
  assert.equal(game.issueForceFire(22.5, 20.5).ok, false);
  assert.deepEqual(rifle.order, { type: 'idle' });
  game.select(enemy.id);
  assert.deepEqual(game.issueForceFire(22.5, 20.5), { ok: true });
});

test('force fire gives up when obstructed and unable to move', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  for (let y = 0; y < game.height; y++) game.terrain[y][22].walkable = false;
  game.select(rifle.id);
  assert.deepEqual(game.issueForceFire(25.5, 20.5), { ok: true });
  advance(game, [rifle], 5);
  assert.equal(rifle.order.type, 'idle');
  assert.equal(game.effects.some(fx => fx.type === 'projectile'), false);
});

test('force fire ends for an aircraft that exhausts ammo without a rearm pad', () => {
  const game = arena();
  const aircraft = game._createUnit('player', 'orca', 20.5, 20.5);
  aircraft.ammo = 1;
  aircraft.cooldown = 0;
  game.select(aircraft.id);
  assert.deepEqual(game.issueForceFire(23.5, 20.5), { ok: true });
  game._updateUnit(aircraft, 0.1);
  assert.equal(aircraft.ammo, 0);
  assert.equal(aircraft.order.type, 'idle');
});

test('force move advances through weapon range without auto-engaging', () => {
  const game = arena();
  const mover = game._createUnit('player', 'rifle', 10.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 14.5, 21.5);
  enemy.cooldown = 100;
  mover.cooldown = 0;
  game.select(mover.id);
  assert.deepEqual(game.issueForceMove(19.5, 20.5), { ok: true });
  advance(game, [mover], 4);
  assert.ok(mover.x > 15, 'mover continues through an enemy weapon range');
  assert.equal(enemy.hp, enemy.maxHp);
  assert.equal(game.effects.some(fx => fx.type === 'projectile'), false);
  advance(game, [mover], 3);
  assert.equal(mover.order.type, 'idle', 'order completes at the destination');
});

test('force move keeps normal path collision and tank infantry crushing', () => {
  const game = arena();
  const tank = game._createUnit('player', 'lightTank', 10.5, 10.5);
  const infantry = game._createUnit('enemy', 'rifle', 13.5, 10.5);
  game.select(tank.id);
  assert.deepEqual(game.issueForceMove(18.5, 10.5), { ok: true });
  advance(game, [tank], 3);
  assert.equal(infantry.hp, 0, 'heavy armor crushes enemy infantry on its path');
  for (let y = 8; y <= 12; y++) if (y !== 12) game.terrain[y][21].walkable = false;
  game.select(tank.id);
  assert.deepEqual(game.issueForceMove(25.5, 10.5), { ok: true });
  for (let i = 0; i < 100; i++) {
    game.time += 0.1;
    game._updateUnit(tank, 0.1);
    assert.ok(game.terrain[Math.floor(tank.y)][Math.floor(tank.x)].walkable,
      'tank never enters a blocked tile');
  }
  assert.ok(tank.x > 22, 'tank routes around a blocked column');
});

test('force move handles ground and air, ignores harvest tiles, validates ownership, and persists', () => {
  const game = arena();
  const harvester = game._createUnit('player', 'harvester', 10.5, 20.5);
  const aircraft = game._createUnit('player', 'orca', 11.5, 21.5);
  aircraft.ammo = 0;
  const foreign = game._createUnit('enemy', 'rifle', 30.5, 30.5);
  game.terrain[20][16].resource = 500;
  game.select([harvester.id, aircraft.id]);
  assert.equal(game.issueForceMove(NaN, 20.5).ok, false);
  assert.equal(game.issueForceMove(-1, 20.5).ok, false);
  assert.deepEqual(game.issueForceMove(16.5, 20.5), { ok: true });
  assert.equal(harvester.order.type, 'forceMove', 'force move does not become harvest');
  assert.equal(aircraft.order.type, 'forceMove');
  const saved = Game.deserialize(game.serialize());
  const savedHarvester = saved.getEntity(harvester.id);
  const savedAircraft = saved.getEntity(aircraft.id);
  advance(saved, [savedHarvester, savedAircraft], 2);
  assert.ok(savedHarvester.x > 11.5 && savedAircraft.x > 12.5,
    'empty aircraft still obeys a force move instead of diverting to rearm');
  game.commandOwner = 'enemy';
  assert.equal(game.issueForceMove(20.5, 20.5).ok, false, 'stale selection cannot order other side');
  game.select(foreign.id);
  assert.deepEqual(game.issueForceMove(32.5, 30.5), { ok: true });
  assert.equal(foreign.order.type, 'forceMove');
});
