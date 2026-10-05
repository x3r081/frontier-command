import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCTRINE_DEFS, DOCTRINE_REPLACEMENT_COST, DOCTRINE_REPLACEMENT_RULES_VERSION,
  DOCTRINE_REPLACEMENT_TIME, Game } from '../src/game/engine.js';

function poweredTech(game, owner = 'player') {
  game._createBuilding(owner, 'tech', owner === 'player' ? 4 : 54, owner === 'player' ? 36 : 4);
  game._refreshPower();
}

test('doctrine selection is mutually exclusive, costs credits, and pauses without powered tech', () => {
  const game = new Game({ seed: 7, mode: 'multiplayer' });
  game.replayVersion = DOCTRINE_REPLACEMENT_RULES_VERSION - 1;
  assert.equal(game.chooseDoctrine('logistics').ok, false);
  poweredTech(game);
  const credits = game.credits.player;
  assert.deepEqual(game.chooseDoctrine('logistics'), { ok: true });
  assert.equal(game.credits.player, credits - DOCTRINE_DEFS.logistics.cost);
  assert.equal(game.chooseDoctrine('signal').ok, false);
  game._updateResearch(12);
  assert.equal(game.research.player.project.progress, 0.25);
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').powered = false;
  game._updateResearch(8);
  assert.equal(game.research.player.project.progress, 0.25);
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').hp = 0;
  game._updateResearch(3);
  assert.equal(game.research.player.project.progress, 0.25);
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').hp = 760;
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').powered = true;
  game._updateResearch(36);
  assert.equal(game.research.player.doctrine, 'logistics');
  assert.equal(game.research.player.project, null);
  assert.equal(game.chooseDoctrine('signal').ok, false);
  const oldSave = JSON.parse(game.serialize());
  delete oldSave.research;
  assert.deepEqual(Game.deserialize(oldSave).research, {
    player: { doctrine: null, project: null, tactical: null, tacticalProject: null, replacementUsed: false },
    enemy: { doctrine: null, project: null, tactical: null, tacticalProject: null, replacementUsed: false },
  });
});

test('version 42 permits one costly doctrine replacement while the active effect and tactical package persist', () => {
  const game = new Game({ seed: 22, mode: 'multiplayer' });
  game.replayVersion = DOCTRINE_REPLACEMENT_RULES_VERSION;
  game.credits.player = 5000;
  poweredTech(game);
  assert.equal(game.chooseDoctrine('siege').ok, true);
  game._updateResearch(DOCTRINE_DEFS.siege.researchTime);
  assert.equal(game.research.player.doctrine, 'siege');
  assert.equal(game.chooseTacticalPackage('breach').ok, true);
  game._updateResearch(38);
  assert.equal(game.research.player.tactical, 'breach');

  const before = game.credits.player;
  assert.equal(game.chooseDoctrine('siege').ok, false, 'the active doctrine cannot be selected again');
  assert.equal(game.chooseDoctrine('logistics').ok, true);
  assert.equal(game.credits.player, before - DOCTRINE_REPLACEMENT_COST);
  assert.deepEqual(game.research.player.project, { id: 'logistics', progress: 0 });
  assert.equal(game.research.player.doctrine, 'siege', 'the completed doctrine remains active during replacement');
  assert.equal(game.research.player.tactical, 'breach', 'the tactical tier is independent');

  game._updateResearch(DOCTRINE_REPLACEMENT_TIME / 2);
  assert.equal(game.research.player.project.progress, 0.5);
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').powered = false;
  game._updateResearch(20);
  assert.equal(game.research.player.project.progress, 0.5, 'replacement pauses without powered tech');
  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(restored.research.player, game.research.player);
  restored.buildings.find(b => b.owner === 'player' && b.defId === 'tech').powered = true;
  restored._updateResearch(DOCTRINE_REPLACEMENT_TIME / 2);
  assert.equal(restored.research.player.doctrine, 'logistics');
  assert.equal(restored.research.player.project, null);
  assert.equal(restored.research.player.replacementUsed, true);
  assert.equal(restored.research.player.tactical, 'breach');
  assert.equal(restored.chooseDoctrine('signal').ok, false, 'a second replacement is not allowed');
});

test('pre-version-42 doctrine rules still keep the completed choice permanent', () => {
  const game = new Game({ seed: 23, mode: 'multiplayer' });
  game.replayVersion = DOCTRINE_REPLACEMENT_RULES_VERSION - 1;
  poweredTech(game);
  game.research.player.doctrine = 'siege';
  const credits = game.credits.player;
  assert.equal(game.chooseDoctrine('logistics').ok, false);
  assert.equal(game.credits.player, credits);
  assert.equal(game.research.player.project, null);
});

test('an unversioned version-41 save cannot gain doctrine replacement after loading', () => {
  const game = new Game({ seed: 25, mode: 'skirmish' });
  poweredTech(game);
  game.research.player.doctrine = 'siege';
  const legacy = JSON.parse(game.serialize());
  delete legacy.doctrineReplacementRulesVersion;
  const restored = Game.deserialize(legacy);
  assert.equal(restored.replayVersion, 41);
  assert.equal(restored.chooseDoctrine('logistics').ok, false);
  assert.equal(restored.research.player.doctrine, 'siege');
  assert.equal(Game.deserialize(game.serialize()).replayVersion, undefined);
});

test('campaign research keeps its doctrine permanent after completion', () => {
  const game = new Game({ seed: 24, mode: 'campaign' });
  poweredTech(game);
  game.research.player.doctrine = 'siege';
  const credits = game.credits.player;
  assert.equal(game.chooseDoctrine('logistics').ok, false);
  assert.equal(game.credits.player, credits);
  assert.equal(game.research.player.doctrine, 'siege');
  assert.equal(game.research.player.project, null);
});

function doctrineAdaptationFixture(version = DOCTRINE_REPLACEMENT_RULES_VERSION) {
  const game = new Game({ seed: 91 });
  game.replayVersion = version;
  poweredTech(game, 'enemy');
  game.credits.enemy = DOCTRINE_REPLACEMENT_COST + 1250;
  game.commandEnergy.enemy = 100;
  game.relays.forEach(relay => { relay.owner = null; relay.progress = 0; });
  game.research.enemy.doctrine = 'logistics';
  game.research.enemy.tactical = 'breach';
  return game;
}

test('version 42 skirmish AI adapts once to a clearly stronger visible defense situation', () => {
  const game = doctrineAdaptationFixture();
  const observer = game._createUnit('enemy', 'scout', 32.5, 20.5);
  observer.sight = 10;
  for (const [x, y] of [[31, 19], [34, 19], [37, 19]]) {
    const defense = game._createBuilding('player', 'turret', x, y);
    defense.powered = true;
    assert.equal(game.isVisible(defense, 'enemy'), true);
  }

  game._aiTick();
  assert.equal(game.research.enemy.project?.id, 'siege');
  assert.equal(game.research.enemy.doctrine, 'logistics', 'the active benefit persists during research');
  assert.equal(game.research.enemy.replacementUsed, true);
  assert.ok(game.credits.enemy <= 1250 && game.credits.enemy >= 0,
    'the replacement cost is charged before any other bounded AI spending');
  assert.equal(game.research.enemy.tactical, 'breach', 'replacement leaves the tactical tier untouched');
  game._updateResearch(DOCTRINE_REPLACEMENT_TIME);
  assert.equal(game.research.enemy.doctrine, 'siege');

  game.buildings.filter(building => building.owner === 'player' && building.defId === 'turret')
    .forEach(building => { building.hp = 0; });
  game.relays[0].owner = 'enemy'; game.relays[0].progress = 1;
  game.relays[1].owner = 'enemy'; game.relays[1].progress = 1;
  game._aiTick();
  assert.equal(game.research.enemy.project, null, 'the AI cannot start a second replacement');
  assert.equal(game.research.enemy.doctrine, 'siege');
});

test('version 42 skirmish AI does not adapt to hidden defenses and version 41 never adapts', () => {
  const current = doctrineAdaptationFixture();
  for (const [x, y] of [[2, 2], [5, 2], [8, 2]]) {
    const defense = current._createBuilding('player', 'turret', x, y);
    defense.powered = true;
    assert.equal(current.isVisible(defense, 'enemy'), false);
  }
  current._aiTick();
  assert.equal(current.research.enemy.project, null);
  assert.equal(current.research.enemy.replacementUsed, false);

  const legacy = doctrineAdaptationFixture(DOCTRINE_REPLACEMENT_RULES_VERSION - 1);
  const observer = legacy._createUnit('enemy', 'scout', 32.5, 20.5);
  observer.sight = 10;
  for (const [x, y] of [[31, 19], [34, 19], [37, 19]]) {
    const defense = legacy._createBuilding('player', 'turret', x, y);
    defense.powered = true;
  }
  legacy._aiTick();
  assert.equal(legacy.research.enemy.doctrine, 'logistics');
  assert.equal(legacy.research.enemy.project, null);
  assert.equal(legacy.research.enemy.replacementUsed, false);
});

test('doctrine progress and completion survive serialization deterministically', () => {
  const game = new Game({ seed: 8, mode: 'multiplayer' });
  poweredTech(game);
  assert.equal(game.chooseDoctrine('siege').ok, true);
  game._updateResearch(17.3);
  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(restored.research, game.research);
  game._updateResearch(40.7);
  restored._updateResearch(40.7);
  assert.deepEqual(restored.research, game.research);
  assert.equal(game.research.player.doctrine, 'siege');
});

test('AI selects Logistics when its economy has multiple harvesters', () => {
  const game = new Game({ seed: 91 });
  poweredTech(game, 'enemy');
  game._createUnit('enemy', 'harvester', 51.5, 5.5);
  game._createUnit('enemy', 'harvester', 52.5, 5.5);
  game._aiTick();
  assert.equal(game.research.enemy.project?.id, 'logistics');
});

test('version 27 replay retains the original seed-based AI research choice', () => {
  const current = new Game({ seed: 91 });
  const legacy = new Game({ seed: 91 });
  for (const game of [current, legacy]) {
    poweredTech(game, 'enemy');
    game._createUnit('enemy', 'harvester', 51.5, 5.5);
    game._createUnit('enemy', 'harvester', 52.5, 5.5);
  }
  current.replayVersion = 28;
  legacy.replayVersion = 27;
  current._aiTick(); legacy._aiTick();
  assert.equal(current.research.enemy.project?.id, 'logistics');
  assert.equal(legacy.research.enemy.project?.id, 'siege');
});

test('AI selects Siege when it has seen multiple powered ground defenses', () => {
  const game = new Game({ seed: 91 });
  poweredTech(game, 'enemy');
  const observer = game._createUnit('enemy', 'scout', 30.5, 20.5);
  observer.sight = 10;
  for (const [x, y] of [[32, 20], [34, 20]]) {
    const defense = game._createBuilding('player', 'turret', x, y);
    defense.powered = true;
  }
  assert.ok(game.buildings.filter(building => building.owner === 'player' && building.defId === 'turret')
    .every(building => game.isVisible(building, 'enemy')));
  game._aiTick();
  assert.equal(game.research.enemy.project?.id, 'siege');
});

test('visible economy buildings do not count as ground defenses for doctrine choice', () => {
  const game = new Game({ seed: 91 });
  poweredTech(game, 'enemy');
  const observer = game._createUnit('enemy', 'scout', 30.5, 20.5);
  observer.sight = 10;
  const enemyBuildings = game.buildings.filter(building => building.owner === 'enemy' &&
    building.hp > 0 && building.progress >= 1);
  const before = game._aiDoctrineForSituation(enemyBuildings);
  const power = game._createBuilding('player', 'power', 32, 20);
  power.powered = true;
  assert.equal(game.isVisible(power, 'enemy'), true);
  assert.equal(game._aiDoctrineForSituation(enemyBuildings), before);
});

test('AI selects Signal when it secures relays and is low on command energy', () => {
  const game = new Game({ seed: 91 });
  poweredTech(game, 'enemy');
  game.relays[0].owner = 'enemy'; game.relays[0].progress = 1;
  game.relays[1].owner = 'enemy'; game.relays[1].progress = 1;
  game.commandEnergy.enemy = 20;
  game._aiTick();
  assert.equal(game.research.enemy.project?.id, 'signal');
});

test('AI doctrine tie-break is deterministic and an in-progress choice survives load', () => {
  const a = new Game({ seed: 91 });
  const b = new Game({ seed: 91 });
  poweredTech(a, 'enemy'); poweredTech(b, 'enemy');
  // Flatten context scores so the seed-based stable tie order decides.
  for (const game of [a, b]) {
    game.credits.enemy = 3000;
    game.commandEnergy.enemy = 100;
    game.relays.forEach(relay => { relay.owner = null; relay.progress = 0; });
  }
  a._aiTick(); b._aiTick();
  assert.ok(a.research.enemy.project);
  assert.equal(a.research.enemy.project.id, 'siege');
  assert.deepEqual(a.research.enemy, b.research.enemy);
  const restored = Game.deserialize(a.serialize());
  restored._aiTick();
  assert.deepEqual(restored.research.enemy, a.research.enemy,
    'an existing project is not reconsidered after loading');
});

test('research effects change harvesting, hostile structure damage, and command recovery', () => {
  const economy = new Game({ seed: 15, mode: 'multiplayer' });
  const crystal = economy.terrain.flatMap((row, y) => row.map((tile, x) => ({ tile, x, y })))
    .find(({ tile }) => tile.resource > 100);
  assert.ok(crystal);
  const harvester = economy.units.find(u => u.owner === 'player' && u.defId === 'harvester');
  harvester.x = crystal.x + 0.5; harvester.y = crystal.y + 0.5;
  harvester.cargo = 0; harvester._harvestPhase = 'field';
  harvester._harvestTile = { x: crystal.x, y: crystal.y };
  harvester.order = { type: 'harvest', x: crystal.x, y: crystal.y };
  const logistics = Game.deserialize(economy.serialize());
  logistics.research.player.doctrine = 'logistics';
  economy._updateHarvester(harvester, 0.1);
  const boostedHarvester = logistics.getEntity(harvester.id);
  logistics._updateHarvester(boostedHarvester, 0.1);
  assert.ok(Math.abs(boostedHarvester.cargo / harvester.cargo - 1.25) < 1e-8);

  const combat = new Game({ seed: 16, mode: 'multiplayer' });
  const siege = Game.deserialize(combat.serialize());
  siege.research.player.doctrine = 'siege';
  const enemyId = combat.buildings.find(b => b.owner === 'enemy' && b.defId === 'command').id;
  const ownId = combat.buildings.find(b => b.owner === 'player' && b.defId === 'command').id;
  combat._applyDamage(combat.getEntity(enemyId), 100, 'ion', 'player');
  siege._applyDamage(siege.getEntity(enemyId), 100, 'ion', 'player');
  assert.ok(Math.abs((siege.getEntity(enemyId).hp - siege.getEntity(enemyId).maxHp) /
    (combat.getEntity(enemyId).hp - combat.getEntity(enemyId).maxHp) - 1.2) < 1e-8);
  combat._applyDamage(combat.getEntity(ownId), 100, 'ion', 'player');
  siege._applyDamage(siege.getEntity(ownId), 100, 'ion', 'player');
  assert.equal(siege.getEntity(ownId).hp, combat.getEntity(ownId).hp,
    'siege does not amplify friendly fire');

  const command = new Game({ seed: 17, mode: 'multiplayer' });
  const signal = Game.deserialize(command.serialize());
  signal.research.player.doctrine = 'signal';
  command.commandEnergy.player = 0; signal.commandEnergy.player = 0;
  command._updateRelays(1); signal._updateRelays(1);
  assert.ok(Math.abs(signal.commandEnergy.player / command.commandEnergy.player - 1.25) < 1e-8);
  command.commandCooldowns.player.scan = 10; signal.commandCooldowns.player.scan = 10;
  command._tick(0.1); signal._tick(0.1);
  assert.ok(Math.abs(command.commandCooldowns.player.scan - 9.9) < 1e-8);
  assert.ok(Math.abs(signal.commandCooldowns.player.scan - 9.88) < 1e-8);
});
