import assert from 'node:assert/strict';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

function run(difficulty, replayVersion, directRelayOrder = false) {
  const game = createCampaignGame(14, difficulty, 123, 'standard', 'none', 'none', 'none', 'none', null,
    replayVersion);
  let ordered = false;
  for (let tick = 0; tick < 450 * 30 && game.status === 'playing'; tick++) {
    game.update(1 / 30);
    updateCampaign(game, 14, 1 / 30, replayVersion);
    if (directRelayOrder && !ordered && game.campaignState.reserveCommitted) {
      const guardId = game.campaignState.reserveGuardUnitId;
      game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester' &&
        unit.id !== guardId).map(unit => unit.id));
      assert.equal(game.issueMove(game.relays[2].x, game.relays[2].y, true).ok, true);
      ordered = true;
    }
  }
  const playerOrders = game.events.filter(event => event.type === 'order' && event.ids?.some(id =>
    game.getEntity(id)?.owner === 'player')).length;
  return {
    difficulty,
    replayVersion,
    ordered,
    playerOrders,
    status: game.status,
    elapsed: Number(game.campaignState.elapsed.toFixed(1)),
    relayOwner: game.relays.find(relay => relay.id === game.campaignState.relayId)?.owner,
    enemyRelayHold: Number((game.campaignState.enemyRelayHoldElapsed || 0).toFixed(1)),
    result: game.events.filter(event => event.type === 'defeat').at(-1)?.reason || null,
  };
}

const legacy = run('normal', 54);
assert.equal(legacy.status, 'victory', 'v54 playback keeps its historical no-order victory');
assert.equal(legacy.playerOrders, 0);

const results = [legacy];
for (const difficulty of ['easy', 'normal', 'hard']) {
  const idle = run(difficulty, 55);
  assert.equal(idle.status, 'defeat', `${difficulty} idle run should lose the freight relay`);
  assert.ok(idle.elapsed >= 89.9, `${difficulty} receives the full post-assault response window`);
  assert.equal(idle.playerOrders, 0);
  results.push(idle);

  const directed = run(difficulty, 55, true);
  assert.equal(directed.status, 'victory', `${difficulty} relay defense order should win`);
  assert.ok(directed.playerOrders > 0);
  results.push(directed);
}

console.log(JSON.stringify(results, null, 2));
