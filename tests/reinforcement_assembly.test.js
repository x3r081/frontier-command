import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS, UNIT_DEFS, REINFORCEMENT_ASSEMBLY_RULES_VERSION } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloPlayback, createSoloRecorder } from '../src/game/replay.js';

const replayEnvelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 12345,
  scenarioId: SKIRMISH_MAPS[0].id };

const makeFactoryGame = replayVersion => {
  const game = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 80217,
    mapId: SKIRMISH_MAPS[0].id, replayVersion });
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  game.buildings = [factory];
  game.units = [];
  game.selection = [];
  factory.rally = { x: 18.5, y: 41.5 };
  game.power.player.ratio = 1;
  return { game, factory };
};

const queueAndProduce = (game, factory, defId, count = 1) => {
  factory.queue.push(...Array.from({ length: count }, () => ({ defId, progress: 1 })));
  for (let i = 0; i < count; i++) game._updateBuildings(0);
  return game.units.slice(-count);
};

test('queued ground reinforcements get reachable, separated assembly points', () => {
  assert.equal(REINFORCEMENT_ASSEMBLY_RULES_VERSION, 68);
  const { game, factory } = makeFactoryGame();
  const units = queueAndProduce(game, factory, 'lightTank', 2);
  assert.equal(units.length, 2);
  assert.deepEqual(units.map(unit => unit.order.type), ['move', 'move']);
  const goals = units.map(unit => ({ x: unit.order.x, y: unit.order.y }));
  assert.ok(Math.hypot(goals[0].x - goals[1].x, goals[0].y - goals[1].y) > 0.9);
  for (const unit of units) assert.ok(game._findPath(unit.x, unit.y, unit.order.x, unit.order.y).length > 0);

  for (let step = 0; step < 500; step++) {
    for (const unit of game.units) game._updateUnit(unit, 0.1);
    game._resolveUnitSeparation();
  }
  assert.ok(Math.hypot(units[0].x - units[1].x, units[0].y - units[1].y) > 0.9);
  assert.ok(units.every(unit => unit.order.type === 'idle'));
});

test('blocked rally tile selects a bounded reachable nearby tile', () => {
  const { game, factory } = makeFactoryGame();
  const originalPassable = game._isPassable.bind(game);
  game._isPassable = (x, y) => !(x === 18 && y === 41) && originalPassable(x, y);
  const [unit] = queueAndProduce(game, factory, 'lightTank');
  assert.notDeepEqual({ x: unit.order.x, y: unit.order.y }, factory.rally);
  assert.ok(Math.hypot(unit.order.x - factory.rally.x, unit.order.y - factory.rally.y) <= 5);
  assert.ok(originalPassable(Math.floor(unit.order.x), Math.floor(unit.order.y)));
  assert.ok(game._findPath(unit.x, unit.y, unit.order.x, unit.order.y).length > 0);
});

test('legacy replay keeps exact rally orders and a later rally change leaves earlier orders intact', () => {
  const legacy = makeFactoryGame(67);
  const oldUnits = queueAndProduce(legacy.game, legacy.factory, 'lightTank', 2);
  assert.deepEqual(oldUnits.map(unit => [unit.order.x, unit.order.y]), [[18.5, 41.5], [18.5, 41.5]]);

  const current = makeFactoryGame();
  const [first] = queueAndProduce(current.game, current.factory, 'lightTank');
  const firstOrder = structuredClone(first.order);
  current.factory.rally = { x: 24.5, y: 39.5 };
  queueAndProduce(current.game, current.factory, 'lightTank');
  assert.deepEqual(first.order, firstOrder);
});

test('air and ground slots use separate friendly occupancy layers', () => {
  const { game, factory } = makeFactoryGame();
  game._createUnit('player', 'lightTank', factory.rally.x, factory.rally.y);
  const aircraft = game._createUnit('player', 'dropship', 10.5, 10.5);
  assert.deepEqual(game._productionAssemblyPoint(factory, aircraft), factory.rally,
    'a ground unit at the rally does not reserve the air layer');

  game._createUnit('player', 'dropship', factory.rally.x, factory.rally.y);
  const secondAircraft = game._createUnit('player', 'dropship', 11.5, 10.5);
  const airSlot = game._productionAssemblyPoint(factory, secondAircraft);
  assert.ok(Math.hypot(airSlot.x - factory.rally.x, airSlot.y - factory.rally.y) >=
    UNIT_DEFS.dropship.radius * 2 + 0.18,
  'an existing air unit reserves a distinct air assembly slot');

  const ground = game._createUnit('player', 'lightTank', 10.5, 10.5);
  assert.notDeepEqual(game._productionAssemblyPoint(factory, ground), factory.rally,
    'a ground unit at the rally reserves the ground layer');
});

test('hidden enemy positions do not affect the selected assembly point', () => {
  const { game, factory } = makeFactoryGame();
  const unit = game._createUnit('player', 'lightTank', 10.5, 10.5);
  const before = game._productionAssemblyPoint(factory, unit);
  const enemy = game._createUnit('enemy', 'lightTank', factory.rally.x, factory.rally.y);
  enemy.revealedUntil = 0;
  const after = game._productionAssemblyPoint(factory, unit);
  assert.deepEqual(after, before);
});

test('recorded public production commands replay two reinforcements to matching spaced targets', () => {
  const game = new Game({ mode: replayEnvelope.mode, difficulty: replayEnvelope.difficulty,
    faction: replayEnvelope.faction, seed: replayEnvelope.seed, mapId: replayEnvelope.scenarioId });
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const rally = { ...factory.rally };
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);

  assert.equal(game.setRally(factory.id, rally.x, rally.y).ok, true);
  assert.equal(game.queueUnit('buggy', factory.id).ok, true);
  assert.equal(game.queueUnit('buggy', factory.id).ok, true);
  for (let tick = 0; tick < 45 * 30; tick++)
    clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  recorder.dispose();

  const reinforcements = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'buggy')
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  assert.ok(reinforcements.length >= 2, 'both queued vehicles arrive within the 45 second bound');
  assert.ok(reinforcements.slice(0, 2).every(unit => unit.order.type === 'idle'),
    'both reinforcements reach their assembly points');
  assert.ok(Math.hypot(reinforcements[0].x - reinforcements[1].x,
    reinforcements[0].y - reinforcements[1].y) > 0.9, 'the reinforcements finish apart');
  assert.deepEqual(recorder.commands.map(command => command.method),
    ['setRally', 'queueUnit', 'queueUnit']);

  const playback = createSoloPlayback(replayEnvelope, recorder.commands, clock.completedTicks,
    REINFORCEMENT_ASSEMBLY_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(JSON.parse(playback.game.serialize()).units, JSON.parse(game.serialize()).units,
    'recorded playback reproduces reinforcement targets and final unit state');
  assert.deepEqual(playback.game.credits, game.credits);
  assert.equal(playback.game.time, game.time);
});

test('save marker preserves current null-version assembly rules and pins unmarked legacy saves', () => {
  const current = new Game({ seed: 12345, mode: 'skirmish' });
  current.replayVersion = null;
  const currentData = JSON.parse(current.serialize());
  assert.equal(currentData.reinforcementAssemblyRulesVersion, REINFORCEMENT_ASSEMBLY_RULES_VERSION);
  const currentRoundTrip = Game.deserialize(current.serialize());
  assert.equal(currentRoundTrip.replayVersion, null,
    'a current null-version save keeps current production behavior after loading');
  assert.equal(currentRoundTrip.reinforcementAssemblyRulesVersion, REINFORCEMENT_ASSEMBLY_RULES_VERSION);

  const pre68 = { ...currentData };
  delete pre68.reinforcementAssemblyRulesVersion;
  const legacy = Game.deserialize(pre68);
  assert.equal(legacy.replayVersion, 67,
    'a pre-68 null-version save with no assembly marker is pinned to legacy production behavior');
  assert.equal(legacy.reinforcementAssemblyRulesVersion, REINFORCEMENT_ASSEMBLY_RULES_VERSION,
    'the loaded legacy game receives the current marker without changing its pinned rules');

  const explicitlyOld = new Game({ seed: 12345, mode: 'skirmish', replayVersion: 65 });
  const explicitlyOldData = JSON.parse(explicitlyOld.serialize());
  delete explicitlyOldData.reinforcementAssemblyRulesVersion;
  const oldRoundTrip = Game.deserialize(explicitlyOldData);
  assert.equal(oldRoundTrip.replayVersion, 65,
    'a save with an explicitly older replay version is never raised by the missing marker');
});
