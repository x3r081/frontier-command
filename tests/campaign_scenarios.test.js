import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Game } from '../src/game/engine.js';
import { CAMPAIGN_MISSIONS, QUIET_KNIFE_ESCAPE, createCampaignGame, getCampaignResult, updateCampaign } from '../src/game/campaign.js';

function signature(game) {
  const terrain = game.terrain.map(row => row.map(tile => `${tile.type[0]}${tile.resource}`).join(',')).join('|');
  return createHash('sha256').update(terrain).digest('hex');
}

function targetFor(game, index) {
  if (index === 5) return game.campaignState.transmissionUplinks[0];
  if (index === 12 || index === 14) return game.relays.find(relay => relay.id === game.campaignState.relayId);
  if ([1, 3, 6, 9, 11, 13].includes(index)) return game.getEntity(game.campaignState.targetId);
  if (index === 8) return game.relays[0];
  if (index === 10) return game.getEntity(game.campaignState.fallbackId);
  return game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
}

test('each authored battlefield is repeatable, distinct, and keeps the saved mission identity', () => {
  const signatures = new Set();
  for (let index = 0; index < CAMPAIGN_MISSIONS.length; index++) {
    const game = createCampaignGame(index);
    assert.equal(game.campaignMission, index);
    assert.equal(game.mission.title, CAMPAIGN_MISSIONS[index].title);
    assert.equal(signature(game), signature(createCampaignGame(index)));
    signatures.add(signature(game));
    const loaded = Game.deserialize(game.serialize());
    assert.equal(loaded.campaignMission, index);
    assert.deepEqual(loaded.campaignState, game.campaignState);
    assert.equal(signature(loaded), signature(game));
  }
  assert.equal(signatures.size, CAMPAIGN_MISSIONS.length, 'missions must not reuse the same valley terrain');
  assert.deepEqual(CAMPAIGN_MISSIONS.map(mission => mission.id), [
    'first-harvest', 'silent-switch', 'last-light', 'black-shard',
    'red-ledger', 'ashes-in-transit', 'dawnfall', 'eye-of-the-storm',
    'three-points-of-light', 'quiet-knife', 'last-ember', 'dawn-of-the-free',
    'after-the-dawn', 'ghost-channel', 'iron-current',
  ]);
});

test('First Harvest v54 telegraphs a public raid while v53 and unmarked saves keep the economy objective', () => {
  const current = createCampaignGame(0, 'normal', 481516);
  assert.equal(current.campaignState.firstHarvestRaidRulesVersion, 54);
  assert.match(current.mission.objective, /repel the warned southern Vesper raid/i);
  current.campaignState.elapsed = 7;
  updateCampaign(current, 0, 0);
  assert.equal(current.campaignState.firstHarvestRaidWarned, true);
  const warning = current.events.find(event => event.type === 'campaignThreatWarning');
  assert.deepEqual(warning.marker, current.campaignState.firstHarvestRaidPoint);
  assert.match(warning.message, /twelve seconds/i);
  current.campaignState.elapsed = 19;
  updateCampaign(current, 0, 0);
  assert.equal(current.campaignState.firstHarvestRaidFired, true);
  assert.equal(current.campaignState.firstHarvestRaidUnitIds.length, 3);
  assert.ok(current.campaignState.firstHarvestRaidUnitIds.every(id =>
    current.visibleEnemies.some(enemy => enemy.id === id)), 'scan reveals the raid through normal visibility');
  const lead = current.getEntity(current.campaignState.firstHarvestRaidTargetId);
  assert.equal(lead.order.type, 'attack');
  assert.equal(lead.order.targetId, current.campaignState.firstHarvestRaidCurrentTargetId);
  const loaded = Game.deserialize(current.serialize());
  assert.deepEqual(loaded.campaignState, current.campaignState, 'the timed response state survives a save');

  const lostYard = createCampaignGame(0, 'normal', 481516);
  lostYard.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  assert.equal(updateCampaign(lostYard, 0, 0), false);
  assert.equal(lostYard.status, 'defeat', 'losing the command yard cannot leave a no-base stall');

  const oldReplay = createCampaignGame(0, 'normal', 481516, 'standard', 'none', 'none', 'none', 'none', null, 53);
  assert.equal(oldReplay.campaignState.firstHarvestRaidRulesVersion, undefined);
  assert.equal(oldReplay.mission.objective, 'Build a second refinery and bank 2,200 credits.');
  oldReplay.credits.player = 2200;
  oldReplay._createBuilding('player', 'refinery', 8, 40, 1);
  assert.equal(updateCampaign(oldReplay, 0, 0, 53), true, 'v53 playback retains economy-only completion');
  assert.equal(oldReplay.events.some(event => event.type === 'campaignThreatWarning'), false);

  const unmarkedSave = createCampaignGame(0, 'normal', 481516);
  delete unmarkedSave.campaignState.firstHarvestRaidRulesVersion;
  unmarkedSave.credits.player = 2200;
  unmarkedSave._createBuilding('player', 'refinery', 8, 40, 1);
  assert.equal(updateCampaign(unmarkedSave, 0, 0), true, 'an unmarked legacy save keeps its saved objective');
});

test('Silent Switch allows barracks recovery while the yard survives and fails when recovery is impossible', () => {
  const game = createCampaignGame(1, 'normal', 2);
  for (const engineer of game.units.filter(unit => unit.owner === 'player' && unit.defId === 'engineer'))
    engineer.hp = 0;
  game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks').hp = 0;
  updateCampaign(game, 1, 0);
  assert.equal(game.status, 'playing', 'the surviving yard can rebuild a barracks');
  assert.equal(game.canBuild('barracks').ok, true);
  let site = null;
  for (let y = 0; y < game.height && !site; y++) for (let x = 0; x < game.width; x++) {
    if (game.canPlaceBuilding('barracks', x, y).ok) { site = { x, y }; break; }
  }
  assert.ok(site);
  const rebuilt = game.issueBuild('barracks', site.x, site.y);
  assert.equal(rebuilt.ok, true);
  for (let tick = 0; tick < 150 && game.status === 'playing'; tick++) {
    game.update(0.2);
    updateCampaign(game, 1, 0.2);
  }
  assert.equal(game.getEntity(rebuilt.id).progress, 1);
  assert.equal(game.queueUnit('engineer').ok, true);
  for (let tick = 0; tick < 70 && game.status === 'playing'; tick++) {
    game.update(0.2);
    updateCampaign(game, 1, 0.2);
  }
  assert.ok(game.units.some(unit => unit.owner === 'player' && unit.defId === 'engineer' && unit.hp > 0));
  assert.equal(game.status, 'playing');

  const mcvRecovery = createCampaignGame(1, 'normal', 42);
  const advance = steps => {
    for (let tick = 0; tick < steps && mcvRecovery.status === 'playing'; tick++) {
      mcvRecovery.update(0.2);
      updateCampaign(mcvRecovery, 1, 0.2);
    }
  };
  const build = defId => {
    while (!mcvRecovery.canBuild(defId).ok && mcvRecovery.canBuild(defId).reason === 'Insufficient credits.')
      advance(1);
    assert.equal(mcvRecovery.canBuild(defId).ok, true, `${defId} is buildable`);
    let site = null;
    for (let y = 0; y < mcvRecovery.height && !site; y++) for (let x = 0; x < mcvRecovery.width; x++) {
      if (mcvRecovery.canPlaceBuilding(defId, x, y).ok) { site = { x, y }; break; }
    }
    assert.ok(site, `${defId} has a legal site`);
    const order = mcvRecovery.issueBuild(defId, site.x, site.y);
    assert.equal(order.ok, true, `${defId} build order`);
    for (let tick = 0; tick < 500 && mcvRecovery.status === 'playing' &&
      mcvRecovery.getEntity(order.id)?.progress < 1; tick++) advance(1);
    assert.equal(mcvRecovery.getEntity(order.id)?.progress, 1, `${defId} completes`);
    return mcvRecovery.getEntity(order.id);
  };
  const factory = build('factory');
  build('radar');
  build('tech');
  assert.equal(mcvRecovery.queueUnit('mcv').ok, true, 'the factory can queue an MCV');
  for (let tick = 0; tick < 600 && mcvRecovery.status === 'playing' &&
    !mcvRecovery.units.some(unit => unit.owner === 'player' && unit.defId === 'mcv'); tick++) advance(1);
  const mcv = mcvRecovery.units.find(unit => unit.owner === 'player' && unit.defId === 'mcv');
  assert.ok(mcv, 'the queued MCV becomes available');
  for (const engineer of mcvRecovery.units.filter(unit => unit.owner === 'player' && unit.defId === 'engineer'))
    engineer.hp = 0;
  for (const building of mcvRecovery.buildings.filter(item => item.owner === 'player' &&
    ['barracks', 'command'].includes(item.defId))) building.hp = 0;
  for (const unit of mcvRecovery.units.filter(item => item.owner === 'player' &&
    item.id !== mcv.id && item.defId !== 'harvester')) unit.hp = 0;
  updateCampaign(mcvRecovery, 1, 0);
  assert.equal(mcvRecovery.status, 'playing', 'a surviving MCV keeps the objective recoverable');
  mcvRecovery.select(mcv.id);
  assert.equal(mcvRecovery.issueMove(25.5, 37.5).ok, true);
  advance(150);
  assert.equal(mcvRecovery.canDeployMCV(mcv.id).ok, true, 'the MCV reaches a legal deployment site');
  assert.equal(mcvRecovery.issueDeploy(mcv.id).ok, true);
  updateCampaign(mcvRecovery, 1, 0);
  assert.equal(mcvRecovery.status, 'playing', 'the rebuilt yard restores barracks construction');
  let mcvBarracksSite = null;
  for (let y = 0; y < mcvRecovery.height && !mcvBarracksSite; y++) for (let x = 0; x < mcvRecovery.width; x++) {
    if (mcvRecovery.canPlaceBuilding('barracks', x, y).ok) { mcvBarracksSite = { x, y }; break; }
  }
  assert.ok(mcvBarracksSite);
  const mcvBarracks = mcvRecovery.issueBuild('barracks', mcvBarracksSite.x, mcvBarracksSite.y);
  assert.equal(mcvBarracks.ok, true);
  for (let tick = 0; tick < 150 && mcvRecovery.status === 'playing' &&
    mcvRecovery.getEntity(mcvBarracks.id)?.progress < 1; tick++) advance(1);
  assert.equal(mcvRecovery.getEntity(mcvBarracks.id)?.progress, 1);
  assert.equal(mcvRecovery.queueUnit('engineer').ok, true);

  const impossible = createCampaignGame(1, 'normal', 2);
  for (const engineer of impossible.units.filter(unit => unit.owner === 'player' && unit.defId === 'engineer'))
    engineer.hp = 0;
  impossible.buildings.find(building => building.owner === 'player' && building.defId === 'barracks').hp = 0;
  impossible.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  updateCampaign(impossible, 1, 0);
  assert.equal(impossible.status, 'defeat');
  assert.equal(impossible.events.filter(event => event.type === 'defeat').at(-1).reason,
    'The engineers and every route to rebuild the command chain were lost before the radar could be captured.');
});

for (const difficulty of ['normal', 'hard']) test(`Dawn of the Free completes both authored stages (${difficulty})`, () => {
  const game = createCampaignGame(11, difficulty);
  assert.match(game.mission.objective, /keep your command yard standing/i,
    'the displayed objective includes the command yard survival condition');
  assert.equal(game.campaignState.phase, 'secure-relays');
  assert.equal(game.campaignState.targetId, game.buildings.find(b => b.owner === 'enemy' && b.defId === 'command').id);
  // Exercise the real capture and hold timers while isolating the authored objective.
  game.units = [];
  for (const relay of game.relays.slice(0, 2)) game._createUnit('player', 'rifle', relay.x, relay.y);
  for (let i = 0; i < 48; i++) {
    game.update(1);
    updateCampaign(game, 11, 1);
  }
  assert.equal(game.relays.filter(relay => relay.owner === 'player').length >= 2, true);
  assert.equal(game.campaignState.phase, 'destroy-command');
  assert.equal(game.status, 'playing');
  const target = game.getEntity(game.campaignState.targetId);
  target.hp = 0;
  assert.equal(updateCampaign(game, 11, 0), true);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignResult.mission, 'dawn-of-the-free');
  const loaded = Game.deserialize(game.serialize());
  assert.deepEqual(loaded.campaignState, game.campaignState);
  assert.deepEqual(loaded.campaignResult, game.campaignResult);
});

test('Dawnfall exposes its command yard only after the central relay is secured', () => {
  let game = createCampaignGame(6, 'normal', 6);
  const relay = game.relays.find(item => item.id === game.campaignState.relayId);
  const command = game.getEntity(game.campaignState.targetId);
  const originalHealth = command.hp;
  assert.equal(game.mission.objective.includes('central Resonance Relay'), true);
  assert.equal(command.campaignShielded, true);
  game._applyDamage(command, 10000, 'explosive', 'player');
  assert.equal(command.hp, originalHealth, 'the yard remains shielded during the relay assault');

  relay.owner = 'player';
  for (let i = 0; i < 4; i++) updateCampaign(game, 6, 1);
  assert.equal(game.campaignState.holdElapsed, 4);
  game = Game.deserialize(game.serialize());
  for (let i = 0; i < 4; i++) updateCampaign(game, 6, 1);
  assert.equal(game.campaignState.phase, 'destroy-command');
  assert.equal(game.getEntity(command.id).campaignShielded, false);
  assert.ok(game.getEntity(command.id).hp <= originalHealth * 0.7);
  game.getEntity(command.id).hp = 0;
  assert.equal(updateCampaign(game, 6, 0), true);
  assert.equal(game.status, 'victory');
});

test('Black Shard requires an uncontested central relay breach before its forward relay can be destroyed', () => {
  const game = createCampaignGame(3, 'normal', 31);
  const relay = game.relays.find(item => item.id === game.campaignState.relayId);
  const target = game.getEntity(game.campaignState.targetId);
  const originalHealth = target.hp;
  assert.equal(game.mission.objective.includes('central Resonance Relay'), true);
  assert.equal(target.campaignShielded, true);
  game._applyDamage(target, 10000, 'explosive', 'player');
  assert.equal(target.hp, originalHealth, 'the forward relay cannot be bombarded through the shield');

  relay.owner = 'player';
  for (let i = 0; i < 4; i++) updateCampaign(game, 3, 1);
  assert.equal(game.campaignState.holdElapsed, 4);
  const loaded = Game.deserialize(game.serialize());
  const loadedRelay = loaded.relays.find(item => item.id === loaded.campaignState.relayId);
  for (let i = 0; i < 3; i++) updateCampaign(loaded, 3, 1);
  loadedRelay.contested = true;
  updateCampaign(loaded, 3, 1);
  assert.equal(loaded.campaignState.holdElapsed, 0, 'enemy contesting resets the relay hold');
  loadedRelay.contested = false;
  for (let i = 0; i < 8; i++) updateCampaign(loaded, 3, 1);
  assert.equal(loaded.campaignState.phase, 'destroy-relay');
  const exposed = loaded.getEntity(target.id);
  assert.equal(exposed.campaignShielded, false);
  assert.ok(exposed.hp <= exposed.maxHp * 0.7);
  exposed.hp = 0;
  assert.equal(updateCampaign(loaded, 3, 0), true);
  assert.equal(loaded.status, 'victory');
  assert.deepEqual(Game.deserialize(loaded.serialize()).campaignResult, loaded.campaignResult);
});

test('Black Shard keeps direct relay destruction for version 34 playback', () => {
  const game = createCampaignGame(3, 'normal', 32);
  const target = game.getEntity(game.campaignState.targetId);
  updateCampaign(game, 3, 0, 34);
  assert.equal(target.campaignShielded, false);
  target.hp = 0;
  assert.equal(updateCampaign(game, 3, 0.1, 34), true);
  assert.equal(game.status, 'victory');
});

test('campaign saves predating relay stages and the chief escape keep their original objectives', () => {
  for (const [index, oldVersion] of [[3, 34], [6, 32]]) {
    const saved = createCampaignGame(index, 'normal', 7031);
    delete saved.campaignState.phase;
    const target = saved.getEntity(saved.campaignState.targetId);
    target.campaignShielded = false;
    const loaded = Game.deserialize(saved.serialize());
    assert.equal(loaded.replayVersion, oldVersion);
    loaded.getEntity(target.id).hp = 0;
    assert.equal(updateCampaign(loaded, index, 0.1), true,
      `mission ${index} retains its reachable original objective after load`);
  }
  const savedChief = createCampaignGame(9, 'normal', 7031);
  delete savedChief.campaignState.chiefEscapePhase;
  const loadedChief = Game.deserialize(savedChief.serialize());
  assert.equal(loadedChief.replayVersion, 33);
  assert.equal(updateCampaign(loadedChief, 9, 0.1), false);
  assert.equal(loadedChief.campaignState.chiefEscapePhase, undefined);
});

test('Dawnfall keeps the original destroy-yard condition in version 32 playback', () => {
  const game = createCampaignGame(6, 'normal', 7);
  const command = game.getEntity(game.campaignState.targetId);
  updateCampaign(game, 6, 0, 32);
  assert.equal(command.campaignShielded, false);
  command.hp = 0;
  assert.equal(updateCampaign(game, 6, 0.1, 32), true);
  assert.equal(game.status, 'victory');
});

test('Dawnfall relay breach and artillery siege wins through the northern pass across difficulties and seeds', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 5, 167706]) {
    const game = createCampaignGame(6, difficulty, seed);
    const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
    const command = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
    assert.ok(factory && command);
    assert.deepEqual(game.setRally(factory.id, 38.5, 17.5), { ok: true });
    for (let i = 0; i < 4; i++) assert.equal(game.queueUnit('artillery').ok, true,
      `${difficulty} seed ${seed} can fund its siege force`);

    const army = () => game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester');
    const orderAttackMove = (x, y) => {
      game.select(army().map(unit => unit.id));
      assert.equal(game.issueMove(x, y, true).ok, true);
    };
    const relay = game.relays.find(item => item.id === game.campaignState.relayId);
    orderAttackMove(relay.x, relay.y);
    let siegeStarted = false;

    for (let tick = 0; tick < 1000 && game.status === 'playing'; tick++) {
      game.update(0.5);
      updateCampaign(game, 6, 0.5);
      if (game.campaignState.phase === 'destroy-command' && !siegeStarted) {
        siegeStarted = true;
        orderAttackMove(35.5, 19.5);
      }
      if (siegeStarted && tick === 120) orderAttackMove(41, 21);
      if (siegeStarted && tick === 220) orderAttackMove(44, 21);
      if (command.hp < command.maxHp * 0.9 && !command.repairing)
        assert.deepEqual(game.toggleRepair(command.id), { ok: true, active: true });
    }

    assert.equal(game.status, 'victory', `${difficulty} seed ${seed} siege route`);
    assert.equal(game.campaignState.phase, 'destroy-command');
    assert.equal(game.campaignComplete, true);
    assert.equal(game.getEntity(game.campaignState.targetId)?.hp > 0, false);
    assert.ok(command.hp > 0, `${difficulty} seed ${seed} keeps the command yard standing`);
    assert.equal(game.campaignResult.mission, 'dawnfall');
    assert.equal(game.campaignResult.stars, 3);
  }
});

test('Dawn of the Free is winnable through public commands against the live normal AI', () => {
  const game = createCampaignGame(11, 'normal');
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  assert.ok(barracks && factory);

  assert.deepEqual(game.setRally(barracks.id, 22.5, 27.5), { ok: true });
  assert.deepEqual(game.setRally(factory.id, 42.5, 29.5), { ok: true });
  for (const defId of ['rocket', 'rocket', 'rocket', 'medic', 'rifle',
    'lightTank', 'lightTank', 'lightTank', 'lightTank']) {
    assert.equal(game.queueUnit(defId).ok, true, `${defId} can be produced`);
  }

  const openingForce = game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester');
  game.select(openingForce.map(unit => unit.id));
  assert.deepEqual(game.issueMove(42.5, 29.5, true), { ok: true });

  const advance = (steps) => {
    for (let i = 0; i < steps && game.status === 'playing'; i++) {
      game.update(0.5);
      updateCampaign(game, 11, 0.5);
    }
  };
  for (let i = 0; i < 200 && game.campaignState.phase === 'secure-relays' && game.status === 'playing'; i++) {
    advance(1);
  }
  assert.equal(game.campaignState.phase, 'destroy-command', 'the two held relays expose the command yard');
  assert.equal(game.relays.filter(relay => relay.owner === 'player').length, 2);
  assert.equal(game.relays[1].owner, 'enemy');
  assert.equal(game.getEntity(game.campaignState.targetId).campaignShielded, false);

  assert.deepEqual(game.useCommandAbility('shield', 43, 30), { ok: true });
  let assaultForce = game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester');
  game.select(assaultForce.map(unit => unit.id));
  assert.deepEqual(game.issueMove(47, 22, true), { ok: true });
  for (let i = 0; i < 100 && game.buildings.some(building =>
    building.owner === 'enemy' && building.defId === 'turret' && building.hp > 0) && game.status === 'playing'; i++) {
    advance(1);
  }
  assert.equal(game.buildings.some(building => building.owner === 'enemy' && building.defId === 'turret' && building.hp > 0), false,
    'the attack-move clears the turret covering the northern approach');

  assaultForce = game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester');
  game.select(assaultForce.map(unit => unit.id));
  assert.deepEqual(game.issueMove(52.5, 10.5, true), { ok: true });
  advance(120);

  assert.equal(game.status, 'victory');
  assert.equal(game.campaignComplete, true);
  assert.ok(game.buildings.some(building => building.owner === 'player' && building.defId === 'command' && building.hp > 0));
  assert.equal(game.campaignResult.mission, 'dawn-of-the-free');
  assert.equal(game.campaignResult.stars, 3);
  assert.equal(game.campaignResult.keyAssetSurvived, true);
  assert.ok(game.campaignResult.elapsed <= 360);
});

test('After the Dawn airlift rescue beats the live normal AI using player commands', () => {
  let game = createCampaignGame(12, 'normal');
  const ships = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'dropship');
  const infantry = game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'dropship');
  const engineerId = game.campaignState.engineerId;
  const advance = steps => {
    for (let i = 0; i < steps && game.status === 'playing'; i++) {
      game.update(0.2);
      updateCampaign(game, 12, 0.2);
    }
  };

  assert.equal(game.buildings.length, 0, 'the rescue team has no production or reinforcements');
  assert.equal(game._findPath(21.5, 29.5, 42.5, 29.5).length, 0,
    'the eastern relay cannot be reached on foot');
  game.select(infantry.filter(unit => ['engineer', 'rocket', 'medic'].includes(unit.defId)).map(unit => unit.id));
  assert.deepEqual(game.issueBoard(ships[0].id), { ok: true });
  game.select(infantry.filter(unit => ['flamer', 'rifle'].includes(unit.defId)).map(unit => unit.id));
  assert.deepEqual(game.issueBoard(ships[1].id), { ok: true });
  advance(50);
  assert.deepEqual(ships.map(ship => ship.passengerIds.length), [4, 2]);

  // A save during the airlift preserves the fixed force and objective state.
  game = Game.deserialize(game.serialize());
  const loadedShips = ships.map(ship => game.getEntity(ship.id));
  assert.equal(game.campaignState.phase, 'secure-landing');
  assert.deepEqual(loadedShips.map(ship => ship.passengerIds.length), [4, 2]);
  game.select(loadedShips[0].id);
  assert.deepEqual(game.issueUnload(41.5, 29.5), { ok: true });
  game.select(loadedShips[1].id);
  assert.deepEqual(game.issueUnload(41.5, 32.5), { ok: true });
  advance(300);
  assert.equal(game.campaignState.phase, 'extract-engineer');
  assert.equal(game.status, 'playing', 'the relay hold alone does not finish the operation');
  assert.equal(game.relays[2].owner, 'player');
  assert.ok(game.kills.player >= 3, 'the landed team fought the live defenders');

  const engineer = game.getEntity(engineerId);
  game.select(engineer.id);
  assert.deepEqual(game.issueBoard(loadedShips[0].id), { ok: true });
  advance(20);
  assert.deepEqual(loadedShips[0].passengerIds, [engineer.id]);
  game.select(loadedShips[0].id);
  assert.deepEqual(game.issueUnload(22.5, 29.5), { ok: true });
  advance(150);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignComplete, true);
  assert.equal(game.campaignResult.mission, 'after-the-dawn');
  assert.equal(game.campaignResult.keyAssetSurvived, true);
  assert.equal(engineer.embarkedIn, null);
  assert.ok(engineer.x < 30, 'the engineer returned across the channel');
});

test('After the Dawn fails when the engineer is lost or the recovery window closes', () => {
  const lost = createCampaignGame(12);
  lost.getEntity(lost.campaignState.engineerId).hp = 0;
  updateCampaign(lost, 12, 0.2);
  assert.equal(lost.status, 'defeat');

  const late = createCampaignGame(12);
  late.campaignState.elapsed = late.campaignState.deadline - 1;
  updateCampaign(late, 12, 1);
  assert.equal(late.status, 'defeat');
});

test('Ghost Channel captures the radar key and extracts the same engineer under live pressure', () => {
  let game = createCampaignGame(13, 'normal');
  const engineerId = game.campaignState.engineerId;
  const vaultId = game.campaignState.targetId;
  const advance = (steps, index = 13) => {
    for (let i = 0; i < steps && game.status === 'playing'; i++) {
      game.update(0.2);
      updateCampaign(game, index, 0.2);
    }
  };
  assert.equal(game.buildings.filter(building => building.owner === 'player').length, 0);
  assert.equal(game.canBuild('power').ok, false);
  const escort = game.units.filter(unit => unit.owner === 'player' && unit.id !== engineerId);
  game.select(escort.map(unit => unit.id));
  assert.equal(game.issueMove(42.5, 20.5, true).ok, true);
  advance(150);
  assert.ok(game.kills.player > 0, 'the escort fought the vault guards');
  game = Game.deserialize(game.serialize());
  const engineer = game.getEntity(engineerId);
  const vault = game.getEntity(vaultId);
  assert.equal(vault.owner, 'enemy');
  assert.equal(vault.campaignShielded, true);
  game.select(engineer.id);
  assert.equal(game.issueMove(43.5, 18.5).ok, true);
  advance(330);
  assert.equal(game.campaignState.phase, 'extract-engineer');
  assert.equal(vault.owner, 'player');
  assert.ok(engineer.hp > 0, 'the engineer is retained after the campaign vault capture');
  assert.equal(game.status, 'playing', 'capture alone cannot complete the mission');
  game.select(engineer.id);
  assert.equal(game.issueMove(13.5, 34.5).ok, true);
  advance(500);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignResult.mission, 'ghost-channel');
  assert.equal(game.campaignResult.keyAssetSurvived, true);
  assert.deepEqual(Game.deserialize(game.serialize()).campaignResult, game.campaignResult);
});

test('Ghost Channel public extraction route survives difficulty and seed variation', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 5, 167706]) {
    const game = createCampaignGame(13, difficulty, seed);
    const engineerId = game.campaignState.engineerId;
    const escorts = game.units.filter(unit => unit.owner === 'player' && unit.id !== engineerId);
    game.select(escorts.map(unit => unit.id));
    assert.equal(game.issueMove(42.5, 20.5, true).ok, true);
    for (let i = 0; i < 150 && game.status === 'playing'; i++) {
      game.update(0.2);
      updateCampaign(game, 13, 0.2);
    }

    const engineer = game.getEntity(engineerId);
    const vault = game.getEntity(game.campaignState.targetId);
    assert.ok(engineer?.hp > 0, `${difficulty} seed ${seed} keeps the signal engineer alive`);
    assert.ok(vault && game.campaignState.phase === 'capture-vault', `${difficulty} seed ${seed} reaches the vault`);
    game.select(engineer.id);
    assert.equal(game.issueMove(43.5, 18.5).ok, true);
    for (let i = 0; i < 330 && game.status === 'playing'; i++) {
      game.update(0.2);
      updateCampaign(game, 13, 0.2);
    }
    assert.equal(game.campaignState.phase, 'extract-engineer', `${difficulty} seed ${seed} captures the vault`);
    game.select(engineer.id);
    assert.equal(game.issueMove(13.5, 34.5).ok, true);
    for (let i = 0; i < 500 && game.status === 'playing'; i++) {
      game.update(0.2);
      updateCampaign(game, 13, 0.2);
    }

    assert.equal(game.status, 'victory', `${difficulty} seed ${seed}`);
    assert.ok(engineer.hp > 0, `${difficulty} seed ${seed} extracts the same engineer`);
    assert.ok(game.campaignState.elapsed < game.campaignState.deadline);
  }
});

test('Ghost Channel fails if its engineer dies or the transmission window closes', () => {
  const lost = createCampaignGame(13);
  lost.getEntity(lost.campaignState.engineerId).hp = 0;
  updateCampaign(lost, 13, 0);
  assert.equal(lost.status, 'defeat');
  const late = createCampaignGame(13);
  late.campaignState.elapsed = late.campaignState.deadline - 1;
  updateCampaign(late, 13, 1);
  assert.equal(late.status, 'defeat');
});

test('Iron Current funds a real reserve, then holds the freight relay through an assault', () => {
  const game = createCampaignGame(14, 'normal');
  const state = game.campaignState;
  const relay = game.relays.find(item => item.id === state.relayId);
  const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  assert.ok(yard && game.buildings.some(building => building.owner === 'player' && building.defId === 'factory'));
  assert.ok(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'harvester').length >= 2);
  assert.ok(game.credits.player < state.reserveTarget);
  game.credits.player = state.reserveTarget;
  updateCampaign(game, 14, 0);
  assert.equal(state.phase, 'hold-freight');
  assert.equal(state.reserveCommitted, true);
  assert.ok(game.getEntity(state.reserveGuardUnitId), 'the committed reserve deploys a home guard');
  assert.equal(game.credits.player, 0, 'the reserve is spent rather than simply checked');
  relay.owner = 'player';
  state.holdElapsed = 9;
  relay.contested = true;
  updateCampaign(game, 14, 1);
  assert.equal(state.holdElapsed, 0, 'an enemy contest interrupts the hold');
  relay.contested = false;
  state.elapsed = 34;
  updateCampaign(game, 14, 1);
  assert.equal(state.assaultWaveOneFired, true);
  assert.ok(game.units.some(unit => unit.owner === 'enemy' && unit.order?.targetId ===
    game.buildings.find(building => building.owner === 'player' && building.defId === 'refinery').id));
  assert.equal(game.status, 'playing');
  state.elapsed = 54;
  updateCampaign(game, 14, 1);
  assert.equal(state.assaultWaveTwoFired, true);
  assert.equal(game.status, 'playing');
  state.elapsed = 70;
  updateCampaign(game, 14, 0);
  assert.equal(state.assaultWaveThreeFired, true);
  assert.deepEqual(game.getEntity(state.assaultWaveThreeUnitId).order, {
    type: 'move', x: relay.x, y: relay.y, attackMove: true,
  }, 'v55 final armor attacks the freight relay rather than the command yard');
  assert.ok(game.getEntity(state.assaultWaveThreeEscortUnitId), 'the relay push has a live escort');
  game.getEntity(state.assaultWaveThreeEscortUnitId).hp = 0;
  game.getEntity(state.assaultWaveThreeUnitId).hp = 0;
  state.holdElapsed = state.holdDuration - 1;
  state.postAssaultHoldElapsed = state.postAssaultHoldDuration - 1;
  updateCampaign(game, 14, 1);
  assert.equal(state.assaultWaveThreeFired, true);
  assert.equal(game.status, 'playing', 'the final hold starts after the initial 22-second hold');
  updateCampaign(game, 14, 10);
  updateCampaign(game, 14, 2);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignResult.mission, 'iron-current');
  assert.equal(game.campaignResult.keyAssetSurvived, true);
});

test('Iron Current v55 makes the freight relay a contested objective while v54 and unmarked saves retain prior rules', () => {
  const run = (version, orders = false) => {
    const game = createCampaignGame(14, 'normal', 123, 'standard', 'none', 'none', 'none', 'none', null, version);
    let ordered = false;
    for (let i = 0; i < 450 * 30 && game.status === 'playing'; i++) {
      game.update(1 / 30);
      updateCampaign(game, 14, 1 / 30, version);
      if (orders && !ordered && game.campaignState.reserveCommitted) {
        const guardId = game.campaignState.reserveGuardUnitId;
        game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester' &&
          unit.id !== guardId).map(unit => unit.id));
        assert.deepEqual(game.issueMove(game.relays[2].x, game.relays[2].y, true), { ok: true });
        ordered = true;
      }
    }
    return { game, ordered };
  };

  const oldReplay = run(54).game;
  assert.equal(oldReplay.status, 'victory', 'v54 replay keeps its previous no-command completion');
  assert.equal(oldReplay.campaignState.ironCurrentRulesVersion, undefined);
  assert.match(oldReplay.mission.objective, /destroy the final Vesper tank/i);

  const currentNoOrders = run(55).game;
  assert.equal(currentNoOrders.status, 'defeat', 'Vesper captures the undefended relay and cuts the route');
  assert.ok(currentNoOrders.campaignState.elapsed >= 89.9,
    'the enemy relay cut-off starts after the final assault arrives at 70 seconds');
  assert.equal(currentNoOrders.events.filter(event => event.type === 'order' && event.ids?.some(id =>
    currentNoOrders.getEntity(id)?.owner === 'player')).length, 0);
  assert.equal(currentNoOrders.events.filter(event => event.type === 'defeat').at(-1).reason,
    'Vesper seized the freight relay and cut the supply line.');

  const ordered = run(55, true);
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.game.status, 'victory', 'a public attack-move to the relay wins on Normal');
  assert.ok(ordered.game.campaignState.postAssaultHoldElapsed + 1e-6 >= ordered.game.campaignState.postAssaultHoldDuration);

  const legacySave = createCampaignGame(14, 'normal', 123);
  delete legacySave.campaignState.ironCurrentRulesVersion;
  for (let i = 0; i < 450 * 30 && legacySave.status === 'playing'; i++) {
    legacySave.update(1 / 30);
    updateCampaign(legacySave, 14, 1 / 30);
  }
  assert.equal(legacySave.status, 'victory', 'an unmarked saved mission keeps its old wave and reserve behavior');
});

test('Iron Current can be won with public orders and replays identically after a mid-mission save', () => {
  const game = createCampaignGame(14, 'normal', 123);
  let ordered = false;
  for (let i = 0; i < 450 * 30 && game.status === 'playing' && !ordered; i++) {
    game.update(1 / 30);
    updateCampaign(game, 14, 1 / 30);
    if (game.campaignState.reserveCommitted) {
      const guardId = game.campaignState.reserveGuardUnitId;
      game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester' &&
        unit.id !== guardId).map(unit => unit.id));
      assert.equal(game.issueMove(game.relays[2].x, game.relays[2].y, true).ok, true);
      ordered = true;
    }
  }
  assert.equal(ordered, true);
  assert.equal(game.campaignState.phase, 'hold-freight');
  const loaded = Game.deserialize(game.serialize());
  for (const run of [game, loaded]) {
    for (let i = 0; i < 450 * 30 && run.status === 'playing'; i++) {
      run.update(1 / 30);
      updateCampaign(run, 14, 1 / 30);
    }
    assert.equal(run.status, 'victory');
    assert.equal(run.campaignState.reserveCommitted, true);
    assert.equal(run.campaignState.assaultWaveOneFired, true);
    assert.equal(run.campaignState.assaultWaveTwoFired, true);
  }
  assert.deepEqual(loaded.campaignResult, game.campaignResult);
  assert.ok(game.kills.player > 0, 'the relay force fought live defenders');
});

test('Iron Current starting force cannot win before all three counterattacks and the final hold', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const seed of [1, 206590, 987654321]) {
      const game = createCampaignGame(14, difficulty, seed);
      game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester').map(unit => unit.id));
      assert.equal(game.issueMove(game.relays[2].x, game.relays[2].y, true).ok, true);

      for (let i = 0; i < 900 && game.status === 'playing'; i++) {
        game.update(0.2);
        updateCampaign(game, 14, 0.2);
      }

      assert.equal(game.campaignState.assaultWaveOneFired, true);
      assert.equal(game.campaignState.assaultWaveTwoFired, true);
      assert.equal(game.campaignState.assaultWaveThreeFired, true);
      if (game.status === 'victory') {
        assert.equal(game.campaignState.reserveCommitted, true);
        assert.ok(game.campaignState.holdElapsed + 1e-6 >= game.campaignState.holdDuration);
        assert.ok(game.campaignState.postAssaultHoldElapsed + 1e-6 >= game.campaignState.postAssaultHoldDuration);
        assert.equal(game.campaignResult.keyAssetSurvived, true);
      }
    }
  }
});

test('Iron Current requires a fresh 12-second relay hold after the initial hold and final tank are complete', () => {
  const game = createCampaignGame(14);
  const state = game.campaignState;
  const relay = game.relays.find(item => item.id === state.relayId);
  state.reserveCommitted = true;
  state.phase = 'hold-freight';
  state.assaultWaveThreeFired = true;
  state.assaultWaveThreeEscortUnitId = null;
  state.holdElapsed = 0;
  state.postAssaultHoldElapsed = 0;
  relay.owner = 'player';
  relay.contested = false;

  // The final tank is absent, so killing it early cannot satisfy the later hold.
  for (const dt of [10, 10, 2]) updateCampaign(game, 14, dt);
  assert.equal(state.holdElapsed, 22);
  assert.equal(state.postAssaultHoldElapsed, 0);
  assert.equal(game.status, 'playing');

  updateCampaign(game, 14, 10);
  relay.contested = true;
  updateCampaign(game, 14, 5);
  assert.equal(state.postAssaultHoldElapsed, 0, 'contesting the relay resets the final hold');
  relay.contested = false;
  for (const dt of [10, 10, 2]) updateCampaign(game, 14, dt);
  assert.equal(state.postAssaultHoldElapsed, 0, 'the initial hold must be repeated after losing the relay');
  for (const dt of [10, 2]) updateCampaign(game, 14, dt);
  assert.equal(game.status, 'victory');
});

test('Iron Current legacy replay rules preserve the pre-v15 overlapping hold timer', () => {
  const game = createCampaignGame(14);
  const state = game.campaignState;
  const relay = game.relays.find(item => item.id === state.relayId);
  state.reserveCommitted = true;
  state.phase = 'hold-freight';
  state.assaultWaveThreeFired = true;
  relay.owner = 'player';
  relay.contested = false;

  for (const dt of [10, 10, 2]) updateCampaign(game, 14, dt, 14);
  assert.equal(state.postAssaultHoldElapsed, 22);
  assert.equal(game.status, 'victory');
});

test('Iron Current uses the committed reserve to defend the yard while the force holds the relay', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const seed of [1, 206590, 987654321]) {
      const game = createCampaignGame(14, difficulty, seed);
      let orderedAssault = false;
      let orderedFinalTank = false;
      for (let i = 0; i < 900 && game.status === 'playing'; i++) {
        game.update(0.2);
        updateCampaign(game, 14, 0.2);
        if (!orderedAssault && game.campaignState.reserveGuardUnitId) {
          const guardId = game.campaignState.reserveGuardUnitId;
          assert.ok(game.getEntity(guardId));
          game.select(game.units.filter(unit => unit.owner === 'player' &&
            unit.defId !== 'harvester' && unit.id !== guardId).map(unit => unit.id));
          assert.equal(game.issueMove(game.relays[2].x, game.relays[2].y, true).ok, true);
          orderedAssault = true;
        }
        if (!orderedFinalTank && game.campaignState.assaultWaveThreeFired &&
            game.getEntity(game.campaignState.assaultWaveThreeUnitId)?.hp > 0) {
          const guardId = game.campaignState.reserveGuardUnitId;
          game.select(game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
            unit.defId !== 'harvester' && unit.id !== guardId).map(unit => unit.id));
          if (game.selection.length) {
            assert.equal(game.issueMove(game.relays[2].x, game.relays[2].y, true).ok, true);
            orderedFinalTank = true;
          }
        }
      for (const building of game.buildings.filter(item => item.owner === 'player' &&
        item.hp < item.maxHp * 0.8 && !item.repairing)) {
        assert.equal(game.toggleRepair(building.id).ok, true);
      }
      }

      assert.equal(orderedAssault, true, `${difficulty}, seed ${seed} committed its reserve`);
      assert.equal(orderedFinalTank, true, `${difficulty}, seed ${seed} ordered a response to the final armor group`);
      assert.equal(game.status, 'victory', `${difficulty}, seed ${seed} remains winnable`);
      assert.equal(game.campaignState.assaultWaveOneFired, true);
      assert.equal(game.campaignState.assaultWaveTwoFired, true);
      assert.equal(game.campaignState.assaultWaveThreeFired, true);
      assert.ok(game.campaignState.postAssaultHoldElapsed + 1e-6 >= game.campaignState.postAssaultHoldDuration);
      assert.equal(game.campaignResult.keyAssetSurvived, true);
    }
  }
});

test('Iron Current loses when its command yard falls', () => {
  const game = createCampaignGame(14);
  game.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  updateCampaign(game, 14, 0);
  assert.equal(game.status, 'defeat');
});

test('Dawn of the Free command yard shield blocks damage and farming until relay hold completes', () => {
  const game = createCampaignGame(11, 'normal');
  const target = game.getEntity(game.campaignState.targetId);
  const attacker = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle');
  assert.equal(target.campaignShielded, true);
  const originalHp = target.hp;
  game._applyDamage(target, 500, 'explosive', 'player', attacker.id);
  game._applyDamage(target, 500, 'ion', 'player', attacker.id);
  assert.equal(target.hp, originalHp);
  assert.equal(attacker.xp, 0);
  assert.equal(game.salvageEarned.enemy, 0);
  assert.equal(game.events.some(event => event.type === 'vesperSalvage' && event.targetId === target.id), false);

  const loaded = Game.deserialize(game.serialize());
  const loadedTarget = loaded.getEntity(target.id);
  const loadedAttacker = loaded.getEntity(attacker.id);
  assert.equal(loadedTarget.campaignShielded, true);
  loaded._applyDamage(loadedTarget, 500, 'explosive', 'player', loadedAttacker.id);
  assert.equal(loadedTarget.hp, originalHp, 'shield state persists across save/reload');

  loaded.units = [];
  loaded.relays[0].owner = 'player';
  loaded.relays[1].owner = 'player';
  loaded.campaignState.holdElapsed = loaded.campaignState.holdDuration - 1;
  assert.equal(updateCampaign(loaded, 11, 1), false, 'phase transition does not complete the mission');
  assert.equal(loaded.campaignState.phase, 'destroy-command');
  assert.equal(loadedTarget.campaignShielded, false);
  const postPhaseAttacker = loaded._createUnit('player', 'rifle', 20.5, 31.5);
  loaded._applyDamage(loadedTarget, 100, 'explosive', 'player', postPhaseAttacker.id);
  assert.ok(loadedTarget.hp < originalHp);
  assert.ok(postPhaseAttacker.xp > 0);
});

test('server seeds vary campaign randomness without changing authored objectives or placements', () => {
  for (let index = 0; index < CAMPAIGN_MISSIONS.length; index++) {
    const first = createCampaignGame(index, 'normal', 12345);
    const second = createCampaignGame(index, 'normal', 67890);
    const placements = game => [...game.buildings, ...game.units]
      .map(({ owner, defId, x, y, w, h }) => ({ owner, defId, x, y, w, h }));

    assert.equal(first.seed, 12345);
    assert.equal(second.seed, 67890);
    assert.equal(first.campaignMission, index);
    assert.equal(second.campaignMission, index);
    assert.equal(first.mission.objective, CAMPAIGN_MISSIONS[index].objective);
    assert.equal(second.mission.objective, CAMPAIGN_MISSIONS[index].objective);
    assert.deepEqual(placements(first), placements(second), `mission ${index} authored forces`);

    const target = targetFor(first, index);
    assert.ok(target, `mission ${index} objective target exists`);
    if (target.id) assert.equal(second.getEntity(target.id)?.defId, target.defId);
  }
});

test('campaign medals distinguish command survival and pace, and persist with the completed save', () => {
  const game = createCampaignGame(5);
  // This medal scenario exercises the historical quiet route; v48 North now
  // requires the visible extraction intercept to be cleared before success.
  game.replayVersion = 47;
  const escort = game.getEntity(game.campaignState.escortId);
  const uplink = game.campaignState.transmissionUplinks[0];
  escort.x = uplink.x;
  escort.y = uplink.y;
  assert.equal(updateCampaign(game, 5, 8), false);
  assert.equal(game.campaignState.phase, 'extract-analyst');
  escort.x = game.campaignState.extraction.x;
  escort.y = game.campaignState.extraction.y;
  game.campaignState.elapsed = 240;
  assert.equal(updateCampaign(game, 5, 0), true);
  assert.deepEqual(game.campaignResult, {
    mission: 'ashes-in-transit', stars: 3, elapsed: 240,
    keyAssetSurvived: true, kills: 0,
    fieldOrderId: 'none', fieldOrderStatus: 'none',
    campaignVeteran: { defId: 'flamer', faction: 'vesper', veterancy: 1, promotion: null },
  });
  assert.deepEqual(Game.deserialize(game.serialize()).campaignResult, game.campaignResult);

  const slower = createCampaignGame(5);
  slower.replayVersion = 47;
  const slowerEscort = slower.getEntity(slower.campaignState.escortId);
  const slowerUplink = slower.campaignState.transmissionUplinks[0];
  slowerEscort.x = slowerUplink.x;
  slowerEscort.y = slowerUplink.y;
  assert.equal(updateCampaign(slower, 5, 8), false);
  slowerEscort.x = slower.campaignState.extraction.x;
  slowerEscort.y = slower.campaignState.extraction.y;
  slower.campaignState.elapsed = 301;
  updateCampaign(slower, 5, 0);
  assert.equal(slower.campaignResult.stars, 2);
  assert.equal(getCampaignResult(createCampaignGame(5)), null, 'unfinished operations have no medal result');
});

test('authored obstacles create navigable routes without trapping starting forces or objectives', () => {
  for (let index = 0; index < CAMPAIGN_MISSIONS.length; index++) {
    const game = createCampaignGame(index);
    const target = targetFor(game, index);
    assert.ok(target, `mission ${index} has its objective target`);
    const routes = game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester')
      .map(unit => game._findPath(unit.x, unit.y, target.x, target.y));
    if (index === 12) {
      assert.ok(routes.every(route => route.length === 0), 'the flooded channel has no ground route');
      assert.ok(game.terrain.every(row => row.slice(30, 37).every(tile =>
        tile.type === 'water' && !tile.walkable)), 'the full water barrier remains intact');
      assert.equal(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'dropship').length, 2);
    } else {
      assert.ok(routes.some(route => route.length > 0), `mission ${index} has a path to its objective`);
    }
    for (const unit of game.units) {
      assert.ok(game._isPassable(Math.floor(unit.x), Math.floor(unit.y)),
        `mission ${index} starts ${unit.defId} on passable ground`);
    }
    for (const building of game.buildings) {
      for (let y = building.y; y < building.y + building.h; y++) {
        for (let x = building.x; x < building.x + building.w; x++) {
          assert.equal(game.terrain[y][x].type, 'sand',
            `mission ${index} gives ${building.defId} a clear footprint`);
        }
      }
    }
  }
});

test('stormfront operation fails when the shelter or command yard is lost', () => {
  const game = createCampaignGame(7);
  game.buildings = game.buildings.filter(building => building.owner !== 'enemy');
  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId === 'harvester');
  const distantEnemyHarvester = game.units.find(unit => unit.owner === 'enemy');
  distantEnemyHarvester.x = 60.5; distantEnemyHarvester.y = 46.5;
  for (let tick = 0; tick < 500 && game.status === 'playing'; tick++) {
    game.update(0.2);
    updateCampaign(game, 7, 0.2);
  }
  assert.ok(game.storm.cycle >= 1);
  assert.equal(game.status, 'defeat');
  assert.equal(game.relays[0].owner, null);

  const lost = createCampaignGame(7);
  lost.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  assert.equal(updateCampaign(lost, 7, 0.1), false);
  assert.equal(lost.status, 'defeat');
});

test('relay operation requires two captures and a sustained hold', () => {
  assert.match(CAMPAIGN_MISSIONS[8].objective, /command yard standing/i,
    'the displayed objective includes the command yard survival condition');
  assert.match(CAMPAIGN_MISSIONS[8].objective, /first pair determines the reserve team/i,
    'the displayed objective explains why the chosen relay pair matters');
  const game = createCampaignGame(8);
  game.units = game.units.filter(unit => unit.owner === 'player');
  for (const relay of game.relays.slice(0, 2)) {
    game._createUnit('player', 'rifle', relay.x, relay.y);
    game._createUnit('player', 'rifle', relay.x + 0.2, relay.y);
  }
  game._updateRelays(25);
  assert.equal(game.relays.filter(relay => relay.owner === 'player').length, 2);
  updateCampaign(game, 8, 10);
  updateCampaign(game, 8, 10);
  assert.equal(game.status, 'playing', 'holding for less than 25 seconds does not complete the operation');
  game.relays[0].owner = null;
  updateCampaign(game, 8, 1);
  assert.equal(game.campaignState.holdElapsed, 0, 'losing either relay breaks the sustained hold');
  game.relays[0].owner = 'player';
  updateCampaign(game, 8, 10);
  updateCampaign(game, 8, 10);
  updateCampaign(game, 8, 5);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignState.relayPairChoice, 'yard-guard');

  const lost = createCampaignGame(8);
  lost.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  updateCampaign(lost, 8, 0.1);
  assert.equal(lost.status, 'defeat');
});

test('Three Points of Light locks a distinct relay-pair reserve, saves it, and preserves version 23 rules', () => {
  const cases = [
    { relays: [0, 1], choice: 'yard-guard', units: ['rocket', 'rifle'] },
    { relays: [1, 2], choice: 'eastern-armor', units: ['lightTank', 'rocket'] },
    { relays: [0, 2], choice: 'crossing-screen', units: ['scout', 'buggy'] },
  ];
  for (const scenario of cases) {
    const game = createCampaignGame(8, 'normal', 9182);
    for (const index of scenario.relays) game.relays[index].owner = 'player';
    updateCampaign(game, 8, 0);
    assert.equal(game.campaignState.relayPairChoice, scenario.choice);
    const ids = game.campaignState.relayReserveUnitIds;
    assert.deepEqual(ids.map(id => game.getEntity(id).defId), scenario.units);
    updateCampaign(game, 8, 0);
    assert.equal(game.campaignState.relayReserveUnitIds.length, 2, 'the reserve is one-shot');
    const loaded = Game.deserialize(game.serialize());
    assert.equal(loaded.campaignState.relayPairChoice, scenario.choice);
    assert.deepEqual(loaded.campaignState.relayReserveUnitIds, ids);
    assert.deepEqual(ids.map(id => loaded.getEntity(id).defId), scenario.units);
  }

  const legacy = createCampaignGame(8, 'normal', 9182);
  legacy.relays[0].owner = 'player';
  legacy.relays[1].owner = 'player';
  updateCampaign(legacy, 8, 0, 23);
  assert.equal(legacy.campaignState.relayPairChoice, 'none');
  assert.deepEqual(legacy.campaignState.relayReserveUnitIds, []);
});

test('Three Points of Light alternate pairs are reachable with public attack-move orders', () => {
  const cases = [
    { relays: [1, 2], choice: 'eastern-armor', groups: [[['rifle', 'buggy'], 1], [['scout', 'lightTank', 'rocket'], 2]] },
    { relays: [0, 2], choice: 'crossing-screen', groups: [[['rifle', 'buggy'], 0], [['scout', 'lightTank', 'rocket'], 2]] },
  ];
  for (const scenario of cases) {
    const game = createCampaignGame(8, 'normal', 1001);
    for (const [definitions, relayIndex] of scenario.groups) {
      const units = game.units.filter(unit => unit.owner === 'player' && definitions.includes(unit.defId));
      game.select(units.map(unit => unit.id));
      assert.equal(game.issueMove(game.relays[relayIndex].x, game.relays[relayIndex].y, true).ok, true);
    }
    for (let tick = 0; tick < 600 && game.status === 'playing' &&
        game.campaignState.relayPairChoice === 'none'; tick++) {
      game.update(0.5);
      updateCampaign(game, 8, 0.5);
    }
    assert.equal(game.campaignState.relayPairChoice, scenario.choice);
    assert.deepEqual(game.campaignState.relayReserveUnitIds.map(id => game.getEntity(id).owner),
      ['player', 'player']);
  }
});

test('relay holds stop while an enemy contests a captured relay', () => {
  for (const index of [8, 11]) {
    const game = createCampaignGame(index, 'normal');
    for (const relay of game.relays.slice(0, 2)) relay.owner = 'player';
    game.relays[1].contested = true;

    updateCampaign(game, index, 10);
    assert.equal(game.campaignState.holdElapsed, 0, `mission ${index} does not count a contested relay`);
    assert.equal(game.status, 'playing');
    if (index === 11) assert.equal(game.campaignState.phase, 'secure-relays');

    game.relays[1].contested = false;
    updateCampaign(game, index, 10);
    assert.equal(game.campaignState.holdElapsed, 10);
  }
});

test('assassination operation tracks the named signal chief and enforces its deadline', () => {
  const game = createCampaignGame(9);
  const target = game.getEntity(game.campaignState.targetId);
  assert.equal(target.defId, 'engineer');
  assert.equal(game.units.some(unit => unit.owner === 'enemy' && unit.defId === 'stealthTank'), true);
  game._applyDamage(target, target.hp * 2, 'explosive', 'player');
  assert.equal(updateCampaign(game, 9, 0.1), true);
  assert.equal(game.status, 'victory');

  const escaped = createCampaignGame(9);
  escaped.campaignState.elapsed = 299;
  updateCampaign(escaped, 9, 1);
  assert.equal(escaped.status, 'defeat');
});

test('Quiet Knife needs an ordered strike on the chief across difficulties and seeds', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 5, 167706]) {
    const idle = createCampaignGame(9, difficulty, seed);
    const chief = idle.getEntity(idle.campaignState.targetId);
    runCampaignIdle(idle, 9);
    assert.equal(idle.status, 'defeat', `${difficulty} seed ${seed} idle`);
    assert.ok(chief.hp > 0, 'the unarmed chief remains sheltered at the outpost');

    const game = createCampaignGame(9, difficulty, seed);
    const orderedChief = game.getEntity(game.campaignState.targetId);
    game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester')
      .map(unit => unit.id));
    assert.equal(game.issueMove(52.5, 22.5, true).ok, true);
    let strikeOrdered = false;
    for (let tick = 0; tick < 600 && game.status === 'playing'; tick++) {
      game.update(0.2);
      if (!strikeOrdered && game.visibleEnemies.some(unit => unit.id === orderedChief.id)) {
        game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester')
          .map(unit => unit.id));
        assert.equal(game.issueAttack(orderedChief.id).ok, true,
          `${difficulty} seed ${seed} can order the visible signal chief directly`);
        strikeOrdered = true;
      }
      updateCampaign(game, 9, 0.2);
    }
    assert.equal(strikeOrdered, true, `${difficulty} seed ${seed} spots the chief`);
    assert.equal(game.status, 'victory', `${difficulty} seed ${seed} ordered strike`);
    assert.ok(!game.getEntity(orderedChief.id));
  }
});

test('Quiet Knife version 34 warns then sends the chief to a winnable extraction route', () => {
  assert.match(CAMPAIGN_MISSIONS[9].briefing, /once spotted, the chief will flee for the southeast extraction zone/i);
  assert.match(CAMPAIGN_MISSIONS[9].objective, /issue a direct attack to intercept/i);
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 5, 167706, 481516]) {
    const game = createCampaignGame(9, difficulty, seed);
    const chief = game.getEntity(game.campaignState.targetId);
    const armed = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      unit.defId !== 'harvester');
    game.select(armed().map(unit => unit.id));
    assert.equal(game.issueMove(52.5, 22.5, true).ok, true);
    let attackOrdered = false;
    for (let tick = 0; tick < 200 && game.status === 'playing'; tick++) {
      game.update(0.2);
      if (!attackOrdered && game.visibleEnemies.some(unit => unit.id === chief.id)) {
        game.select(armed().map(unit => unit.id));
        assert.equal(game.issueAttack(chief.id).ok, true, `${difficulty} seed ${seed} intercept order`);
        attackOrdered = true;
      }
      updateCampaign(game, 9, 0.2, 34);
    }

    assert.equal(attackOrdered, true, `${difficulty} seed ${seed} discovers the chief`);
    assert.equal(game.campaignState.chiefEscapePhase, 'intercepted', `${difficulty} seed ${seed} stops the escape`);
    assert.ok(game.events.some(event => event.type === 'campaignIntel' &&
      /running for the southeast extraction zone/i.test(event.message)), `${difficulty} seed ${seed} gets the warning`);
    assert.ok(game.status === 'victory', `${difficulty} seed ${seed} wins after a direct interception order`);
    assert.ok(!game.getEntity(chief.id));
  }
});

test('Quiet Knife lets the chief escape if the player does not issue a direct interception order', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 167706]) {
    const game = createCampaignGame(9, difficulty, seed);
    const armed = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      unit.defId !== 'harvester');
    game.select(armed.map(unit => unit.id));
    assert.equal(game.issueMove(52.5, 22.5, true).ok, true);
    for (let tick = 0; tick < 200 && game.status === 'playing'; tick++) {
      game.update(0.2);
      updateCampaign(game, 9, 0.2, 34);
    }
    assert.equal(game.status, 'defeat', `${difficulty} seed ${seed} escape is a recoverable response check`);
    assert.equal(game.campaignState.chiefEscapePhase, 'escaped');
    assert.ok(game.campaignState.elapsed < game.campaignState.deadline,
      `${difficulty} seed ${seed} escape precedes the 300-second safety deadline`);
    assert.match(game.events.filter(event => event.type === 'defeat').at(-1).reason,
      /southeast extraction zone/i);
  }
});

test('Quiet Knife escape warning, route, and phase survive a mid-run save', () => {
  const game = createCampaignGame(9, 'normal', 481516);
  const chief = game.getEntity(game.campaignState.targetId);
  const armed = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    unit.defId !== 'harvester');
  game.select(armed().map(unit => unit.id));
  assert.equal(game.issueMove(52.5, 22.5, true).ok, true);
  for (let tick = 0; tick < 200 && game.campaignState.chiefEscapePhase !== 'escaping'; tick++) {
    game.update(0.2);
    updateCampaign(game, 9, 0.2, 34);
  }
  assert.equal(game.campaignState.chiefEscapePhase, 'escaping');
  assert.deepEqual([chief.order.x, chief.order.y], [QUIET_KNIFE_ESCAPE.x, QUIET_KNIFE_ESCAPE.y]);
  assert.equal(game.campaignState.chiefEscapeDelayRemaining, 0);

  const loaded = Game.deserialize(game.serialize());
  const restoredChief = loaded.getEntity(chief.id);
  assert.equal(loaded.campaignState.chiefEscapePhase, 'escaping');
  assert.deepEqual([restoredChief.order.x, restoredChief.order.y], [QUIET_KNIFE_ESCAPE.x, QUIET_KNIFE_ESCAPE.y]);
  assert.equal(loaded.events.filter(event => event.type === 'campaignIntel' &&
    /running for the southeast extraction zone/i.test(event.message)).length, 1);

  for (const run of [game, loaded]) {
    const target = run.getEntity(chief.id);
    run.select(run.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      unit.defId !== 'harvester').map(unit => unit.id));
    assert.equal(run.issueAttack(target.id).ok, true);
    for (let tick = 0; tick < 200 && run.status === 'playing'; tick++) {
      run.update(0.2);
      updateCampaign(run, 9, 0.2, 34);
    }
    assert.equal(run.status, 'victory');
  }
  assert.deepEqual(loaded.campaignResult, game.campaignResult);
});

test('Quiet Knife replay versions through 33 keep the chief stationary after discovery', () => {
  for (const replayVersion of [1, 33]) {
    const game = createCampaignGame(9, 'normal', 481516);
    const chief = game.getEntity(game.campaignState.targetId);
    const originalPosition = [chief.x, chief.y];
    const armed = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      unit.defId !== 'harvester');
    game.select(armed.map(unit => unit.id));
    assert.equal(game.issueMove(52.5, 22.5, true).ok, true);
    let spotted = false;
    for (let tick = 0; tick < 160 && !spotted; tick++) {
      game.update(0.2);
      spotted = game.isVisible(chief);
      updateCampaign(game, 9, 0.2, replayVersion);
    }
    assert.equal(spotted, true, `version ${replayVersion} reveals the chief`);
    assert.equal(game.campaignState.chiefEscapePhase, undefined,
      `version ${replayVersion} does not create new escape state`);
    assert.deepEqual([chief.x, chief.y], originalPosition,
      `version ${replayVersion} preserves the old stationary target`);
    assert.equal(game.events.some(event => event.type === 'campaignIntel' &&
      /running for the southeast extraction zone/i.test(event.message)), false);
  }
});

test('fallback defense survives loss of the forward yard but fails if the beacon is destroyed', () => {
  const game = createCampaignGame(10);
  game.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  game.campaignState.elapsed = 119;
  updateCampaign(game, 10, 1);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignResult.keyAssetSurvived, true);

  const lost = createCampaignGame(10);
  lost.getEntity(lost.campaignState.fallbackId).hp = 0;
  updateCampaign(lost, 10, 0.1);
  assert.equal(lost.status, 'defeat');
});

test('Last Ember reinforcement waves fire once on schedule and persist across save reload', () => {
  let game = createCampaignGame(10, 'normal', 7654321);
  const fallbackId = game.campaignState.fallbackId;
  const initialIds = new Set(game.units.map(unit => unit.id));
  const advanceTo = (targetTime) => {
    while (game.campaignState.elapsed < targetTime) {
      updateCampaign(game, 10, Math.min(10, targetTime - game.campaignState.elapsed));
    }
  };

  advanceTo(25.9);
  assert.equal(game.campaignState.assaultWaveOneFired, false);
  advanceTo(26);
  assert.equal(game.campaignState.assaultWaveOneFired, true);
  let wave = game.units.filter(unit => !initialIds.has(unit.id));
  assert.deepEqual(wave.map(unit => unit.defId), ['rifle', 'buggy']);
  assert.ok(wave.every(unit => unit.owner === 'enemy' && unit.order.targetId === fallbackId));
  assert.equal(game.events.at(-1).message, 'Aegis assault team breached the western pass.');

  game = Game.deserialize(game.serialize());
  const waveOneIds = new Set(game.units.map(unit => unit.id));
  advanceTo(66);
  assert.equal(game.campaignState.assaultWaveOneFired, true);
  assert.equal(game.campaignState.assaultWaveTwoFired, true);
  wave = game.units.filter(unit => !waveOneIds.has(unit.id));
  assert.deepEqual(wave.map(unit => unit.defId), ['lightTank', 'lightTank', 'rifle', 'rocket']);
  assert.ok(wave.every(unit => unit.owner === 'enemy' && unit.order.targetId === fallbackId));
  assert.equal(game.events.at(-1).message, 'Aegis heavy relief column is attacking the fallback beacon.');

  const beforeRelief = new Set(game.units.map(unit => unit.id));
  advanceTo(88);
  assert.equal(game.campaignState.reliefSquadFired, true);
  wave = game.units.filter(unit => !beforeRelief.has(unit.id));
  assert.deepEqual(wave.map(unit => unit.defId), ['flamer', 'flamer', 'rocket']);
  assert.ok(wave.every(unit => unit.owner === 'player' && unit.faction === 'vesper' && unit.order.type === 'guard'));
  assert.equal(game.events.at(-1).message, 'Vesper relief squad reached the fallback beacon.');

  const beforeFinalColumn = new Set(game.units.map(unit => unit.id));
  advanceTo(100);
  assert.equal(game.campaignState.assaultWaveThreeFired, true);
  wave = game.units.filter(unit => !beforeFinalColumn.has(unit.id));
  assert.deepEqual(wave.map(unit => unit.defId), ['lightTank', 'lightTank', 'rocket']);
  assert.ok(wave.every(unit => unit.owner === 'enemy' && unit.order.targetId === fallbackId));
  assert.equal(game.events.at(-1).message, 'Aegis final column is pushing through the western pass.');

  game = Game.deserialize(game.serialize());
  const beforeRepeat = game.units.length;
  advanceTo(101);
  assert.equal(game.units.length, beforeRepeat, 'already-fired waves must not spawn again');
});

function simulateLastEmber(game) {
  for (let tick = 0; tick < 1200 && game.status === 'playing'; tick++) {
    game.update(0.1);
    updateCampaign(game, 10, 0.1);
  }
}

test('Last Ember idle defenses lose the beacon across difficulties and seeds', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 2, 3, 4, 5]) {
    const game = createCampaignGame(10, difficulty, seed);
    simulateLastEmber(game);
    assert.equal(game.status, 'defeat', `${difficulty} seed ${seed}`);
    assert.ok(!game.getEntity(game.campaignState.fallbackId), 'destroyed beacon is removed from the battlefield');
  }
});

test('Last Ember can be defended through public commands on normal and hard', () => {
  for (const difficulty of ['normal', 'hard']) for (const seed of [1, 2, 3, 4, 5]) {
    const game = createCampaignGame(10, difficulty, seed);
    const beacon = game.getEntity(game.campaignState.fallbackId);
    const defenders = game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester');
    game.select(defenders.map(unit => unit.id));
    assert.deepEqual(game.issueMove(17, 33, true), { ok: true });
    assert.deepEqual(game.toggleRepair(beacon.id), { ok: true, active: true });
    for (const type of ['barracks', 'factory']) {
      const building = game.buildings.find(item => item.owner === 'player' && item.defId === type);
      assert.deepEqual(game.setRally(building.id, 16.5, 33.5), { ok: true });
    }
    for (const defId of ['rocket', 'rocket', 'lightTank']) {
      assert.equal(game.queueUnit(defId).ok, true);
    }
    simulateLastEmber(game);
    assert.equal(game.status, 'victory', `${difficulty} seed ${seed}`);
    assert.ok(beacon.hp > 0);
    assert.equal(game.campaignState.assaultWaveThreeFired, true);
  }
});

test('both economy operations have nearby harvestable crystal and legal expansion ground', () => {
  for (const index of [0, 4]) {
    const game = createCampaignGame(index);
    const harvesters = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'harvester');
    assert.ok(harvesters.length >= (index === 4 ? 2 : 1));
    assert.ok(game.canBuild('refinery').ok);
    assert.ok(game.credits.player < (index === 4 ? 4800 : 2200) + game.buildingDefs.refinery.cost,
      'the objective requires earning credits rather than only spending the starting treasury');
    const field = game.terrain.flatMap((row, y) => row.map((tile, x) => ({ x, y, tile })))
      .filter(({ x, y, tile }) => tile.resource > 0 && harvesters.some(unit =>
        Math.hypot(unit.x - x - 0.5, unit.y - y - 0.5) < 8));
    assert.ok(field.reduce((sum, entry) => sum + entry.tile.resource, 0) > 12000,
      `mission ${index} has enough local crystal for the second refinery and reserve`);
    let expansion = null;
    for (let y = 0; y < game.height && !expansion; y++) for (let x = 0; x < game.width; x++) {
      if (game.canPlaceBuilding('refinery', x, y).ok) { expansion = { x, y }; break; }
    }
    assert.ok(expansion, `mission ${index} has a buildable second refinery site`);
  }
});

test('First Harvest v53 economy playback requires the second refinery to finish and come online', () => {
  const game = createCampaignGame(0, 'normal', 1, 'standard', 'none', 'none', 'none', 'none', null, 53);
  let site = null;
  for (let y = 0; y < game.height && !site; y++) for (let x = 0; x < game.width; x++) {
    if (game.canPlaceBuilding('refinery', x, y).ok) { site = { x, y }; break; }
  }
  assert.ok(site);
  const order = game.issueBuild('refinery', site.x, site.y);
  assert.equal(order.ok, true);
  const refinery = game.getEntity(order.id);

  for (let tick = 0; tick < 200 && game.credits.player < 2200; tick++) {
    game.update(0.2);
    updateCampaign(game, 0, 0.2);
  }
  assert.ok(game.credits.player >= 2200, 'harvesting reaches the credit threshold');
  assert.ok(refinery.progress < 1, 'the newly placed refinery is still under construction');
  assert.equal(refinery.powered, false);
  assert.equal(game.status, 'playing', 'an unfinished refinery cannot complete the objective');

  for (let tick = 0; tick < 300 && game.status === 'playing'; tick++) {
    game.update(0.2);
    updateCampaign(game, 0, 0.2);
  }
  assert.equal(refinery.progress, 1);
  assert.equal(refinery.powered, true);
  assert.equal(game.status, 'victory', 'the objective completes once the second refinery is operational');
});

test('Red Ledger does not count an unfinished second refinery toward its reserve objective', () => {
  const game = createCampaignGame(4, 'normal', 1);
  assert.match(game.mission.objective, /keep your field command post standing/i,
    'the displayed objective includes the field command post survival condition');
  let site = null;
  for (let y = 0; y < game.height && !site; y++) for (let x = 0; x < game.width; x++) {
    if (game.canPlaceBuilding('refinery', x, y).ok) { site = { x, y }; break; }
  }
  assert.ok(site);
  const order = game.issueBuild('refinery', site.x, site.y);
  assert.equal(order.ok, true);
  const refinery = game.getEntity(order.id);
  game.credits.player = 4800;
  updateCampaign(game, 4, 0);

  assert.ok(refinery.progress < 1);
  assert.equal(game.status, 'playing', 'the reserve threshold cannot substitute for a completed refinery');

  updateCampaign(game, 4, 0, 3);
  assert.equal(game.status, 'victory', 'version 3 playback preserves the historical objective result');
});

test('refinery construction and harvesting complete both timed and untimed economy goals', () => {
  for (const index of [0, 4]) {
    const game = createCampaignGame(index, 'normal');
    if (index === 0) game.replayVersion = 53;
    let site = null;
    for (let y = 0; y < game.height && !site; y++) for (let x = 0; x < game.width; x++) {
      if (game.canPlaceBuilding('refinery', x, y).ok) { site = { x, y }; break; }
    }
    assert.equal(game.startConstruction('refinery').ok, true);
    for (let tick = 0; tick < 1200 && game.status === 'playing'; tick++) {
      game.update(0.2);
      if (game.construction?.ready) {
        assert.equal(game.issueBuild('refinery', site.x, site.y).ok, true);
      }
      updateCampaign(game, index, 0.2);
    }
    assert.equal(game.status, 'victory', `mission ${index} can fund its objective through harvesting`);
    if (index === 4) assert.ok(game.campaignState.elapsed < game.campaignState.deadline);
  }
});

test('Red Ledger public economy route holds up across difficulty and seed variation', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 2, 5, 167706]) {
    const game = createCampaignGame(4, difficulty, seed);
    let site = null;
    for (let y = 0; y < game.height && !site; y++) for (let x = 0; x < game.width; x++) {
      if (game.canPlaceBuilding('refinery', x, y).ok) { site = { x, y }; break; }
    }
    assert.ok(site, `${difficulty} seed ${seed} has an expansion site`);
    assert.equal(game.startConstruction('refinery').ok, true);
    const assault = game.units.filter(unit => unit.owner === 'player' &&
      !['harvester', 'engineer'].includes(unit.defId));
    game.select(assault.map(unit => unit.id));
    assert.equal(game.issueMove(25, 24, true).ok, true);

    for (let tick = 0; tick < 1800 && game.status === 'playing'; tick++) {
      if (game.construction?.ready && site) {
        assert.equal(game.issueBuild('refinery', site.x, site.y).ok, true);
        site = null;
      }
      game.update(0.2);
      updateCampaign(game, 4, 0.2);
    }

    assert.equal(game.status, 'victory', `${difficulty} seed ${seed}`);
    assert.ok(game.campaignState.elapsed < game.campaignState.deadline);
    assert.ok(game.kills.player > 0, `${difficulty} seed ${seed} engaged the patrols`);
  }
});

test('Red Ledger courier cache is an optional, save-safe 700 credit reward', () => {
  const game = createCampaignGame(4);
  const courier = game.getEntity(game.campaignState.courierId);
  assert.equal(courier?.defId, 'buggy');
  assert.match(game.mission.objective, /Optional: destroy the courier buggy for 700 credits/);

  courier.hp = 0;
  updateCampaign(game, 4, 0);
  assert.equal(game.credits.player, 3200);
  assert.equal(game.campaignState.courierRewardClaimed, true);
  assert.ok(game.events.some(event => event.type === 'campaignIntel' && event.reward === 700));

  const loaded = Game.deserialize(game.serialize());
  updateCampaign(loaded, 4, 0);
  assert.equal(loaded.credits.player, 3200, 'loading cannot claim the cache twice');
  assert.equal(loaded.campaignState.courierRewardClaimed, true);
});

test('facing the eastern approach and repairing can hold Last Light through the assault', () => {
  const game = createCampaignGame(2, 'normal');
  const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  game.select([tank.id]);
  assert.equal(game.issueMove(36, 33, true).ok, true);
  for (let tick = 0; tick < 1000 && game.status === 'playing'; tick++) {
    for (const building of game.buildings.filter(building => building.owner === 'player' &&
      building.hp < building.maxHp * 0.8 && !building.repairing)) {
      assert.equal(game.toggleRepair(building.id).ok, true);
    }
    game.update(0.2);
    updateCampaign(game, 2, 0.2, 41);
  }
  assert.equal(game.status, 'victory');
  assert.ok(yard.hp > 0);
  assert.ok(game.campaignState.elapsed >= 180);
});

test('Last Light version 42 can end early by destroying the eastern flank, while version 41 keeps the timer', () => {
  assert.match(CAMPAIGN_MISSIONS[2].objective, /destroy the eastern flank force/i);
  const prepareFlank = replayVersion => {
    const game = createCampaignGame(2, 'normal', 17);
    game.campaignState.elapsed = 149;
    updateCampaign(game, 2, 1, replayVersion);
    assert.equal(game.campaignState.lastLightFlankFired, true);
    assert.equal(game.campaignState.lastLightFlankUnitIds.length, 3);
    return game;
  };

  const current = prepareFlank(42);
  const resumed = Game.deserialize(current.serialize());
  assert.deepEqual(resumed.campaignState.lastLightFlankUnitIds, current.campaignState.lastLightFlankUnitIds);
  for (const id of resumed.campaignState.lastLightFlankUnitIds) resumed.getEntity(id).hp = 0;
  assert.equal(updateCampaign(resumed, 2, 0, 42), true);
  assert.equal(resumed.status, 'victory');
  assert.equal(resumed.campaignState.elapsed, 150);

  const legacy = prepareFlank(41);
  for (const id of legacy.campaignState.lastLightFlankUnitIds) legacy.getEntity(id).hp = 0;
  assert.equal(updateCampaign(legacy, 2, 0, 41), false);
  assert.equal(legacy.status, 'playing');
  legacy.campaignState.elapsed = 179;
  assert.equal(updateCampaign(legacy, 2, 1, 41), true);
  assert.equal(legacy.status, 'victory');
});

test('Last Light counterattack is reachable with public orders on each difficulty', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const game = createCampaignGame(2, difficulty, 17);
    const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
    const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
    const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
    assert.deepEqual(game.setRally(factory.id, 38, 33), { ok: true });
    assert.deepEqual(game.setRally(barracks.id, 38, 33), { ok: true });
    game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester')
      .map(unit => unit.id));
    assert.equal(game.issueMove(37, 31, true).ok, true);
    for (const defId of ['lightTank', 'lightTank', 'lightTank', 'rocket', 'rocket'])
      assert.equal(game.queueUnit(defId).ok, true);
    for (let tick = 0; tick < 1000 && game.status === 'playing'; tick++) {
      if (yard.hp < yard.maxHp * 0.4 && !yard.repairing)
        assert.equal(game.toggleRepair(yard.id).ok, true);
      game.update(0.2);
      updateCampaign(game, 2, 0.2, 42);
    }
    const flankIds = game.campaignState.lastLightFlankUnitIds || [];
    assert.equal(game.status, 'victory', `${difficulty} counterattack wins`);
    assert.ok(flankIds.length > 0, `${difficulty} waits for the authored eastern flank`);
    assert.ok(flankIds.every(id => !game.getEntity(id) || game.getEntity(id).hp <= 0),
      `${difficulty} defeats the entire tracked wave`);
    assert.ok(game.campaignState.elapsed < 180, `${difficulty} wins before the survival timer`);
    assert.ok(yard.hp > 0, `${difficulty} protects the command yard`);
  }
});

function runCampaignIdle(game, index, seconds = 400) {
  for (let tick = 0; tick < seconds * 2 && game.status === 'playing'; tick++) {
    game.update(0.5);
    updateCampaign(game, index, 0.5);
  }
}

test('idle defense does not beat Last Light on any difficulty', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const game = createCampaignGame(2, difficulty);
    runCampaignIdle(game, 2, 180);
    assert.equal(game.status, 'defeat', `${difficulty} must lose without defending the yard`);
    assert.ok(game.campaignState.elapsed < 180);
  }
});

test('positioning the opening force and repairing holds Last Light on easy seeds', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const idle = createCampaignGame(2, 'easy', seed);
    runCampaignIdle(idle, 2, 180);
    assert.equal(idle.status, 'defeat', `seed ${seed} idle`);
    assert.equal(idle.campaignState.lastLightFlankFired, true);

    const game = createCampaignGame(2, 'easy', seed);
    game.select(game.units.filter(unit => unit.owner === 'player' &&
      ['rocket', 'lightTank'].includes(unit.defId))
      .map(unit => unit.id));
    assert.equal(game.issueMove(36, 33, true).ok, true);
    for (let tick = 0; tick < 360 && game.status === 'playing'; tick++) {
      for (const building of game.buildings.filter(item => item.owner === 'player' &&
        item.hp < item.maxHp * 0.8 && !item.repairing)) {
        assert.equal(game.toggleRepair(building.id).ok, true);
      }
      game.update(0.5);
      updateCampaign(game, 2, 0.5);
    }
    assert.equal(game.status, 'victory', `seed ${seed} ordered defense`);
    assert.ok(game.buildings.some(item => item.owner === 'player' && item.defId === 'command' && item.hp > 0));
  }
});

test('repair orders can defend Last Light against the hard eastern flank', () => {
  const game = createCampaignGame(2, 'hard');
  for (let tick = 0; tick < 360 && game.status === 'playing'; tick++) {
    for (const building of game.buildings.filter(item => item.owner === 'player' &&
      item.hp < item.maxHp * 0.8 && !item.repairing)) {
      assert.equal(game.toggleRepair(building.id).ok, true);
    }
    game.update(0.5);
    updateCampaign(game, 2, 0.5);
  }
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignState.lastLightFlankFired, true);
});

test('Last Light eastern defense survives seed and difficulty variation with public orders', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [1, 2, 5, 42, 167706]) {
    const game = createCampaignGame(2, difficulty, seed);
    const yard = game.buildings.find(item => item.owner === 'player' && item.defId === 'command');
    const factory = game.buildings.find(item => item.owner === 'player' && item.defId === 'factory');
    const barracks = game.buildings.find(item => item.owner === 'player' && item.defId === 'barracks');
    const label = `${difficulty} seed ${seed}`;
    assert.ok(yard && factory && barracks, `${label} has an operative base`);
    assert.deepEqual(game.setRally(factory.id, 38, 33), { ok: true });
    assert.deepEqual(game.setRally(barracks.id, 38, 33), { ok: true });
    game.select(game.units.filter(unit => unit.owner === 'player' && unit.defId !== 'harvester')
      .map(unit => unit.id));
    assert.equal(game.issueMove(37, 31, true).ok, true, `${label} takes a covered approach to the eastern flank`);
    for (const defId of ['lightTank', 'lightTank', 'lightTank', 'rocket', 'rocket'])
      assert.equal(game.queueUnit(defId).ok, true, `${label} queues ${defId}`);

    let nextRepairCheck = 0;
    for (let tick = 0; tick < 1000 && game.status === 'playing'; tick++) {
      if (game.campaignState.elapsed + 1e-6 >= nextRepairCheck) {
        if (yard.hp < yard.maxHp * 0.4 && !yard.repairing) {
          assert.deepEqual(game.toggleRepair(yard.id), { ok: true, active: true });
        }
        nextRepairCheck += 15;
      }
      game.update(0.2);
      updateCampaign(game, 2, 0.2);
    }
    assert.equal(game.status, 'victory', `${label} holds until extraction`);
    assert.ok(yard.hp > 0, `${label} keeps the yard standing`);
  }
});

test('Eye of the Storm needs an ordered relay shelter defense', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const idle = createCampaignGame(7, difficulty);
    runCampaignIdle(idle, 7, 90);
    assert.equal(idle.status, 'defeat', `${difficulty} idle shelter defense`);
    assert.equal(idle.relays[0].owner, null);

    const game = createCampaignGame(7, difficulty);
    const yard = game.buildings.find(item => item.owner === 'player' && item.defId === 'command');
    assert.deepEqual(game.toggleRepair(yard.id), { ok: true, active: true });
    const guardian = game.units.find(unit => unit.owner === 'player' && unit.defId === 'guardian');
    game.select(guardian.id);
    assert.equal(game.issueMove(game.relays[0].x, game.relays[0].y, true).ok, true);
    game.select(game.units.filter(unit => unit.owner === 'player' &&
      ['rocket', 'rifle', 'medic'].includes(unit.defId)).map(unit => unit.id));
    assert.equal(game.issueMove(19.5, 35.5, true).ok, true);
    for (const defId of ['lightTank', 'lightTank', 'rocket']) assert.equal(game.queueUnit(defId).ok, true);
    runCampaignIdle(game, 7, 90);
    assert.equal(game.status, 'victory', `${difficulty} ordered shelter defense`);
    assert.equal(game.campaignState.shelterHoldElapsed >= 10, true);
    assert.equal(game.campaignState.stormAssaultOneFired, true);
    assert.equal(game.campaignState.stormAssaultTwoFired, true);
    assert.ok(yard.hp > 0);
    assert.equal(Game.deserialize(game.serialize()).campaignState.shelterHoldElapsed,
      game.campaignState.shelterHoldElapsed);
  }
});

test('Three Points of Light requires a relay push and hold', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const idle = createCampaignGame(8, difficulty);
    runCampaignIdle(idle, 8);
    assert.equal(idle.status, 'defeat', `${difficulty} idle relay play`);
    assert.equal(idle.relays.some(relay => relay.owner === 'player'), false);

    const game = createCampaignGame(8, difficulty);
    game.select(game.units.filter(unit => unit.owner === 'player' &&
      ['rifle', 'buggy'].includes(unit.defId)).map(unit => unit.id));
    assert.equal(game.issueMove(game.relays[0].x, game.relays[0].y, true).ok, true);
    game.select(game.units.filter(unit => unit.owner === 'player' &&
      ['scout', 'lightTank', 'rocket'].includes(unit.defId)).map(unit => unit.id));
    assert.equal(game.issueMove(game.relays[1].x, game.relays[1].y, true).ok, true);
    runCampaignIdle(game, 8, 120);
    assert.equal(game.status, 'victory', `${difficulty} ordered relay push`);
    assert.ok(game.campaignState.holdElapsed >= 25);
    assert.equal(game.relays.filter(relay => relay.owner === 'player').length, 2);
    assert.equal(game.campaignState.relayPairChoice, 'yard-guard');
    assert.equal(game.campaignState.relayReserveUnitIds.length, 2);
  }
});

test('Ashes in Transit requires an uninterrupted north or south transmission before extraction', () => {
  for (const uplinkId of ['north', 'south']) {
    const game = createCampaignGame(5, 'normal', 1);
    const analyst = game.getEntity(game.campaignState.escortId);
    const uplink = game.campaignState.transmissionUplinks.find(item => item.id === uplinkId);
    assert.ok(game._findPath(analyst.x, analyst.y, uplink.x, uplink.y), `${uplinkId} uplink is reachable`);
    assert.ok(game._findPath(uplink.x, uplink.y, 48, 17), `${uplinkId} route reaches extraction`);

    // A direct public order to the extraction beacon cannot skip the signal stop.
    game.select(analyst.id);
    assert.equal(game.issueMove(48, 17).ok, true);
    for (let tick = 0; tick < 400 && game.status === 'playing'; tick++) {
      game.update(0.2);
      updateCampaign(game, 5, 0.2);
    }
    assert.notEqual(game.status, 'victory', 'direct extraction does not satisfy the new objective');
    assert.equal(game.campaignComplete, false);

    const routeGame = createCampaignGame(5, 'normal', 1);
    const routeAnalyst = routeGame.getEntity(routeGame.campaignState.escortId);
    routeAnalyst.x = uplink.x;
    routeAnalyst.y = uplink.y;
    updateCampaign(routeGame, 5, 3, 47);
    const interrupted = Game.deserialize(routeGame.serialize());
    const restoredAnalyst = interrupted.getEntity(routeAnalyst.id);
    assert.equal(interrupted.campaignState.transmissionUplinkId, uplinkId);
    assert.equal(interrupted.campaignState.transmissionElapsed, 3);
    restoredAnalyst.x += 5;
    updateCampaign(interrupted, 5, 0.2, 47);
    assert.equal(interrupted.campaignState.transmissionElapsed, 0, 'leaving the uplink resets progress');
    restoredAnalyst.x = uplink.x;
    restoredAnalyst.y = uplink.y;
    updateCampaign(interrupted, 5, 8, 47);
    assert.equal(interrupted.campaignState.phase, 'extract-analyst');
    restoredAnalyst.x = interrupted.campaignState.extraction.x;
    restoredAnalyst.y = interrupted.campaignState.extraction.y;
    updateCampaign(interrupted, 5, 0, 47);
    assert.equal(interrupted.status, 'victory');
    assert.equal(interrupted.campaignState.transmissionUplinkId, uplinkId);
    assert.ok(restoredAnalyst.hp > 0);
  }
});

test('Ashes in Transit v48 makes the uplink choice a saved speed-versus-exposure tradeoff', () => {
  const northern = createCampaignGame(5, 'normal', 481516);
  assert.equal(northern.campaignState.ashesUplinkRulesVersion, 48);
  const northAnalyst = northern.getEntity(northern.campaignState.escortId);
  const north = northern.campaignState.transmissionUplinks.find(item => item.id === 'north');
  northAnalyst.x = north.x;
  northAnalyst.y = north.y;
  updateCampaign(northern, 5, 5, 48);
  assert.equal(northern.campaignState.phase, 'extract-analyst');
  assert.equal(northern.campaignState.transmissionDuration, 5);
  assert.equal(northern.campaignState.extractionInterceptWarned, true);
  assert.equal(northern.campaignState.extractionInterceptFired, false,
    'the warning opens a response window instead of spawning on the upload frame');
  assert.equal(northern.events.filter(event => event.type === 'campaignThreatWarning' &&
    /northern burst exposed/i.test(event.message)).length, 1);

  const savedWarning = Game.deserialize(northern.serialize());
  updateCampaign(savedWarning, 5, 4.9, 48);
  assert.equal(savedWarning.campaignState.extractionInterceptFired, false);
  updateCampaign(savedWarning, 5, 0.1, 48);
  assert.equal(savedWarning.campaignState.extractionInterceptFired, true);
  const interceptIds = savedWarning.campaignState.extractionInterceptUnitIds;
  assert.equal(interceptIds.length, 1);
  assert.deepEqual(interceptIds.map(id => savedWarning.getEntity(id)?.defId), ['buggy']);
  assert.ok(interceptIds.every(id => savedWarning.isVisible(savedWarning.getEntity(id))),
    'the bounded response is visible in the extraction corridor');
  updateCampaign(savedWarning, 5, 20, 48);
  assert.equal(savedWarning.campaignState.extractionInterceptUnitIds.length, 1,
    'the response does not repeat');
  const savedAnalyst = savedWarning.getEntity(savedWarning.campaignState.escortId);
  savedAnalyst.x = savedWarning.campaignState.extraction.x;
  savedAnalyst.y = savedWarning.campaignState.extraction.y;
  assert.equal(updateCampaign(savedWarning, 5, 0, 48), false,
    'the North route cannot complete while its visible interceptor remains');
  savedWarning.getEntity(interceptIds[0]).hp = 0;
  assert.equal(updateCampaign(savedWarning, 5, 0, 48), true,
    'destroying the interceptor opens extraction');

  const southern = createCampaignGame(5, 'normal', 481516);
  const southAnalyst = southern.getEntity(southern.campaignState.escortId);
  const south = southern.campaignState.transmissionUplinks.find(item => item.id === 'south');
  assert.equal(south.y, 32, 'the new quiet route shortens the exposed return corridor');
  assert.ok(Math.hypot(north.x - south.x, north.y - south.y) > north.radius + south.radius,
    'the two uplink selection rings do not overlap');
  southAnalyst.x = south.x;
  southAnalyst.y = south.y;
  updateCampaign(southern, 5, 7.9, 48);
  assert.equal(southern.campaignState.phase, 'transmit-codes');
  updateCampaign(southern, 5, 0.1, 48);
  assert.equal(southern.campaignState.phase, 'extract-analyst');
  assert.equal(southern.campaignState.transmissionDuration, 8);
  assert.equal(southern.campaignState.extractionInterceptFired, false);
  assert.equal(southern.campaignState.extractionInterceptUnitIds.length, 0);
  assert.ok(southern.events.some(event => event.type === 'campaignIntel' &&
    /low-power southern transmission/i.test(event.message)));
});

test('Ashes in Transit replay versions 43 through 47 retain the original eight-second quiet upload', () => {
  for (const replayVersion of [43, 47]) for (const uplinkId of ['north', 'south']) {
    const game = createCampaignGame(5, 'normal', 481516);
    const analyst = game.getEntity(game.campaignState.escortId);
    const uplink = game.campaignState.transmissionUplinks.find(item => item.id === uplinkId);
    analyst.x = uplink.x;
    analyst.y = uplink.y;
    updateCampaign(game, 5, 7.9, replayVersion);
    assert.equal(game.campaignState.phase, 'transmit-codes');
    updateCampaign(game, 5, 0.1, replayVersion);
    assert.equal(game.campaignState.phase, 'extract-analyst');
    assert.equal(game.campaignState.transmissionDuration, 8);
    assert.equal(game.campaignState.extractionInterceptFired, false);
    assert.equal(game.campaignState.extractionInterceptUnitIds.length, 0);
  }
});

test('markerless staged Ashes saves migrate to quiet v47 rules while fresh games stay v48', () => {
  const source = createCampaignGame(5, 'normal', 90210);
  const legacyData = JSON.parse(source.serialize());
  delete legacyData.campaignState.ashesUplinkRulesVersion;
  delete legacyData.campaignState.extractionInterceptWarned;
  delete legacyData.campaignState.extractionInterceptWarningElapsed;
  delete legacyData.campaignState.extractionInterceptFired;
  delete legacyData.campaignState.extractionInterceptUnitIds;
  const loaded = Game.deserialize(legacyData);
  const analyst = loaded.getEntity(loaded.campaignState.escortId);
  const north = loaded.campaignState.transmissionUplinks.find(item => item.id === 'north');
  analyst.x = north.x;
  analyst.y = north.y;

  updateCampaign(loaded, 5, 7.9);
  assert.equal(loaded.campaignState.ashesUplinkRulesVersion, 47);
  assert.equal(loaded.campaignState.phase, 'transmit-codes');
  updateCampaign(loaded, 5, 0.1);
  assert.equal(loaded.campaignState.phase, 'extract-analyst');
  assert.equal(loaded.campaignState.transmissionDuration, 8);
  assert.notEqual(loaded.campaignState.extractionInterceptFired, true);
});

test('Ashes in Transit replay version 42 keeps its direct extraction objective', () => {
  const game = createCampaignGame(5, 'normal', 1);
  const analyst = game.getEntity(game.campaignState.escortId);
  delete game.campaignState.transmissionUplinks;
  delete game.campaignState.phase;
  delete game.campaignState.transmissionUplinkId;
  delete game.campaignState.transmissionElapsed;
  delete game.campaignState.transmissionDuration;
  analyst.x = game.campaignState.extraction.x;
  analyst.y = game.campaignState.extraction.y;
  assert.equal(updateCampaign(game, 5, 0), true, 'an unversioned old save with no transmission state keeps the old rule');
  const replay = createCampaignGame(5, 'normal', 1);
  const replayAnalyst = replay.getEntity(replay.campaignState.escortId);
  replayAnalyst.x = replay.campaignState.extraction.x;
  replayAnalyst.y = replay.campaignState.extraction.y;
  assert.equal(updateCampaign(replay, 5, 0, 42), true);
  assert.equal(game.status, 'victory');
  assert.equal(replay.status, 'victory');
});

for (const difficulty of ['easy', 'normal', 'hard']) test(`the silent switch can be captured through live scouting and engineer orders (${difficulty})`, () => {
  const game = createCampaignGame(1, difficulty);
  const radar = game.getEntity(game.campaignState.targetId);
  const engineers = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'engineer');
  game.select(game.units.filter(unit => unit.owner === 'player' &&
    !['engineer', 'harvester'].includes(unit.defId)).map(unit => unit.id));
  assert.equal(game.issueMove(40, 17, true).ok, true);
  let orderedCapture = false;
  for (let tick = 0; tick < 500 && game.status === 'playing'; tick++) {
    game.update(0.2);
    if (!orderedCapture && game.isVisible(radar)) {
      game.select(engineers.map(unit => unit.id));
      assert.equal(game.issueEngineer(radar.id).ok, true);
      orderedCapture = true;
    }
    updateCampaign(game, 1, 0.2);
  }
  assert.equal(orderedCapture, true, 'the covering force reveals the array');
  assert.equal(game.status, 'victory');
  assert.equal(radar.owner, 'player');
});

test('the forward relay can be reached and destroyed before its deadline', () => {
  const game = createCampaignGame(3, 'normal');
  const target = game.getEntity(game.campaignState.targetId);
  const centralRelay = game.relays.find(item => item.id === game.campaignState.relayId);
  // Isolate the commanded route and staged objective from combat variance; the
  // separate mission pressure and relay-contest tests cover those threats.
  for (const unit of game.units.filter(item => item.owner === 'enemy')) unit.hp = 0;
  for (const building of game.buildings.filter(item => item.owner === 'enemy' && item.id !== target.id)) building.hp = 0;
  game.select(game.units.filter(unit => unit.owner === 'player' &&
    !['engineer', 'harvester'].includes(unit.defId)).map(unit => unit.id));
  assert.equal(game.issueMove(centralRelay.x, centralRelay.y, true).ok, true);
  let orderedAttack = false;
  for (let tick = 0; tick < 600 && game.status === 'playing'; tick++) {
    game.update(0.2);
    updateCampaign(game, 3, 0.2);
    if (!orderedAttack && game.campaignState.phase === 'destroy-relay' && game.isVisible(target)) {
      game.select(game.units.filter(unit => unit.owner === 'player' &&
        ['rocket', 'guardian', 'buggy'].includes(unit.defId)).map(unit => unit.id));
      assert.equal(game.issueAttack(target.id).ok, true);
      orderedAttack = true;
    }
  }
  assert.equal(orderedAttack, true);
  assert.equal(centralRelay.owner, 'player');
  assert.equal(game.status, 'victory');
  assert.ok(game.campaignState.elapsed < game.campaignState.deadline);
});

test('Black Shard relay breach and forward assault win against live pressure across difficulties and seeds', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) for (const seed of [31, 481516, 90817]) {
    const game = createCampaignGame(3, difficulty, seed);
    const state = game.campaignState;
    const relay = game.relays.find(item => item.id === state.relayId);
    const armed = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      game.unitDefs[unit.defId]?.weapon);
    game.select(armed().map(unit => unit.id));
    assert.equal(game.issueMove(relay.x, relay.y, true).ok, true);
    let forwardPush = false;
    for (let tick = 0; tick < 2150 && game.status === 'playing'; tick++) {
      game.update(0.2);
      updateCampaign(game, 3, 0.2);
      if (!forwardPush && state.phase === 'destroy-relay') {
        // The phase change's tactical uplink publishes the array sector.
        game.select(armed().map(unit => unit.id));
        forwardPush = game.issueMove(40.5, 21.5, true).ok;
      }
    }
    assert.equal(forwardPush, true, `${difficulty}/${seed}: shield breach should open the forward push`);
    assert.equal(game.status, 'victory', `${difficulty}/${seed}: ordered force should finish the mission`);
    assert.ok(state.elapsed < state.deadline, `${difficulty}/${seed}: finish before the relay transmission`);
  }
});
