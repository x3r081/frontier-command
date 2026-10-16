import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_MISSIONS, createCampaignGame, getCampaignFieldOrderView, getCampaignResult,
  getDeadSignalView, DEAD_SIGNAL_RULES_VERSION, updateCampaign } from '../src/game/campaign.js';

const makeGame = (fieldOrder = 'none', replayVersion = DEAD_SIGNAL_RULES_VERSION) =>
  createCampaignGame(17, 'normal', 41090, 'standard', fieldOrder, 'none', 'none', 'none', null, replayVersion);

function tick(game, seconds, recorder = null) {
  const steps = Math.ceil(seconds / 0.1);
  for (let i = 0; i < steps && game.status === 'playing'; i++) {
    const dt = Math.min(0.1, seconds - i * 0.1);
    game.update(dt);
    updateCampaign(game, 17, dt, DEAD_SIGNAL_RULES_VERSION);
    recorder?.();
  }
}

test('Dead Signal is append-only, version-gated, and exposes its public relay and call plan', () => {
  assert.equal(CAMPAIGN_MISSIONS[17].id, 'dead-signal');
  assert.equal(CAMPAIGN_MISSIONS[16].id, 'counterbattery');
  assert.throws(() => createCampaignGame(17, 'normal', 1, 'standard', 'none', 'none', 'none', 'none', null, 89),
    /requires replay rules version 90/);
  const game = makeGame();
  const view = getDeadSignalView(game);
  assert.equal(game.faction, 'vesper');
  assert.deepEqual([view.call.status, view.call.secondsUntil], ['armed', 10]);
  assert.deepEqual([view.sourceRelay.id, view.sourceRelay.owner, view.sourceRelay.contested], ['relay2', 'enemy', false]);
  assert.equal(view.sourceRelay.progress, undefined, 'the public view omits internal signed capture progress');
  assert.equal(game.relays.find(relay => relay.id === 'relay2').progress, -1,
    'enemy-owned source progress must use the enemy signed endpoint');
  assert.deepEqual([view.shelterRelay.id, view.shelterRelay.owner], ['relay1', 'player']);
  assert.equal(view.striker.hpPercent, 72);
  assert.equal(game.campaignState.deadSignalRulesVersion, DEAD_SIGNAL_RULES_VERSION);
  assert.equal(game.commandEnergy.enemy, 20, 'the authored call spends the ordinary 55 command energy');
  assert.equal(game.commandCooldowns.enemy.stormcall, 95);
  assert.equal(getDeadSignalView(createCampaignGame(16)), null);
});

test('the authored enemy Stormcall resolves through the ordinary pulse and the shelter protects its nearby force', () => {
  const game = makeGame();
  const rifle = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  const shelter = game.relays.find(relay => relay.id === 'relay1');
  for (const [index, unit] of game.units.filter(unit => unit.owner === 'enemy').entries()) {
    unit.x = 53 + index; unit.y = 7;
  }
  tick(game, 11);
  assert.equal(game.events.some(event => event.type === 'commandAbility' &&
    event.owner === 'enemy' && event.abilityId === 'stormcall'), true);
  assert.equal(game.events.some(event => event.type === 'stormcallPulse' &&
    event.owner === 'enemy' && event.relayId === 'relay2'), true);
  assert.equal(game.storm.lure?.pulseResolved, true);
  assert.ok(Math.hypot(rifle.x - shelter.x, rifle.y - shelter.y) <= 2.3, 'the Scout starts inside shelter range');
  assert.equal(rifle.hp, rifle.maxHp, 'the sheltered Scout avoids ambient ion damage and sits outside the pulse radius');
  assert.equal(getDeadSignalView(game).call.status, 'fired');
});

test('a player Scout can contest the source before pulse and the normal Stormcall cancellation fires', () => {
  const game = makeGame('dead-signal-intercept');
  const scout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  const source = game.relays.find(relay => relay.id === 'relay2');
  game.selection = [scout.id];
  assert.equal(game.issueMove(source.x, source.y).ok, true);
  tick(game, 7);
  assert.equal(game.campaignState.callStatus, 'cancelled');
  assert.equal(game.events.some(event => event.type === 'stormcallCanceled' && event.relayId === source.id), true);
  assert.equal(game.events.some(event => event.type === 'stormcallPulse' && event.relayId === source.id), false);
  tick(game, 0.1);
  assert.equal(getCampaignFieldOrderView(game)?.status, 'completed');
  assert.equal(game.events.some(event => event.type === 'campaignIntel' &&
    event.fieldOrderId === 'dead-signal-intercept'), true);
});

test('a player can capture the signed enemy source relay through ordinary relay control', () => {
  const game = makeGame();
  const source = game.relays.find(relay => relay.id === 'relay2');
  const scout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  for (const enemy of game.units.filter(unit => unit.owner === 'enemy')) enemy.x = 55, enemy.y = 5;
  scout.x = source.x; scout.y = source.y;
  game._updateRelays(30);
  assert.equal(source.owner, null);
  assert.ok(source.progress > 0, 'crossing zero neutralizes the enemy claim and starts the player capture');
  game._updateRelays(30);
  assert.equal(source.owner, 'player');
});

test('the relay hold starts after the first recovery and continues into calm; Engineer kit order is optional', () => {
  const game = makeGame('dead-signal-signal');
  const source = game.relays.find(relay => relay.id === 'relay2');
  source.owner = 'player'; source.progress = 1; source.contested = false;
  game.campaignState.callStatus = 'fired';
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  game.campaignState.engineerId = engineer.id;
  engineer.fieldRepairKits = 1;
  game.storm.phase = 'surge';
  assert.equal(updateCampaign(game, 17, 4, DEAD_SIGNAL_RULES_VERSION), false);
  assert.equal(game.campaignState.holdElapsed, 0);
  game.storm.phase = 'recovery';
  assert.equal(updateCampaign(game, 17, 4, DEAD_SIGNAL_RULES_VERSION), false);
  assert.equal(game.campaignState.holdElapsed, 4);
  assert.equal(game.campaignState.callThreatEnded, true);
  game.storm.phase = 'calm';
  assert.equal(updateCampaign(game, 17, 4, DEAD_SIGNAL_RULES_VERSION), true);
  assert.equal(game.status, 'victory');
  assert.equal(getCampaignFieldOrderView(game)?.status, 'completed');
  assert.equal(getCampaignResult(game, 17).keyAssetSurvived, true);
  assert.equal(game.credits.player, 650, 'the optional Engineer kit field order pays only on completion');
  assert.match(getCampaignFieldOrderView(game).title, /Field Kit/);
});

test('markerless saves do not acquire new Dead Signal update rules', () => {
  const game = makeGame();
  delete game.campaignState.deadSignalRulesVersion;
  assert.equal(updateCampaign(game, 17, 1), false);
  assert.equal(game.campaignState.elapsed, 0);
  assert.equal(game.campaignComplete, false);
});
