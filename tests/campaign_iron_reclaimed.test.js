import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS, IRON_RECLAIMED_RULES_VERSION, createCampaignGame,
  getCampaignResult, getIronReclaimedView, updateCampaign } from '../src/game/campaign.js';
import { advanceCampaignLegacyCompletion, campaignProgressAtDifficulty, saveCampaignResult } from '../src/game/campaignProgress.js';
import { campaignDossierView } from '../src/game/campaignDossier.js';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

function advance(game, seconds) {
  for (let i = 0; i < Math.round(seconds * 10); i++) {
    game.update(0.1);
    updateCampaign(game, 15, 0.1);
  }
}

function advanceCampaignOnly(game, seconds) {
  for (let i = 0; i < Math.round(seconds * 10); i++) updateCampaign(game, 15, 0.1);
}

function restoreGuardian(game) {
  const state = game.campaignState;
  const engineer = game.getEntity(state.engineerId);
  const wreck = game.wrecks.find(item => item.id === state.wreckId);
  game.select(engineer.id);
  assert.equal(game.canRecommissionWreck(wreck.id).ok, true);
  assert.equal(game.issueRecommissionWreck(wreck.id).ok, true);
  advance(game, 14);
  const event = game.events.find(item => item.type === 'wreckRecommissioned' && item.id === wreck.id);
  assert.ok(event, 'the engine completed the marked wreck restoration');
  return { engineer, event, vehicle: game.getEntity(event.vehicleId) };
}

test('Iron Reclaimed is appended with fixed rescue force and rules 73 is required', () => {
  assert.equal(CAMPAIGN_MISSIONS[15].id, 'iron-reclaimed');
  assert.equal(IRON_RECLAIMED_RULES_VERSION, 73);
  assert.throws(() => createCampaignGame(15, 'normal', 73, 'standard', 'none', 'none', 'none', 'none', null, 72),
    /requires replay rules version 73/i);
  const game = createCampaignGame(15, 'normal', 73);
  const workshop = game.buildings.find(building => building.defId === 'serviceBay');
  const engineer = game.units.find(unit => unit.defId === 'engineer');
  assert.equal(workshop?.powered, true);
  assert.ok(game.buildings.some(building => building.defId === 'power' && building.powered));
  assert.equal(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle').length, 2);
  assert.equal(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'scout').length, 1);
  assert.equal(engineer?.owner, 'player');
  assert.equal(game.credits.player, 600);
  assert.equal(game.wrecks.find(wreck => wreck.id === game.campaignState.wreckId)?.restoreDefId, 'guardian');

  delete game.campaignState.ironReclaimedRulesVersion;
  assert.equal(updateCampaign(game, 15, 1, null), false, 'an unmarked legacy state cannot activate the new objective');
  assert.equal(game.campaignState.elapsed, 0);
});

test('legacy progress cannot infer bonus completion or advance the ordinary route', () => {
  const storage = memoryStorage({ 'frontier-command-campaign-v1': '99' });
  const dossier = campaignDossierView(storage, null, null, 'normal');
  assert.equal(dossier.mission(15).localCompleted, false);
  assert.equal(advanceCampaignLegacyCompletion(storage, 'normal', 15), false);

  const fresh = memoryStorage();
  assert.equal(campaignProgressAtDifficulty(fresh, 'normal'), 0);
  assert.equal(saveCampaignResult(fresh, 'normal', 15, 'iron-reclaimed',
    { mission: 'iron-reclaimed', stars: 2, fieldOrderStatus: 'none' }), true);
  assert.equal(fresh.getItem('frontier-command-campaign-v1'), null);
  assert.equal(campaignProgressAtDifficulty(fresh, 'normal'), 0);
  assert.equal(campaignDossierView(fresh, null, null, 'normal').mission(15).localCompleted, true);
});

test('marked Guardian is restored by its Engineer and the same pair must reach extraction', () => {
  let game = createCampaignGame(15, 'normal', 41073);
  let { engineer, event, vehicle } = restoreGuardian(game);
  assert.equal(event.unitId, engineer.id);
  assert.equal(event.defId, 'guardian');
  assert.equal(event.cost, 520);
  assert.equal(game.credits.player, 80);
  assert.equal(vehicle._recommissioned, true);
  assert.equal(game.campaignState.recommissionedVehicleId, vehicle.id);
  assert.equal(getIronReclaimedView(game).phase, 'escort-to-relay');

  game = Game.deserialize(game.serialize());
  engineer = game.getEntity(engineer.id);
  vehicle = game.getEntity(vehicle.id);
  game.campaignState.routeChoice = null;
  vehicle.x = 31.5;
  vehicle.y = 18.5;
  updateCampaign(game, 15, 0.1);
  assert.equal(game.campaignState.routeChoice, 'north');
  assert.equal(game.campaignState.routeWarningActive, true);
  assert.match(getIronReclaimedView(game).warning, /north pass patrol arrives/i);
  advanceCampaignOnly(game, 5);
  assert.equal(game.campaignState.routeAmbushFired, true);
  assert.equal(game.campaignState.routeAmbushUnitIds.length, 2);

  const decoy = game._createUnit('player', 'guardian', 48.5, 24.5);
  engineer.x = 48.5; engineer.y = 24.5;
  decoy.x = 48.5; decoy.y = 24.5;
  updateCampaign(game, 15, 0.1);
  assert.equal(game.campaignState.phase, 'escort-to-relay', 'a different Guardian cannot satisfy the recovery marker');

  vehicle.x = 48.5; vehicle.y = 24.5;
  updateCampaign(game, 15, 0.1);
  assert.equal(game.campaignState.phase, 'extract-team');
  assert.equal(getIronReclaimedView(game).markers.extraction.x, 11.5);
  engineer.x = vehicle.x = 11.5;
  engineer.y = vehicle.y = 36.5;
  assert.equal(updateCampaign(game, 15, 0.1), true);
  assert.equal(game.status, 'victory');
  assert.equal(getCampaignResult(game, 15).keyAssetSurvived, true);
  assert.equal(game.campaignResult.mission, 'iron-reclaimed');
});

test('loss of the original Engineer or recommissioned Guardian fails the operation', () => {
  const engineerLoss = createCampaignGame(15, 'normal', 51073);
  engineerLoss.getEntity(engineerLoss.campaignState.engineerId).hp = 0;
  updateCampaign(engineerLoss, 15, 0.1);
  assert.equal(engineerLoss.status, 'defeat');

  const vehicleLoss = createCampaignGame(15, 'normal', 52073);
  const { vehicle } = restoreGuardian(vehicleLoss);
  vehicle.hp = 0;
  updateCampaign(vehicleLoss, 15, 0.1);
  assert.equal(vehicleLoss.status, 'defeat');
});

test('cash-salvaging the marked wreck, losing the workshop, and missing the recovery window fail clearly', () => {
  const salvaged = createCampaignGame(15, 'normal', 53073);
  const salvageState = salvaged.campaignState;
  salvaged.select(salvageState.engineerId);
  assert.equal(salvaged.issueRecoverWreck(salvageState.wreckId).ok, true);
  advance(salvaged, 5);
  assert.equal(salvaged.events.some(event => event.type === 'wreckRecovered' && event.id === salvageState.wreckId), true);
  assert.equal(salvaged.status, 'defeat');
  assert.match(salvaged.events.findLast(event => event.type === 'defeat').reason, /requires recommissioning/i);

  const noWorkshop = createCampaignGame(15, 'normal', 54073);
  noWorkshop.buildings.find(building => building.defId === 'serviceBay').hp = 0;
  updateCampaign(noWorkshop, 15, 0.1);
  assert.equal(noWorkshop.status, 'defeat');
  assert.match(noWorkshop.events.findLast(event => event.type === 'defeat').reason, /Field Workshop was destroyed/i);

  const expired = createCampaignGame(15, 'normal', 55073);
  expired.campaignState.deadline = 0.1;
  updateCampaign(expired, 15, 0.1);
  assert.equal(expired.status, 'defeat');
  assert.match(expired.events.findLast(event => event.type === 'defeat').reason, /recovery window closed/i);
});

test('optional interception order refits the fixed-force rescue team', () => {
  const order = CAMPAIGN_FIELD_ORDERS[15][0];
  const game = createCampaignGame(15, 'normal', 53073, 'standard', order.id);
  const target = game.getEntity(game.campaignState.fieldOrderTargetId);
  const rifle = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle');
  const maxHp = rifle.maxHp;
  rifle.hp = 40;
  for (const row of game.fog) row.fill(2);
  game.select(rifle.id);
  assert.equal(game.issueAttack(target.id).ok, true);
  target.hp = 0;
  updateCampaign(game, 15, 0.1);
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.equal(game.credits.player, 600, 'this fixed-force operation grants a health refit instead of unusable credits');
  assert.equal(rifle.maxHp, Math.round(maxHp * 1.25));
  assert.ok(rifle.hp > 40);
  assert.match(order.rewardText, /Field refit/i);
});
