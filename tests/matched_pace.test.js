import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MATCHED_PACE_RULES_VERSION, REVERSE_MOVE_RULES_VERSION } from '../src/game/engine.js';

function arena(replayVersion = null) {
  const game = new Game({ seed: 73104, replayVersion });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function mixedGround(game) {
  return [
    game._createUnit('player', 'scout', 10.5, 10.5),
    game._createUnit('player', 'rocket', 12.5, 10.5),
  ];
}

function arrivalTimes(game, units, timeout = 50) {
  const arrivedAt = new Map();
  for (let elapsed = 0; elapsed < timeout && arrivedAt.size < units.length; elapsed += 1 / 30) {
    game.update(1 / 30);
    for (const unit of units) if (!arrivedAt.has(unit.id) && unit.order.type === 'idle')
      arrivedAt.set(unit.id, game.time);
  }
  assert.equal(arrivedAt.size, units.length, 'every unit reaches its assigned destination');
  return units.map(unit => arrivedAt.get(unit.id));
}

test('Match Pace narrows mixed ground squad arrival spread at the cost of the fast unit', () => {
  const run = matchPace => {
    const game = arena();
    const units = mixedGround(game);
    game._createUnit('enemy', 'rifle', 55.5, 40.5);
    game.select(units.map(unit => unit.id));
    assert.deepEqual(game.issueMove(35.5, 20.5, false, false, matchPace), { ok: true });
    const pace = units[0].order.pace;
    const arrivals = arrivalTimes(game, units);
    return { arrivals, pace, units };
  };
  const free = run(false);
  const matched = run(true);
  const spread = arrivals => Math.max(...arrivals) - Math.min(...arrivals);
  assert.ok(spread(matched.arrivals) < spread(free.arrivals) * 0.35,
    `matched arrival spread ${spread(matched.arrivals)} should be below free spread ${spread(free.arrivals)}`);
  assert.equal(free.pace, undefined, 'default orders retain their legacy shape');
  assert.ok(matched.pace > 0);
  assert.ok(matched.arrivals[0] > free.arrivals[0], 'the faster scout pays the shared pace cost');
});

test('aircraft keep their own movement speed while sharing a mixed move command', () => {
  const game = arena();
  const scout = game._createUnit('player', 'scout', 10.5, 10.5);
  const ground = game._createUnit('player', 'rocket', 12.5, 10.5);
  const air = game._createUnit('player', 'orca', 14.5, 10.5);
  game.select([scout.id, ground.id, air.id]);
  assert.deepEqual(game.issueForceMove(35.5, 20.5, false, true), { ok: true });
  assert.equal(scout.order.pace, ground.order.pace);
  assert.equal(air.order.pace, undefined, 'aircraft orders do not report a ground pace');
  const before = [scout.x, scout.y, ground.x, ground.y, air.x, air.y];
  game.update(1 / 30);
  const scoutStep = Math.hypot(scout.x - before[0], scout.y - before[1]);
  const groundStep = Math.hypot(ground.x - before[2], ground.y - before[3]);
  const airStep = Math.hypot(air.x - before[4], air.y - before[5]);
  assert.ok(Math.abs(scoutStep - groundStep) < 1e-9, 'both eligible ground units use the same speed cap');
  assert.ok(airStep > groundStep * 1.8, `air step ${airStep} should exceed paced ground step ${groundStep}`);

  const soloGroundGame = arena();
  const soloGround = soloGroundGame._createUnit('player', 'rocket', 10.5, 10.5);
  const soloAir = soloGroundGame._createUnit('player', 'orca', 12.5, 10.5);
  soloGroundGame.select([soloGround.id, soloAir.id]);
  assert.deepEqual(soloGroundGame.issueMove(35.5, 20.5, false, false, true), { ok: true });
  assert.equal(soloGround.order.pace, undefined, 'one ground unit has no group pace cap');
  assert.equal(soloAir.order.pace, undefined, 'one ground unit does not pace aircraft');
});

test('queued Match Pace survives save/load and old replay versions reject and strip it', () => {
  const game = arena();
  const units = mixedGround(game);
  game.select(units.map(unit => unit.id));
  assert.deepEqual(game.issueMove(22.5, 16.5, false, false, true), { ok: true });
  assert.deepEqual(game.issueForceMove(35.5, 20.5, true, true), { ok: true });
  const loaded = Game.deserialize(game.serialize());
  for (const unit of units) {
    const restored = loaded.getEntity(unit.id);
    assert.equal(restored.order.pace, unit.order.pace);
    assert.equal(restored.order.queue[0].pace, unit.order.queue[0].pace);
  }

  const legacy = arena(MATCHED_PACE_RULES_VERSION - 1);
  const legacyUnits = mixedGround(legacy);
  legacy.select(legacyUnits.map(unit => unit.id));
  assert.equal(legacy.issueMove(35.5, 20.5, false, false, true).ok, false);
  assert.equal(legacy.issueMove(35.5, 20.5).ok, true);
  legacyUnits[0].order.pace = 0.5;
  legacyUnits[0].order.queue = [{ type: 'forceMove', x: 30.5, y: 18.5, pace: 0.5 }];
  const legacyLoaded = Game.deserialize(legacy.serialize());
  assert.equal(legacyLoaded.getEntity(legacyUnits[0].id).order.pace, undefined);
  assert.equal(legacyLoaded.getEntity(legacyUnits[0].id).order.queue[0].pace, undefined);
  assert.ok(REVERSE_MOVE_RULES_VERSION < MATCHED_PACE_RULES_VERSION);
});

test('reverse Match Pace includes reverse and current vehicle damage penalties', () => {
  const game = arena();
  const damaged = game._createUnit('player', 'lightTank', 10.5, 10.5);
  const healthy = game._createUnit('player', 'stealthTank', 12.5, 10.5);
  damaged.hp = damaged.maxHp * 0.3;
  game.select([damaged.id, healthy.id]);
  assert.deepEqual(game.issueReverseMove(30.5, 20.5, false, true), { ok: true });
  const expected = game.unitDefs.lightTank.speed * 0.72 * 0.65 *
    game._campaignUnitMultiplier('player', 'rapid', 1.12);
  assert.ok(Math.abs(damaged.order.pace - expected) < 1e-9);
  assert.equal(healthy.order.pace, damaged.order.pace);
  const before = [damaged.x, damaged.y];
  game.update(1 / 30);
  assert.equal(damaged.order.reverse, true);
  const dx = damaged.x - before[0], dy = damaged.y - before[1];
  const movementAngle = Math.atan2(dy, dx);
  const facingDifference = Math.abs(Math.atan2(Math.sin(damaged.facing - movementAngle - Math.PI),
    Math.cos(damaged.facing - movementAngle - Math.PI)));
  assert.ok(facingDifference < 0.01, 'reverse facing stays opposite its travel direction');
});

test('Ghost Run temporarily overrides the stored Match Pace cap', () => {
  const game = arena();
  const scout = game._createUnit('player', 'stealthTank', 10.5, 10.5);
  const slow = game._createUnit('player', 'artillery', 12.5, 10.5);
  game.select([scout.id, slow.id]);
  assert.deepEqual(game.issueMove(35.5, 20.5, false, false, true), { ok: true });
  assert.ok(scout.order.pace < game.unitDefs.stealthTank.speed);
  scout.ghostRunUntil = 6;
  const before = [scout.x, scout.y];
  game.update(1 / 30);
  const distance = Math.hypot(scout.x - before[0], scout.y - before[1]);
  const expected = game.unitDefs.stealthTank.speed *
    game._campaignUnitMultiplier('player', 'rapid', 1.12) * 1.65 / 30;
  assert.ok(distance > scout.order.pace / 30 * 1.4);
  assert.ok(distance <= expected + 0.001);
});
