// Compact deterministic route and branch audit using the public campaign API.
import assert from 'node:assert/strict';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS, createCampaignGame,
  getCampaignFieldOrderView, updateCampaign } from '../src/game/campaign.js';
import { CAMPAIGN_ROUTE_ORDERED_IDS, campaignNextChoices } from '../src/game/campaignRoute.js';
import { campaignMissionUnlocked, saveCampaignResult } from '../src/game/campaignProgress.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

assert.equal(CAMPAIGN_MISSIONS.length, 15);
assert.deepEqual(CAMPAIGN_ROUTE_ORDERED_IDS.slice(0, 7), [
  'first-harvest', 'silent-switch', 'last-light', 'black-shard',
  'ghost-channel', 'iron-current', 'red-ledger',
]);
assert.deepEqual(campaignNextChoices('black-shard'), ['ghost-channel', 'iron-current']);
for (const [branchIndex, branchId] of [[13, 'ghost-channel'], [14, 'iron-current']]) {
  const storage = new MemoryStorage();
  for (const [index, id] of [[0, 'first-harvest'], [1, 'silent-switch'], [2, 'last-light'], [3, 'black-shard']]) {
    assert.equal(campaignMissionUnlocked(storage, 'normal', index), true, `${id} unlocked`);
    assert.equal(saveCampaignResult(storage, 'normal', index, id, { mission: id, stars: 1 }), true);
  }
  assert.equal(campaignMissionUnlocked(storage, 'normal', 13), true);
  assert.equal(campaignMissionUnlocked(storage, 'normal', 14), true);
  assert.equal(campaignMissionUnlocked(storage, 'normal', 4), false);
  assert.equal(saveCampaignResult(storage, 'normal', branchIndex, branchId,
    { mission: branchId, stars: 1 }), true);
  assert.equal(campaignMissionUnlocked(storage, 'normal', 4), true,
    `${branchId} unlocks Red Ledger`);
}
assert.equal(campaignNextChoices('after-the-dawn').length, 0);

// Ghost Channel route: escort the fixed team, move the engineer onto the vault,
// then extract that same engineer. Commands use the ordinary selection/move API.
const game = createCampaignGame(13, 'normal', 167706);
const engineer = game.getEntity(game.campaignState.engineerId);
const escorts = game.units.filter(unit => unit.owner === 'player' && unit.id !== engineer.id);
const advance = steps => {
  for (let i = 0; i < steps && game.status === 'playing'; i++) {
    game.update(0.2);
    updateCampaign(game, 13, 0.2);
  }
};
game.select(escorts.map(unit => unit.id));
assert.equal(game.issueMove(42.5, 20.5, true).ok, true);
advance(150);
assert.ok(engineer.hp > 0 && game.campaignState.phase === 'capture-vault');
game.select(engineer.id);
assert.equal(game.issueMove(43.5, 18.5).ok, true);
advance(330);
assert.equal(game.campaignState.phase, 'extract-engineer');
game.select(engineer.id);
assert.equal(game.issueMove(13.5, 34.5).ok, true);
advance(500);
assert.equal(game.status, 'victory');
assert.equal(game.campaignResult.mission, 'ghost-channel');
assert.ok(engineer.hp > 0 && game.campaignState.elapsed < game.campaignState.deadline);

// Both optional branch Field Orders must remain actionable through the same
// public attack/move and relay capture commands.
for (const index of [13, 14]) for (const choice of [0, 1]) {
  const order = CAMPAIGN_FIELD_ORDERS[index][choice];
  const branch = createCampaignGame(index, 'normal', 7331, 'standard', order.id);
  const target = getCampaignFieldOrderView(branch).target;
  const armed = () => branch.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && !['harvester', 'engineer'].includes(unit.defId));
  branch.select(armed().map(unit => unit.id));
  assert.equal(branch.issueMove(target.x, target.y, choice === 0).ok, true);
  const attacked = new Set();
  for (let i = 0; i < 900 && branch.status === 'playing' &&
      branch.campaignState.fieldOrderStatus === 'active'; i++) {
    branch.update(0.2);
    updateCampaign(branch, index, 0.2);
    if (choice !== 0) continue;
    for (const enemy of branch.visibleEnemies.filter(unit => unit.owner === 'enemy' &&
      Math.hypot(unit.x - target.x, unit.y - target.y) < 7 && !attacked.has(unit.id))) {
      const responders = armed().filter(unit => Math.hypot(unit.x - enemy.x, unit.y - enemy.y) < 22);
      if (responders.length) {
        branch.select(responders.map(unit => unit.id));
        branch.issueAttack(enemy.id);
        attacked.add(enemy.id);
      }
    }
  }
  assert.equal(branch.campaignState.fieldOrderStatus, 'completed', order.id);
}
console.log(`route unlocks: both branches reach Red Ledger; Ghost Channel public route: victory at ${game.campaignState.elapsed.toFixed(1)}s; all branch Field Orders completed`);
