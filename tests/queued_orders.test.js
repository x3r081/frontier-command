import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MAX_QUEUED_ORDERS, QUEUED_ORDERS_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

function arena() {
  const game = new Game({ seed: 4312 });
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

test('Shift queued waypoints execute in order and survive save/load', () => {
  assert.equal(QUEUED_ORDERS_RULES_VERSION, 56);
  const game = arena();
  const scout = game._createUnit('player', 'buggy', 10.5, 10.5);
  game.select(scout.id);
  assert.equal(game.issueMove(16.5, 10.5).ok, true);
  assert.equal(game.issueMove(16.5, 16.5, true, true).ok, true);
  assert.equal(game.issueForceMove(20.5, 16.5, true).ok, true);
  assert.deepEqual(scout.order.queue.map(order => [order.type, order.attackMove || false]),
    [['move', true], ['forceMove', false]]);
  const loaded = Game.deserialize(game.serialize());
  const follower = loaded.getEntity(scout.id);
  assert.equal(follower.order.queue.length, 2);
  advance(loaded, follower, 16);
  assert.equal(follower.order.type, 'idle');
  assert.ok(Math.hypot(follower.x - 20.5, follower.y - 16.5) < 0.4);
});

test('queued attack waits for movement and the route continues after target loss', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 10.5, 10.5);
  const enemy = game._createUnit('enemy', 'rifle', 20.5, 10.5);
  game.select(rifle.id);
  assert.equal(game.issueForceMove(13.5, 10.5).ok, true);
  assert.equal(game.issueAttack(enemy.id, true).ok, true);
  assert.equal(game.issueMove(26.5, 10.5, false, true).ok, true);
  assert.equal(rifle.order.type, 'forceMove');
  assert.equal(rifle.order.queue.length, 2);
  advance(game, rifle, 3);
  assert.equal(rifle.order.type, 'attack');
  enemy.hp = 0;
  advance(game, rifle, 0.1);
  assert.equal(rifle.order.type, 'move');
  advance(game, rifle, 10);
  assert.equal(rifle.order.type, 'idle');
  assert.ok(rifle.x > 26);
});

test('queued route capacity is atomic, and a direct order cancels the route', () => {
  const game = arena();
  const a = game._createUnit('player', 'buggy', 10.5, 10.5);
  const b = game._createUnit('player', 'buggy', 11.5, 10.5);
  game.select([a.id, b.id]);
  assert.equal(game.issueMove(15.5, 10.5).ok, true);
  for (let i = 0; i < MAX_QUEUED_ORDERS; i++)
    assert.equal(game.issueMove(17.5 + i, 12.5, false, true).ok, true);
  assert.equal(game.issueMove(30.5, 12.5, false, true).ok, false);
  assert.equal(a.order.queue.length, MAX_QUEUED_ORDERS);
  assert.equal(b.order.queue.length, MAX_QUEUED_ORDERS);
  assert.equal(game.issueMove(18.5, 18.5).ok, true);
  assert.equal(a.order.queue, undefined);
  assert.equal(b.order.queue, undefined);
  game.replayVersion = 55;
  assert.match(game.issueMove(19.5, 18.5, false, true).reason, /unavailable/i);
});

test('queued orders record and replay at fixed ticks; v55 rejects the new command form', () => {
  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 321, scenarioId: 'shard-valley' };
  const game = new Game({ seed: envelope.seed, mode: 'skirmish', difficulty: envelope.difficulty,
    faction: envelope.faction, mapId: envelope.scenarioId });
  const unit = game.units.find(candidate => candidate.owner === 'player' && candidate.defId === 'rifle');
  assert.ok(unit);
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  game.select(unit.id);
  assert.equal(game.issueMove(unit.x + 2, unit.y).ok, true);
  assert.equal(game.issueMove(unit.x + 4, unit.y + 1, true, true).ok, true);
  for (let tick = 0; tick < 60; tick++) { game.update(SOLO_STEP_SECONDS); clock.completedTicks++; }
  recorder.dispose();
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, 56), true);
  assert.throws(() => createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 55),
    /queued orders require replay version 56/i);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 56);
  playback.step(clock.completedTicks);
  const replayed = playback.game.getEntity(unit.id);
  assert.ok(replayed);
  assert.deepEqual(replayed.order, unit.order);
  assert.ok(Math.hypot(replayed.x - unit.x, replayed.y - unit.y) < 0.000001);
});
