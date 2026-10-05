// Deterministic public-command probes for optional Field Orders in missions
// 6, 7, 11, and 12. Policies use the displayed order target and normal
// selection/move commands; they do not edit campaign or entity state.
import assert from 'node:assert/strict';
import { CAMPAIGN_FIELD_ORDERS, createCampaignGame, getCampaignFieldOrderView, updateCampaign } from '../src/game/campaign.js';

const cases = [
  { index: 5, choice: 0, difficulty: 'normal', seed: 7105 }, // Marked buggy intercept
  { index: 6, choice: 1, difficulty: 'normal', seed: 7006 }, // Central relay
  { index: 10, choice: 1, difficulty: 'normal', seed: 7010 }, // Western relay
  { index: 11, choice: 1, difficulty: 'normal', seed: 7011 }, // Eastern relay
];

for (const { index, choice, difficulty, seed } of cases) {
  const order = CAMPAIGN_FIELD_ORDERS[index][choice];
  const game = createCampaignGame(index, difficulty, seed, 'standard', order.id);
  const view = getCampaignFieldOrderView(game);
  const activeUnits = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && !['harvester', 'engineer'].includes(unit.defId));

  assert.ok(view?.target, `${order.id} exposes a target for player orders`);
  game.select(activeUnits().map(unit => unit.id));
  assert.equal(game.issueMove(view.target.x, view.target.y, choice === 0).ok, true,
    `${order.id} accepts a public move order`);

  // Intercept probes issue a direct attack only after the marked target is
  // visible. Relay probes let ordinary unit movement and capture resolve.
  for (let tick = 0; tick < 750 && game.status === 'playing' &&
      game.campaignState.fieldOrderStatus === 'active'; tick++) {
    game.update(0.2);
    updateCampaign(game, index, 0.2);
    if (choice === 0) {
      const target = game.visibleEnemies.find(enemy => enemy.owner === 'enemy' &&
        Math.hypot(enemy.x - view.target.x, enemy.y - view.target.y) < 5);
      if (target) {
        const responders = activeUnits().filter(unit => Math.hypot(unit.x - target.x, unit.y - target.y) < 15);
        if (responders.length) {
          game.select(responders.map(unit => unit.id));
          game.issueAttack(target.id);
        }
      }
    }
  }

  assert.equal(game.campaignState.fieldOrderStatus, 'completed',
    `${order.id} should be achievable with public commands (${difficulty}, seed ${seed})`);
  console.log(`${order.id} ${difficulty} seed ${seed}: completed at ${game.time.toFixed(1)}s; ` +
    `${game.kills.player} player kills`);
}
