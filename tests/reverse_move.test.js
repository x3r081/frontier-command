import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER, GROUND_ARMOR_REAR_DAMAGE_MULTIPLIER }
  from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 6101 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function advance(game, unit, seconds) {
  for (let tick = 0; tick < Math.round(seconds * 10); tick++) {
    game.time += 0.1;
    game._updateUnit(unit, 0.1);
  }
}

test('reverse movement trades speed for front armor while backing away, then holds facing at the destination', () => {
  const normalGame = arena();
  const normalTank = normalGame._createUnit('player', 'lightTank', 10.5, 10.5);
  normalGame.select(normalTank.id);
  assert.equal(normalGame.issueMove(7.5, 10.5).ok, true);
  advance(normalGame, normalTank, 1);

  const reverseGame = arena();
  const reverseTank = reverseGame._createUnit('player', 'lightTank', 10.5, 10.5);
  reverseGame.select(reverseTank.id);
  assert.equal(reverseGame.issueReverseMove(7.5, 10.5).ok, true);
  assert.equal(reverseTank.order.reverse, true);
  advance(reverseGame, reverseTank, 1);

  const normalDistance = 10.5 - normalTank.x;
  const reverseDistance = 10.5 - reverseTank.x;
  assert.ok(reverseDistance > 0, 'reverse order moves toward its destination');
  assert.ok(Math.abs(reverseDistance / normalDistance - 0.65) < 0.08,
    `reverse speed is about 65% of normal (${reverseDistance / normalDistance})`);
  assert.ok(Math.abs(normalTank.facing - Math.PI) < 0.01, 'normal retreat faces its travel direction');
  assert.ok(Math.abs(reverseTank.facing) < 0.01, 'reverse retreat keeps the hull pointed toward the pursuer');

  for (const [game, tank] of [[normalGame, normalTank], [reverseGame, reverseTank]]) {
    const attacker = game._createUnit('enemy', 'buggy', 16.5, 10.5);
    const before = tank.hp;
    game._applyDamage(tank, 100, 'cannon', 'enemy', attacker.id,
      { x: attacker.x, y: attacker.y, sourceId: attacker.id, owner: 'enemy' });
    const damage = before - tank.hp;
    if (tank === reverseTank)
      assert.equal(damage, 100 * GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER);
    else
      assert.equal(damage, 100 * GROUND_ARMOR_REAR_DAMAGE_MULTIPLIER);
  }

  advance(reverseGame, reverseTank, 10);
  assert.equal(reverseTank.order.type, 'idle');
  assert.ok(Math.abs(reverseTank.x - 7.5) < 0.4);
  assert.ok(Math.abs(reverseTank.facing) < 0.01, 'arrival preserves the reverse hull facing');
});

test('reverse movement changes only eligible selected armored ground units and respects replay version', () => {
  const game = arena();
  const tank = game._createUnit('player', 'lightTank', 10.5, 10.5);
  const rifle = game._createUnit('player', 'rifle', 10.5, 11.5, { type: 'guard', x: 10.5, y: 11.5 });
  const aircraft = game._createUnit('player', 'orca', 10.5, 12.5, { type: 'guard', x: 10.5, y: 12.5 });
  const unarmed = game._createUnit('player', 'apc', 10.5, 13.5, { type: 'guard', x: 10.5, y: 13.5 });
  const deadTank = game._createUnit('player', 'buggy', 10.5, 14.5, { type: 'guard', x: 10.5, y: 14.5 });
  deadTank.hp = 0;
  const embarkedTank = game._createUnit('player', 'guardian', 10.5, 15.5, { type: 'guard', x: 10.5, y: 15.5 });
  embarkedTank.embarkedIn = 'u99999';
  const unchanged = [rifle, aircraft, unarmed, deadTank, embarkedTank].map(unit => structuredClone(unit.order));

  game.replayVersion = 60;
  game.select([tank.id, rifle.id, aircraft.id, unarmed.id, deadTank.id, embarkedTank.id]);
  assert.equal(game.issueReverseMove(15.5, 10.5).ok, false);
  assert.equal(tank.order.type, 'idle', 'version-gated failure leaves orders untouched');

  game.replayVersion = 61;
  assert.equal(game.issueReverseMove(15.5, 10.5).ok, true);
  assert.equal(tank.order.type, 'move');
  assert.equal(tank.order.reverse, true);
  assert.equal(tank.order.attackMove, false);
  for (const [index, unit] of [rifle, aircraft, unarmed, deadTank, embarkedTank].entries())
    assert.deepEqual(unit.order, unchanged[index], `${unit.defId} keeps its existing order`);
});

test('reverse move can queue after a move and survives save/load through arrival', () => {
  const game = arena();
  const buggy = game._createUnit('player', 'buggy', 10.5, 10.5);
  game.select(buggy.id);
  assert.equal(game.issueMove(12.5, 10.5).ok, true);
  assert.equal(game.issueReverseMove(16.5, 10.5, true).ok, true);
  assert.deepEqual(buggy.order.queue, [{ type: 'move', x: 16.5, y: 10.5, reverse: true, attackMove: false }]);

  const loaded = Game.deserialize(game.serialize());
  const follower = loaded.getEntity(buggy.id);
  assert.deepEqual(follower.order.queue, buggy.order.queue);
  advance(loaded, follower, 8);
  assert.equal(follower.order.type, 'idle');
  assert.ok(Math.abs(follower.x - 16.5) < 0.4);
  assert.ok(Math.abs(Math.abs(follower.facing) - Math.PI) < 0.01,
    'queued reverse order completes facing opposite its eastward travel');
});

test('ordinary move queue shape stays unchanged and reverse routes fire without chasing off-route targets', () => {
  const saved = arena();
  const ordinary = saved._createUnit('player', 'buggy', 10.5, 10.5);
  saved.select(ordinary.id);
  assert.equal(saved.issueMove(12.5, 10.5).ok, true);
  assert.equal(saved.issueMove(14.5, 10.5, false, true).ok, true);
  const loaded = Game.deserialize(saved.serialize());
  assert.deepEqual(loaded.getEntity(ordinary.id).order.queue,
    [{ type: 'move', x: 14.5, y: 10.5, attackMove: false }]);

  const game = arena();
  const tank = game._createUnit('player', 'lightTank', 10.5, 10.5);
  const enemy = game._createUnit('enemy', 'buggy', 10.5, 13.5);
  enemy.order = { type: 'idle' };
  enemy.stance = 'holdFire';
  game.select(tank.id);
  assert.equal(game.issueReverseMove(16.5, 10.5).ok, true);
  game.update(0.5);
  assert.ok(tank.cooldown > 0, 'the tank fires at a visible target during the route');
  assert.ok(tank.x > 10.8, 'the tank continues toward its requested destination');
  assert.ok(Math.abs(tank.y - 10.5) < 0.1, 'the tank does not turn off-route to chase the target');
  assert.ok(Math.abs(Math.abs(tank.facing) - Math.PI) < 0.01,
    'firing does not overwrite reverse hull orientation');
});

test('reverse move validates bounds, selection, and replay version', () => {
  const game = arena();
  game.replayVersion = 61;
  assert.equal(game.issueReverseMove(4, 4).ok, false, 'empty selection is rejected');
  game.select(game._createUnit('player', 'lightTank', 10.5, 10.5).id);
  assert.equal(game.issueReverseMove(-1, 10).ok, false, 'out-of-map target is rejected');
  game.replayVersion = 60;
  assert.equal(game.issueReverseMove(15.5, 10.5).ok, false, 'older replay version is rejected');
});
