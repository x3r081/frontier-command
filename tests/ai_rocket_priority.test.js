import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_ROCKET_PRIORITY_RULES_VERSION, Game } from '../src/game/engine.js';

function arena(replayVersion = AI_ROCKET_PRIORITY_RULES_VERSION) {
  const game = new Game({ seed: 8601, mode: 'skirmish', replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function setVisibleToEnemy(game, visibleEntities) {
  const visible = game.isVisible.bind(game);
  const seen = new Set(visibleEntities);
  game.isVisible = (entity, viewer) => viewer === 'enemy' && entity.owner === 'player'
    ? seen.has(entity) : visible(entity, viewer);
}

function firedAt(game, rocket, target) {
  rocket.cooldown = 0;
  game._updateUnit(rocket, 0.1);
  const shot = game.effects.filter(effect => effect.type === 'projectile' && effect.sourceId === rocket.id).at(-1);
  assert.ok(shot, 'rocket should fire a real combat projectile');
  assert.equal(shot.targetId, target.id);
  return shot;
}

test('visible nearby aircraft steer enemy Rockets to fire at aircraft over nearer armor', () => {
  const game = arena();
  const rocket = game._createUnit('enemy', 'rocket', 20.5, 20.5);
  const armor = game._createUnit('player', 'lightTank', 22.2, 20.5);
  const aircraft = game._createUnit('player', 'orca', 23, 20.5);
  setVisibleToEnemy(game, [armor, aircraft]);

  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'aircraft');
  firedAt(game, rocket, aircraft);
  assert.equal(armor.hp, armor.maxHp, 'the ordinary eligible armor target remains unharmed');
});

test('air sightings elsewhere do not mask a local armor preference; acquisition remains local', () => {
  const game = arena();
  const rocket = game._createUnit('enemy', 'rocket', 20.5, 20.5);
  const armor = game._createUnit('player', 'lightTank', 22.5, 20.5);
  const remoteAircraft = game._createUnit('player', 'orca', 34, 20.5);
  setVisibleToEnemy(game, [armor, remoteAircraft]);

  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'vehicles');
  firedAt(game, rocket, armor);
});

test('unseen or expired mobile sightings do not sustain a counter preference', () => {
  const game = arena();
  const rocket = game._createUnit('enemy', 'rocket', 20.5, 20.5);
  const aircraft = game._createUnit('player', 'orca', 22.5, 20.5);
  setVisibleToEnemy(game, []);
  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'auto', 'hidden aircraft never enters the AI intel used here');

  setVisibleToEnemy(game, [aircraft]);
  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'aircraft');
  game.time = 25;
  setVisibleToEnemy(game, []);
  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'auto', 'the preference clears with the 24-second sighting');
});

test('no local observed counter threat returns Rockets to normal auto targeting', () => {
  const game = arena();
  const rocket = game._createUnit('enemy', 'rocket', 20.5, 20.5);
  const infantry = game._createUnit('player', 'rifle', 21.5, 20.5);
  rocket.targetPriority = 'aircraft';
  setVisibleToEnemy(game, [infantry]);
  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'auto');
  firedAt(game, rocket, infantry);
});

test('rules 85 and markerless v85 saves retain auto behavior', () => {
  assert.equal(AI_ROCKET_PRIORITY_RULES_VERSION, 86);
  const currentRoundTrip = Game.deserialize(arena().serialize());
  assert.equal(currentRoundTrip.aiRocketPriorityRulesVersion, AI_ROCKET_PRIORITY_RULES_VERSION);
  const game = arena(AI_ROCKET_PRIORITY_RULES_VERSION - 1);
  const rocket = game._createUnit('enemy', 'rocket', 20.5, 20.5);
  const aircraft = game._createUnit('player', 'orca', 22.5, 20.5);
  setVisibleToEnemy(game, [aircraft]);
  game._aiObserve();
  game._aiAdaptRocketTargetPriorities();
  assert.equal(rocket.targetPriority, 'auto');

  const markerless = JSON.parse(arena().serialize());
  markerless.replayVersion = null;
  delete markerless.aiRocketPriorityRulesVersion;
  const restored = Game.deserialize(markerless);
  assert.equal(restored.replayVersion, AI_ROCKET_PRIORITY_RULES_VERSION - 1);
  assert.equal(restored.aiRocketPriorityRulesVersion, AI_ROCKET_PRIORITY_RULES_VERSION);
});
