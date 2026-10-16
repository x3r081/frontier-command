import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MOBILE_RALLY_RULES_VERSION, UNIT_DEFS } from '../src/game/engine.js';

function makeFactoryGame(replayVersion = MOBILE_RALLY_RULES_VERSION) {
  const game = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 80217, replayVersion });
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  game.buildings = [factory];
  game.units = [];
  game.selection = [];
  factory.rally = { x: 18.5, y: 41.5 };
  game.power.player.ratio = 1;
  game.credits.player = 5000;
  return { game, factory };
}

function produce(game, building, defId) {
  building.queue.push({ defId, progress: 1 });
  game._updateBuildings(0);
  return game.units.at(-1);
}

function advancePair(game, units, frames = 300) {
  for (let frame = 0; frame < frames; frame++) {
    for (const unit of units) game._updateUnit(unit, 0.1);
    game._resolveUnitSeparation();
  }
}

test('mobile rally command validates a completed friendly producer and living friendly mobile unit', () => {
  assert.equal(MOBILE_RALLY_RULES_VERSION, 81);
  const { game, factory } = makeFactoryGame();
  const leader = game._createUnit('player', 'lightTank', 25.5, 25.5);
  assert.deepEqual(game.setRallyTarget(factory.id, leader.id), { ok: true, unitId: leader.id });
  assert.equal(factory.rallyTargetId, leader.id);
  assert.equal(game.setRallyTarget(factory.id, null).ok, true);
  assert.equal(factory.rallyTargetId, null);

  assert.equal(game.setRallyTarget(factory.id, 'missing').ok, false);
  const hostile = game._createUnit('enemy', 'lightTank', 30.5, 25.5);
  assert.equal(game.setRallyTarget(factory.id, hostile.id).ok, false);
  leader.embarkedIn = 'carrier';
  assert.equal(game.setRallyTarget(factory.id, leader.id).ok, false);
  leader.embarkedIn = null;
  factory.progress = 0.5;
  assert.equal(game.setRallyTarget(factory.id, leader.id).ok, false);
});

test('paid reinforcements assemble in separate typed slots, then rendezvous with a moving leader', () => {
  const { game, factory } = makeFactoryGame();
  const leader = game._createUnit('player', 'lightTank', 25.5, 25.5);
  assert.equal(game.setRallyTarget(factory.id, leader.id).ok, true);
  const credits = game.credits.player;
  assert.equal(game.queueUnit('buggy', factory.id).ok, true);
  assert.equal(game.queueUnit('buggy', factory.id).ok, true);
  assert.equal(game.credits.player, credits - UNIT_DEFS.buggy.cost * 2);
  factory.queue[0].progress = 1;
  game._updateBuildings(0);
  factory.queue[0].progress = 1;
  game._updateBuildings(0);
  const reinforcements = game.units.filter(unit => unit.defId === 'buggy');
  assert.equal(reinforcements.length, 2);
  assert.ok(reinforcements.every(unit => unit.order.type === 'move' && unit._productionRally?.stage === 'approach'));
  assert.ok(Math.hypot(reinforcements[0].order.x - reinforcements[1].order.x,
    reinforcements[0].order.y - reinforcements[1].order.y) > 0.9,
  'the existing production assembly reservation keeps same-layer units apart');
  assert.notDeepEqual({ x: reinforcements[0].order.x, y: reinforcements[0].order.y }, factory.rally);

  leader.order = { type: 'move', x: 32.5, y: 25.5 };
  advancePair(game, [leader, ...reinforcements]);
  assert.ok(reinforcements.every(unit => unit.order.type === 'follow' && unit.order.targetId === leader.id));
  assert.ok(reinforcements.every(unit => Math.hypot(unit.x - leader.x, unit.y - leader.y) < 2.5),
    'new units keep moving with the selected front unit');
});

test('leader death, embarkation, or ownership loss releases followers to a reachable saved rally point', () => {
  for (const loss of ['death', 'embark', 'capture']) {
    const { game, factory } = makeFactoryGame();
    const leader = game._createUnit('player', 'lightTank', 25.5, 25.5);
    assert.equal(game.setRallyTarget(factory.id, leader.id).ok, true);
    const follower = produce(game, factory, 'buggy');
    advancePair(game, [leader, follower]);
    assert.equal(follower.order.type, 'follow');
    if (loss === 'death') leader.hp = 0;
    if (loss === 'embark') {
      const carrier = game._createUnit('player', 'apc', 58.5, 44.5);
      leader.embarkedIn = carrier.id;
      leader.x = carrier.x; leader.y = carrier.y;
    }
    if (loss === 'capture') {
      leader.owner = 'enemy';
      leader.x = 58.5; leader.y = 44.5;
    }
    game._updateUnit(follower, 0.1);
    assert.equal(follower.order.type, 'move', `${loss}: fallback is an ordinary movement order`);
    assert.equal(follower._productionRally, undefined);
    assert.ok(Math.hypot(follower.order.x - factory.rally.x, follower.order.y - factory.rally.y) <= 5,
      `${loss}: fallback stays near the producer's saved rally point`);
    assert.ok(game._findPath(follower.x, follower.y, follower.order.x, follower.order.y).length > 0 ||
      Math.hypot(follower.x - follower.order.x, follower.y - follower.order.y) < 0.5,
    `${loss}: fallback is reachable`);
    assert.equal(factory.rallyTargetId, null);
  }
});

test('normal rally and captured production sites clear the anchor; special outputs keep their old routing', () => {
  const { game, factory } = makeFactoryGame();
  const leader = game._createUnit('player', 'lightTank', 25.5, 25.5);
  assert.equal(game.setRallyTarget(factory.id, leader.id).ok, true);
  assert.equal(game.setRally(factory.id, 20.5, 40.5).ok, true);
  assert.equal(factory.rallyTargetId, null);
  assert.equal(game.setRallyTarget(factory.id, leader.id).ok, true);
  const harvester = produce(game, factory, 'harvester');
  const mcv = produce(game, factory, 'mcv');
  const transport = produce(game, factory, 'apc');
  assert.equal(harvester.order.type, 'harvest');
  assert.equal(mcv.order.type, 'move');
  assert.equal(transport.order.type, 'move');
  assert.equal(harvester._productionRally, undefined);
  assert.equal(mcv._productionRally, undefined);
  assert.equal(transport._productionRally, undefined);

  const captureGame = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 80217,
    replayVersion: MOBILE_RALLY_RULES_VERSION });
  const enemyFactory = captureGame.buildings.find(building => building.owner === 'enemy' &&
    building.defId === 'factory');
  const enemyLeader = captureGame.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
  enemyFactory.rallyTargetId = enemyLeader.id;
  enemyFactory.hp = enemyFactory.maxHp * 0.7;
  const engineer = captureGame._createUnit('player', 'engineer', enemyFactory.x - 0.5,
    enemyFactory.y + enemyFactory.h / 2);
  captureGame._updateFog();
  captureGame.select(engineer.id);
  assert.equal(captureGame.issueEngineer(enemyFactory.id).ok, true);
  captureGame._updateUnit(engineer, 0);
  assert.equal(enemyFactory.owner, 'player');
  assert.equal(enemyFactory.rallyTargetId, null, 'capture path clears the old owner anchor');
});

test('v80 replays cannot set or honor mobile rallies and markerless v80 saves stay pinned', () => {
  const old = makeFactoryGame(80);
  const leader = old.game._createUnit('player', 'lightTank', 25.5, 25.5);
  assert.equal(old.game.setRallyTarget(old.factory.id, leader.id).ok, false);
  old.factory.rallyTargetId = leader.id;
  const output = produce(old.game, old.factory, 'buggy');
  assert.equal(output._productionRally, undefined);
  assert.deepEqual({ x: output.order.x, y: output.order.y }, old.factory.rally);

  const current = makeFactoryGame();
  const currentLeader = current.game._createUnit('player', 'lightTank', 25.5, 25.5);
  assert.equal(current.game.setRallyTarget(current.factory.id, currentLeader.id).ok, true);
  const inTransit = produce(current.game, current.factory, 'buggy');
  const roundTrip = Game.deserialize(current.game.serialize());
  assert.equal(roundTrip.getEntity(current.factory.id).rallyTargetId, currentLeader.id);
  assert.equal(roundTrip.getEntity(inTransit.id)._productionRally.targetId, currentLeader.id);

  const markerless = makeFactoryGame();
  const markerlessLeader = markerless.game._createUnit('player', 'lightTank', 25.5, 25.5);
  assert.equal(markerless.game.setRallyTarget(markerless.factory.id, markerlessLeader.id).ok, true);
  const saved = JSON.parse(markerless.game.serialize());
  saved.replayVersion = null;
  delete saved.mobileRallyRulesVersion;
  const restored = Game.deserialize(saved);
  assert.equal(restored.replayVersion, 80);
  assert.equal(restored._mobileRallyEnabled(), false);
  assert.equal(restored.getEntity(markerless.factory.id).rallyTargetId, null);
});
