// Deterministic public-command probe for the Mission 1 defended-economy objective.
// The policy reads only revealed legal build sites, the public raid marker, and
// visible enemies; it responds with the ordinary player Attack order.
import assert from 'node:assert/strict';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

const index = 0;
const id = 'first-harvest';
const seed = 481516;
const step = 0.2;

function startSecondRefinery(game) {
  const yard = game.buildings.find(building =>
    building.owner === 'player' && building.defId === 'command');
  assert.ok(yard, 'the player command yard is present');
  const sites = [];
  for (let y = yard.y - 10; y < yard.y + 10; y++) {
    for (let x = yard.x - 10; x < yard.x + 10; x++) {
      if (game.canPlaceBuilding('refinery', x, y).ok)
        sites.push({ x, y, distance: Math.hypot(x - yard.x, y - yard.y) });
    }
  }
  sites.sort((a, b) => a.distance - b.distance);
  const site = sites[0];
  assert.ok(site, 'a revealed legal refinery site is available near the yard');
  const construction = game.startConstruction('refinery');
  assert.equal(construction.ok, true, 'the second refinery can be queued');
  let refineryId = null;
  return () => {
    if (refineryId || !game.construction?.ready) return;
    const placed = game.issueBuild('refinery', site.x, site.y);
    assert.equal(placed.ok, true, 'the second refinery placement is accepted');
    refineryId = placed.id;
  };
}

function advance(game, place, respondToRaid, limit = 1800) {
  let attackOrdered = false;
  let responseOrdered = false;
  let raidClearAt = null;
  const knownRaidIds = new Set();
  let activeAttackTargetId = null;
  for (let tick = 0; tick < limit && game.status === 'playing'; tick++) {
    place();
    game.update(step);
    updateCampaign(game, index, step);
    if (respondToRaid && !responseOrdered && game.campaignState.firstHarvestRaidWarned) {
      const marker = game.campaignState.firstHarvestRaidPoint;
      const armed = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
        !unit.embarkedIn && unit.defId !== 'harvester');
      game.select(armed.map(unit => unit.id));
      assert.equal(game.issueMove(marker.x, marker.y, true).ok, true,
        'the public warning marker accepts an ordinary attack-move response');
      responseOrdered = true;
    }
    if (game.campaignState.firstHarvestRaidRepelled && raidClearAt === null)
      raidClearAt = game.campaignState.elapsed;
    if (respondToRaid) {
      const marker = game.campaignState.firstHarvestRaidPoint;
      const warning = game.events.find(event => event.type === 'campaignReinforcement' &&
        event.marker?.x === marker.x && event.marker?.y === marker.y);
      for (const enemy of game.visibleEnemies) if (
        Math.hypot(enemy.x - marker.x, enemy.y - marker.y) <= marker.radius + 5) knownRaidIds.add(enemy.id);
      const activeTarget = activeAttackTargetId ? game.getEntity(activeAttackTargetId) : null;
      const visibleTarget = game.visibleEnemies.find(enemy => knownRaidIds.has(enemy.id) &&
        enemy.id === warning?.targetId) || game.visibleEnemies.find(enemy => knownRaidIds.has(enemy.id));
      if ((!activeTarget || activeTarget.hp <= 0) && visibleTarget) {
        const armed = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
          !unit.embarkedIn && unit.defId !== 'harvester');
        game.select(armed.map(unit => unit.id));
        assert.equal(game.issueAttack(visibleTarget.id).ok, true,
          'a visible raid contact accepts a normal direct Attack order');
        activeAttackTargetId = visibleTarget.id;
        attackOrdered ||= visibleTarget.id === warning?.targetId;
      }
    }
  }
  return { attackOrdered, responseOrdered, raidClearAt };
}

const passiveDifficulty = 'normal';
const passive = createCampaignGame(index, passiveDifficulty, seed);
const placePassive = startSecondRefinery(passive);
advance(passive, placePassive, false, 137);
const passiveEconomyReadyAt = passive.campaignState.elapsed;
assert.notEqual(passive.status, 'victory',
  'building and ticking alone cannot clear the mission while the raid remains');
assert.equal(passive.campaignState.firstHarvestRaidFired, true, 'the warned raid has launched');
assert.equal(passive.campaignState.firstHarvestRaidRepelled, false,
  'the raiders remain active when the former economy-only path would have won');
assert.ok(passive.buildings.filter(building => building.owner === 'player' && building.defId === 'refinery' &&
  building.progress === 1 && building.powered).length >= 2, 'the refinery objective is already met');
assert.ok(passive.credits.player >= 2200, 'the credit reserve objective is already met');
advance(passive, placePassive, false, 1000);
assert.notEqual(passive.status, 'victory', 'an unattended mission cannot eventually convert the raid into a win');
console.log(`passive build-and-wait: ${passive.status} at ${passive.campaignState.elapsed.toFixed(1)}s ` +
  `(economy ready at ${passiveEconomyReadyAt.toFixed(1)}s; raid repelled: ${passive.campaignState.firstHarvestRaidRepelled})`);

for (const difficulty of ['easy', 'normal', 'hard']) {
  const game = createCampaignGame(index, difficulty, seed);
  const place = startSecondRefinery(game);
  const { attackOrdered, responseOrdered, raidClearAt } = advance(game, place, true);
  assert.equal(attackOrdered, true, `${difficulty}: direct attack ordered on the visible raid lead`);
  assert.equal(responseOrdered, true, `${difficulty}: answered the warning with an attack-move`);
  assert.equal(game.status, 'victory', `${id} ${difficulty} seed ${seed}`);
  assert.equal(game.campaignResult?.mission, id);
  assert.equal(game.campaignState.firstHarvestRaidAttackOrdered, true);
  assert.equal(game.campaignState.firstHarvestRaidRepelled, true);
  const refinery = game.buildings.find(building =>
    building.owner === 'player' && building.defId === 'refinery' && building.progress === 1 && building.powered);
  const yard = game.buildings.find(building =>
    building.owner === 'player' && building.defId === 'command' && building.hp > 0);
  assert.ok(refinery, `${difficulty}: the second refinery is complete and powered`);
  assert.ok(game.credits.player >= 2200, `${difficulty}: the reserve objective is met`);
  assert.ok(yard, `${difficulty}: the command yard survives`);
  assert.ok(game.events.some(event => event.type === 'campaignThreatWarning' &&
    event.marker?.x === game.campaignState.firstHarvestRaidPoint.x), `${difficulty}: warning exposes the raid marker`);
  console.log(`${id} ${difficulty} seed ${seed}: ${game.status} at ` +
    `${game.campaignState.elapsed.toFixed(1)}s; warning response at marker; ` +
    `raid cleared at ${raidClearAt?.toFixed(1)}s; credits ${game.credits.player}; ` +
    `command yard ${yard.hp.toFixed(1)} HP`);
}
