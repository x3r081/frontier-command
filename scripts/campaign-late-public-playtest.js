// Deterministic public-command probes for three later campaign objectives.
// Policies use authored objective waypoints, player-visible units, and public
// relay locations. Campaign state is read only for final route assertions.
import assert from 'node:assert/strict';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

const cases = [
  { index: 9, id: 'quiet-knife', difficulty: 'normal', seed: 481516 },
  { index: 9, id: 'quiet-knife', difficulty: 'hard', seed: 481516 },
  { index: 10, id: 'last-ember', difficulty: 'normal', seed: 481516 },
  { index: 10, id: 'last-ember', difficulty: 'hard', seed: 481516 },
  { index: 14, id: 'iron-current', difficulty: 'normal', seed: 481516 },
  { index: 14, id: 'iron-current', difficulty: 'hard', seed: 481516 },
];

function advance(game, index, steps) {
  for (let tick = 0; tick < steps && game.status === 'playing'; tick++) {
    game.update(0.2);
    updateCampaign(game, index, 0.2);
  }
}

for (const { index, id, difficulty, seed } of cases) {
  const game = createCampaignGame(index, difficulty, seed);
  const armed = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && unit.defId !== 'harvester');

  if (id === 'quiet-knife') {
    // The marked outpost waypoint is public mission guidance. Attack-move lets
    // the force reveal the chief; a direct attack order intercepts the escape.
    game.select(armed().map(unit => unit.id));
    assert.equal(game.issueMove(52.5, 22.5, true).ok, true);
    let strikeOrdered = false;
    for (let tick = 0; tick < 1500 && game.status === 'playing'; tick++) {
      game.update(0.2);
      const chief = game.visibleEnemies.find(enemy => enemy.defId === 'engineer');
      if (!strikeOrdered && chief) {
        game.select(armed().map(unit => unit.id));
        assert.equal(game.issueAttack(chief.id).ok, true);
        strikeOrdered = true;
      }
      updateCampaign(game, index, 0.2);
    }
    assert.equal(strikeOrdered, true, `${difficulty}: the signal chief is spotted`);
  } else if (id === 'last-ember') {
    const beacon = game.buildings.find(building => building.owner === 'player' && building.defId === 'radar');
    assert.ok(beacon, `${difficulty}: fallback beacon is present`);
    game.select(armed().map(unit => unit.id));
    assert.equal(game.issueMove(beacon.x + beacon.w / 2 + 1, beacon.y + beacon.h / 2 + 1).ok, true);
    let nextThreatCheck = 0;
    for (let tick = 0; tick < 700 && game.status === 'playing'; tick++) {
      game.update(0.2);
      updateCampaign(game, index, 0.2);

      // Toggle the public structure repair command back on after it completes
      // each repair cycle, and direct nearby defenders at visible threats.
      if (beacon.hp < beacon.maxHp && !beacon.repairing && game.credits.player > 100)
        game.toggleRepair(beacon.id);
      if (game.time >= nextThreatCheck) {
        nextThreatCheck = game.time + 3;
        const threats = game.visibleEnemies.filter(enemy => enemy.hp > 0 &&
          Math.hypot(enemy.x + (enemy.w || 0) / 2 - (beacon.x + beacon.w / 2),
            enemy.y + (enemy.h || 0) / 2 - (beacon.y + beacon.h / 2)) <= 12);
        const target = threats.sort((a, b) =>
          Math.hypot(a.x - beacon.x, a.y - beacon.y) - Math.hypot(b.x - beacon.x, b.y - beacon.y))[0];
        if (target) {
          const responders = armed().filter(unit => Math.hypot(unit.x - target.x, unit.y - target.y) < 7);
          if (responders.length) {
            game.select(responders.map(unit => unit.id));
            game.issueAttack(target.id);
          }
        }
      }
    }
    assert.ok(beacon.hp > 0, `${difficulty}: fallback beacon survives the assault`);
  } else {
    // The eastern freight relay is the objective marker. Keep harvesters
    // collecting while the starting armed force moves there on attack-move.
    const freightRelay = game.relays[2];
    game.select(armed().map(unit => unit.id));
    assert.equal(game.issueMove(freightRelay.x, freightRelay.y, true).ok, true);
    advance(game, index, 750);
  }

  assert.equal(game.status, 'victory', `${id} ${difficulty} seed ${seed}`);
  assert.equal(game.campaignResult.mission, id);
  console.log(`${id} ${difficulty} seed ${seed}: ${game.status} at ${game.campaignState.elapsed.toFixed(1)}s; ` +
    `kills ${game.kills.player}; key asset ${game.campaignResult.keyAssetSurvived ? 'survived' : 'lost'}`);
}
