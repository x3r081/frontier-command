import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SIEGE_ANCHOR_RULES_VERSION, SIEGE_ANCHOR_SETUP_SECONDS,
  SIEGE_ANCHOR_ION_STORM_DAMAGE_MULTIPLIER } from '../src/game/engine.js';
import { createSoloPlayback, validateSoloReplay, SOLO_REPLAY_VERSION } from '../src/game/replay.js';
import { CAMPAIGN_MISSIONS, createCampaignGame } from '../src/game/campaign.js';

function arena(replayVersion = SOLO_REPLAY_VERSION) {
  const game = new Game({ seed: 941, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

test('Siege Anchor completes setup before adding range and cancels on movement', () => {
  const game = arena();
  const crawler = game._createUnit('player', 'artillery', 20.5, 20.5);
  assert.equal(game.useUnitAbility(crawler.id, 'siegeAnchor').ok, true);
  assert.deepEqual(crawler.order, { type: 'siegeAnchor', x: 20.5, y: 20.5,
    facing: crawler.facing, readyAt: game.time + SIEGE_ANCHOR_SETUP_SECONDS });
  assert.equal(crawler.path.length, 0);
  assert.equal(game._unitWeaponRange(crawler, { range: 8.3 }), 8.3);
  game.time += SIEGE_ANCHOR_SETUP_SECONDS - 0.01;
  assert.equal(game._unitWeaponRange(crawler, { range: 8.3 }), 8.3);
  game.time += 0.02;
  assert.equal(game._unitWeaponRange(crawler, { range: 8.3 }), 10.3);

  game.select([crawler.id]);
  assert.equal(game.issueMove(23.5, 20.5).ok, true);
  assert.equal(crawler.order.type, 'move');
  assert.equal(game._unitWeaponRange(crawler, { range: 8.3 }), 8.3);
});

test('anchored artillery fires at visible structures and Normal AI unpacks for close threats', () => {
  const game = arena();
  const crawler = game._createUnit('player', 'artillery', 20.5, 20.5);
  const blockedNearTarget = game._createBuilding('enemy', 'factory', 29, 19);
  const clearFarTarget = game._createBuilding('enemy', 'factory', 29, 26);
  game.terrain[20][24].type = 'rock';
  crawler.cooldown = 0;
  assert.equal(game.useUnitAbility(crawler.id, 'siegeAnchor').ok, true);
  crawler.order.readyAt = game.time;
  game._updateUnit(crawler, 0.1);
  assert.equal(crawler.x, 20.5);
  assert.equal(crawler.y, 20.5);
  assert.ok(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === crawler.id &&
    effect.targetId === clearFarTarget.id));
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === crawler.id &&
    effect.targetId === blockedNearTarget.id), false);

  const aiGame = arena();
  aiGame.mode = 'skirmish';
  aiGame.difficulty = 'normal';
  const aiCrawler = aiGame._createUnit('enemy', 'artillery', 20.5, 20.5);
  const observedStructure = aiGame._createBuilding('player', 'factory', 29, 19);
  aiGame._createUnit('enemy', 'scout', 25.5, 20.5);
  aiCrawler.order = { type: 'attack', targetId: observedStructure.id };
  aiGame._aiSiegeAnchorTick([aiCrawler]);
  assert.equal(aiCrawler.order.type, 'siegeAnchor');
  const closeThreat = aiGame._createUnit('player', 'buggy', 21.5, 20.5);
  aiGame._aiSiegeAnchorTick([aiCrawler]);
  assert.deepEqual(aiCrawler.order, { type: 'attack', targetId: closeThreat.id, aiSiegeAnchorThreat: true });

  const persistentAI = arena();
  persistentAI.mode = 'skirmish';
  persistentAI.difficulty = 'normal';
  persistentAI.aiCommanderProfileId = 'siege-director';
  persistentAI.credits.enemy = 0;
  persistentAI._createBuilding('enemy', 'command', 3, 3);
  persistentAI._createBuilding('enemy', 'factory', 8, 3);
  persistentAI._createBuilding('enemy', 'radar', 11, 7);
  persistentAI._createBuilding('player', 'command', 47, 33);
  const persistentTarget = persistentAI._createBuilding('player', 'turret', 29, 19);
  const persistentCrawler = persistentAI._createUnit('enemy', 'artillery', 20.5, 20.5);
  persistentAI._createUnit('enemy', 'scout', 25.5, 20.5);
  persistentCrawler.order = { type: 'attack', targetId: persistentTarget.id };
  persistentAI._aiTick();
  assert.equal(persistentCrawler.order.type, 'siegeAnchor');
  const originalReadyAt = persistentCrawler.order.readyAt;
  for (let n = 0; n < 3; n++) {
    persistentAI.time += 2;
    persistentAI._aiTick();
    assert.equal(persistentCrawler.order.type, 'siegeAnchor');
    assert.equal(persistentCrawler.order.readyAt, originalReadyAt,
      'full AI decisions preserve a useful setup instead of restarting it');
  }
});

test('only ordinary ion storm damage is halved; ion pulse damage stays full', () => {
  const game = arena();
  const crawler = game._createUnit('player', 'artillery', 20.5, 20.5);
  assert.equal(game.useUnitAbility(crawler.id, 'siegeAnchor').ok, true);
  crawler.order.readyAt = game.time;
  const beforeStorm = crawler.hp;
  game._applyDamage(crawler, 10, 'ion', null, null, null, false, false, 'storm');
  assert.equal(beforeStorm - crawler.hp, 10 * SIEGE_ANCHOR_ION_STORM_DAMAGE_MULTIPLIER);
  const beforePulse = crawler.hp;
  game._applyDamage(crawler, 10, 'ion', null, null);
  assert.equal(beforePulse - crawler.hp, 10);
});

test('anchor order and v92 marker survive saves; old rules reject the command', () => {
  const game = arena();
  const crawler = game._createUnit('player', 'artillery', 20.5, 20.5);
  assert.equal(game.useUnitAbility(crawler.id, 'siegeAnchor').ok, true);
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.siegeAnchorRulesVersion, SIEGE_ANCHOR_RULES_VERSION);
  assert.deepEqual(restored.getEntity(crawler.id).order, crawler.order);

  const markerlessData = JSON.parse(game.serialize());
  delete markerlessData.siegeAnchorRulesVersion;
  delete markerlessData.replayVersion;
  const markerless = Game.deserialize(markerlessData);
  assert.equal(markerless.replayVersion, SIEGE_ANCHOR_RULES_VERSION - 1);
  assert.equal(markerless._unitWeaponRange(markerless.getEntity(crawler.id), { range: 8.3 }), 8.3);

  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 941,
    scenarioId: 'shard-valley', victoryMode: 'elimination' };
  const command = { tick: 0, sequence: 0, method: 'useUnitAbility', args: [crawler.id, 'siegeAnchor'],
    selectedIds: [] };
  assert.throws(() => validateSoloReplay(envelope, [command], 1, SIEGE_ANCHOR_RULES_VERSION - 1),
    /Siege Anchor requires replay version 92/);
  assert.equal(validateSoloReplay(envelope, [command], 1, SOLO_REPLAY_VERSION), true);
  const oldRulesGame = arena(SIEGE_ANCHOR_RULES_VERSION - 1);
  const oldCrawler = oldRulesGame._createUnit('player', 'artillery', 20.5, 20.5);
  assert.equal(oldRulesGame.useUnitAbility(oldCrawler.id, 'siegeAnchor').ok, false);
});

test('authored campaign Siege Crawler accepts the public field action command', () => {
  const missionIndex = CAMPAIGN_MISSIONS.findIndex(mission => mission.id === 'dawnfall');
  const game = createCampaignGame(missionIndex, 'normal', 941, 'standard', 'none', 'none', 'none', 'none', null,
    SOLO_REPLAY_VERSION);
  const crawler = game.units.find(unit => unit.owner === 'player' && unit.defId === 'artillery');
  assert.ok(crawler, 'campaign force includes a Siege Crawler');
  assert.equal(game.useUnitAbility(crawler.id, 'siegeAnchor').ok, true);
  assert.equal(crawler.order.type, 'siegeAnchor');
  const replay = createSoloPlayback({ mode: 'campaign', difficulty: 'normal',
    faction: CAMPAIGN_MISSIONS[missionIndex].faction, seed: 941,
    scenarioId: 'dawnfall' }, [{ tick: 0, sequence: 0, method: 'useUnitAbility',
    args: [crawler.id, 'siegeAnchor'], selectedIds: [] }], 1, SOLO_REPLAY_VERSION);
  assert.equal(replay.step(1).status, 'playing');
  assert.equal(replay.game.units.find(unit => unit.id === crawler.id)?.order.type, 'siegeAnchor');
});
