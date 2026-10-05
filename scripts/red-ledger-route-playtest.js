// Deterministic public-command completion probes for the v46 Red Ledger route
// objectives. The policy builds a refinery, commands its army, and sends the
// Engineer to the displayed freight marker using ordinary game commands.
import assert from 'node:assert/strict';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

const cases = [
  { route: 'ghost-channel', seed: 481516 },
  { route: 'iron-current', seed: 481517 },
];

for (const { route, seed } of cases) {
  const game = createCampaignGame(4, 'normal', seed, 'standard', 'none', 'none', 'none', route);
  const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const sites = [];
  for (let y = yard.y - 10; y < yard.y + 10; y++) for (let x = yard.x - 10; x < yard.x + 10; x++) {
    if (game.canPlaceBuilding('refinery', x, y).ok)
      sites.push({ x, y, distance: Math.hypot(x - yard.x, y - yard.y) });
  }
  sites.sort((a, b) => a.distance - b.distance);
  const site = sites[0];
  assert.ok(site, `${route}: revealed refinery site`);
  assert.equal(game.startConstruction('refinery').ok, true, `${route}: start expansion`);

  const assault = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && !['harvester', 'engineer'].includes(unit.defId));
  if (route === 'iron-current') {
    game.select(assault().map(unit => unit.id));
    assert.equal(game.issueMove(38.5, 23.5, true).ok, true, `${route}: cover the eastern freight approach`);
  }

  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  const cache = game.wrecks.find(wreck => wreck.id === game.campaignState.freightCacheId);
  let engineerAtEastPass = false;
  if (route === 'iron-current') {
    assert.ok(engineer && cache, 'Iron Current exposes its Engineer and cache marker');
    game.select([engineer.id]);
    assert.equal(game.issueMove(32.5, 21.5).ok, true, 'send Engineer through the north canyon pass');
  }

  let refineryId = null;
  let recoveryOrdered = false;
  let harvestersPaused = false;
  let lastCourierAttackAt = -Infinity;
  for (let tick = 0; tick < 1800 && game.status === 'playing'; tick++) {
    if (!refineryId && game.construction?.ready) {
      const placed = game.issueBuild('refinery', site.x, site.y);
      assert.equal(placed.ok, true, `${route}: place second refinery`);
      refineryId = placed.id;
    }

    if (route === 'iron-current' && !harvestersPaused && refineryId && game.credits.player >= 4800) {
      const harvesters = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'harvester' && unit.hp > 0);
      game.select(harvesters.map(unit => unit.id));
      assert.equal(game.issueMove(8.5, 43.5).ok, true, 'pause harvesting after the reserve is funded');
      harvestersPaused = true;
    }

    if (route === 'ghost-channel' && game.time - lastCourierAttackAt >= 5) {
      const courier = game.visibleEnemies.find(enemy => enemy.id === game.campaignState.courierId);
      if (courier) {
        const responders = assault();
        if (responders.length) {
          game.select(responders.map(unit => unit.id));
          assert.equal(game.issueAttack(courier.id).ok, true, 'directly order an attack on the revealed courier');
          lastCourierAttackAt = game.time;
        }
      }
    }

    if (route === 'iron-current' && !recoveryOrdered &&
        game.isVisible({ x: cache.x, y: cache.y, owner: 'enemy' }, 'player')) {
      game.select([engineer.id]);
      const result = game.issueRecoverWreck(cache.id);
      if (result.ok) recoveryOrdered = true;
    }

    if (route === 'iron-current' && !engineerAtEastPass && engineer.hp > 0 &&
        Math.hypot(engineer.x - 32.5, engineer.y - 21.5) < 2) {
      game.select([engineer.id]);
      assert.equal(game.issueMove(cache.x, cache.y).ok, true, 'continue from the pass to the freight cache');
      engineerAtEastPass = true;
    }


    game.update(0.2);
    updateCampaign(game, 4, 0.2);
  }

  assert.equal(game.status, 'victory', `${route} wins within the 360 second deadline ` +
    `(elapsed ${game.campaignState.elapsed.toFixed(1)}, credits ${game.credits.player}, ` +
    `courier ${game.campaignState.courierRewardClaimed}/${game.campaignState.courierAttackOrdered}, ` +
    `freight ${game.campaignState.freightCacheRecovered}/${recoveryOrdered}, harvesters paused ${harvestersPaused}, ` +
    `pass ${engineerAtEastPass}, engineer ` +
    `${engineer?.x.toFixed(1)},${engineer?.y.toFixed(1)} ${engineer?.order?.type}/${engineer?._wreckRecoveryProgress}, ` +
    `capacity ${game.creditCapacity.player}, ` +
    `cache ${game.wrecks.some(wreck => wreck.id === cache?.id)})`);
  assert.ok(refineryId && game.getEntity(refineryId)?.powered, `${route}: second refinery is powered`);
  assert.ok(game.credits.player >= 4800, `${route}: reserve reaches 4,800 credits`);
  if (route === 'ghost-channel') assert.equal(game.campaignState.courierRewardClaimed, true);
  else assert.equal(game.campaignState.freightCacheRecovered, true);
  console.log(`${route} seed ${seed}: victory at ${game.campaignState.elapsed.toFixed(1)}s; ` +
    `credits ${game.credits.player}; route task complete`);
}
