import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, PRODUCTION_REPEAT_RULES_VERSION } from '../src/game/engine.js';
import { createSoloRecorder } from '../src/game/replay.js';

function arena({ replayVersion = null, credits = 2000 } = {}) {
  const game = new Game({ seed: 7801, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  const power = game._createBuilding('player', 'power', 5, 5, 1);
  const barracks = game._createBuilding('player', 'barracks', 12, 10, 1);
  game._refreshPower();
  game.credits.player = credits;
  return { game, power, barracks };
}

test('repeat intent can wait for credits and inserts one paid unit when affordable', () => {
  const { game, barracks } = arena({ credits: 50 });
  assert.deepEqual(game.setProductionRepeat(barracks.id, 'rifle'), { ok: true, unitDefId: 'rifle' });
  assert.equal(game.getProductionRepeatStatus(barracks.id).state, 'waiting');
  assert.match(game.getProductionRepeatStatus(barracks.id).reason, /credits/i);
  game._updateBuildings(0.1);
  assert.equal(barracks.queue.length, 0);
  assert.equal(game.credits.player, 50);

  game.credits.player = 100;
  game._updateBuildings(0.1);
  assert.equal(barracks.queue.length, 1);
  assert.equal(barracks.queue[0].defId, 'rifle');
  assert.equal(game.credits.player, 0);
  assert.equal(game.getProductionRepeatStatus(barracks.id).state, 'training');
});

test('manual queue entries finish before repeat starts, and disabling repeat preserves a paid job', () => {
  const { game, barracks } = arena();
  game.setProductionRepeat(barracks.id, 'rifle');
  assert.equal(game.queueUnit('scout', barracks.id).ok, true);
  const paidCredits = game.credits.player;
  assert.equal(game.getProductionRepeatStatus(barracks.id).state, 'manual');
  barracks.queue[0].progress = 1;
  game._updateBuildings(0.1);
  assert.equal(barracks.queue.length, 0, 'the last manual job completes before a repeat item is added');
  assert.equal(game.credits.player, paidCredits);
  game._updateBuildings(0.1);
  assert.equal(barracks.queue[0].defId, 'rifle');

  const repeatCredits = game.credits.player;
  assert.equal(game.setProductionRepeat(barracks.id, null).ok, true);
  assert.equal(game.getProductionRepeatStatus(barracks.id).state, 'off');
  assert.equal(barracks.queue.length, 1, 'clearing repeat leaves the paid job in place');
  assert.equal(game.credits.player, repeatCredits);
});

test('standby pauses repeat spending and the intent resumes when power is restored', () => {
  const { game, barracks } = arena();
  game.setProductionRepeat(barracks.id, 'rifle');
  barracks.powerStandby = true;
  game._refreshPower();
  const credits = game.credits.player;
  game._updateBuildings(0.1);
  assert.equal(barracks.queue.length, 0);
  assert.equal(game.credits.player, credits);
  assert.equal(game.getProductionRepeatStatus(barracks.id).state, 'standby');

  barracks.powerStandby = false;
  game._refreshPower();
  game._updateBuildings(0.1);
  assert.equal(barracks.queue[0].defId, 'rifle');
  assert.equal(game.credits.player, credits - 100);
});

test('a completed repeat job blocked at the exit stays paid without queuing another unit', () => {
  const { game, barracks } = arena();
  game.setProductionRepeat(barracks.id, 'rifle');
  game._updateBuildings(0.1);
  barracks.queue[0].progress = 1;
  for (const row of game.terrain) for (const tile of row) tile.walkable = false;
  const credits = game.credits.player;
  game._updateBuildings(0.1);
  game._updateBuildings(0.1);
  assert.equal(barracks.queue.length, 1);
  assert.equal(barracks.queue[0].progress, 1);
  assert.equal(game.credits.player, credits);
  assert.equal(game.getProductionRepeatStatus(barracks.id).state, 'waiting');
  assert.match(game.getProductionRepeatStatus(barracks.id).reason, /exit is blocked/i);
});

test('repeat selection accepts temporarily missing prerequisites but rejects wrong producer and faction', () => {
  const { game } = arena();
  const factory = game._createBuilding('player', 'factory', 20, 10, 1);
  game._refreshPower();
  assert.equal(game.setProductionRepeat(factory.id, 'artillery').ok, true);
  assert.equal(game.getProductionRepeatStatus(factory.id).state, 'waiting');
  assert.match(game.getProductionRepeatStatus(factory.id).reason, /radar/i);
  assert.equal(factory.repeatUnitDefId, 'artillery');
  assert.equal(game.setProductionRepeat(factory.id, 'rifle').ok, false);
  assert.equal(game.setProductionRepeat(factory.id, 'stealthTank').ok, false);
});

test('capturing a producer clears the prior owner repeat intent', () => {
  const { game, barracks } = arena();
  game.setProductionRepeat(barracks.id, 'rifle');
  barracks.hp = barracks.maxHp * 0.7;
  const engineer = game._createUnit('enemy', 'engineer', barracks.x - 0.2, barracks.y + 1.5);
  engineer.order = { type: 'engineer', targetId: barracks.id };
  game._updateEngineer(engineer, barracks, 0.1);
  assert.equal(barracks.owner, 'enemy');
  assert.equal(barracks.repeatUnitDefId, null);
});

test('v77 migration disables saved repeat intents, while v78 persists validated intent', () => {
  const { game, barracks } = arena();
  game.setProductionRepeat(barracks.id, 'rifle');
  assert.equal(PRODUCTION_REPEAT_RULES_VERSION, 78);
  const current = Game.deserialize(game.serialize());
  assert.equal(current.getEntity(barracks.id).repeatUnitDefId, 'rifle');

  const markerless77 = JSON.parse(game.serialize());
  markerless77.replayVersion = null;
  markerless77.harvesterHomeRulesVersion = 77;
  delete markerless77.productionRepeatRulesVersion;
  const old = Game.deserialize(markerless77);
  assert.equal(old.replayVersion, 77);
  assert.equal(old.getEntity(barracks.id).repeatUnitDefId, null);
  assert.equal(old.setProductionRepeat(barracks.id, 'rifle').ok, false);
  old.credits.player = 2000;
  old._refreshPower();
  old._updateBuildings(0.1);
  assert.equal(old.getEntity(barracks.id).queue.length, 0);
});

test('automatic queue insertion stays internal to the replay command stream', () => {
  const { game, barracks } = arena();
  const recorder = createSoloRecorder(game, { completedTicks: 0 });
  assert.equal(game.setProductionRepeat(barracks.id, 'rifle').ok, true);
  game._updateBuildings(0.1);
  assert.deepEqual(recorder.commands.map(command => command.method), ['setProductionRepeat']);
  recorder.dispose();
});
