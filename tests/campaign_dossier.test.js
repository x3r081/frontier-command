import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignDossierView } from '../src/game/campaignDossier.js';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS } from '../src/game/campaign.js';
import { saveCampaignResult } from '../src/game/campaignProgress.js';

const storage = (seed = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};
const indexOf = id => CAMPAIGN_MISSIONS.findIndex(mission => mission.id === id);
const dossier = {
  profileId: 'commander-a',
  difficulties: {
    normal: {
      completedMissionIds: ['first-harvest', 'silent-switch'],
      unlockedMissionIds: ['first-harvest', 'silent-switch', 'last-light'],
      medalsByMission: { 'first-harvest': 3, 'silent-switch': 1 },
      fieldOrdersByMission: { 'first-harvest': [CAMPAIGN_FIELD_ORDERS[0][0].id] },
      chosenBranchId: null,
    },
  },
};

test('verified campaign completion opens the next operation in a fresh browser without writing local results', () => {
  const local = storage();
  const view = campaignDossierView(local, dossier, 'commander-a', 'normal');
  assert.equal(view.source, 'profile');
  assert.equal(view.mission(indexOf('last-light')).unlocked, true);
  assert.equal(view.mission(indexOf('silent-switch')).verifiedCompleted, true);
  assert.equal(view.mission(indexOf('first-harvest')).verifiedStars, 3);
  assert.equal(view.mission(indexOf('first-harvest')).localStars, 0);
  assert.equal(view.mission(indexOf('last-light')).localUnlocked, false);
  assert.equal(view.fieldOrder(0, CAMPAIGN_FIELD_ORDERS[0][0].id).verified, true);
  assert.equal(view.fieldOrderTotal, 1);
});

test('profile and difficulty changes cannot borrow another commander’s verified unlocks', () => {
  const local = storage();
  assert.equal(campaignDossierView(local, dossier, 'commander-b', 'normal')
    .mission(indexOf('last-light')).unlocked, false);
  assert.equal(campaignDossierView(local, dossier, 'commander-a', 'hard')
    .mission(indexOf('last-light')).unlocked, false);
});

test('legacy linear progress does not mark Dead Signal complete or unlock it', () => {
  const local = storage({ 'frontier-command-campaign-v1': '999' });
  const view = campaignDossierView(local, null, 'commander-a', 'normal');
  const deadSignal = view.mission(indexOf('dead-signal'));
  assert.equal(deadSignal.localCompleted, false);
  assert.equal(deadSignal.completed, false);
  assert.equal(deadSignal.localUnlocked, false);
});

test('local practice stays playable alongside a different verified campaign route', () => {
  const local = storage();
  const routeIndex = indexOf('iron-current');
  assert.equal(saveCampaignResult(local, 'normal', routeIndex, 'iron-current',
    { mission: 'iron-current', stars: 2 }, 'none'), true);
  const remote = {
    profileId: 'commander-a',
    difficulties: { normal: {
      completedMissionIds: ['ghost-channel'],
      unlockedMissionIds: ['ghost-channel', 'iron-current', 'red-ledger'],
      medalsByMission: { 'ghost-channel': 1 },
      fieldOrdersByMission: {}, chosenBranchId: 'ghost-channel',
    } },
  };
  const view = campaignDossierView(local, remote, 'commander-a', 'normal');
  assert.equal(view.chosenBranchId, 'ghost-channel');
  assert.equal(view.localBranchId, 'iron-current');
  assert.equal(view.mission(routeIndex).localCompleted, true);
  assert.equal(view.mission(indexOf('ghost-channel')).verifiedCompleted, true);
});
