import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_ESCORT_RULES_VERSION, Game } from '../src/game/engine.js';

function arena(replayVersion = COMBAT_ESCORT_RULES_VERSION) {
  const game = new Game({ seed: 8901, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function shotsBy(game, source) {
  return game.effects.filter(effect => effect.type === 'projectile' && effect.sourceId === source.id);
}

test('armed ground Follow escorts acquire and shoot a threat near their leader; rules 88 retain old follow behavior', () => {
  const game = arena();
  const leader = game._createUnit('player', 'harvester', 20.5, 20.5);
  const follower = game._createUnit('player', 'rifle', 20.5, 22.5);
  const threat = game._createUnit('enemy', 'rifle', 24.5, 20.5);
  follower.order = { type: 'follow', targetId: leader.id };

  for (let i = 0; i < 80 && !shotsBy(game, follower).length; i++) game._updateUnit(follower, 0.1);
  assert.ok(shotsBy(game, follower).some(shot => shot.targetId === threat.id),
    'follower should close from the leader perimeter and fire through normal combat');
  assert.equal(follower.order.type, 'follow', 'combat must not replace the follow order');

  const old = arena(COMBAT_ESCORT_RULES_VERSION - 1);
  const oldLeader = old._createUnit('player', 'harvester', 20.5, 20.5);
  const oldFollower = old._createUnit('player', 'rifle', 20.5, 22.5);
  old._createUnit('enemy', 'rifle', 24.5, 20.5);
  oldFollower.order = { type: 'follow', targetId: oldLeader.id };
  old._updateUnit(oldFollower, 0.1);
  assert.equal(shotsBy(old, oldFollower).length, 0, 'archived rules should not add sight-range escort acquisition');
  assert.ok(Math.hypot(oldFollower.x - 20.5, oldFollower.y - 22.5) > 0,
    'archived follow movement remains active');
});

test('escort pursuit stays inside the four-tile leash and rejoins when the threat leaves leader range', () => {
  const game = arena();
  const leader = game._createUnit('player', 'harvester', 20.5, 20.5);
  const follower = game._createUnit('player', 'rifle', 25.5, 20.5);
  game._createUnit('enemy', 'rifle', 21.5, 20.5);
  follower.order = { type: 'follow', targetId: leader.id };
  const before = Math.hypot(follower.x - leader.x, follower.y - leader.y);
  game._updateUnit(follower, 0.1);
  assert.ok(Math.hypot(follower.x - leader.x, follower.y - leader.y) < before,
    'a follower already outside the leash should rejoin instead of chasing');
  assert.equal(shotsBy(game, follower).length, 0);

  const outsideButShootable = arena();
  const shootableLeader = outsideButShootable._createUnit('player', 'harvester', 20.5, 20.5);
  const shootableEscort = outsideButShootable._createUnit('player', 'rifle', 25.2, 20.5);
  const nearbyThreat = outsideButShootable._createUnit('enemy', 'rifle', 24.8, 20.5);
  shootableEscort.order = { type: 'follow', targetId: shootableLeader.id };
  const outsideBefore = Math.hypot(shootableEscort.x - shootableLeader.x,
    shootableEscort.y - shootableLeader.y);
  outsideButShootable._updateUnit(shootableEscort, 0.1);
  assert.equal(shotsBy(outsideButShootable, shootableEscort).length, 0,
    'an in-range target cannot make an escort fire beyond the leash');
  assert.ok(Math.hypot(shootableEscort.x - shootableLeader.x,
    shootableEscort.y - shootableLeader.y) < outsideBefore,
  'an out-of-leash escort rejoins before resuming combat');
  assert.equal(nearbyThreat.hp, nearbyThreat.maxHp);

  const nearby = arena();
  const movingLeader = nearby._createUnit('player', 'harvester', 20.5, 20.5);
  const escort = nearby._createUnit('player', 'rifle', 21.5, 20.5);
  const enemy = nearby._createUnit('enemy', 'rifle', 23.5, 20.5);
  escort.order = { type: 'follow', targetId: movingLeader.id };
  movingLeader.x = 30.5;
  escort.cooldown = 0;
  nearby._updateUnit(escort, 0.1);
  assert.equal(shotsBy(nearby, escort).some(shot => shot.targetId === enemy.id), false,
    'a threat no longer near the leader is not pursued');

  const stalePath = arena();
  const staleLeader = stalePath._createUnit('player', 'harvester', 20.5, 20.5);
  const staleEscort = stalePath._createUnit('player', 'rocket', 16.51, 20.5);
  const staleThreat = stalePath._createUnit('enemy', 'rifle', 22.51, 20.5);
  staleEscort.order = { type: 'follow', targetId: staleLeader.id };
  const approach = stalePath._combatEscortApproachPoint(staleEscort, staleThreat, staleLeader,
    5);
  assert.ok(approach, 'test setup has a visible firing point inside the leash');
  staleEscort.path = [{ x: 12.5, y: 20.5 }];
  staleEscort._pathGoal = { x: approach.x, y: approach.y };
  staleEscort._repath = 1;
  stalePath._updateUnit(staleEscort, 0.1);
  assert.ok(staleEscort.x > 16.51,
    'an old path is replaced by the validated approach prefix');
  assert.ok(Math.hypot(staleEscort.x - staleLeader.x, staleEscort.y - staleLeader.y) <= 4,
    'reused movement stays within the leash');
});

test('escort acquisition requires current visibility and Hold Fire prevents combat', () => {
  const game = arena();
  const leader = game._createUnit('player', 'harvester', 20.5, 20.5);
  const follower = game._createUnit('player', 'rifle', 21.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 23.5, 20.5);
  follower.order = { type: 'follow', targetId: leader.id };
  game.fog[20][23] = 1;
  game._updateUnit(follower, 0.1);
  assert.equal(shotsBy(game, follower).length, 0, 'escort cannot acquire a hidden last-known position');

  game.fog[20][23] = 2;
  follower.stance = 'holdFire';
  follower.cooldown = 0;
  game._updateUnit(follower, 0.1);
  assert.equal(shotsBy(game, follower).length, 0, 'Hold Fire remains authoritative');
  assert.equal(enemy.hp, enemy.maxHp);
});

test('escort obeys target priority and does not fire through blocked line of sight', () => {
  const game = arena();
  const leader = game._createUnit('player', 'harvester', 20.5, 20.5);
  const follower = game._createUnit('player', 'buggy', 20.5, 21.5);
  const infantry = game._createUnit('enemy', 'rifle', 22.5, 20.5);
  const vehicle = game._createUnit('enemy', 'lightTank', 23.5, 21.5);
  follower.order = { type: 'follow', targetId: leader.id };
  game.select(follower.id);
  assert.equal(game.issueSetTargetPriority('vehicles').ok, true);
  follower.cooldown = 0;
  game._updateUnit(follower, 0.1);
  assert.equal(shotsBy(game, follower).at(-1)?.targetId, vehicle.id,
    'a shootable preferred category should win over a closer nonpreferred target');
  assert.equal(infantry.hp, infantry.maxHp);

  const blocked = arena();
  const blockedLeader = blocked._createUnit('player', 'harvester', 20.5, 20.5);
  const rocket = blocked._createUnit('player', 'rocket', 20.5, 21.5);
  const hiddenByRock = blocked._createUnit('enemy', 'lightTank', 23.5, 21.5);
  rocket.order = { type: 'follow', targetId: blockedLeader.id };
  blocked.terrain[21][22].type = 'rock';
  assert.equal(blocked._hasLineOfSight(rocket.x, rocket.y, hiddenByRock.x, hiddenByRock.y), false);
  blocked._updateUnit(rocket, 0.1);
  assert.equal(shotsBy(blocked, rocket).length, 0, 'range does not bypass the ordinary LOS rule');
});

test('combat escort marker round-trips and markerless v88 saves stay on archived rules', () => {
  const game = arena();
  const leader = game._createUnit('player', 'harvester', 20.5, 20.5);
  const follower = game._createUnit('player', 'rifle', 20.5, 22.5);
  follower.order = { type: 'follow', targetId: leader.id };
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.combatEscortRulesVersion, COMBAT_ESCORT_RULES_VERSION);
  assert.equal(loaded.getEntity(follower.id).order.type, 'follow');

  const markerless = JSON.parse(game.serialize());
  delete markerless.replayVersion;
  delete markerless.combatEscortRulesVersion;
  const oldLoaded = Game.deserialize(markerless);
  assert.equal(oldLoaded.replayVersion, COMBAT_ESCORT_RULES_VERSION - 1);
  const oldLeader = oldLoaded.getEntity(leader.id);
  const oldFollower = oldLoaded.getEntity(follower.id);
  oldLoaded._createUnit('enemy', 'rifle', 24.5, 20.5);
  oldLoaded._updateUnit(oldFollower, 0.1);
  assert.equal(shotsBy(oldLoaded, oldFollower).length, 0);
});
