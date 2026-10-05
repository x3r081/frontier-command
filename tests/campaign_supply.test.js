import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS, CAMPAIGN_SUPPLIES,
  createCampaignGame, getCampaignRequisitionBalance } from '../src/game/campaign.js';
import { createSoloPlayback, SOLO_REPLAY_VERSION, validateSoloEnvelope } from '../src/game/replay.js';

const order = (mission, choice = 0) => CAMPAIGN_FIELD_ORDERS[mission][choice].id;
const envelope = (index, extra = {}) => ({ mode: 'campaign', difficulty: 'normal',
  faction: CAMPAIGN_MISSIONS[index].faction, seed: 417 + index, scenarioId: CAMPAIGN_MISSIONS[index].id,
  ...extra });

test('requisition counts distinct completed prior-route orders and subtracts distinct spent sorties', () => {
  assert.deepEqual(CAMPAIGN_SUPPLIES.map(supply => supply.id), ['none', 'reserves', 'recon', 'vanguard']);
  assert.equal(getCampaignRequisitionBalance(0, [order(0)]), 0);
  assert.equal(getCampaignRequisitionBalance(2, [order(0), order(0), order(1), order(2)]), 2);
  assert.equal(getCampaignRequisitionBalance(2, [order(0), order(1)], ['first-harvest', 'first-harvest']), 1);
  assert.equal(getCampaignRequisitionBalance(2, [order(0), order(1)], ['first-harvest', 'last-light']), 0);
  assert.equal(getCampaignRequisitionBalance(2, [order(0)], ['dawnfall']), 0,
    'replaying an earlier mission cannot reuse a token already spent later');
  assert.equal(getCampaignRequisitionBalance(13, [order(0), order(3), order(13)]), 2);
  assert.equal(getCampaignRequisitionBalance(4, [order(0), order(3), order(13), order(14), order(14)]), 3);
  assert.equal(getCampaignRequisitionBalance(5, [order(0), order(13), order(4), order(5)]), 3);
  assert.equal(getCampaignRequisitionBalance(12, [order(11), order(12)]), 1);
  assert.equal(getCampaignRequisitionBalance(-1, [order(0)]), 0);
});

test('reserves adds credits and storage; recon seeds a deterministic timed objective scan', () => {
  const base = createCampaignGame(4, 'normal', 807, 'standard', 'none', 'none');
  const reserve = createCampaignGame(4, 'normal', 807, 'standard', 'none', 'none', 'reserves');
  assert.equal(reserve.credits.player - base.credits.player, 500);
  assert.equal(reserve.creditCapacity.player - base.creditCapacity.player, 500);

  const reconA = createCampaignGame(1, 'normal', 808, 'standard', 'none', 'none', 'recon');
  const reconB = createCampaignGame(1, 'normal', 808, 'standard', 'none', 'none', 'recon');
  assert.deepEqual(reconA.scans, reconB.scans);
  assert.equal(reconA.scans.length, 1);
  assert.equal(reconA.scans[0].owner, 'player');
  assert.equal(reconA.scans[0].radius, 7);
  assert.equal(reconA.scans[0].until, 20);
  const objective = reconA.getEntity(reconA.campaignState.targetId);
  assert.ok(Math.hypot(reconA.scans[0].x - (objective.x + objective.w / 2),
    reconA.scans[0].y - (objective.y + objective.h / 2)) < 0.01);
});

test('vanguard refits only existing armed player units and round-trips through save data', () => {
  const base = createCampaignGame(13, 'normal', 809);
  const game = createCampaignGame(13, 'normal', 809, 'standard', 'none', 'none', 'vanguard');
  assert.equal(game.units.length, base.units.length, 'fixed-force scenario gains no units');
  for (const unit of game.units) {
    const original = base.getEntity(unit.id);
    if (unit.owner === 'player' && game.unitDefs[unit.defId]?.weapon) {
      assert.equal(unit.maxHp, Math.round(original.maxHp * 1.1));
      assert.equal(unit.hp, unit.maxHp);
    } else assert.equal(unit.maxHp, original.maxHp);
  }
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.campaignSupplyId, 'vanguard');
  const oldSave = JSON.parse(base.serialize());
  delete oldSave.campaignSupplyId;
  assert.equal(Game.deserialize(oldSave).campaignSupplyId, 'none');
});

test('every later authored operation can start with each requisition package', () => {
  for (let index = 1; index < CAMPAIGN_MISSIONS.length; index++) {
    const baseline = createCampaignGame(index, 'normal', 1200 + index);
    for (const supply of CAMPAIGN_SUPPLIES.filter(item => item.id !== 'none')) {
      const game = createCampaignGame(index, 'normal', 1200 + index,
        'standard', 'none', 'none', supply.id);
      assert.equal(game.campaignSupplyId, supply.id, `${CAMPAIGN_MISSIONS[index].id}: ${supply.id}`);
      assert.equal(game.campaignMission, index);
      assert.equal(game.status, 'playing');
      if (supply.id === 'reserves') {
        assert.equal(game.credits.player - baseline.credits.player, 500);
        assert.equal(game.creditCapacity.player - baseline.creditCapacity.player, 500);
      }
      if (supply.id === 'recon') assert.equal(game.scans.length, baseline.scans.length + 1);
      if (supply.id === 'vanguard') assert.equal(game.units.length, baseline.units.length);
    }
  }
});

test('campaign replay version 9 carries supply choice while old records default to none', () => {
  assert.equal(SOLO_REPLAY_VERSION, 57);
  const currentEnvelope = envelope(13, { supplyId: 'recon' });
  assert.equal(validateSoloEnvelope(currentEnvelope), 13);
  const current = createSoloPlayback(currentEnvelope, [], 0);
  assert.equal(current.game.campaignSupplyId, 'recon');
  assert.equal(current.reset().campaignSupplyId, 'recon');
  assert.equal(createSoloPlayback(envelope(13), [], 0, 8).game.campaignSupplyId, 'none');
  assert.throws(() => createSoloPlayback(currentEnvelope, [], 0, 8), /require replay version 9/);
  assert.throws(() => validateSoloEnvelope(envelope(0, { supplyId: 'reserves' })), /supply package/);
  assert.throws(() => validateSoloEnvelope({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 1, scenarioId: 'shard-valley', supplyId: 'none' }), /campaign supplies/);
});
