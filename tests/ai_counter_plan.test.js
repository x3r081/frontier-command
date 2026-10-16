import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

const observeArmor = (game, tank, samples = 6) => {
  const visible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === tank && viewer === 'enemy' ? true : visible(entity, viewer);
  for (let i = 0; i < samples; i++) {
    game.time = i;
    game._aiObserve();
  }
};

test('v59 counter-plan requires repeated observed armor and uses its last observed sector', () => {
  const game = new Game({ seed: 59, mode: 'skirmish', replayVersion: 59 });
  const tank = game._createUnit('player', 'lightTank', 36, 22);
  const visible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === tank && viewer === 'enemy' ? true : visible(entity, viewer);
  for (let i = 0; i < 5; i++) { game.time = i; game._aiObserve(); }
  assert.equal(game.aiCounterPlan, null, 'one sighting pattern does not trigger immediately');
  game.time = 5;
  game._aiObserve();
  assert.deepEqual(game.aiCounterPlan, {
    id: 'anti-armor-screen', observedArmor: 1, startedAt: 5, lastObservedAt: 5,
    target: { x: tank.x, y: tank.y },
  });
  game.time = 6;
  game._aiObserve();
  assert.equal(game.events.filter(event => event.type === 'aiCounterPlanStarted').length, 1);
  assert.deepEqual(Game.deserialize(game.serialize()).aiCounterPlan, game.aiCounterPlan,
    'the public telegraph survives save and replay serialization');
});

test('unseen armor cannot trigger the v59 plan', () => {
  const game = new Game({ seed: 60, mode: 'skirmish', replayVersion: 59 });
  const tank = game._createUnit('player', 'lightTank', 36, 22);
  const visible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === tank && viewer === 'enemy' ? false : visible(entity, viewer);
  for (let i = 0; i < 10; i++) { game.time = i; game._aiObserve(); }
  assert.equal(game.aiCounterPlan, null);
  assert.ok(!game._aiIntel.some(item => item.id === tank.id));
});

test('visible unarmed economy units do not count as armored combat strategy', () => {
  const game = new Game({ seed: 63, mode: 'skirmish', replayVersion: 59 });
  const harvester = game._createUnit('player', 'harvester', 36, 22);
  const visible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === harvester && viewer === 'enemy' ? true : visible(entity, viewer);
  for (let i = 0; i < 10; i++) { game.time = i; game._aiObserve(); }
  assert.equal(game.aiCounterPlan, null);
});

test('counter-plan assigns at most two counters to a passable observed sector', () => {
  const game = new Game({ seed: 61, mode: 'skirmish', replayVersion: 59 });
  const tank = game._createUnit('player', 'lightTank', 36, 22);
  observeArmor(game, tank);
  const counters = Array.from({ length: 3 }, (_, index) =>
    game._createUnit('enemy', 'rocket', 20 + index, 22));
  game._aiExecuteCounterPlan(counters);
  const assigned = counters.filter(unit => unit.order?.aiCounterPlan === 'anti-armor-screen');
  assert.equal(assigned.length, 2);
  assert.ok(assigned.every(unit => unit.order.type === 'move' &&
    game._isPassable(Math.floor(unit.order.x), Math.floor(unit.order.y))));
  assert.equal(counters[2].order?.aiCounterPlan, undefined);
});

test('moving observed armor does not reset a counter path for every small target shift', () => {
  const game = new Game({ seed: 65, mode: 'skirmish', replayVersion: 59 });
  const tank = game._createUnit('player', 'lightTank', 36, 22);
  observeArmor(game, tank);
  const rocket = game._createUnit('enemy', 'rocket', 20, 22);
  game._aiExecuteCounterPlan([rocket]);
  const firstOrder = rocket.order;
  rocket.path = [[21, 22]];
  tank.x += 1;
  game.time = 6;
  game._aiObserve();
  game._aiExecuteCounterPlan([rocket]);
  assert.equal(rocket.order, firstOrder);
  assert.deepEqual(rocket.path, [[21, 22]]);
});

test('v58 preserves the prior observation and execution behavior', () => {
  const game = new Game({ seed: 62, mode: 'skirmish', replayVersion: 58 });
  const tank = game._createUnit('player', 'lightTank', 36, 22);
  observeArmor(game, tank, 8);
  assert.equal(game.aiCounterPlan, undefined);
  const rocket = game._createUnit('enemy', 'rocket', 20, 22);
  const order = { type: 'idle' };
  rocket.order = order;
  game._aiExecuteCounterPlan([rocket]);
  assert.equal(rocket.order, order);

  const legacy = JSON.parse(new Game({ seed: 64, mode: 'skirmish' }).serialize());
  legacy.replayVersion = null;
  delete legacy.aiCounterPlanRulesVersion;
  delete legacy.aiCounterPlan;
  const restored = Game.deserialize(legacy);
  assert.equal(restored.replayVersion, 58, 'unversioned pre-v59 saves retain the old skirmish rules');
  assert.equal(restored.aiCounterPlanRulesVersion, 59, 'deserialization normalizes the marker');
  assert.equal(restored.aiCounterPlan, undefined);
});
