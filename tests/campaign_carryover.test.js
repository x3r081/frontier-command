import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_CARRYOVERS, CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS,
  createCampaignGame, getCampaignCarryoverUnlocks } from '../src/game/campaign.js';
import { Game } from '../src/game/engine.js';
import { createSoloPlayback, validateSoloEnvelope } from '../src/game/replay.js';

test('carryover catalog and preceding mission unlock mapping are stable', () => {
  assert.deepEqual(CAMPAIGN_CARRYOVERS.map(item => item.id), ['none', 'assault', 'signal']);
  assert.deepEqual(getCampaignCarryoverUnlocks(0, CAMPAIGN_FIELD_ORDERS[0].map(item => item.id)), ['none']);
  assert.deepEqual(getCampaignCarryoverUnlocks(2, CAMPAIGN_FIELD_ORDERS[0].map(item => item.id)), ['none']);
  assert.deepEqual(getCampaignCarryoverUnlocks(1, CAMPAIGN_FIELD_ORDERS[0].map(item => item.id)),
    ['none', 'assault', 'signal']);
});

test('campaign fork carries Intel through either branch and preserves legacy Red Ledger Intel', () => {
  const blackShard = CAMPAIGN_FIELD_ORDERS[3].map(order => order.id);
  const ghost = CAMPAIGN_FIELD_ORDERS[13].map(order => order.id);
  const iron = CAMPAIGN_FIELD_ORDERS[14].map(order => order.id);
  assert.deepEqual(getCampaignCarryoverUnlocks(13, blackShard), ['none', 'assault', 'signal']);
  assert.deepEqual(getCampaignCarryoverUnlocks(14, blackShard), ['none', 'assault', 'signal']);
  assert.deepEqual(getCampaignCarryoverUnlocks(4, [ghost[0], iron[1]]), ['none', 'assault', 'signal']);
  assert.deepEqual(getCampaignCarryoverUnlocks(4, blackShard), ['none', 'assault', 'signal']);
  assert.deepEqual(getCampaignCarryoverUnlocks(5, ghost), ['none']);
});

test('assault shields only starting player armed units for 45 simulation seconds', () => {
  const game = createCampaignGame(1, 'normal', 1001, 'reinforced', 'none', 'assault');
  const armed = game.units.find(unit => unit.owner === 'player' && game.unitDefs[unit.defId].weapon);
  assert.ok(armed);
  assert.equal(armed.shieldHp, armed.maxHp * 0.2);
  assert.equal(armed.shieldUntil, 45);
  assert.ok(game.units.filter(unit => unit.owner !== 'player' || !game.unitDefs[unit.defId].weapon)
    .every(unit => !unit.shieldHp));
  const fresh = game._createUnit('player', 'rifle', 25, 25);
  assert.equal(fresh.shieldHp, undefined);
  const initialHp = armed.hp;
  game._applyDamage(armed, armed.shieldHp / 2, 'ion', 'enemy');
  assert.equal(armed.hp, initialHp);
  game.time = 45;
  game._applyDamage(armed, 1, 'ion', 'enemy');
  assert.ok(armed.hp < initialHp);
});

test('signal grants 50 starting energy and both bonuses survive save and replay', () => {
  const signal = createCampaignGame(1, 'normal', 1002, 'standard', 'none', 'signal');
  assert.equal(signal.commandEnergy.player, 80);
  assert.equal(signal.commandEnergy.enemy, 30);
  assert.equal(Game.deserialize(signal.serialize()).commandEnergy.player, 80);
  const assault = createCampaignGame(1, 'normal', 1002, 'standard', 'none', 'assault');
  const armed = assault.units.find(unit => unit.owner === 'player' && gameWeapon(assault, unit));
  const loaded = Game.deserialize(assault.serialize());
  assert.equal(loaded.campaignCarryoverId, 'assault');
  assert.equal(loaded.getEntity(armed.id).shieldHp, armed.shieldHp);
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[1].faction,
    scenarioId: CAMPAIGN_MISSIONS[1].id, seed: 1002, carryoverId: 'signal' };
  assert.equal(createSoloPlayback(envelope, [], 0).game.commandEnergy.player, 80);
  assert.equal(createSoloPlayback({ ...envelope, carryoverId: 'assault' }, [], 0).game.campaignCarryoverId, 'assault');
  assert.equal(createSoloPlayback({ ...envelope, carryoverId: undefined }, [], 0).game.campaignCarryoverId, 'none');
  assert.throws(() => validateSoloEnvelope({ ...envelope, carryoverId: 'forged' }), /carryover/i);
  assert.throws(() => validateSoloEnvelope({ ...envelope, scenarioId: CAMPAIGN_MISSIONS[0].id,
    carryoverId: 'signal' }), /carryover/i);
  assert.throws(() => createCampaignGame(0, 'normal', 1002, 'standard', 'none', 'assault'), RangeError);
});

const gameWeapon = (game, unit) => !!game.unitDefs[unit.defId].weapon;
