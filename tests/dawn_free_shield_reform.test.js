import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

function breachShield(game, replayVersion = null) {
  for (const relay of game.relays.slice(0, 2)) relay.owner = 'player';
  updateCampaign(game, 11, 10, replayVersion);
  updateCampaign(game, 11, 8, replayVersion);
}

test('v60 Dawn of the Free telegraphs one relay counterattack after the first breach', () => {
  const game = createCampaignGame(11, 'normal', 60260);
  breachShield(game);

  assert.equal(game.campaignState.phase, 'destroy-command');
  assert.equal(game.campaignState.shieldReformCount, 0);
  assert.equal(game.campaignState.relayCounterattackFired, false);
  const warning = game.events.find(event => event.type === 'campaignThreatWarning' && event.relayId);
  assert.equal(warning.relayId, game.relays[1].id);
  assert.deepEqual(warning.marker, { x: game.relays[1].x, y: game.relays[1].y });

  game.time = game.campaignState.relayCounterattackAt;
  updateCampaign(game, 11, 0);
  assert.equal(game.campaignState.relayCounterattackFired, true);
  const attackers = game.campaignState.relayCounterattackUnitIds.map(id => game.getEntity(id));
  assert.equal(attackers.length, 3);
  assert.ok(attackers.every(unit => unit.owner === 'enemy' && unit.order.x === game.relays[1].x &&
    unit.order.y === game.relays[1].y && unit.order.attackMove));
  assert.ok(game.events.some(event => event.type === 'campaignReinforcement' &&
    event.relayId === game.relays[1].id));
});

test('due reserve deploys after reform even though the objective is back on relay capture', () => {
  const game = createCampaignGame(11, 'normal', 60263);
  breachShield(game);
  const state = game.campaignState;
  for (const relay of game.relays.slice(0, 2)) relay.owner = null;
  updateCampaign(game, 11, 6);
  updateCampaign(game, 11, 1);
  assert.equal(state.phase, 'secure-relays');
  assert.equal(state.relayCounterattackFired, false);

  game.time = state.relayCounterattackAt;
  updateCampaign(game, 11, 0);
  assert.equal(state.relayCounterattackFired, true);
  assert.equal(state.relayCounterattackUnitIds.length, 3);
});

test('v60 shield reform warning survives a save and requires a fresh relay hold', () => {
  const game = createCampaignGame(11, 'normal', 60261);
  const target = game.getEntity(game.campaignState.targetId);
  breachShield(game);
  const breachedHp = target.hp;
  for (const relay of game.relays.slice(0, 2)) relay.owner = null;

  updateCampaign(game, 11, 3);
  assert.equal(game.campaignState.shieldReformWarningActive, true);
  assert.equal(game.campaignState.shieldReformWarningElapsed, 3);
  const loaded = Game.deserialize(game.serialize());
  updateCampaign(loaded, 11, 3);
  assert.equal(loaded.campaignState.phase, 'destroy-command');
  assert.equal(loaded.campaignState.shieldReformWarningElapsed, 6);
  updateCampaign(loaded, 11, 1);

  assert.equal(loaded.campaignState.phase, 'secure-relays');
  assert.equal(loaded.campaignState.shieldReformCount, 1);
  assert.equal(loaded.campaignState.holdElapsed, 0);
  assert.equal(loaded.getEntity(loaded.campaignState.targetId).campaignShielded, true);
  assert.equal(loaded.getEntity(loaded.campaignState.targetId).hp, breachedHp);
  assert.ok(loaded.events.some(event => event.type === 'campaignIntel' && /restored the command shield/.test(event.message)));

  for (const relay of loaded.relays.slice(0, 2)) relay.owner = 'player';
  updateCampaign(loaded, 11, 10);
  updateCampaign(loaded, 11, 8);
  assert.equal(loaded.campaignState.phase, 'destroy-command');
  assert.equal(loaded.getEntity(loaded.campaignState.targetId).campaignShielded, false);
  for (const relay of loaded.relays.slice(0, 2)) relay.owner = null;
  updateCampaign(loaded, 11, 20);
  assert.equal(loaded.campaignState.phase, 'destroy-command');
  assert.equal(loaded.campaignState.shieldReformCount, 1);
  assert.equal(loaded.getEntity(loaded.campaignState.targetId).campaignShielded, false);
});

test('v58 and v59 Dawn of the Free replays keep the original one-way breach', () => {
  for (const replayVersion of [58, 59]) {
    const game = createCampaignGame(11, 'normal', 60262 + replayVersion, 'standard', 'none',
      'none', 'none', 'none', null, replayVersion);
    breachShield(game, replayVersion);
    const target = game.getEntity(game.campaignState.targetId);
    assert.equal(game.campaignState.phase, 'destroy-command');
    assert.equal(target.campaignShielded, false);
    assert.equal(game.campaignState.relayCounterattackAt, undefined);
    assert.equal(game.campaignState.shieldReformCount, undefined);
    assert.equal(game.campaignState.dawnFreeShieldReformRulesVersion, undefined);

    for (const relay of game.relays.slice(0, 2)) relay.owner = null;
    updateCampaign(game, 11, 10, replayVersion);
    updateCampaign(game, 11, 10, replayVersion);
    assert.equal(game.campaignState.phase, 'destroy-command');
    assert.equal(target.campaignShielded, false);
  }
});

test('a destroyed exposed yard completes before reform or a due reserve can fire', () => {
  const game = createCampaignGame(11, 'normal', 60264);
  breachShield(game);
  const state = game.campaignState;
  const target = game.getEntity(state.targetId);
  for (const relay of game.relays.slice(0, 2)) relay.owner = null;
  state.shieldReformWarningActive = true;
  state.shieldReformWarningElapsed = 6.9;
  state.relayCounterattackAt = game.time;
  target.hp = 0;

  assert.equal(updateCampaign(game, 11, 0.2), true);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignComplete, true);
  assert.equal(target.campaignShielded, false);
  assert.equal(state.shieldReformCount, 0);
  assert.equal(state.relayCounterattackFired, false);
  assert.equal(state.relayCounterattackUnitIds.length, 0);
});

test('markerless unversioned Dawn of the Free saves retain their archived rules', () => {
  const game = createCampaignGame(11, 'normal', 60265);
  breachShield(game);
  const state = game.campaignState;
  delete state.dawnFreeShieldReformRulesVersion;
  for (const relay of game.relays.slice(0, 2)) relay.owner = null;
  state.relayCounterattackAt = game.time;

  updateCampaign(game, 11, 10, null);
  assert.equal(state.phase, 'destroy-command');
  assert.equal(state.shieldReformCount, 0);
  assert.equal(state.relayCounterattackFired, false);
});
