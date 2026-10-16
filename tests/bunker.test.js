import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_DEFS, GARRISON_RULES_VERSION, Game } from '../src/game/engine.js';

function arena(replayVersion = null, faction = 'aegis') {
  const game = new Game({ seed: 7419, mode: 'multiplayer', replayVersion, faction });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  game._createBuilding('enemy', 'command', 55, 40);
  return game;
}

function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 30); i++) game.update(1 / 30);
}

function bunkerWithCrew(game, owner = 'player', defs = ['rifle'], x = 20, y = 20) {
  const bunker = game._createBuilding(owner, 'bunker', x, y);
  for (const defId of defs) {
    const unit = game._createUnit(owner, defId, x + 0.5, y + 0.5);
    unit.embarkedIn = bunker.id;
    unit.x = x + 1; unit.y = y + 1;
    unit.cooldown = 0;
    bunker.garrisonIds.push(unit.id);
  }
  return bunker;
}

test('Field Bunker is available to both factions only under rules 79', () => {
  assert.equal(GARRISON_RULES_VERSION, 79);
  for (const faction of ['aegis', 'vesper']) {
    const game = arena(null, faction);
    game._createBuilding('player', 'command', 2, 2);
    game._createBuilding('player', 'barracks', 5, 5);
    assert.equal(game.canBuild('bunker').ok, true);
  }
  const old = arena(78);
  old._createBuilding('player', 'command', 2, 2);
  old._createBuilding('player', 'barracks', 5, 5);
  assert.equal(old.canBuild('bunker').ok, false);
});

test('garrison orders reserve capacity while infantry approach, board only armed infantry, and hide crew from selection', () => {
  const game = arena();
  const bunker = game._createBuilding('player', 'bunker', 20, 20);
  const crew = [
    game._createUnit('player', 'rifle', 17.5, 20.5),
    game._createUnit('player', 'rocket', 17.5, 21.5),
    game._createUnit('player', 'flamer', 24.5, 20.5),
    game._createUnit('player', 'rifle', 17.5, 22.5),
  ];
  game.select(crew.slice(0, 3).map(unit => unit.id));
  assert.equal(game.issueGarrison(bunker.id).ok, true);
  game.select(crew[3].id);
  assert.equal(game.issueGarrison(bunker.id).ok, false, 'pending orders already reserve all three seats');
  game.select(crew[0].id);
  assert.equal(game.issueGarrison(bunker.id).ok, true, 'selected armed infantry can reserve an existing pending seat');
  advance(game, 9);
  assert.equal(bunker.garrisonIds.length, 3);
  assert.deepEqual(new Set(bunker.garrisonIds), new Set(crew.slice(0, 3).map(unit => unit.id)));
  assert.ok(crew.slice(0, 3).every(unit => unit.embarkedIn === bunker.id));
  assert.equal(crew[3].embarkedIn, null);
  assert.equal(game.selectedUnits.includes(crew[0]), false);
  assert.equal(game.units.filter(unit => unit.embarkedIn === bunker.id).length, 3);
});

test('garrison rejects unfinished, foreign, old-rules, and non-armed selections', () => {
  const game = arena();
  const bunker = game._createBuilding('player', 'bunker', 20, 20, 0.5);
  const rifle = game._createUnit('player', 'rifle', 19.5, 20.5);
  const foreign = game._createBuilding('enemy', 'bunker', 30, 20);
  game.select(rifle.id);
  assert.equal(game.issueGarrison(bunker.id).ok, false);
  assert.equal(game.issueGarrison(foreign.id).ok, false);
  const engineer = game._createUnit('player', 'engineer', 19.5, 21.5);
  game.select(engineer.id);
  assert.equal(game.issueGarrison(bunker.id).ok, false);
  const old = arena(78);
  const oldBunker = old._createBuilding('player', 'bunker', 20, 20);
  const oldRifle = old._createUnit('player', 'rifle', 19.5, 20.5);
  old.select(oldRifle.id);
  assert.equal(old.issueGarrison(oldBunker.id).ok, false);
  assert.equal(old.issueEvacuateGarrison(oldBunker.id).ok, false);
});

test('crew fires its normal weapon from outside the hull with one extra tile of reach and normal AA targeting', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle']);
  const rifle = game.getEntity(bunker.garrisonIds[0]);
  const target = game._createUnit('enemy', 'buggy', 26.2, 21);
  game._updateBunkerGarrison(bunker, 0);
  const shot = game.effects.find(effect => effect.type === 'projectile' && effect.sourceId === rifle.id);
  assert.ok(shot, 'the target is reachable from the firing port with the bunker range bonus');
  assert.ok(shot.launchX > bunker.x + bunker.w, 'projectile starts outside the bunker footprint');
  assert.equal(shot.targetId, target.id);
  target.hp = 0;
  const air = game._createUnit('enemy', 'dropship', 24, 21);
  const rocket = game._createUnit('player', 'rocket', 21, 21);
  rocket.embarkedIn = bunker.id; rocket.cooldown = 0;
  bunker.garrisonIds.push(rocket.id);
  rifle.cooldown = 0;
  game.effects = [];
  game._updateBunkerGarrison(bunker, 0);
  const airShots = game.effects.filter(effect => effect.type === 'projectile');
  assert.deepEqual(airShots.map(effect => [effect.sourceId, effect.targetId]), [[rocket.id, air.id]],
    'the Rocket Trooper actually fires at air while the ready Rifle Squad cannot');
  assert.ok(bunker.garrisonFireUntil > game.time);
});

test('bunker crew respects rock line of sight and auto-selects another clear visible target', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle']);
  const blocked = game._createUnit('enemy', 'buggy', 26.2, 21);
  const clear = game._createUnit('enemy', 'buggy', 21, 26.2);
  game.terrain[21][24].type = 'rock';
  game.terrain[21][24].walkable = false;
  game.getEntity(bunker.garrisonIds[0]).cooldown = 0;
  game._updateBunkerGarrison(bunker, 0);
  const shot = game.effects.find(effect => effect.type === 'projectile' && effect.sourceId === bunker.garrisonIds[0]);
  assert.ok(shot);
  assert.equal(shot.targetId, clear.id);
  assert.notEqual(shot.targetId, blocked.id);
});

test('focus fire uses occupant weapon restrictions; queued focus is rejected and Stop clears the focus', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rocket']);
  const air = game._createUnit('enemy', 'dropship', 24, 21);
  game.select(bunker.id);
  assert.equal(game.issueAttack(air.id, true).ok, false);
  assert.equal(game.issueAttack(air.id).ok, true);
  assert.equal(bunker._garrisonTargetId, air.id);
  assert.equal(game.issueStop().ok, true);
  assert.equal(bunker._garrisonTargetId, undefined);
});

test('flame damage exposes bunker crew to 35 percent raw damage through the normal armor path', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle']);
  const crew = game.getEntity(bunker.garrisonIds[0]);
  const beforeCrew = crew.hp, beforeHull = bunker.hp;
  game._applyDamage(bunker, 100, 'flame', 'enemy', null);
  assert.equal(crew.hp, beforeCrew - 52.5, '100 raw flame damage exposes crew to 35%, then infantry flame armor applies 1.5x');
  assert.equal(bunker.hp, beforeHull - 90, 'the bunker hull independently takes normal structure flame damage');
  assert.equal(crew.embarkedIn, bunker.id);
});

test('engineer capture is rejected while occupied, and succeeds once the bunker is empty', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'enemy', ['rifle']);
  bunker.hp = bunker.maxHp * 0.7;
  const engineer = game._createUnit('player', 'engineer', bunker.x + 0.5, bunker.y + 0.5,
    { type: 'engineer', targetId: bunker.id });
  game.select(engineer.id);
  const capture = game.issueEngineer(bunker.id);
  assert.equal(capture.ok, false);
  assert.match(capture.reason, /Clear the enemy Field Bunker/);
  // Keep the arrival-time guard as a second line of defense for stale orders.
  game._updateEngineer(engineer, bunker, 0.1);
  assert.equal(bunker.owner, 'enemy');
  assert.equal(engineer.hp > 0, true);
  const crew = game.getEntity(bunker.garrisonIds[0]);
  bunker.garrisonIds = [];
  crew.embarkedIn = null;
  assert.equal(game.issueEngineer(bunker.id).ok, true);
  game._updateEngineer(engineer, bunker, 0.1);
  assert.equal(bunker.owner, 'player');
});

test('blocked evacuation waits for space; bunker destruction ejects at half health or loses crew only if boxed in', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle']);
  const crew = game.getEntity(bunker.garrisonIds[0]);
  const inbound = game._createUnit('player', 'rocket', bunker.x - 2, bunker.y + 0.5,
    { type: 'garrison', bunkerId: bunker.id, approachX: bunker.x - 1 + 0.5, approachY: bunker.y + 0.5 });
  for (let y = bunker.y - 3; y < bunker.y + bunker.h + 3; y++) for (let x = bunker.x - 3; x < bunker.x + bunker.w + 3; x++) {
    if (x >= bunker.x && x < bunker.x + bunker.w && y >= bunker.y && y < bunker.y + bunker.h) continue;
    game.terrain[y][x].walkable = false;
    game.terrain[y][x].type = 'rock';
  }
  const evacuate = game.issueEvacuateGarrison(bunker.id);
  assert.equal(evacuate.ok, true);
  assert.equal(evacuate.remaining, 1);
  assert.equal(inbound.order.type, 'idle', 'evacuation cancels friendly infantry still approaching');
  assert.equal(crew.hp > 0, true);
  game.terrain[bunker.y - 1][bunker.x].walkable = true;
  game.terrain[bunker.y - 1][bunker.x].type = 'sand';
  game._updateBunkerGarrison(bunker, 0.1);
  assert.equal(crew.embarkedIn, null);
  assert.equal(bunker.garrisonIds.length, 0);

  const pendingOnlyBunker = game._createBuilding('player', 'bunker', 50, 30);
  const pendingOnly = game._createUnit('player', 'rifle', 47, 30.5,
    { type: 'garrison', bunkerId: pendingOnlyBunker.id, approachX: 49.5, approachY: 30.5 });
  const pendingEvacuation = game.issueEvacuateGarrison(pendingOnlyBunker.id);
  assert.equal(pendingEvacuation.ok, true, 'evacuation may cancel pending-only boarding orders');
  assert.equal(pendingEvacuation.remaining, 0);
  assert.equal(pendingOnly.order.type, 'idle');

  const doomedBunker = bunkerWithCrew(game, 'player', ['rocket'], 35, 25);
  const doomedCrew = game.getEntity(doomedBunker.garrisonIds[0]);
  for (let y = doomedBunker.y - 3; y < doomedBunker.y + doomedBunker.h + 3; y++) for (let x = doomedBunker.x - 3; x < doomedBunker.x + doomedBunker.w + 3; x++) {
    if (x >= doomedBunker.x && x < doomedBunker.x + doomedBunker.w && y >= doomedBunker.y && y < doomedBunker.y + doomedBunker.h) continue;
    game.terrain[y][x].walkable = false;
    game.terrain[y][x].type = 'rock';
  }
  doomedBunker.hp = 0;
  game._destroyEntity(doomedBunker, 'enemy', null);
  assert.equal(doomedCrew.hp, 0);
  assert.equal(doomedCrew.embarkedIn, null);

  const survivorBunker = bunkerWithCrew(game, 'player', ['rifle'], 48, 25);
  const survivor = game.getEntity(survivorBunker.garrisonIds[0]);
  const survivorHp = survivor.hp;
  survivorBunker.hp = 0;
  game._destroyEntity(survivorBunker, 'enemy', null);
  assert.equal(survivor.embarkedIn, null);
  assert.equal(survivor.hp, survivorHp * 0.5);
});

test('selling a bunker emergency-ejects survivors at half health', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle']);
  const crew = game.getEntity(bunker.garrisonIds[0]);
  const before = crew.hp;
  assert.equal(game.sellBuilding(bunker.id).ok, true);
  assert.equal(crew.embarkedIn, null);
  assert.equal(crew.hp, before * 0.5);
  assert.equal(bunker.garrisonIds.length, 0);
});

test('v79 saves preserve valid crew, markerless v78 saves pin old rules, and elimination recognizes armed bunker crew', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle']);
  const restored = Game.deserialize(game.serialize());
  const restoredBunker = restored.getEntity(bunker.id);
  assert.deepEqual(restoredBunker.garrisonIds, bunker.garrisonIds);
  assert.equal(restored.getEntity(bunker.garrisonIds[0]).embarkedIn, bunker.id);

  const oldData = JSON.parse(game.serialize());
  oldData.replayVersion = null;
  delete oldData.garrisonRulesVersion;
  const old = Game.deserialize(oldData);
  assert.equal(old.replayVersion, GARRISON_RULES_VERSION - 1);
  assert.equal(old.issueGarrison(bunker.id).ok, false);
  assert.equal(old.canBuild('bunker').ok, false);

  const elimination = arena();
  elimination.mode = 'skirmish'; elimination.victoryMode = 'elimination';
  const activeBunker = bunkerWithCrew(elimination, 'player', ['rifle']);
  elimination._createBuilding('enemy', 'command', 52, 40);
  elimination._tick(0.01);
  assert.equal(elimination.status, 'playing', 'armed crew inside a noncritical bunker keeps an elimination force active');
  elimination.units.find(unit => unit.embarkedIn === activeBunker.id).hp = 0;
  elimination._tick(0.01);
  assert.equal(elimination.status, 'defeat', 'an empty bunker alone cannot prolong elimination');
});

test('deserialization sanitizes duplicate, foreign, and ineligible bunker occupants', () => {
  const game = arena();
  const bunker = bunkerWithCrew(game, 'player', ['rifle', 'rocket']);
  const engineer = game._createUnit('player', 'engineer', bunker.x + 1, bunker.y + 1);
  const foreign = game._createUnit('enemy', 'rifle', bunker.x + 1, bunker.y + 1);
  engineer.embarkedIn = bunker.id;
  foreign.embarkedIn = bunker.id;
  bunker.garrisonIds.push(engineer.id, foreign.id, bunker.garrisonIds[0]);
  const restored = Game.deserialize(game.serialize());
  const restoredBunker = restored.getEntity(bunker.id);
  assert.deepEqual(new Set(restoredBunker.garrisonIds), new Set(bunker.garrisonIds.slice(0, 2)));
  assert.equal(restored.getEntity(engineer.id).embarkedIn, null);
  assert.equal(restored.getEntity(foreign.id).embarkedIn, null);
});
