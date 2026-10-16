import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, POWER_STANDBY_RULES_VERSION } from '../src/game/engine.js';

function arena(replayVersion = null) {
  const game = new Game({ seed: 4171, mode: 'multiplayer', replayVersion });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  game._createBuilding('player', 'command', 2, 2);
  game._createBuilding('enemy', 'command', 57, 42);
  game._createBuilding('player', 'advancedPower', 7, 2);
  game._createBuilding('player', 'advancedPower', 10, 2);
  game._refreshPower();
  return game;
}

function advance(game, seconds) {
  const steps = Math.ceil(seconds * 30);
  for (let i = 0; i < steps; i++) game.update(1 / 30);
}

test('standby validates the requested building and emits an idempotent explicit change', () => {
  const game = arena();
  const refinery = game._createBuilding('player', 'refinery', 14, 5);
  const power = game._createBuilding('player', 'power', 18, 5);
  const unfinished = game._createBuilding('player', 'radar', 22, 5, 0.5);
  const enemyRefinery = game._createBuilding('enemy', 'refinery', 30, 5);
  game._refreshPower();

  assert.equal(POWER_STANDBY_RULES_VERSION, 71);
  assert.equal(game.canSetBuildingPower(refinery.id, true).ok, true);
  assert.equal(game.canSetBuildingPower(refinery.id, 1).ok, false);
  assert.equal(game.canSetBuildingPower(power.id, true).ok, false);
  assert.equal(game.canSetBuildingPower(unfinished.id, true).ok, false);
  assert.equal(game.canSetBuildingPower(enemyRefinery.id, true).ok, false);
  assert.deepEqual(game.setBuildingPower(refinery.id, true), { ok: true, standby: true });
  const event = game.events.at(-1);
  assert.deepEqual({ type: event.type, id: event.id, owner: event.owner, standby: event.standby,
    powerSaved: event.powerSaved }, { type: 'buildingPowerChanged', id: refinery.id, owner: 'player',
    standby: true, powerSaved: 35 });
  const eventCount = game.events.length;
  assert.deepEqual(game.setBuildingPower(refinery.id, true), { ok: true, standby: true });
  assert.equal(game.events.length, eventCount, 'repeating the same setting has no duplicate event');
  assert.equal(game.setBuildingPower(refinery.id, false).ok, true);
  assert.equal(game.events.at(-1).powerSaved, -35);

  const legacy = arena(70);
  const legacyRefinery = legacy._createBuilding('player', 'refinery', 14, 5);
  const credits = legacy.credits.player;
  assert.equal(legacy.setBuildingPower(legacyRefinery.id, true).ok, false);
  assert.equal(legacy.credits.player, credits);
});

test('capturing a standby structure restores it for its new owner', () => {
  const game = arena();
  const refinery = game._createBuilding('enemy', 'refinery', 25, 5);
  refinery.hp = refinery.maxHp * 0.7;
  refinery.powerStandby = true;
  game._refreshPower();
  const engineer = game._createUnit('player', 'engineer', refinery.x + 1.5, refinery.y + 1);
  engineer.order = { type: 'engineer', targetId: refinery.id };

  game._updateEngineer(engineer, refinery, 0.1);
  assert.equal(refinery.owner, 'player');
  assert.equal(refinery.powerStandby, false);
  assert.equal(refinery.powered, true);
});

test('capturing an assigned refinery releases a harvester dock and reroutes cargo to its friendly refinery', () => {
  const game = arena();
  const friendlyRefinery = game._createBuilding('player', 'refinery', 10, 5);
  const capturedRefinery = game._createBuilding('player', 'refinery', 18, 5);
  capturedRefinery.hp = capturedRefinery.maxHp * 0.7;
  const harvester = game._createUnit('player', 'harvester', 18.5, 6.5, { type: 'harvest' });
  harvester.cargo = 200;
  harvester._harvestPhase = 'return';
  harvester._unloadRefineryId = capturedRefinery.id;
  harvester._unloadApproach = { x: harvester.x, y: harvester.y };
  capturedRefinery._unloadHarvesterId = harvester.id;
  const engineer = game._createUnit('enemy', 'engineer', capturedRefinery.x + 1.5, capturedRefinery.y + 1);
  const credits = game.credits.player;

  game._updateEngineer(engineer, capturedRefinery, 0.1);
  assert.equal(capturedRefinery.owner, 'enemy');
  game._updateHarvester(harvester, 5);

  assert.equal(harvester.cargo, 200, 'cargo is not unloaded into an enemy account');
  assert.equal(game.credits.player, credits, 'no credits are banked through an enemy refinery');
  assert.equal(harvester._unloadRefineryId, friendlyRefinery.id,
    'the stale dock is released and the harvester is assigned to its other friendly refinery');
  assert.equal(capturedRefinery._unloadHarvesterId, null);
});

test('standby pauses factory progress and defense fire, then both resume when restored', () => {
  const game = arena();
  const factory = game._createBuilding('player', 'factory', 14, 5);
  const turret = game._createBuilding('player', 'turret', 20, 5);
  game._refreshPower();
  assert.equal(game.queueUnit('lightTank', factory.id).ok, true);
  const queued = factory.queue[0];
  queued.progress = 0.25;
  game.setBuildingPower(factory.id, true);
  const credits = game.credits.player;
  assert.equal(game.queueUnit('lightTank', factory.id).ok, false, 'an explicit offline site rejects before spending');
  assert.equal(game.credits.player, credits);
  advance(game, 4);
  assert.equal(queued.progress, 0.25, 'the paid job remains in the queue at the same progress');

  const enemy = game._createUnit('enemy', 'lightTank', 23.5, 6.5);
  turret.cooldown = 0;
  game.setBuildingPower(turret.id, true);
  game._updateBuildings(0.1);
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === turret.id), false);
  game.setBuildingPower(turret.id, false);
  game._updateBuildings(0.1);
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === turret.id), true);
  assert.ok(enemy.hp > 0);

  game.setBuildingPower(factory.id, false);
  advance(game, 1);
  assert.ok(queued.progress > 0.25, 'the original paid production job resumes after restoration');
});

test('automatic queues select an online site, and reject without spending if all sites are off', () => {
  const game = arena();
  const first = game._createBuilding('player', 'factory', 14, 5);
  const second = game._createBuilding('player', 'factory', 20, 5);
  game._refreshPower();
  game.setBuildingPower(first.id, true);
  assert.equal(game.queueUnit('lightTank').buildingId, second.id);
  const explicitCredits = game.credits.player;
  assert.match(game.queueUnit('lightTank', first.id).reason, /production site is on standby/i);
  assert.equal(game.credits.player, explicitCredits, 'an explicitly selected standby site does not spend credits');
  game.setBuildingPower(second.id, true);
  const credits = game.credits.player;
  assert.equal(game.queueUnit('lightTank').ok, false);
  assert.match(game.canQueueUnit('lightTank').reason, /all War Factory sites are on standby/i,
    'unit catalog cards explain that their production sites are off');
  assert.equal(game.credits.player, credits);
});

test('standby disables radar and pauses research until the powered center returns', () => {
  const game = arena();
  const radar = game._createBuilding('player', 'radar', 14, 5);
  const tech = game._createBuilding('player', 'tech', 18, 5);
  game._refreshPower();
  assert.equal(game.radar.player, true);
  assert.equal(game.chooseDoctrine('logistics').ok, true);
  const project = game.research.player.project;
  project.progress = 0.2;
  game.setBuildingPower(radar.id, true);
  assert.equal(game.radar.player, false);
  game.setBuildingPower(tech.id, true);
  advance(game, 5);
  assert.equal(project.progress, 0.2, 'research does not progress while its center is on standby');
  assert.equal(game.chooseDoctrine('signal').ok, false, 'an offline center cannot start research');
  game.setBuildingPower(tech.id, false);
  assert.equal(game.radar.player, false, 'radar remains offline while its own array is on standby');
  game.setBuildingPower(radar.id, false);
  assert.equal(game.radar.player, true);
  game._updateResearch(5);
  assert.ok(project.progress > 0.2, 'research resumes after the center returns');

  const standbyArray = game._createBuilding('player', 'radar', 22, 5);
  game.setBuildingPower(standbyArray.id, true);
  radar.hp = 0;
  radar.powered = true;
  game._refreshPower();
  assert.equal(game.radar.player, false, 'a dead radar cannot keep coverage active through stale powered state');
});

test('standby preserves strategic charge while brownout behavior matches replay 70', () => {
  const current = arena();
  const warhead = current._createBuilding('player', 'warhead', 14, 5);
  current._refreshPower();
  current.superweapon.player = 0.6;
  current.setBuildingPower(warhead.id, true);
  current._updateSuperweapon(10);
  assert.equal(current.superweapon.player, 0.6, 'standby holds the accumulated charge');
  assert.equal(current.useSuperweapon(20, 20).ok, false, 'a standby warhead cannot be fired');
  current.setBuildingPower(warhead.id, false);
  current.power.player.ratio = 1;
  current._updateSuperweapon(10);
  assert.ok(current.superweapon.player > 0.6, 'charging resumes when the warhead returns');

  for (const replayVersion of [70, 71]) {
    const game = arena(replayVersion);
    const weapon = game._createBuilding('player', 'warhead', 14, 5);
    game._refreshPower();
    weapon.powered = false;
    game.power.player.ratio = 0.4;
    game.superweapon.player = 0.4;
    game._updateSuperweapon(10);
    assert.equal(game.superweapon.player, 0.4, `v${replayVersion} brownout pauses without losing charge`);
    game.superweapon.player = 1;
    assert.equal(game.useSuperweapon(3, 3).ok, true,
      `v${replayVersion} keeps the established cast behavior during brownout`);
  }
});

test('harvesters keep cargo while all refineries are off and resume unloading after restoration', () => {
  const game = arena();
  const refinery = game._createBuilding('player', 'refinery', 14, 5);
  const alternate = game._createBuilding('player', 'refinery', 18, 5);
  game._refreshPower();
  const harvester = game._createUnit('player', 'harvester', 15.5, 7.5, { type: 'harvest' });
  harvester.cargo = 80;
  harvester._harvestPhase = 'return';
  game.setBuildingPower(refinery.id, true);
  game.setBuildingPower(alternate.id, true);
  const credits = game.credits.player;
  game._updateHarvester(harvester, 1);
  assert.equal(harvester.cargo, 80);
  assert.equal(harvester.order.type, 'harvest');
  assert.equal(harvester._harvestPhase, 'return');
  assert.equal(game.credits.player, credits);

  game.setBuildingPower(alternate.id, false);
  game._updateHarvester(harvester, 0.1);
  assert.equal(harvester._unloadRefineryId, alternate.id, 'cargo is routed to the remaining online refinery');
  advance(game, 15);
  assert.equal(harvester.cargo, 0, 'the harvester unloads after an online refinery is restored');
  assert.ok(game.credits.player > credits);
});

test('harvesters return to idle without a live refinery in replay 70 and 71', () => {
  for (const replayVersion of [70, 71]) {
    const game = arena(replayVersion);
    const harvester = game._createUnit('player', 'harvester', 15.5, 7.5, { type: 'harvest' });
    harvester.cargo = 50;
    harvester._harvestPhase = 'return';
    game._updateHarvester(harvester, 0.1);
    assert.equal(harvester.order.type, 'idle', `v${replayVersion} preserves no-refinery behavior`);
    assert.equal(harvester.cargo, 50);
  }

  const waiting = arena();
  const refinery = waiting._createBuilding('player', 'refinery', 14, 5);
  waiting.setBuildingPower(refinery.id, true);
  const harvester = waiting._createUnit('player', 'harvester', 15.5, 7.5, { type: 'harvest' });
  harvester.cargo = 50;
  harvester._harvestPhase = 'return';
  waiting._updateHarvester(harvester, 0.1);
  assert.equal(harvester.order.type, 'harvest', 'cargo waits only when a completed standby refinery can return');
  assert.equal(harvester._harvestPhase, 'return');
});

test('save loading normalizes old standby data and preserves current settings', () => {
  const game = arena();
  const refinery = game._createBuilding('player', 'refinery', 14, 5);
  game.setBuildingPower(refinery.id, true);
  const currentSave = JSON.parse(game.serialize());
  const restored = Game.deserialize(currentSave);
  assert.equal(restored.getEntity(refinery.id).powerStandby, true);
  assert.equal(restored.powerStandbyRulesVersion, POWER_STANDBY_RULES_VERSION);

  const oldSave = structuredClone(currentSave);
  oldSave.replayVersion = 70;
  oldSave.buildings.find(building => building.id === refinery.id).powerStandby = true;
  const legacy = Game.deserialize(oldSave);
  assert.equal(legacy.getEntity(refinery.id).powerStandby, false);
  assert.equal(legacy.setBuildingPower(refinery.id, true).ok, false);

  const markerlessNullVersion = structuredClone(currentSave);
  delete markerlessNullVersion.powerStandbyRulesVersion;
  markerlessNullVersion.replayVersion = null;
  markerlessNullVersion.buildings.find(building => building.id === refinery.id).powerStandby = true;
  const normalized = Game.deserialize(markerlessNullVersion);
  assert.equal(normalized.getEntity(refinery.id).powerStandby, false);
  assert.equal(normalized.replayVersion, 70, 'markerless null-version saves retain their pre-v71 behavior');

  const malformed = structuredClone(currentSave);
  malformed.buildings.find(building => building.defId === 'advancedPower').powerStandby = true;
  malformed.buildings.find(building => building.defId === 'command').powerStandby = true;
  const normalizedMalformed = Game.deserialize(malformed);
  assert.equal(normalizedMalformed.buildings.find(building => building.defId === 'advancedPower').powerStandby, false);
  assert.equal(normalizedMalformed.buildings.find(building => building.defId === 'command').powerStandby, false);
});
