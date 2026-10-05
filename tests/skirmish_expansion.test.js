import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function readyForExpansion(seed = 1, difficulty = 'normal', victoryMode = 'elimination') {
  const game = new Game({ seed, difficulty, victoryMode });
  for (const defId of ['refinery', 'tech']) {
    const site = game._findAiPlacement(defId);
    assert.ok(site, `fixture can place ${defId}`);
    game._createBuilding('enemy', defId, site.x, site.y, 1);
  }
  game.time = 150;
  game.credits.enemy = 6000;
  return game;
}

test('a live player Dominion hold frees expansion production and defers the retry in v45', () => {
  const game = readyForExpansion(482, 'normal', 'dominion');
  assert.equal(game._aiManageExpansion(), true);
  const factory = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
  const site = { x: game._aiExpansionTarget.x, y: game._aiExpansionTarget.y };
  assert.equal(factory.queue[0].defId, 'mcv');
  factory.queue[0].progress = 0.4;
  game.credits.enemy = 200;
  game.relayDominion.owner = 'player';
  assert.equal(game._aiManageExpansion(), true);
  assert.equal(factory.queue.some(item => item.defId === 'mcv'), false);
  assert.equal(game.credits.enemy, 3210, 'the ordinary queue cancellation refund is available for defenders');
  assert.deepEqual({ x: game._aiExpansionTarget.x, y: game._aiExpansionTarget.y }, site);
  assert.equal(game._aiExpansionTarget.stage, 'funding');
  assert.equal(game._aiExpansionTarget.retryAt, game.time + 90);
  assert.equal(game.commandOwner, 'player');
  const cancelled = game.events.filter(event => event.type === 'unitCancelled' && event.defId === 'mcv');
  assert.equal(cancelled.length, 1);

  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(restored._aiExpansionTarget, game._aiExpansionTarget);
  game.relayDominion.owner = null;
  assert.equal(game._aiManageExpansion(), false, 'a brief relay contest cannot restart the rig');
  assert.equal(factory.queue.some(item => item.defId === 'mcv'), false);

  const olderReplay = readyForExpansion(482, 'normal', 'dominion');
  olderReplay.replayVersion = 44;
  assert.equal(olderReplay._aiManageExpansion(), true);
  const oldFactory = olderReplay.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
  olderReplay.relayDominion.owner = 'player';
  assert.equal(olderReplay._aiManageExpansion(), false);
  assert.equal(oldFactory.queue.some(item => item.defId === 'mcv'), true,
    'verified v44 orders retain the old expansion decision');

  const unversionedOldSave = JSON.parse(olderReplay.serialize());
  delete unversionedOldSave.replayVersion;
  delete unversionedOldSave.relayDominionExpansionPauseRulesVersion;
  assert.equal(Game.deserialize(unversionedOldSave).replayVersion, 44);
});

test('v7 and easy skirmishes keep the established no-expansion AI', () => {
  const legacy = readyForExpansion();
  legacy.replayVersion = 7;
  assert.equal(legacy._aiManageExpansion(), false);
  assert.equal(legacy.units.some(unit => unit.owner === 'enemy' && unit.defId === 'mcv'), false);

  const easy = readyForExpansion(2, 'easy');
  assert.equal(easy._aiManageExpansion(), false);
  assert.equal(easy.units.some(unit => unit.owner === 'enemy' && unit.defId === 'mcv'), false);
});

test('AI skips an expansion when the crystal field is unreachable or the site is visibly threatened', () => {
  const blocked = readyForExpansion();
  for (let y = 0; y < blocked.height; y++) {
    blocked.terrain[y][38].walkable = false;
    blocked.terrain[y][38].buildable = false;
  }
  const components = blocked._groundComponents();
  const enemyCommand = blocked.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
  const approach = blocked._nearestPassable(enemyCommand.x + 1, enemyCommand.y + 1,
    enemyCommand.x + 1, enemyCommand.y + 1);
  const baseComponent = components[approach[1] * blocked.width + approach[0]];
  for (let y = 0; y < blocked.height; y++) for (let x = 0; x < blocked.width; x++) {
    const tile = blocked.terrain[y][x];
    if (tile.type === 'crystal' && components[y * blocked.width + x] === baseComponent) tile.resource = 0;
  }
  assert.equal(blocked._aiExpansionSite(), null);
  assert.equal(blocked._aiManageExpansion(), false);

  const threatened = readyForExpansion();
  const site = threatened._aiExpansionSite();
  assert.ok(site);
  assert.equal(threatened._aiManageExpansion(), true);
  const target = threatened._aiExpansionTarget;
  const rig = threatened._createUnit('enemy', 'mcv', site.x + 1.5, site.y + 1.5);
  threatened._createUnit('enemy', 'buggy', site.x + 5, site.y + 1.5);
  threatened._createUnit('player', 'lightTank', site.x + 1.5, site.y + 1.5);
  assert.equal(threatened._aiExpansionThreatened(site.x + 1.5, site.y + 1.5), true);
  threatened._aiExpansionTarget = { x: site.x, y: site.y, stage: 'queued' };
  assert.equal(threatened._aiManageExpansion(), false);
  assert.equal(threatened._aiExpansionTarget.x, target.x);
  assert.ok(threatened._aiExpansionTarget.retryAt > threatened.time);
  assert.equal(threatened.getEntity(rig.id)?.defId, 'mcv', 'an unsafe approach keeps the rig for a later retry');
});

test('normal AI deploys one reachable outpost, builds its local refinery, and adds a third harvester', () => {
  const game = readyForExpansion();
  game.replayVersion = 8;
  assert.equal(game._aiExpansionSite() != null, true);
  assert.equal(game._aiManageExpansion(), true);
  assert.ok(game.buildings.some(building => building.owner === 'enemy' &&
    building.queue.some(item => item.defId === 'mcv')));

  for (let i = 0; i < 2400 && game.buildings.filter(building =>
    building.owner === 'enemy' && building.defId === 'command').length < 2; i++) game.update(0.1);
  const yards = game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'command');
  assert.equal(yards.length, 2, 'the MCV reaches its selected site and deploys');
  const homeYard = yards.find(building => building.x > 40);
  const outpost = yards.find(building => building.id !== homeYard.id);
  assert.equal(game._aiExpansionTarget.yardId, outpost.id);

  for (let i = 0; i < 1000 && !game.buildings.some(building => building.owner === 'enemy' &&
      building.defId === 'refinery' && Math.hypot(Math.max(0, outpost.x - (building.x + building.w)),
      Math.max(0, building.x - (outpost.x + outpost.w)), Math.max(0, outpost.y - (building.y + building.h)),
      Math.max(0, building.y - (outpost.y + outpost.h))) <= 8); i++) game.update(0.1);
  const remoteRefinery = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'refinery' &&
    Math.hypot(Math.max(0, outpost.x - (building.x + building.w)),
      Math.max(0, building.x - (outpost.x + outpost.w)), Math.max(0, outpost.y - (building.y + building.h)),
      Math.max(0, building.y - (outpost.y + outpost.h))) <= 8);
  assert.ok(remoteRefinery, 'the second yard receives a nearby refinery');
  remoteRefinery.progress = 1;
  game.credits.enemy = 6000;
  const harvesterCount = game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'harvester').length;
  game._aiTick();
  assert.equal(game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'harvester').length +
    game.buildings.filter(building => building.owner === 'enemy').flatMap(building => building.queue)
      .filter(item => item.defId === 'harvester').length, Math.max(3, harvesterCount),
  'the operating outpost permits one additional harvester');
  assert.equal(game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'command').length, 2,
    'the expansion limit is one outpost');
});

test('an expansion in progress survives save and load without choosing a different site', () => {
  const game = readyForExpansion(41);
  game.replayVersion = 8;
  game._aiManageExpansion();
  const site = { x: game._aiExpansionTarget.x, y: game._aiExpansionTarget.y };
  for (let i = 0; i < 120; i++) game.update(0.1);
  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(restored._aiExpansionTarget, game._aiExpansionTarget);
  for (let i = 0; i < 100; i++) {
    game.update(0.1);
    restored.update(0.1);
  }
  assert.deepEqual(restored._aiExpansionTarget, game._aiExpansionTarget);
  assert.deepEqual(restored.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'mcv')
    .map(unit => [unit.x, unit.y, unit.order]),
  game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'mcv').map(unit => [unit.x, unit.y, unit.order]));
  assert.equal(restored._aiExpansionTarget.x, site.x);
  assert.equal(restored._aiExpansionTarget.y, site.y);
});

test('a sustained Delta Crossing match funds and completes its remote outpost', () => {
  const game = new Game({ seed: 481516, mapId: 'delta-crossing', difficulty: 'normal', victoryMode: 'elimination' });
  game.replayVersion = 8;
  game.units = game.units.filter(unit => unit.owner === 'enemy');
  for (const building of game.buildings) if (building.owner === 'player') building.hp = 1e9;

  for (let step = 0; step < 5000 && game.buildings.filter(building => building.owner === 'enemy' &&
      building.defId === 'refinery').length < 3; step++) game.update(0.1);
  for (let step = 0; step < 20 && game._aiExpansionTarget; step++) game.update(0.1);

  assert.equal(game.status, 'playing', 'the protected opposing base keeps the simulation live');
  assert.equal(game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'command').length, 2);
  assert.equal(game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'refinery').length, 3);
  assert.equal(game._aiExpansionTarget, null, 'the completed refinery clears the one-outpost plan');
});
