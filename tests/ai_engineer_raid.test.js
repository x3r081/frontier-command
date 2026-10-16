import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS, AI_ENGINEER_RAID_RULES_VERSION,
  AI_ECONOMY_RESERVE_RULES_VERSION } from '../src/game/engine.js';

function raidFixture({ difficulty = 'normal', replayVersion = 70, engineer = false } = {}) {
  const game = new Game({ seed: 42070, difficulty, replayVersion });
  const target = game.buildings.find(building => building.owner === 'player' && building.defId === 'power');
  target.x = 40; target.y = 20; target.hp = target.maxHp * 0.7;
  const scout = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'scout');
  scout.x = 43.5; scout.y = 20.5; scout.stance = 'holdFire';
  const playerScout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  playerScout.x = 43.5; playerScout.y = 23.5; playerScout.stance = 'holdFire';
  game._updateFog();
  game.credits.enemy = 3000;
  const raider = engineer ? game._createUnit('enemy', 'engineer', 43.5, 20.5) : null;
  if (raider) raider.stance = 'holdFire';
  game._updateFog();
  return { game, target, raider };
}

const runRaid = (game, protectedEconomy = false) =>
  game._aiEngineerCaptureRaidTick({ protectedEconomy, combatUnits: [] });

test('v70 normal and hard AI capture one visible completed damaged structure and announce only the spotted raider', () => {
  for (const difficulty of ['normal', 'hard']) {
    const { game, target, raider } = raidFixture({ difficulty, engineer: true });
    const attacker = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
    attacker.order = { type: 'attack', targetId: target.id, aiIntel: true,
      lastX: target.x + 1, lastY: target.y + 1 };
    const targetHp = target.hp;

    assert.equal(runRaid(game), true);
    assert.equal(raider.order.aiEngineerRaid, game._aiEngineerRaidState.active.raidId);
    assert.equal(game.events.filter(event => event.type === 'engineerRaidSpotted').length, 1);
    const spotted = game.events.find(event => event.type === 'engineerRaidSpotted');
    assert.deepEqual({ unitId: spotted.unitId, targetId: spotted.targetId,
      sectorX: spotted.sectorX, sectorY: spotted.sectorY },
    { unitId: raider.id, targetId: target.id, sectorX: 43, sectorY: 20 });
    assert.equal(runRaid(game), true);
    assert.equal(game.events.filter(event => event.type === 'engineerRaidSpotted').length, 1,
      'a visible raid raises one spotted event');

    game._updateUnit(attacker, 0.1);
    assert.equal(target.hp, targetHp, 'enemy fire holds on the reserved capture target');
    for (let step = 0; step < 300 && target.owner === 'player'; step++) {
      game.time += 0.1;
      game._updateUnit(raider, 0.1);
    }
    assert.equal(target.owner, 'enemy');
    assert.equal(game.events.some(event => event.type === 'buildingCaptured' && event.id === target.id), true);
  }
});

test('a reachable damaged target outside the enemy command bubble remains eligible', () => {
  const { game, target } = raidFixture();
  target.x = 30; target.y = 20;
  const scout = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'scout');
  scout.x = 33.5; scout.y = 20.5;
  const playerScout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  playerScout.x = 33; playerScout.y = 23.5;
  game._updateFog();
  assert.equal(game._aiEngineerRaidTargetValid(target), true);
  assert.equal(runRaid(game), true);
  assert.equal(game._aiEngineerRaidState.active.targetId, target.id);
});

test('spotted event fires once on the first player-visible Engineer frame eight tiles from target', () => {
  const { game, target, raider } = raidFixture({ engineer: true });
  const visibility = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity?.id === raider.id && viewer === 'player'
    ? false : visibility(entity, viewer);
  raider.x = 47.5; raider.y = 20.5;
  assert.equal(runRaid(game), true);
  assert.equal(game.events.some(event => event.type === 'engineerRaidSpotted'), false,
    'a hidden Engineer purchase/route is not announced');

  game.isVisible = (entity, viewer) => entity?.id === raider.id && viewer === 'player'
    ? true : visibility(entity, viewer);
  const previousX = raider.x;
  game._updateUnit(raider, 0.1);
  const spotted = game.events.filter(event => event.type === 'engineerRaidSpotted');
  assert.equal(spotted.length, 1);
  assert.equal(spotted[0].targetId, target.id);
  assert.equal(spotted[0].sectorX, Math.floor(previousX));
  game._updateUnit(raider, 0.1);
  assert.equal(game.events.filter(event => event.type === 'engineerRaidSpotted').length, 1);
});

test('raid purchase tags its own engineer, transfers the tag at spawn, and saves the active reservation', () => {
  const { game, target } = raidFixture();
  assert.equal(runRaid(game), true);
  const barracks = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'barracks');
  const taggedJob = barracks.queue[0];
  assert.equal(taggedJob.defId, 'engineer');
  assert.equal(taggedJob.aiEngineerRaid.targetId, target.id);
  assert.equal(game.credits.enemy, 2550);

  taggedJob.progress = 1;
  game._updateBuildings(0.1);
  const spawned = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'engineer');
  assert.ok(spawned?._aiEngineerRaid);
  assert.equal(spawned._aiEngineerRaid.raidId, game._aiEngineerRaidState.active.raidId);
  assert.equal(game._aiEngineerRaidState.active.engineerId, spawned.id);

  const loaded = Game.deserialize(game.serialize());
  const restored = loaded.units.find(unit => unit.id === spawned.id);
  assert.equal(loaded.aiEngineerRaidRulesVersion, AI_ENGINEER_RAID_RULES_VERSION);
  assert.equal(loaded._aiEngineerRaidState.active.targetId, target.id);
  assert.equal(restored._aiEngineerRaid.raidId, spawned._aiEngineerRaid.raidId);
  assert.equal(runRaid(loaded), true);
  assert.equal(restored.order.type, 'engineer');
  assert.equal(restored.order.targetId, target.id);

  const expiredData = JSON.parse(game.serialize());
  expiredData.time = expiredData._aiEngineerRaidState.active.deadline + 0.1;
  const expiringUnit = expiredData.units.find(unit => unit.id === spawned.id);
  expiringUnit.x = target.x + target.w + 0.5;
  expiringUnit.y = target.y + 0.5;
  const expired = Game.deserialize(expiredData);
  const expiredEngineer = expired.getEntity(spawned.id);
  assert.equal(expired._aiEngineerRaidState.active, null);
  assert.equal(expiredEngineer.order.type, 'idle', 'an expired tagged raid must not restore as an ordinary capture order');
  expired._updateUnit(expiredEngineer, 0.1);
  assert.equal(expired.getEntity(target.id).owner, 'player');
});

test('repair or concealment cancels and refunds only the tagged queued engineer', () => {
  for (const invalidate of [
    ({ target }) => { target.hp = target.maxHp * 0.8; },
    ({ game, target }) => {
      const isVisible = game.isVisible.bind(game);
      game.isVisible = (entity, viewer) => entity?.id === target.id && viewer === 'enemy'
        ? false : isVisible(entity, viewer);
    },
  ]) {
    const { game, target } = raidFixture();
    assert.equal(runRaid(game), true);
    const barracks = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'barracks');
    const raidId = game._aiEngineerRaidState.active.raidId;
    barracks.queue.push({ defId: 'rifle', progress: 0 });
    const queueCredits = game.credits.enemy;
    barracks.queue[0].progress = 0.5;
    const refund = Math.round(450 * (1 - 0.5 * 0.35));
    invalidate({ game, target });

    assert.equal(runRaid(game), false);
    assert.equal(game._aiEngineerRaidState.active, null);
    assert.equal(barracks.queue.some(item => item.aiEngineerRaid?.raidId === raidId), false);
    assert.deepEqual(barracks.queue.map(item => item.defId), ['rifle'],
      'unrelated production remains queued');
    assert.equal(game.credits.enemy, queueCredits + refund);
    assert.ok(game._aiEngineerRaidState.cooldownUntil > game.time);
  }
});

test('repairing an active raid target releases its Engineer, and a nearby defender can intercept the raider', () => {
  const repaired = raidFixture({ engineer: true });
  repaired.raider.x = 36.5; repaired.raider.y = 20.5;
  assert.equal(runRaid(repaired.game), true);
  let pathChecks = 0;
  const approach = repaired.game._aiEngineerRaidApproach.bind(repaired.game);
  repaired.game._aiEngineerRaidApproach = (...args) => { pathChecks++; return approach(...args); };
  for (let i = 0; i < 8; i++) repaired.game._updateUnit(repaired.raider, 0.1);
  assert.equal(pathChecks, 0, 'unit frames use the cached approach point rather than rerunning perimeter A*');
  repaired.target.hp = repaired.target.maxHp * 0.8;
  assert.equal(runRaid(repaired.game), false);
  assert.equal(repaired.raider.order.type, 'idle');
  assert.equal(repaired.raider._aiEngineerRaid, undefined);
  assert.equal(repaired.target.owner, 'player');

  const { game, target } = raidFixture({ engineer: true });
  const raider = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'engineer');
  for (const unit of game.units) if (unit.owner === 'enemy' && unit !== raider) unit.hp = 0;
  raider.x = 36.5; raider.y = 20.5; raider.stance = 'aggressive';
  const rifle = game._createUnit('player', 'rifle', 36.1, 20.5);
  game._createUnit('player', 'rocket', 35.8, 21.4);
  game._updateFog();
  const targetVisible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity?.id === target.id && viewer === 'enemy'
    ? true : targetVisible(entity, viewer);
  assert.equal(runRaid(game), true);
  assert.equal(game.isVisible(raider, 'player'), true);
  game._applyDamage(raider, raider.hp, 'ballistic', 'player', rifle.id, rifle);
  assert.ok(raider.hp <= 0, 'a defender hit can kill the unarmed Engineer before capture');
  assert.equal(target.owner, 'player');
  assert.equal(runRaid(game), false, 'the next manager tick clears the lost raid and applies cooldown');
  assert.equal(game._aiEngineerRaidState.active, null);
  assert.ok(game._aiEngineerRaidState.cooldownUntil > game.time);
});

test('unreachable approach, relay emergency, command recovery, and base defense block new raids', () => {
  const { game, target } = raidFixture();
  const isVisible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity?.id === target.id && viewer === 'enemy'
    ? true : isVisible(entity, viewer);
  for (let x = 0; x < game.width; x++) game.terrain[17][x].walkable = false;
  assert.equal(runRaid(game), false);
  assert.equal(game._aiEngineerRaidState.active, null);

  const relayEmergency = raidFixture().game;
  relayEmergency.relays[0].owner = 'player';
  relayEmergency.relays[1].owner = 'player';
  relayEmergency.relayDominion.owner = 'player';
  assert.equal(runRaid(relayEmergency), false);

  const commandRecovery = raidFixture().game;
  commandRecovery._aiCommandRecovery = { stage: 'funding' };
  assert.equal(runRaid(commandRecovery), false);

  const baseDefense = raidFixture().game;
  const enemyCommand = baseDefense.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
  const playerRifle = baseDefense.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle');
  playerRifle.x = enemyCommand.x + 1.5; playerRifle.y = enemyCommand.y + 1.5;
  assert.equal(runRaid(baseDefense), false);
});

test('purchase preserves the v69 lost-harvester reserve plus extra cash and waits through cooldown', () => {
  const { game } = raidFixture();
  for (const unit of game.units) if (unit.owner === 'enemy' && unit.defId === 'harvester') unit.hp = 0;
  const harvesterReserve = game._aiEconomyReserve('enemy');
  assert.equal(harvesterReserve, 1250);
  game.credits.enemy = UNIT_DEFS.engineer.cost + harvesterReserve + 599;
  assert.equal(runRaid(game), false, 'the raid must preserve the harvester reserve and extra buffer');
  game.credits.enemy++;
  assert.equal(runRaid(game), true);
  assert.equal(game.credits.enemy, harvesterReserve + 600);

  const { game: cooldownGame } = raidFixture({ engineer: true });
  cooldownGame._aiEngineerRaidState.cooldownUntil = 50;
  assert.equal(runRaid(cooldownGame), false);
  cooldownGame.time = 50;
  assert.equal(runRaid(cooldownGame), true);
});

test('later expansion economy protection does not self-cancel a paid raid; live priorities still abort it', () => {
  const funded = raidFixture();
  assert.equal(runRaid(funded.game), true);
  const barracks = funded.game.buildings.find(building => building.owner === 'enemy' && building.defId === 'barracks');
  const creditsAfterPurchase = funded.game.credits.enemy;
  assert.equal(runRaid(funded.game, true), true,
    'a later expansion cash goal must not unwind an already-funded raid while Harvester reserve is intact');
  assert.ok(barracks.queue.some(item => item.aiEngineerRaid));
  assert.equal(funded.game.credits.enemy, creditsAfterPurchase);

  for (const prioritize of [
    game => {
      game.relays[0].owner = 'player'; game.relays[1].owner = 'player';
      game.relayDominion.owner = 'player';
    },
    game => { game._aiCommandRecovery = { stage: 'funding' }; },
  ]) {
    const interrupted = raidFixture();
    assert.equal(runRaid(interrupted.game), true);
    const building = interrupted.game.buildings.find(item => item.owner === 'enemy' && item.defId === 'barracks');
    prioritize(interrupted.game);
    assert.equal(runRaid(interrupted.game), false);
    assert.equal(interrupted.game._aiEngineerRaidState.active, null);
    assert.equal(building.queue.some(item => item.aiEngineerRaid), false,
      'relay or command recovery can still cancel/refund the tagged raid job');
  }
});

test('easy, legacy, campaign, and multiplayer rules do not start raids; ordinary engineer capture still works', () => {
  for (const options of [
    { difficulty: 'easy', replayVersion: 70 },
    { difficulty: 'normal', replayVersion: 69 },
    { difficulty: 'hard', replayVersion: 68 },
    { difficulty: 'normal', replayVersion: 70, mode: 'campaign' },
    { difficulty: 'normal', replayVersion: 70, mode: 'multiplayer' },
  ]) {
    const game = new Game({ seed: 42, ...options });
    assert.equal(game._aiEngineerCaptureRaidTick(), false);
    assert.equal(game.units.some(unit => unit.owner === 'enemy' && unit.defId === 'engineer'), false);
  }
  assert.equal(AI_ENGINEER_RAID_RULES_VERSION, 70);
  assert.equal(AI_ECONOMY_RESERVE_RULES_VERSION, 69);

  const game = new Game({ seed: 42, difficulty: 'normal', replayVersion: 69 });
  const target = game.buildings.find(building => building.owner === 'player' && building.defId === 'power');
  const engineer = game._createUnit('enemy', 'engineer', target.x + target.w + 0.5, target.y + 0.5);
  target.hp = target.maxHp * 0.7;
  engineer.order = { type: 'engineer', targetId: target.id };
  game._updateEngineer(engineer, target, 0.1);
  assert.equal(target.owner, 'enemy', 'the ordinary engineer capture mechanic remains available');
});

test('markerless null-version Normal/Hard saves pin to v69 while explicit older versions and Easy stay unchanged', () => {
  for (const difficulty of ['normal', 'hard']) {
    const game = new Game({ seed: 42, difficulty, replayVersion: null });
    const data = JSON.parse(game.serialize());
    delete data.aiEngineerRaidRulesVersion;
    const loaded = Game.deserialize(data);
    assert.equal(loaded.replayVersion, 69);
  }
  const old = new Game({ seed: 42, difficulty: 'normal', replayVersion: 68 });
  assert.equal(Game.deserialize(old.serialize()).replayVersion, 68);
  const easy = new Game({ seed: 42, difficulty: 'easy', replayVersion: null });
  const easyData = JSON.parse(easy.serialize());
  delete easyData.aiEngineerRaidRulesVersion;
  assert.equal(Game.deserialize(easyData).replayVersion, null);

  const preAssembly = new Game({ seed: 42, difficulty: 'normal', replayVersion: null });
  const preAssemblyData = JSON.parse(preAssembly.serialize());
  delete preAssemblyData.reinforcementAssemblyRulesVersion;
  delete preAssemblyData.aiEngineerRaidRulesVersion;
  assert.equal(Game.deserialize(preAssemblyData).replayVersion, 67,
    'the earlier missing assembly marker keeps priority over the missing raid marker');
});
