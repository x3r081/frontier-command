import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { CAMPAIGN_MISSIONS, createCampaignGame, updateCampaign } from '../src/game/campaign.js';

function findBuildSite(game, id) {
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    if (game.canPlaceBuilding(id, x, y).ok) return { x, y };
  }
  throw new Error(`No legal site for ${id}`);
}

function clearFirstHarvestRaid(game) {
  game.campaignState.elapsed = 19;
  assert.equal(updateCampaign(game, 0, 0), false, 'the economy alone cannot finish v54');
  for (const id of game.campaignState.firstHarvestRaidUnitIds) game.getEntity(id).hp = 0;
}

test('structure queue, placement, power, and refinery harvester work together', () => {
  const game = new Game({ seed: 80217 });
  const initialCredits = game.credits.player;
  const initialHarvesters = game.units.filter(u => u.owner === 'player' && u.defId === 'harvester').length;
  assert.equal(game.startConstruction('refinery').ok, true);
  assert.equal(game.credits.player, initialCredits - game.buildingDefs.refinery.cost);
  for (let i = 0; i < 100 && !game.construction.ready; i++) game.update(0.5);
  assert.equal(game.construction.ready, true);
  const site = findBuildSite(game, 'refinery');
  assert.equal(game.issueBuild('refinery', site.x, site.y).ok, true);
  assert.equal(game.construction, null);
  assert.equal(game.units.filter(u => u.owner === 'player' && u.defId === 'harvester').length, initialHarvesters + 1);
  assert.equal(game.power.player.consumption > 0, true);
});

test('save/load preserves operational state', () => {
  const game = new Game({ seed: 14, difficulty: 'hard', faction: 'vesper' });
  game.select([game.units.find(u => u.owner === 'player' && u.defId === 'lightTank').id]);
  game.issueMove(21.5, 31.5);
  game.update(2);
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.faction, 'vesper');
  assert.deepEqual(loaded.selection, game.selection);
  assert.deepEqual(loaded.credits, game.credits);
  assert.deepEqual(loaded.units, game.units);
  assert.deepEqual(loaded.terrain, game.terrain);
});

test('campaign missions have distinct achievable objectives', () => {
  assert.equal(CAMPAIGN_MISSIONS.length, 15);
  assert.equal(CAMPAIGN_MISSIONS[11].id, 'dawn-of-the-free');
  assert.equal(CAMPAIGN_MISSIONS[12].id, 'after-the-dawn');
  const harvest = createCampaignGame(0);
  assert.equal(harvest.campaignMission, 0);
  harvest._createBuilding('player', 'refinery', 20, 29, 1);
  harvest.credits.player = 2200;
  clearFirstHarvestRaid(harvest);
  assert.equal(updateCampaign(harvest, 0, 0.1), true);
  assert.equal(harvest.status, 'victory');

  const capture = createCampaignGame(1);
  const target = capture.getEntity(capture.campaignState.targetId);
  assert.equal(target.owner, 'enemy');
  target.owner = 'player';
  assert.equal(updateCampaign(capture, 1, 0.1), true);

  const defense = createCampaignGame(2);
  defense.campaignState.elapsed = 179.9;
  assert.equal(updateCampaign(defense, 2, 0.2), true);
  assert.equal(defense.status, 'victory');
});

test('relay capture is contested, changes ownership, and increases command energy', () => {
  const game = new Game({ seed: 991 });
  const relay = game.relays[0];
  const startEnergy = game.commandEnergy.player;
  game._createUnit('player', 'rifle', relay.x, relay.y);
  game._createUnit('enemy', 'rifle', relay.x + 0.2, relay.y);

  game._updateRelays(10);
  assert.equal(relay.contested, true);
  assert.equal(relay.progress, 0);
  assert.equal(relay.owner, null);

  game.units = game.units.filter(unit => unit.owner !== 'enemy');
  game._updateRelays(30);
  assert.equal(relay.owner, 'player');
  assert.equal(relay.progress, 1);
  assert.ok(game.commandEnergy.player > startEnergy + 30 * 0.32);
  assert.equal(game.events.some(event => event.type === 'relayCaptured' && event.id === relay.id), true);
});

test('ion storm phases advance and storm damage spares units sheltered by a friendly relay', () => {
  const game = new Game({ seed: 203 });
  const storm = game.storm;
  storm.x = 31; storm.y = 24; storm.phase = 'warning'; storm.phaseTime = 9.9; storm.waypoint = 0;
  game._createUnit('player', 'rifle', 31.5, 24.5);
  const exposed = game.units.at(-1);
  game._updateStorm(0.1);
  assert.equal(storm.phase, 'surge');
  game._updateStorm(1);
  assert.ok(exposed.hp < exposed.maxHp);

  const sheltered = game._createUnit('player', 'lightTank', 31.6, 24.5);
  game.relays[0].owner = 'player';
  game.relays[0].x = sheltered.x; game.relays[0].y = sheltered.y;
  const shelteredHp = sheltered.hp;
  game._updateStorm(1);
  assert.equal(sheltered.hp, shelteredHp);
  assert.ok(exposed.hp < exposed.maxHp);
});

test('contested relays stop sheltering units from ion storm damage', () => {
  const game = new Game({ seed: 204 });
  const relay = game.relays[0];
  relay.owner = 'player';
  relay.x = 30; relay.y = 24;
  const sheltered = game._createUnit('player', 'lightTank', relay.x, relay.y);
  const storm = game.storm;
  storm.x = relay.x; storm.y = relay.y; storm.phase = 'surge'; storm.phaseTime = 0;

  game._updateStorm(0.5);
  assert.equal(relay.contested, false);
  assert.equal(sheltered.hp, sheltered.maxHp);

  game._createUnit('enemy', 'rifle', relay.x + 0.2, relay.y);
  game._updateRelays(0);
  assert.equal(relay.contested, true);
  game._updateStorm(0.5);
  assert.ok(sheltered.hp < sheltered.maxHp);
});

test('command abilities spend energy, enforce cooldowns, and apply their effects', () => {
  const game = new Game({ seed: 31 });
  game.commandEnergy.player = 20;
  assert.equal(game.useCommandAbility('scan', 31, 24).ok, false);
  assert.equal(game.commandEnergy.player, 20);
  game.commandEnergy.player = 150;
  const enemy = game._createUnit('enemy', 'rifle', 31, 24);
  const scout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');

  assert.deepEqual(game.useCommandAbility('scan', 31, 24), { ok: true });
  assert.equal(game.commandEnergy.player, 125);
  assert.equal(enemy.revealedUntil, 11);
  assert.equal(game.useCommandAbility('scan', 31, 24).ok, false);

  assert.deepEqual(game.useCommandAbility('overcharge', tank.x, tank.y), { ok: true });
  assert.equal(game.commandEnergy.player, 85);
  assert.equal(tank.overchargedUntil, 13);

  assert.deepEqual(game.useCommandAbility('shield', scout.x, scout.y), { ok: true });
  assert.equal(game.commandEnergy.player, 40);
  assert.equal(scout.shieldUntil, 10);
  assert.ok(scout.shieldHp > 0);
  assert.equal(game.useCommandAbility('shield', scout.x, scout.y).ok, false);
});

test('legacy saves receive defaults for relays, storm, command energy, and cooldowns', () => {
  const data = JSON.parse(new Game({ seed: 7 }).serialize());
  delete data.relays;
  delete data.storm;
  delete data.commandEnergy;
  delete data.commandCooldowns;

  const loaded = Game.deserialize(data);
  assert.equal(loaded.relays.length, 3);
  assert.deepEqual(loaded.commandEnergy, { player: 30, enemy: 30 });
  assert.deepEqual(loaded.commandCooldowns.player, { scan: 0, overcharge: 0, shield: 0,
    stormcall: 0, breach: 0, interdict: 0, rally: 0 });
  assert.deepEqual(loaded.storm, {
    x: 30, y: 24, radius: 5.5, phase: 'calm', phaseTime: 0, cycle: 0,
    waypoint: 0, growthTimer: 0, damageTimer: 0, bloom: null,
  });
});

test('the original seven campaign missions can complete through their authored objectives', () => {
  const firstHarvest = createCampaignGame(0);
  firstHarvest._createBuilding('player', 'refinery', 20, 29, 1);
  firstHarvest.credits.player = 2200;
  clearFirstHarvestRaid(firstHarvest);
  assert.equal(updateCampaign(firstHarvest, 0, 0.1), true);

  const silentSwitch = createCampaignGame(1);
  silentSwitch.getEntity(silentSwitch.campaignState.targetId).owner = 'player';
  assert.equal(updateCampaign(silentSwitch, 1, 0.1), true);

  const lastLight = createCampaignGame(2);
  lastLight.campaignState.elapsed = 179.9;
  assert.equal(updateCampaign(lastLight, 2, 0.2), true);

  const blackShard = createCampaignGame(3);
  blackShard.relays.find(relay => relay.id === blackShard.campaignState.relayId).owner = 'player';
  assert.equal(updateCampaign(blackShard, 3, 8), false);
  assert.equal(blackShard.campaignState.phase, 'destroy-relay');
  blackShard.getEntity(blackShard.campaignState.targetId).hp = 0;
  assert.equal(updateCampaign(blackShard, 3, 0.1), true);

  const redLedger = createCampaignGame(4);
  redLedger._createBuilding('player', 'refinery', 20, 29, 1);
  redLedger.credits.player = 4800;
  assert.equal(updateCampaign(redLedger, 4, 0.1), true);

  const ashes = createCampaignGame(5);
  const escort = ashes.getEntity(ashes.campaignState.escortId);
  // The quiet southern route retains an eight-second upload; the northern
  // route now also requires clearing its visible extraction interceptor.
  const southUplink = ashes.campaignState.transmissionUplinks.find(uplink => uplink.id === 'south');
  escort.x = southUplink.x; escort.y = southUplink.y;
  assert.equal(updateCampaign(ashes, 5, 8), false);
  assert.equal(ashes.campaignState.phase, 'extract-analyst');
  escort.x = 48; escort.y = 17;
  assert.equal(updateCampaign(ashes, 5, 0.1), true);

  const dawnfall = createCampaignGame(6);
  dawnfall.campaignState.phase = 'destroy-command';
  dawnfall.getEntity(dawnfall.campaignState.targetId).campaignShielded = false;
  dawnfall.getEntity(dawnfall.campaignState.targetId).hp = 0;
  assert.equal(updateCampaign(dawnfall, 6, 0.1), true);
});

test('campaign objective loss ends mission instead of leaving an unwinnable game', () => {
  const capture = createCampaignGame(1);
  capture.buildings = capture.buildings.filter(b => b.id !== capture.campaignState.targetId);
  updateCampaign(capture, 1, 0.1);
  assert.equal(capture.status, 'defeat');

  const defense = createCampaignGame(2);
  defense.buildings = defense.buildings.filter(b => !(b.owner === 'player' && b.defId === 'command'));
  updateCampaign(defense, 2, 0.1);
  assert.equal(defense.status, 'defeat');
});

test('expanded campaign missions fail when their critical asset or deadline is lost', () => {
  const relayMission = createCampaignGame(3);
  relayMission.buildings.find(b => b.owner === 'player' && b.defId === 'command').hp = 0;
  updateCampaign(relayMission, 3, 0.1);
  assert.equal(relayMission.status, 'defeat');

  const economyMission = createCampaignGame(4);
  economyMission.campaignState.elapsed = 359.9;
  updateCampaign(economyMission, 4, 0.2);
  assert.equal(economyMission.status, 'defeat');

  const escortMission = createCampaignGame(5);
  escortMission.getEntity(escortMission.campaignState.escortId).hp = 0;
  updateCampaign(escortMission, 5, 0.1);
  assert.equal(escortMission.status, 'defeat');

  const offensiveMission = createCampaignGame(6);
  offensiveMission.buildings.find(b => b.owner === 'player' && b.defId === 'command').hp = 0;
  updateCampaign(offensiveMission, 6, 0.1);
  assert.equal(offensiveMission.status, 'defeat');
});
