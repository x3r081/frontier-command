import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

const playerUnit = (game, defId) => game.units.find(unit => unit.owner === 'player' && unit.defId === defId && unit.hp > 0);

test('v51 Ghost Channel locks the north route and requires a deployed signal shadow before extraction', () => {
  const game = createCampaignGame(5, 'normal', 51051, 'standard', 'none', 'none', 'none', 'ghost-channel');
  const state = game.campaignState;
  const analyst = playerUnit(game, 'engineer');
  const armed = playerUnit(game, 'flamer') || playerUnit(game, 'buggy');
  assert.equal(state.ashesRouteRulesVersion, 51);
  assert.deepEqual(state.transmissionUplinks.map(uplink => uplink.id), ['north']);
  assert.deepEqual(state.ghostShadowPoint, { x: 35.5, y: 25.5, radius: 2.2 });
  assert.ok(Math.hypot(state.ghostShadowPoint.x - state.transmissionUplinks[0].x,
    state.ghostShadowPoint.y - state.transmissionUplinks[0].y) > 4);

  analyst.x = 30.5; analyst.y = 27.5;
  updateCampaign(game, 5, 5);
  assert.equal(state.phase, 'deploy-signal-shadow');
  armed.x = state.ghostShadowPoint.x; armed.y = state.ghostShadowPoint.y;
  updateCampaign(game, 5, 3);
  assert.equal(state.ghostShadowDeployed, true);
  assert.equal(state.phase, 'extract-analyst');
  assert.equal(state.extractionInterceptWarned, true);
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.campaignState.ghostShadowDeployed, true);
  assert.deepEqual(restored.campaignState.ghostShadowPoint, state.ghostShadowPoint);
});

test('v51 Iron Current requires recovering the southern supply cache before extraction', () => {
  const game = createCampaignGame(5, 'normal', 51052, 'standard', 'none', 'none', 'none', 'iron-current');
  const state = game.campaignState;
  const analyst = playerUnit(game, 'engineer');
  assert.equal(state.ashesRouteRulesVersion, 51);
  assert.deepEqual(state.transmissionUplinks.map(uplink => uplink.id), ['south']);
  const cache = game.wrecks.find(wreck => wreck.id === state.routeCacheId);
  assert.ok(cache?.campaignAshesSupplyCache);
  analyst.x = 30.5; analyst.y = 32;
  updateCampaign(game, 5, 8);
  assert.equal(state.phase, 'recover-supply-cache');
  assert.equal(updateCampaign(game, 5, 0), false);
  game.events.push({ type: 'wreckRecovered', id: cache.id, owner: 'enemy', unitId: analyst.id });
  updateCampaign(game, 5, 0);
  assert.equal(state.routeCacheRecovered, false);
  for (const unit of game.units.filter(item => item.owner === 'enemy')) unit.hp = 0;
  analyst.x = cache.x; analyst.y = cache.y;
  for (let y = 29; y <= 36; y++) for (let x = 31; x <= 38; x++) game.fog[y][x] = 2;
  game.select([analyst.id]);
  assert.equal(game.issueRecoverWreck(cache.id).ok, true);
  for (let i = 0; i < 5; i++) game.update(1);
  updateCampaign(game, 5, 0);
  assert.equal(state.routeCacheRecovered, true);
  assert.equal(state.phase, 'extract-analyst');
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.campaignState.routeCacheRecovered, true);
});

test('no-route practice keeps both uplinks and the v50 extraction rule; route payoffs reject v50', () => {
  const practice = createCampaignGame(5, 'normal', 51053);
  assert.deepEqual(practice.campaignState.transmissionUplinks.map(uplink => uplink.id), ['north', 'south']);
  assert.equal(practice.campaignState.ashesRouteRulesVersion, undefined);
  assert.equal(practice.campaignState.routeCacheId, undefined);
  const legacy = createCampaignGame(5, 'normal', 51054);
  const analyst = playerUnit(legacy, 'engineer');
  legacy.campaignState.phase = 'extract-analyst';
  legacy.campaignState.transmissionUplinkId = 'south';
  analyst.x = legacy.campaignState.extraction.x;
  analyst.y = legacy.campaignState.extraction.y;
  assert.equal(updateCampaign(legacy, 5, 0, 50), true, 'legacy direct extraction remains valid');
  const currentPractice = createCampaignGame(5, 'normal', 51059);
  const currentAnalyst = playerUnit(currentPractice, 'engineer');
  currentPractice.campaignState.phase = 'extract-analyst';
  currentPractice.campaignState.transmissionUplinkId = 'south';
  currentAnalyst.x = currentPractice.campaignState.extraction.x;
  currentAnalyst.y = currentPractice.campaignState.extraction.y;
  assert.equal(updateCampaign(currentPractice, 5, 0, 51), true, 'v51 no-route practice adds no route requirement');
  assert.throws(() => createCampaignGame(5, 'normal', 51055, 'standard', 'none', 'none', 'none',
    'ghost-channel', null, 50), /route payoff/);
  assert.throws(() => createCampaignGame(5, 'normal', 51056, 'standard', 'none', 'none', 'none',
    'iron-current', null, 50), /route payoff/);
});

test('route objective locations are passable and each branch can advance to extraction', () => {
  const ghost = createCampaignGame(5, 'normal', 51057, 'standard', 'none', 'none', 'none', 'ghost-channel');
  const iron = createCampaignGame(5, 'normal', 51058, 'standard', 'none', 'none', 'none', 'iron-current');
  const shadow = ghost.campaignState.ghostShadowPoint;
  const cache = iron.wrecks.find(wreck => wreck.id === iron.campaignState.routeCacheId);
  assert.equal(ghost._isPassable(Math.floor(shadow.x), Math.floor(shadow.y)), true);
  assert.equal(iron._isPassable(Math.floor(cache.x), Math.floor(cache.y)), true);

  const ghostAnalyst = playerUnit(ghost, 'engineer');
  const armed = playerUnit(ghost, 'flamer') || playerUnit(ghost, 'buggy');
  ghostAnalyst.x = 30.5; ghostAnalyst.y = 27.5;
  updateCampaign(ghost, 5, 5);
  armed.x = shadow.x; armed.y = shadow.y;
  updateCampaign(ghost, 5, 3);
  assert.equal(ghost.campaignState.phase, 'extract-analyst');
  updateCampaign(ghost, 5, 5);
  for (const id of ghost.campaignState.extractionInterceptUnitIds || []) {
    const intercept = ghost.getEntity(id);
    if (intercept) intercept.hp = 0;
  }
  ghostAnalyst.x = ghost.campaignState.extraction.x;
  ghostAnalyst.y = ghost.campaignState.extraction.y;
  updateCampaign(ghost, 5, 0);
  assert.equal(ghost.status, 'victory');

  const ironAnalyst = playerUnit(iron, 'engineer');
  ironAnalyst.x = 30.5; ironAnalyst.y = 32;
  updateCampaign(iron, 5, 8);
  iron.events.push({ type: 'wreckRecovered', id: cache.id, owner: 'player', unitId: ironAnalyst.id });
  updateCampaign(iron, 5, 0);
  assert.equal(iron.campaignState.phase, 'extract-analyst');
  ironAnalyst.x = iron.campaignState.extraction.x;
  ironAnalyst.y = iron.campaignState.extraction.y;
  updateCampaign(iron, 5, 0);
  assert.equal(iron.status, 'victory');
});
