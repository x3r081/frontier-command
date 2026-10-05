import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, validateSoloEnvelope } from '../src/game/replay.js';

function meetRedLedgerEconomyObjective(game) {
  game._createBuilding('player', 'refinery', 28, 40, 1);
  game.credits.player = 4800;
}

test('Red Ledger route payoffs are mission-scoped and legacy setup stays neutral', () => {
  const neutral = createCampaignGame(4, 'normal', 912, 'standard', 'none', 'none', 'none');
  assert.equal(neutral.campaignRoutePayoffId, 'none');
  assert.equal(neutral.campaignState.signalTraceRemaining, 0);
  assert.equal(neutral.campaignState.freightCacheId, undefined);
  assert.equal(neutral.units.some(unit => unit.owner === 'player' && unit.defId === 'engineer'), false);
  assert.throws(() => createCampaignGame(3, 'normal', 913, 'standard', 'none', 'none', 'none', 'ghost-channel'),
    /route payoff/);
});

test('Ghost Channel reveals the courier and escort for a bounded 20-second opening trace', () => {
  const game = createCampaignGame(4, 'normal', 914, 'standard', 'none', 'none', 'none', 'ghost-channel');
  const courier = game.getEntity(game.campaignState.courierId);
  assert.ok(courier);
  assert.equal(game.isVisible(courier), false);
  updateCampaign(game, 4, 0);
  assert.equal(game.isVisible(courier), true);
  assert.equal(game.campaignState.signalTraceRemaining, 20);
  updateCampaign(game, 4, 10);
  updateCampaign(game, 4, 9);
  assert.equal(game.campaignState.signalTraceRemaining, 1);
  game._updateFog();
  updateCampaign(game, 4, 1);
  assert.equal(game.campaignState.signalTraceRemaining, 0);
  assert.equal(game.isVisible(courier), false);
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.campaignRoutePayoffId, 'ghost-channel');
  assert.equal(loaded.campaignState.signalTraceRemaining, 0);
});

test('Iron Current adds a visible Engineer-recoverable 700-credit cache at the east crossing', () => {
  const game = createCampaignGame(4, 'normal', 915, 'standard', 'none', 'none', 'none', 'iron-current');
  const cache = game.wrecks.find(wreck => wreck.id === game.campaignState.freightCacheId);
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  assert.deepEqual([cache.x, cache.y, cache.value, cache.campaignFreightCache], [40.5, 22.5, 700, true]);
  assert.ok(engineer);
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.wrecks.find(wreck => wreck.id === cache.id).campaignFreightCache, true);
  const credits = game.credits.player;
  for (const unit of game.units.filter(item => item.owner === 'enemy')) unit.hp = 0;
  engineer.x = cache.x; engineer.y = cache.y;
  for (let y = 20; y <= 25; y++) for (let x = 38; x <= 43; x++) game.fog[y][x] = 2;
  game.select([engineer.id]);
  assert.deepEqual(game.issueRecoverWreck(cache.id), { ok: true });
  for (let i = 0; i < 5; i++) game.update(1);
  assert.equal(game.wrecks.some(wreck => wreck.id === cache.id), false);
  assert.equal(game.credits.player, credits + 700);
  updateCampaign(game, 4, 0);
  assert.equal(game.credits.player, credits + 700, 'the cache cannot be paid out twice');
});

test('v46 Ghost Channel route requires the courier, and the requirement survives save/load', () => {
  const game = createCampaignGame(4, 'normal', 917, 'standard', 'none', 'none', 'none', 'ghost-channel');
  meetRedLedgerEconomyObjective(game);
  assert.equal(game.campaignState.routeObjectiveRulesVersion, 46);
  assert.equal(updateCampaign(game, 4, 0), false, 'the funded economy alone does not complete the route sortie');

  const courier = game.getEntity(game.campaignState.courierId);
  const attacker = game.units.find(unit => unit.owner === 'player' && unit.hp > 0 && unit.defId === 'buggy');
  game.select([attacker.id]);
  assert.equal(game.issueAttack(courier.id).ok, true);
  courier.hp = 0;
  updateCampaign(game, 4, 0);
  assert.equal(game.campaignState.courierRewardClaimed, true);
  assert.equal(game.status, 'victory');

  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.campaignState.routeObjectiveRulesVersion, 46);
  assert.equal(loaded.campaignState.courierRewardClaimed, true);
  assert.equal(updateCampaign(loaded, 4, 0), false, 'loading a completed run does not complete it twice');

  const ignored = createCampaignGame(4, 'normal', 921, 'standard', 'none', 'none', 'none', 'ghost-channel');
  meetRedLedgerEconomyObjective(ignored);
  ignored.getEntity(ignored.campaignState.courierId).hp = 0;
  assert.equal(updateCampaign(ignored, 4, 0), false, 'the route task requires a player attack order');
  assert.equal(ignored.campaignState.courierRewardClaimed, false);
});

test('v46 Iron Current route requires the player recovery event for its named cache', () => {
  const game = createCampaignGame(4, 'normal', 918, 'standard', 'none', 'none', 'none', 'iron-current');
  const cache = game.wrecks.find(wreck => wreck.id === game.campaignState.freightCacheId);
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  meetRedLedgerEconomyObjective(game);
  assert.equal(updateCampaign(game, 4, 0), false, 'the funded economy alone does not complete the route sortie');

  // A matching recovery by the opposing side cannot satisfy this objective.
  game.events.push({ type: 'wreckRecovered', id: cache.id, owner: 'enemy' });
  updateCampaign(game, 4, 0);
  assert.equal(game.campaignState.freightCacheRecovered, false);

  for (const unit of game.units.filter(item => item.owner === 'enemy')) unit.hp = 0;
  engineer.x = cache.x; engineer.y = cache.y;
  for (let y = 20; y <= 25; y++) for (let x = 38; x <= 43; x++) game.fog[y][x] = 2;
  game.select([engineer.id]);
  assert.deepEqual(game.issueRecoverWreck(cache.id), { ok: true });
  for (let i = 0; i < 5; i++) game.update(1);
  assert.ok(game.events.some(event => event.type === 'wreckRecovered' && event.id === cache.id && event.owner === 'player'));

  const restored = Game.deserialize(game.serialize());
  assert.equal(updateCampaign(restored, 4, 0), true);
  assert.equal(restored.campaignState.freightCacheRecovered, true);
  assert.equal(restored.status, 'victory');
  const loadedAgain = Game.deserialize(restored.serialize());
  assert.equal(loadedAgain.campaignState.freightCacheRecovered, true);
});

test('route objectives preserve v45 and markerless unversioned economy-only completion', () => {
  const replay = createCampaignGame(4, 'normal', 919, 'standard', 'none', 'none', 'none', 'ghost-channel');
  meetRedLedgerEconomyObjective(replay);
  assert.equal(updateCampaign(replay, 4, 0, 45), true);

  const older = createCampaignGame(4, 'normal', 920, 'standard', 'none', 'none', 'none', 'ghost-channel');
  delete older.campaignState.routeObjectiveRulesVersion;
  meetRedLedgerEconomyObjective(older);
  const restored = Game.deserialize(older.serialize());
  assert.equal(restored.replayVersion ?? null, null, 'the current engine markers leave this old-format fixture unversioned');
  assert.equal(updateCampaign(restored, 4, 0), true);
  assert.equal(restored.campaignState.courierRewardClaimed, false);
});

test('archived Iron Current replay keeps its original freight position', () => {
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'vesper', seed: 922,
    scenarioId: 'red-ledger', routePayoffId: 'iron-current' };
  const archived = createSoloPlayback(envelope, [], 0, 45).game;
  const current = createSoloPlayback(envelope, [], 0, 46).game;
  const archivedCache = archived.wrecks.find(wreck => wreck.id === archived.campaignState.freightCacheId);
  const currentCache = current.wrecks.find(wreck => wreck.id === current.campaignState.freightCacheId);
  assert.deepEqual([archivedCache.x, archivedCache.y], [42.5, 27.5]);
  assert.deepEqual([currentCache.x, currentCache.y], [40.5, 22.5]);
  assert.equal(archived.campaignState.routeObjectiveRulesVersion, undefined);
  assert.equal(current.campaignState.routeObjectiveRulesVersion, 46);
});

test('route payoff is locked into v23 playback while v1-v22 records default to neutral', () => {
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'vesper', seed: 916,
    scenarioId: 'red-ledger', routePayoffId: 'ghost-channel' };
  assert.equal(validateSoloEnvelope(envelope), 4);
  assert.throws(() => createSoloPlayback(envelope, [], 0, 22), /version 23/);
  assert.equal(createSoloPlayback(envelope, [], 0, 23).game.campaignRoutePayoffId, 'ghost-channel');
  const legacy = { ...envelope };
  delete legacy.routePayoffId;
  assert.equal(createSoloPlayback(legacy, [], 0, 22).game.campaignRoutePayoffId, 'none');
  assert.throws(() => validateSoloEnvelope({ ...legacy, scenarioId: 'black-shard', faction: 'aegis',
    routePayoffId: 'iron-current' }), /route payoff/);
});
