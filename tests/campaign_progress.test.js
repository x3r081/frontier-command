import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_FIELD_ORDER_RECORDS_KEY, CAMPAIGN_RECORDS_KEY, campaignFieldOrderCompleted,
  CAMPAIGN_ROUTE_RECORDS_KEY, campaignChosenBranchId, campaignFieldOrderProgress, campaignFieldOrderTotal,
  CAMPAIGN_ROUTE_SCHEMA_KEY, CAMPAIGN_REQUISITION_RECORDS_KEY, campaignRequisitionSpentMissionIds,
  CAMPAIGN_VETERAN_RECORDS_KEY, campaignVeteranRecordForMission, saveCampaignVeteran,
  CAMPAIGN_DIFFICULTY_PROGRESS_KEY, advanceCampaignLegacyCompletion, campaignMissionUnlocked,
  campaignProgressAtDifficulty, campaignRecord, saveCampaignResult } from '../src/game/campaignProgress.js';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS } from '../src/game/campaign.js';
import { CAMPAIGN_ROUTE_ORDERED_IDS, campaignNextChoices } from '../src/game/campaignRoute.js';

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('a local survivor follows the latest preceding victory at the same difficulty', () => {
  const local = storage();
  const rifle = { defId: 'rifle', faction: 'aegis', veterancy: 1, promotion: null };
  const tank = { defId: 'lightTank', faction: 'aegis', veterancy: 2, promotion: 'bulwark' };
  assert.equal(saveCampaignVeteran(local, 'normal', 'first-harvest', rifle, 100), true);
  assert.deepEqual(campaignVeteranRecordForMission(local, 'normal', 1),
    { sourceMissionId: 'first-harvest', veteran: rifle, completedAt: 100 });
  assert.equal(campaignVeteranRecordForMission(local, 'hard', 1), null);
  assert.equal(saveCampaignVeteran(local, 'normal', 'black-shard', tank, 200), true);
  assert.deepEqual(campaignVeteranRecordForMission(local, 'normal', 4)?.veteran, tank);
  assert.equal(saveCampaignVeteran(local, 'normal', 'ghost-channel', null, 300), true);
  assert.deepEqual(campaignVeteranRecordForMission(local, 'normal', 4)?.veteran, null);
  assert.equal(saveCampaignResult(local, 'normal', 13, 'ghost-channel', { mission: 'ghost-channel', stars: 1 }), true);
  assert.equal(saveCampaignVeteran(local, 'normal', 'ghost-channel', rifle, 300), true);
  assert.equal(saveCampaignVeteran(local, 'normal', 'black-shard', tank, 400), true);
  assert.deepEqual(campaignVeteranRecordForMission(local, 'normal', 4)?.veteran, rifle,
    'a later Black Shard replay cannot replace the chosen branch survivor');
  assert.ok(JSON.parse(local.getItem(CAMPAIGN_VETERAN_RECORDS_KEY)).normal);
});

test('invalid local survivor records cannot enter a later briefing', () => {
  const local = storage();
  assert.equal(saveCampaignVeteran(local, 'normal', 'first-harvest',
    { defId: 'mcv', faction: 'aegis', veterancy: 2, promotion: null }, 100), false);
  assert.equal(saveCampaignVeteran(local, 'normal', 'first-harvest', null, -1), false);
  assert.equal(campaignVeteranRecordForMission(local, 'normal', 1), null);
  const damaged = storage({ [CAMPAIGN_VETERAN_RECORDS_KEY]: '{bad json' });
  assert.equal(campaignVeteranRecordForMission(damaged, 'normal', 1), null);
});

test('campaign best stars are isolated by difficulty and never regress', () => {
  const local = storage({ 'frontier-command-campaign-v1': '3' });
  const result = (stars, mission = 'first-harvest') => ({ mission, stars });
  assert.equal(saveCampaignResult(local, 'normal', 0, 'first-harvest', result(3)), true);
  assert.equal(saveCampaignResult(local, 'normal', 0, 'first-harvest', result(1)), true);
  assert.equal(saveCampaignResult(local, 'hard', 0, 'first-harvest', result(2)), true);
  assert.equal(campaignRecord(local, 'normal', 'first-harvest'), 3);
  assert.equal(campaignRecord(local, 'hard', 'first-harvest'), 2);
  assert.equal(campaignRecord(local, 'easy', 'first-harvest'), 0);
  assert.equal(local.getItem('frontier-command-campaign-v1'), '3');
  assert.ok(JSON.parse(local.getItem(CAMPAIGN_RECORDS_KEY)).normal);
});

test('valid completion advances legacy unlock progress while invalid results are ignored', () => {
  const local = storage();
  assert.equal(saveCampaignResult(local, 'normal', 4, 'red-ledger', { mission: 'red-ledger', stars: 2 }), true);
  assert.equal(local.getItem('frontier-command-campaign-v1'), '5');
  assert.equal(saveCampaignResult(local, 'expert', 5, 'ashes-in-transit', { mission: 'ashes-in-transit', stars: 3 }), false);
  assert.equal(saveCampaignResult(local, 'normal', 6, 'dawnfall', { mission: 'wrong-id', stars: 3 }), false);
  assert.equal(saveCampaignResult(local, 'normal', 6, 'dawnfall', { mission: 'dawnfall', stars: 0 }), false);
  assert.equal(local.getItem('frontier-command-campaign-v1'), '5');
});

test('completion index must identify the mission being recorded', () => {
  const local = storage();
  assert.equal(saveCampaignResult(local, 'normal', 14, 'first-harvest',
    { mission: 'first-harvest', stars: 3 }), false);
  assert.equal(saveCampaignResult(local, 'normal', 0, 'red-ledger',
    { mission: 'red-ledger', stars: 3 }), false);
  assert.equal(campaignRecord(local, 'normal', 'first-harvest'), 0);
  assert.equal(campaignRecord(local, 'normal', 'red-ledger'), 0);
  assert.equal(local.getItem('frontier-command-campaign-v1'), null);
});

test('completed field orders persist once per mission and difficulty', () => {
  const local = storage();
  const mission = CAMPAIGN_MISSIONS[0];
  const [first, second] = CAMPAIGN_FIELD_ORDERS[0];
  const win = fieldOrderId => ({ mission: mission.id, stars: 2, fieldOrderId, fieldOrderStatus: 'completed' });
  assert.equal(saveCampaignResult(local, 'normal', 0, mission.id, win(first.id)), true);
  assert.equal(campaignFieldOrderCompleted(local, 'normal', mission.id, first.id), true);
  assert.equal(campaignFieldOrderProgress(local, 'normal', mission.id), 1);
  assert.equal(campaignFieldOrderTotal(local, 'normal'), 1);
  const initialLedger = local.getItem(CAMPAIGN_FIELD_ORDER_RECORDS_KEY);
  saveCampaignResult(local, 'normal', 0, mission.id, win(first.id));
  assert.equal(local.getItem(CAMPAIGN_FIELD_ORDER_RECORDS_KEY), initialLedger);
  saveCampaignResult(local, 'normal', 0, mission.id, win(second.id));
  assert.equal(campaignFieldOrderProgress(local, 'normal', mission.id), 2);
  assert.equal(campaignFieldOrderTotal(local, 'normal'), 2);
  assert.equal(campaignFieldOrderCompleted(local, 'hard', mission.id, first.id), false);
  saveCampaignResult(local, 'hard', 0, mission.id, win(first.id));
  assert.equal(campaignFieldOrderTotal(local, 'hard'), 1);
  assert.equal(campaignFieldOrderTotal(local, 'easy'), 0);
});

test('invalid order IDs and incomplete outcomes never enter the ledger', () => {
  const local = storage();
  const mission = CAMPAIGN_MISSIONS[0];
  const foreignOrder = CAMPAIGN_FIELD_ORDERS[1][0].id;
  saveCampaignResult(local, 'normal', 0, mission.id, { mission: mission.id, stars: 1, fieldOrderId: foreignOrder, fieldOrderStatus: 'completed' });
  saveCampaignResult(local, 'normal', 0, mission.id, { mission: mission.id, stars: 1, fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][0].id, fieldOrderStatus: 'failed' });
  assert.equal(campaignFieldOrderTotal(local, 'normal'), 0);
});

test('route requisition spends once per victorious mission and difficulty', () => {
  const local = storage();
  const win = { mission: 'silent-switch', stars: 2 };
  assert.equal(saveCampaignResult(local, 'normal', 1, 'silent-switch', win, 'recon'), true);
  assert.deepEqual(campaignRequisitionSpentMissionIds(local, 'normal'), ['silent-switch']);
  assert.deepEqual(campaignRequisitionSpentMissionIds(local, 'hard'), []);
  assert.equal(saveCampaignResult(local, 'normal', 1, 'silent-switch', win, 'vanguard'), true);
  assert.deepEqual(campaignRequisitionSpentMissionIds(local, 'normal'), ['silent-switch']);
  assert.equal(saveCampaignResult(local, 'hard', 1, 'silent-switch', win, 'none'), true);
  assert.deepEqual(campaignRequisitionSpentMissionIds(local, 'hard'), []);
  assert.equal(saveCampaignResult(local, 'normal', 2, 'last-light', { mission: 'last-light', stars: 1 }, 'invented'), false);
  assert.deepEqual(JSON.parse(local.getItem(CAMPAIGN_REQUISITION_RECORDS_KEY)).normal, ['silent-switch']);
});

test('malformed and legacy campaign data is ignored safely', () => {
  const mission = CAMPAIGN_MISSIONS[0];
  const orderId = CAMPAIGN_FIELD_ORDERS[0][0].id;
  const malformed = storage({
    [CAMPAIGN_RECORDS_KEY]: JSON.stringify({ normal: { [mission.id]: 3 } }),
    [CAMPAIGN_FIELD_ORDER_RECORDS_KEY]: JSON.stringify({ normal: { [mission.id]: [orderId, 'retired-order', 42], ghost: [orderId] }, impossible: { [mission.id]: [orderId] } }),
  });
  assert.equal(campaignRecord(malformed, 'normal', mission.id), 3);
  assert.equal(campaignFieldOrderTotal(malformed, 'normal'), 1);
  const legacy = storage({ [CAMPAIGN_RECORDS_KEY]: '{bad json', [CAMPAIGN_FIELD_ORDER_RECORDS_KEY]: '{bad json' });
  assert.equal(campaignRecord(legacy, 'normal', mission.id), 0);
  assert.equal(campaignFieldOrderTotal(legacy, 'normal'), 0);
  assert.equal(saveCampaignResult(legacy, 'normal', 0, mission.id, { mission: mission.id, stars: 1 }), true);
  assert.equal(campaignFieldOrderTotal(legacy, 'normal'), 0);
});

test('fresh progress unlocks only the first mission', () => {
  const local = storage();
  assert.equal(campaignMissionUnlocked(local, 'normal', 0), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 1), false);
  assert.equal(campaignMissionUnlocked(local, 'normal', 13), false);
  assert.equal(campaignMissionUnlocked(local, 'normal', 14), false);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), false);
  assert.equal(campaignChosenBranchId(local, 'normal'), null);
});

test('new campaign victories unlock ordinary missions only at the played difficulty', () => {
  const local = storage();
  saveCampaignResult(local, 'normal', 0, 'first-harvest', { mission: 'first-harvest', stars: 1 });
  assert.equal(campaignMissionUnlocked(local, 'normal', 1), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 1), false);
  assert.equal(campaignProgressAtDifficulty(local, 'normal'), 1);
  assert.equal(campaignProgressAtDifficulty(local, 'hard'), 0);
  assert.deepEqual(JSON.parse(local.getItem(CAMPAIGN_DIFFICULTY_PROGRESS_KEY)), {
    easy: 0, normal: 1, hard: 0,
  });
});

test('older victory without medal metadata advances only its played difficulty', () => {
  const local = storage();
  assert.equal(advanceCampaignLegacyCompletion(local, 'normal', 0), true);
  assert.equal(campaignProgressAtDifficulty(local, 'normal'), 1);
  assert.equal(campaignProgressAtDifficulty(local, 'hard'), 0);
  assert.equal(local.getItem('frontier-command-campaign-v1'), '1');
  assert.equal(campaignRecord(local, 'normal', 'first-harvest'), 0);
  assert.equal(advanceCampaignLegacyCompletion(local, 'normal', 13), false);
});

test('legacy global unlock progress is migrated without relocking existing campaign access', () => {
  const local = storage({ 'frontier-command-campaign-v1': '4' });
  assert.equal(campaignMissionUnlocked(local, 'easy', 4), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 4), true);
  assert.equal(campaignProgressAtDifficulty(local, 'hard'), 4);
  assert.deepEqual(JSON.parse(local.getItem(CAMPAIGN_DIFFICULTY_PROGRESS_KEY)), {
    easy: 4, normal: 4, hard: 4,
  });

  saveCampaignResult(local, 'normal', 4, 'red-ledger', { mission: 'red-ledger', stars: 1 });
  assert.equal(campaignMissionUnlocked(local, 'normal', 5), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 5), false);
});

test('existing difficulty records seed unlocks when the old counter is absent', () => {
  const local = storage({
    [CAMPAIGN_RECORDS_KEY]: JSON.stringify({ hard: { 'dawnfall': 2 }, normal: { 'first-harvest': 1 } }),
  });
  assert.equal(campaignMissionUnlocked(local, 'hard', 7), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 8), false);
  assert.equal(campaignMissionUnlocked(local, 'normal', 1), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 2), false);
});

test('M4 completion opens both branch missions and branch victory opens convergence without advancing legacy progress', () => {
  const local = storage();
  saveCampaignResult(local, 'normal', 3, 'black-shard', { mission: 'black-shard', stars: 2 });
  assert.equal(local.getItem('frontier-command-campaign-v1'), '4');
  assert.equal(campaignMissionUnlocked(local, 'normal', 13), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 14), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), false);

  assert.equal(saveCampaignResult(local, 'normal', 13, 'ghost-channel', { mission: 'ghost-channel', stars: 1 }), true);
  assert.equal(local.getItem('frontier-command-campaign-v1'), '4');
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), true);
  assert.equal(campaignChosenBranchId(local, 'normal'), 'ghost-channel');
  assert.equal(JSON.parse(local.getItem(CAMPAIGN_ROUTE_RECORDS_KEY)).normal, 'ghost-channel');
});

test('the other branch remains replayable and the first completed route stays recorded', () => {
  const local = storage({
    'frontier-command-campaign-v1': '4',
    [CAMPAIGN_RECORDS_KEY]: JSON.stringify({ normal: { 'black-shard': 2 } }),
  });
  saveCampaignResult(local, 'normal', 14, 'iron-current', { mission: 'iron-current', stars: 2 });
  assert.equal(campaignMissionUnlocked(local, 'normal', 13), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 14), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), true);
  saveCampaignResult(local, 'normal', 13, 'ghost-channel', { mission: 'ghost-channel', stars: 3 });
  assert.equal(campaignChosenBranchId(local, 'normal'), 'iron-current');
  assert.equal(local.getItem('frontier-command-campaign-v1'), '4');
});

test('branch progress is isolated by difficulty and old linear saves retain convergence access', () => {
  const local = storage({
    'frontier-command-campaign-v1': '4',
    [CAMPAIGN_ROUTE_SCHEMA_KEY]: '1',
    [CAMPAIGN_RECORDS_KEY]: JSON.stringify({ normal: { 'black-shard': 1, 'ghost-channel': 1 } }),
  });
  assert.equal(campaignMissionUnlocked(local, 'normal', 13), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 13), false);
  assert.equal(campaignMissionUnlocked(local, 'hard', 4), false);
  assert.equal(campaignMissionUnlocked(storage({ 'frontier-command-campaign-v1': '5' }), 'easy', 4), true);
  assert.equal(campaignMissionUnlocked(storage({ 'frontier-command-campaign-v1': '5' }), 'easy', 5), true);
});

test('unmarked legacy progress 4 keeps Red Ledger and branch access, including after replaying M4', () => {
  const local = storage({ 'frontier-command-campaign-v1': '4' });
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 13), true);
  assert.equal(campaignMissionUnlocked(local, 'easy', 14), true);
  assert.equal(local.getItem(CAMPAIGN_ROUTE_SCHEMA_KEY), null);

  saveCampaignResult(local, 'normal', 3, 'black-shard', { mission: 'black-shard', stars: 2 });
  assert.equal(local.getItem('frontier-command-campaign-v1'), '4');
  assert.equal(local.getItem(CAMPAIGN_ROUTE_SCHEMA_KEY), null);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 13), true);
  assert.equal(campaignMissionUnlocked(local, 'hard', 14), true);
});

test('first-time M4 completion marks fork schema and keeps Red Ledger gated until a branch victory', () => {
  const local = storage({ 'frontier-command-campaign-v1': '3' });
  saveCampaignResult(local, 'normal', 3, 'black-shard', { mission: 'black-shard', stars: 2 });
  assert.equal(local.getItem(CAMPAIGN_ROUTE_SCHEMA_KEY), '1');
  assert.equal(local.getItem('frontier-command-campaign-v1'), '4');
  assert.equal(campaignMissionUnlocked(local, 'normal', 13), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 14), true);
  assert.equal(campaignMissionUnlocked(local, 'normal', 4), false);
});

test('route module exposes catalog-independent display order and branch choices by stable mission ID', () => {
  assert.equal(CAMPAIGN_ROUTE_ORDERED_IDS[3], 'black-shard');
  assert.deepEqual(CAMPAIGN_ROUTE_ORDERED_IDS.slice(4, 7), ['ghost-channel', 'iron-current', 'red-ledger']);
  assert.deepEqual(campaignNextChoices('black-shard'), ['ghost-channel', 'iron-current']);
  assert.deepEqual(campaignNextChoices('ghost-channel'), ['red-ledger']);
  assert.deepEqual(campaignNextChoices('iron-current'), ['red-ledger']);
  assert.deepEqual(campaignNextChoices('unknown'), []);
});
