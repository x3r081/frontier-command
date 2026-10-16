import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, AI_COMMAND_RECOVERY_RULES_VERSION } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

function recoveryGame(replayVersion = AI_COMMAND_RECOVERY_RULES_VERSION, loseYard = true) {
  const game = new Game({ seed: 762, difficulty: 'normal', mode: 'skirmish', replayVersion });
  const yard = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
  if (loseYard) yard.hp = 0;
  game._createBuilding('enemy', 'radar', 40, 14, 1);
  game._createBuilding('enemy', 'tech', 43, 14, 1);
  game._createBuilding('enemy', 'power', 60, 14, 1);
  game._refreshPower();
  game.credits.enemy = 6000;
  return game;
}

function driveRecoveryRig(game, rig, maxSeconds = 120) {
  game._aiRecoverCommandYard();
  for (let second = 0; second < maxSeconds &&
      !game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0);
      second++) {
    game.time += 1;
    if (rig.order?.type === 'move') game._moveUnit(rig, rig.order.x, rig.order.y, 1, 0.28);
    game._aiRecoverCommandYard();
  }
}

test('v62 queues a paid MCV and deploys a new command yard after the last yard is lost', () => {
  const game = recoveryGame();
  const credits = game.credits.enemy;
  assert.equal(game._aiRecoverCommandYard(), true);
  const factory = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
  assert.deepEqual(factory.queue.map(item => item.defId), ['mcv']);
  assert.equal(game.credits.enemy, credits - game.unitDefs.mcv.cost, 'recovery pays the normal MCV price');
  for (let step = 0; step < 90 / SOLO_STEP_SECONDS &&
      !game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0);
      step++) {
    game.update(SOLO_STEP_SECONDS);
    const queued = game.events.filter(event => event.type === 'unitQueued' && event.owner === 'enemy' && event.defId === 'mcv').length;
    assert.equal(queued, 1, 'recovery queues one normally paid MCV without duplicate production');
  }
  assert.ok(game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0));
  assert.equal(game._aiCommandRecovery, null);
  assert.equal(game.events.filter(event => event.type === 'unitQueued' && event.owner === 'enemy' && event.defId === 'mcv').length,
    1, 'the factory-produced recovery rig deploys through ordinary fixed-step gameplay');
});

test('a surviving MCV routes to clear industry ground and deploys without paying for a replacement', () => {
  const game = recoveryGame();
  // This is a normal owned MCV, already paid for before the yard is lost.
  const rig = game._createUnit('enemy', 'mcv', 42.5, 21.5);
  const credits = game.credits.enemy;
  assert.equal(game._aiRecoverCommandYard(), true);
  assert.equal(game.credits.enemy, credits);
  assert.equal(rig._aiCommandRecovery, true);
  assert.equal(rig.order.aiCommandRecovery, true);
  driveRecoveryRig(game, rig);
  assert.ok(game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0));
});

test('recovery waits without tech, power, credits, or a free command-cap slot', () => {
  for (const blocked of ['tech', 'power', 'credits', 'cap']) {
    const game = recoveryGame();
    if (blocked === 'tech') game.buildings.find(building => building.owner === 'enemy' && building.defId === 'tech').hp = 0;
    if (blocked === 'power') {
      game.buildings.filter(building => building.owner === 'enemy' && ['power', 'advancedPower'].includes(building.defId))
        .forEach(building => { building.hp = 0; });
      game._refreshPower();
    }
    if (blocked === 'credits') game.credits.enemy = game.unitDefs.mcv.cost - 1;
    if (blocked === 'cap') {
      while (game.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 && !unit.embarkedIn &&
          !['harvester', 'engineer', 'medic', 'apc', 'dropship'].includes(unit.defId)).length < 21)
        game._createUnit('enemy', 'rifle', 33, 8);
    }
    game._aiRecoverCommandYard();
    assert.equal(game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory').queue.length, 0,
      `${blocked} blocks paid MCV production`);
    assert.ok(game._aiCommandRecovery.retryAt > game.time, 'failed eligibility is retried with a delay');
  }

  const fusionOnly = recoveryGame();
  fusionOnly.buildings.filter(building => building.owner === 'enemy' && building.defId === 'power')
    .forEach(building => { building.hp = 0; });
  fusionOnly._createBuilding('enemy', 'advancedPower', 60, 14, 1);
  fusionOnly._refreshPower();
  assert.ok(fusionOnly.power.enemy.production > 0);
  assert.equal(fusionOnly._aiCommandRecoveryCanQueue(), true, 'a live Fusion Plant supports recovery without a basic Power Plant');
});

test('failed physical deployment site is remembered briefly and recovery chooses another site', () => {
  const game = recoveryGame();
  const rig = game._createUnit('enemy', 'mcv', 42.5, 21.5);
  game._aiRecoverCommandYard();
  const preferred = { ...game._aiCommandRecovery.target };
  assert.ok(preferred);
  rig.x = preferred.x; rig.y = preferred.y;
  const hiddenBlocker = game._createUnit('player', 'rifle', preferred.x, preferred.y);
  const isVisible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === hiddenBlocker && viewer === 'enemy' ? false : isVisible(entity, viewer);
  game._aiRecoverCommandYard();
  assert.equal(game._aiCommandRecovery.failedSites.length, 1, 'only the physically failed attempt records a site');
  assert.equal(game._aiCommandRecovery.failedSites[0].x, preferred.deployX);
  assert.equal(game._aiCommandRecovery.failedSites[0].y, preferred.deployY);
  assert.ok(game._aiCommandRecovery.failedSites[0].expiresAt <= game.time + 120);
  const resumed = Game.deserialize(game.serialize());
  assert.deepEqual(resumed._aiCommandRecovery.failedSites, game._aiCommandRecovery.failedSites,
    'the bounded failed-site memory survives save/load');
  game.time = game._aiCommandRecovery.retryAt;
  game._aiRecoverCommandYard();
  assert.ok(game._aiCommandRecovery.target);
  assert.notDeepEqual({ x: game._aiCommandRecovery.target.deployX, y: game._aiCommandRecovery.target.deployY },
    { x: preferred.deployX, y: preferred.deployY }, 'a hidden blocker does not trap the planner retrying one deployment footprint');
});

test('recovery safety responds to visible ground units and powered defenses, not fogged units', () => {
  const game = recoveryGame();
  const tank = game._createUnit('player', 'lightTank', 43, 20);
  const visibility = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === tank && viewer === 'enemy' ? false : visibility(entity, viewer);
  assert.equal(game._aiCommandRecoveryThreatened(43, 20), false, 'a hidden ground force is not used as threat intel');
  game.isVisible = (entity, viewer) => entity === tank && viewer === 'enemy' ? true : visibility(entity, viewer);
  assert.equal(game._aiCommandRecoveryThreatened(43, 20), true, 'an observed ground force blocks the site');

  const defense = game._createBuilding('player', 'turret', 45, 20, 1);
  defense.powered = true;
  game.isVisible = (entity, viewer) => entity === defense && viewer === 'enemy' ? true :
    entity === tank && viewer === 'enemy' ? false : visibility(entity, viewer);
  assert.equal(game._aiCommandRecoveryThreatened(45, 20), true, 'visible powered defense sites are respected for every profile');
  defense.powered = false;
  assert.equal(game._aiCommandRecoveryThreatened(45, 20), false, 'an unpowered defense does not block recovery');
});

test('the recovery MCV stays reserved through AI relay, scout, defense and wave assignment ticks', () => {
  const game = recoveryGame();
  const rig = game._createUnit('enemy', 'mcv', 42.5, 21.5);
  game._aiTick();
  assert.equal(rig._aiCommandRecovery, true);
  assert.equal(rig.order.aiCommandRecovery, true);
  assert.ok(!game._launchAiWave() || rig.order.aiCommandRecovery,
    'a launchable wave does not reassign the recovery rig');
});

test('the command-rig opening still performs its initial deployment before recovery rules activate', () => {
  const game = new Game({ seed: 7, difficulty: 'normal', mode: 'skirmish', skirmishOpening: 'command-rig',
    replayVersion: AI_COMMAND_RECOVERY_RULES_VERSION });
  assert.equal(game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command'), false);
  game._aiTick();
  assert.equal(game._aiCommandRigOpeningComplete, true);
  assert.ok(game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0));
  assert.equal(game._aiCommandRecovery, null);
  const yard = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0);
  yard.hp = 0;
  const laterRig = game._createUnit('enemy', 'mcv', 32.5, 22.5);
  game._aiTick();
  assert.ok(game._aiCommandRecovery, 'a later loss enters the v62 recovery path');
  assert.equal(game.units.includes(laterRig), true, 'the old opener shortcut does not deploy later rigs without safety routing');
});

test('v61 command-rig opening keeps its legacy immediate deployment for later MCVs', () => {
  const game = new Game({ seed: 7, difficulty: 'normal', mode: 'skirmish', skirmishOpening: 'command-rig', replayVersion: 61 });
  game._aiTick();
  const yard = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0);
  assert.ok(yard, 'legacy opener deploys its starting rig');
  yard.hp = 0;
  const rig = game._createUnit('enemy', 'mcv', yard.x + 1.5, yard.y + 1.5);
  game._aiTick();
  assert.equal(game.units.includes(rig), false, 'v61 retains its prior immediate later-MCV deployment');
  assert.ok(game.buildings.some(building => building.owner === 'enemy' && building.defId === 'command' && building.hp > 0));
  assert.equal(game._aiCommandRecovery, null, 'the v62 recovery state is not used by the legacy replay');
});

test('v61 and markerless saves retain legacy recovery behavior; current recovery state survives save/load', () => {
  const legacy = recoveryGame(61);
  legacy._aiRecoverCommandYard();
  assert.equal(legacy._aiCommandRecovery, null);
  assert.equal(legacy.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory').queue.length, 0);

  const markerless = JSON.parse(recoveryGame().serialize());
  markerless.replayVersion = null;
  delete markerless.aiCommandRecoveryRulesVersion;
  const loadedLegacy = Game.deserialize(markerless);
  assert.equal(loadedLegacy.replayVersion, 61);
  assert.equal(loadedLegacy.aiCommandRecoveryRulesVersion, AI_COMMAND_RECOVERY_RULES_VERSION);

  const current = recoveryGame();
  const rig = current._createUnit('enemy', 'mcv', 42.5, 21.5);
  current._aiRecoverCommandYard();
  const resumed = Game.deserialize(current.serialize());
  assert.equal(resumed.replayVersion, AI_COMMAND_RECOVERY_RULES_VERSION);
  assert.equal(resumed.aiCommandRecoveryRulesVersion, AI_COMMAND_RECOVERY_RULES_VERSION);
  assert.deepEqual(resumed._aiCommandRecovery, current._aiCommandRecovery);
  const resumedRig = resumed.units.find(unit => unit.id === rig.id);
  assert.equal(resumedRig._aiCommandRecovery, true);
  resumed._aiRecoverCommandYard();
  assert.equal(resumedRig.order.aiCommandRecovery, true);
});

test('v62 recovery engages after public player attack commands where v61 keeps legacy policy', () => {
  const damageRun = replayVersion => {
    const game = recoveryGame(replayVersion, false);
    const command = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
    command.hp = 43;
    const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
    assert.equal(game.queueUnit('lightTank').ok, true, 'the player pays for a tank through the public production command');
    factory.queue[0].progress = 0.999;
    game._updateBuildings(0.1);
    const tank = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'lightTank')
      .sort((a, b) => b.id.localeCompare(a.id))[0];
    assert.ok(tank);
    tank.x = command.x - 1.5; tank.y = command.y + 1.5;
    game._updateFog();
    game.select([tank.id]);
    assert.equal(game.issueMove(command.x - 1, command.y + 1.5).ok, true);
    assert.equal(game.issueAttack(command.id).ok, true);
    for (let second = 0; second < 6 && command.hp > 0; second++) game.update(1);
    return { game, command, tank };
  };
  const oldRun = damageRun(61);
  const newRun = damageRun(62);
  assert.equal(oldRun.command.hp, 0, 'the player attack destroys the same final yard in both runs');
  assert.equal(newRun.command.hp, 0);
  assert.equal(oldRun.game._aiCommandRecovery, null, 'v61 keeps the prior no-recovery policy');
  assert.ok(!oldRun.game.events.some(event => event.type === 'unitQueued' && event.owner === 'enemy' && event.defId === 'mcv'));
  assert.ok(newRun.game.events.some(event => event.type === 'unitQueued' && event.owner === 'enemy' && event.defId === 'mcv'),
    'v62 pays for one MCV through the normal factory queue after the public attack destroys the yard');
});
