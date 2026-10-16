import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_ASSAULT_COORDINATION_RULES_VERSION, Game } from '../src/game/engine.js';

const GROUND_ROSTER = ['lightTank', 'buggy', 'artillery', 'guardian'];

function assaultGame({ replayVersion = AI_ASSAULT_COORDINATION_RULES_VERSION, difficulty = 'normal',
  mode = 'skirmish', scanRadius = 12, spread = null, includeAir = false } = {}) {
  const game = new Game({ seed: 481516, replayVersion, difficulty, mode });
  game.units = [];
  game.buildings = game.buildings.filter(building => building.owner === 'enemy');
  const command = game._createBuilding('player', 'command', 12, 25, 1);
  game._createBuilding('player', 'power', 8, 22, 1);
  const turret = game._createBuilding('player', 'turret', 20, 26, 1);
  game._refreshPower();
  game.scans.push({ owner: 'enemy', x: 13.5, y: 26.5, radius: scanRadius, until: 100 });
  const roster = includeAir ? [...GROUND_ROSTER, 'orca'] : GROUND_ROSTER;
  const attackers = roster.map((defId, index) => {
    const point = spread?.[index] || { x: 44.5, y: 24.5 + index };
    return game._createUnit('enemy', defId, point.x, point.y);
  });
  assert.equal(game.isVisible(command, 'enemy'), true, 'enemy scan exposes the visible building objective');
  return { game, command, turret, attackers };
}

function clearMarch(order) {
  delete order.aiMarchPace;
  delete order.aiMarchUntil;
  delete order.aiMarchHealth;
}

test('a qualifying visible defended-front wave marches at the slowest ground pace', () => {
  const { game, command, turret, attackers } = assaultGame({ includeAir: true });
  assert.equal(game.isVisible(turret, 'enemy'), true);
  assert.equal(game._launchAiWave(), true);
  const ground = attackers.filter(unit => unit.defId !== 'orca');
  const air = attackers.find(unit => unit.defId === 'orca');
  assert.ok(ground.every(unit => unit.order.type === 'attack' && unit.order.targetId === command.id));
  assert.ok(ground.every(unit => unit.order.aiMarchPace === 0.92));
  assert.ok(ground.every(unit => unit.order.aiMarchUntil === 25 && unit.order.aiMarchHealth === unit.hp));
  assert.equal(air.order.aiMarchPace, undefined, 'aircraft keep their normal speed');

  const baseline = Game.deserialize(game.serialize());
  const baselineBuggy = baseline.getEntity(ground.find(unit => unit.defId === 'buggy').id);
  clearMarch(baselineBuggy.order);
  const buggy = ground.find(unit => unit.defId === 'buggy');
  const pacedStart = { x: buggy.x, y: buggy.y };
  const baselineStart = { x: baselineBuggy.x, y: baselineBuggy.y };
  game._moveUnit(buggy, 13.5, 26.5, 1);
  baseline._moveUnit(baselineBuggy, 13.5, 26.5, 1);
  const pacedDistance = Math.hypot(buggy.x - pacedStart.x, buggy.y - pacedStart.y);
  const baselineDistance = Math.hypot(baselineBuggy.x - baselineStart.x, baselineBuggy.y - baselineStart.y);
  assert.ok(pacedDistance <= 0.92 + 0.03, 'the fast ground unit observes the packet march cap');
  assert.ok(baselineDistance > pacedDistance + 0.5, 'ordinary movement remains faster without the packet cap');
});

test('assault coordination requires visible defense and a compact ground packet', () => {
  const hiddenDefense = assaultGame({ scanRadius: 4 });
  assert.equal(hiddenDefense.game.isVisible(hiddenDefense.turret, 'enemy'), false);
  hiddenDefense.game._launchAiWave();
  assert.ok(hiddenDefense.attackers.every(unit => unit.order.aiMarchPace === undefined),
    'a fogged defense does not qualify the attack');

  const dispersed = assaultGame({ spread: [
    { x: 44.5, y: 12.5 }, { x: 44.5, y: 19.5 }, { x: 44.5, y: 27.5 }, { x: 44.5, y: 35.5 },
  ] });
  dispersed.game._launchAiWave();
  assert.ok(dispersed.attackers.every(unit => unit.order.aiMarchPace === undefined),
    'a dispersed force does not acquire a shared approach cap');
});

test('hidden contacts do not release a march cap; visible ground contact does', () => {
  const { game, attackers } = assaultGame();
  game._launchAiWave();
  const contact = game._createUnit('player', 'lightTank', attackers[0].x + 3, attackers[0].y);
  const isVisible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === contact && viewer === 'enemy' ? false : isVisible(entity, viewer);
  game._aiCoordinateAssaults();
  assert.ok(attackers.every(unit => Number.isFinite(unit.order.aiMarchPace)),
    'a hidden tank is not used as contact intel');

  game.isVisible = (entity, viewer) => entity === contact && viewer === 'enemy' ? true : isVisible(entity, viewer);
  game._aiCoordinateAssaults();
  assert.ok(attackers.every(unit => unit.order.aiMarchPace === undefined),
    'the complete packet releases at observed ground contact');
});

test('damage and the 25-second deadline release the complete packet', () => {
  const damaged = assaultGame();
  damaged.game._launchAiWave();
  damaged.attackers[1].hp -= 1;
  damaged.game._aiCoordinateAssaults();
  assert.ok(damaged.attackers.every(unit => unit.order.aiMarchPace === undefined),
    'one damaged member releases every surviving marcher');

  const timedOut = assaultGame();
  timedOut.game._launchAiWave();
  timedOut.game.time = 25;
  timedOut.game._aiCoordinateAssaults();
  assert.ok(timedOut.attackers.every(unit => unit.order.aiMarchPace === undefined),
    'the packet cap ends at its fixed deadline');
});

test('an urgent replacement order stays untouched and fewer than two marchers releases the rest', () => {
  const { game, attackers } = assaultGame();
  game._launchAiWave();
  const urgentOrder = { type: 'attack', targetId: 'urgent-threat', aiDefense: true };
  attackers[0].order = structuredClone(urgentOrder);
  attackers[1].order = { type: 'idle' };
  attackers[2].order = { type: 'idle' };

  game._aiCoordinateAssaults();

  assert.deepEqual(attackers[0].order, urgentOrder, 'coordination leaves the urgent order unchanged');
  assert.equal(attackers[3].order.aiMarchPace, undefined,
    'the sole remaining marcher returns to normal movement');
});

test('easy, campaign, legacy, and markerless saves retain their recorded rules', () => {
  for (const config of [
    { replayVersion: 64, difficulty: 'normal', mode: 'skirmish' },
    { replayVersion: 65, difficulty: 'easy', mode: 'skirmish' },
    { replayVersion: 65, difficulty: 'normal', mode: 'campaign' },
  ]) {
    const legacy = assaultGame(config);
    legacy.game._launchAiWave();
    assert.ok(legacy.attackers.every(unit => unit.order.aiMarchPace === undefined),
      `${config.mode}/${config.difficulty}/v${config.replayVersion} keeps unpaced movement`);
  }

  const current = assaultGame({ replayVersion: null });
  current.game._launchAiWave();
  const loadedCurrent = Game.deserialize(current.game.serialize());
  assert.equal(loadedCurrent.replayVersion, null, 'the current live-rules sentinel survives save/load');
  assert.equal(loadedCurrent.aiAssaultCoordinationRulesVersion, AI_ASSAULT_COORDINATION_RULES_VERSION);
  for (const unit of current.attackers)
    assert.deepEqual(loadedCurrent.getEntity(unit.id).order, unit.order, 'per-order march fields survive save/load');

  const markerless = JSON.parse(current.game.serialize());
  markerless.replayVersion = null;
  delete markerless.aiAssaultCoordinationRulesVersion;
  assert.equal(Game.deserialize(markerless).replayVersion, AI_ASSAULT_COORDINATION_RULES_VERSION - 1,
    'an unversioned markerless save remains at rules64');
});
