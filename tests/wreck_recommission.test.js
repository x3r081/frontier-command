import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, UNIT_DEFS, WRECK_RECOMMISSION_COST_FRACTION, WRECK_RECOMMISSION_HEALTH_FRACTION,
  WRECK_RECOMMISSION_RULES_VERSION, WRECK_RECOMMISSION_SECONDS,
} from '../src/game/engine.js';

function arena(options = {}) {
  const game = new Game({ seed: 73, ...options });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function setup({ defId = 'buggy', owner = 'player', faction = 'aegis' } = {}) {
  const game = arena({ faction });
  const wreck = { id: 'wreck1', x: 20.5, y: 20.5, value: 60, faction: 'vesper',
    expiresAt: 120, restoreDefId: defId, restoreUsed: false };
  game.wrecks.push(wreck);
  const engineer = game._createUnit(owner, 'engineer', 20.5, 20.5);
  const workshop = game._createBuilding(owner, 'serviceBay', 16, 19);
  workshop.powered = true;
  game.credits[owner] = 2000;
  game.select(engineer.id);
  return { game, wreck, engineer, workshop };
}

function advance(game, unit, seconds) {
  const steps = Math.round(seconds * 10);
  for (let i = 0; i < steps; i++) {
    game.time += 0.1;
    game._updateUnit(unit, 0.1);
  }
}

test('a powered workshop restores an armed vehicle, charges on completion, and preserves the Engineer', () => {
  const { game, wreck, engineer } = setup();
  const cost = Math.ceil(450 * WRECK_RECOMMISSION_COST_FRACTION);
  assert.equal(game.canRecommissionWreck(wreck.id).ok, true);
  assert.equal(game.canRecommissionWreck(wreck.id).cost, cost);
  assert.equal(game.issueRecommissionWreck(wreck.id).ok, true);
  assert.deepEqual(engineer.order, { type: 'recommissionWreck', wreckId: wreck.id });
  advance(game, engineer, WRECK_RECOMMISSION_SECONDS - 0.1);
  assert.equal(game.credits.player, 2000);
  assert.equal(game.wrecks.length, 1);
  advance(game, engineer, 0.1);
  const restored = game.units.find(unit => unit.id !== engineer.id);
  assert.equal(restored.defId, 'buggy');
  assert.equal(restored.hp, restored.maxHp * WRECK_RECOMMISSION_HEALTH_FRACTION);
  assert.equal(restored.veterancy, 0);
  assert.equal(restored.promotion, null);
  assert.equal(restored._recommissioned, true);
  assert.equal(engineer.hp > 0, true);
  assert.equal(game.credits.player, 2000 - cost);
  assert.equal(game.wrecks.length, 0);
  assert.equal(game.events.at(-1).type, 'wreckRecommissioned');
  assert.deepEqual(Object.keys(game.events.at(-1)).filter(key =>
    ['id', 'owner', 'unitId', 'vehicleId', 'defId', 'cost', 'x', 'y'].includes(key)).sort(),
  ['cost', 'defId', 'id', 'owner', 'unitId', 'vehicleId', 'x', 'y']);
});

test('workshop power and credits pause channeling without losing progress and emit transitions once', () => {
  const { game, wreck, engineer, workshop } = setup();
  game.issueRecommissionWreck(wreck.id);
  workshop.powered = false;
  advance(game, engineer, 2);
  assert.equal(engineer._wreckRecommissionProgress, 0);
  assert.equal(engineer._wreckRecommissionWaiting, 'workshop');
  assert.equal(game.events.filter(event => event.type === 'wreckRecommissionWaiting').length, 1);
  workshop.powered = true;
  advance(game, engineer, 4);
  assert.ok(Math.abs(engineer._wreckRecommissionProgress - 4) < 1e-8);
  game.credits.player = 100;
  advance(game, engineer, 1);
  assert.ok(Math.abs(engineer._wreckRecommissionProgress - 4) < 1e-8);
  assert.equal(engineer._wreckRecommissionWaiting, 'credits');
  assert.deepEqual(game.events.filter(event => event.type === 'wreckRecommissionWaiting')
    .map(event => event.reason), ['workshop', 'credits']);
  game.credits.player = 2000;
  advance(game, engineer, 8);
  assert.equal(game.wrecks.length, 0);
});

test('an Engineer death releases its assignment and another Engineer can continue the hull', () => {
  const { game, wreck, engineer } = setup();
  game.issueRecommissionWreck(wreck.id);
  advance(game, engineer, 3);
  engineer.hp = 0;
  game._destroyEntity(engineer, 'enemy', null);
  assert.equal(engineer.order.type, 'idle');
  const replacement = game._createUnit('player', 'engineer', 20.5, 20.5);
  game.select(replacement.id);
  assert.equal(game.canRecommissionWreck(wreck.id).ok, true);
  game.issueRecommissionWreck(wreck.id);
  advance(game, replacement, WRECK_RECOMMISSION_SECONDS);
  assert.equal(game.wrecks.length, 0);
});

test('only one Engineer can reserve a wreck, while blocked spawn space waits and later resumes', () => {
  const { game, wreck, engineer } = setup();
  const second = game._createUnit('player', 'engineer', 20.5, 21.5);
  game.issueRecommissionWreck(wreck.id);
  game.select(second.id);
  assert.equal(game.canRecommissionWreck(wreck.id).reason, 'This wreck is already assigned.');
  for (let y = 18; y <= 23; y++) for (let x = 18; x <= 23; x++)
    if (x !== 20 || y !== 20) game.terrain[y][x].walkable = false;
  game.select(engineer.id);
  advance(game, engineer, 2);
  assert.equal(engineer._wreckRecommissionWaiting, 'space');
  assert.equal(engineer._wreckRecommissionProgress, 0);
  assert.equal(game.credits.player, 2000);
  for (let y = 18; y <= 23; y++) for (let x = 18; x <= 23; x++) game.terrain[y][x].walkable = true;
  advance(game, engineer, WRECK_RECOMMISSION_SECONDS);
  assert.equal(game.wrecks.length, 0);
});

test('hidden wreck queries reveal no hull details and enemy assignments do not block the player', () => {
  const { game, wreck, engineer } = setup();
  const enemyEngineer = game._createUnit('enemy', 'engineer', 20.5, 20.5);
  enemyEngineer.order = { type: 'recommissionWreck', wreckId: wreck.id };
  assert.equal(game.canRecommissionWreck(wreck.id).ok, true);
  game.fog[Math.floor(wreck.y)][Math.floor(wreck.x)] = 0;
  const hidden = game.canRecommissionWreck(wreck.id);
  assert.deepEqual(hidden, { ok: false, reason: 'Wreck is outside current vision.' });
  game.fog[Math.floor(wreck.y)][Math.floor(wreck.x)] = 2;
  const far = game._createUnit('player', 'engineer', 10.5, 20.5);
  game.terrain.forEach(row => { row[15].walkable = false; });
  game.select([far.id, engineer.id]);
  assert.equal(game.canRecommissionWreck(wreck.id).ok, true);
  assert.equal(game.issueRecommissionWreck(wreck.id).ok, true);
  assert.equal(far.order.type, 'idle', 'an unreachable selected Engineer is not assigned');
  assert.deepEqual(engineer.order, { type: 'recommissionWreck', wreckId: wreck.id });
});

test('a restored hull leaves salvage on its next loss but cannot be restored a second time', () => {
  const { game, wreck, engineer } = setup();
  game.issueRecommissionWreck(wreck.id);
  advance(game, engineer, WRECK_RECOMMISSION_SECONDS);
  const restored = game.units.find(unit => unit._recommissioned);
  restored.hp = 0;
  game._destroyEntity(restored, 'enemy', null);
  const laterWreck = game.wrecks.at(-1);
  assert.equal(laterWreck.restoreDefId, 'buggy');
  assert.equal(laterWreck.restoreUsed, true);
  game.select(engineer.id);
  assert.equal(game.canRecommissionWreck(laterWreck.id).ok, false);
  assert.equal(game.canRecommissionWreck(laterWreck.id).reason, 'This hull has already been recommissioned.');
  assert.equal(game.issueRecoverWreck(laterWreck.id).ok, true, 'the original salvage order remains available');
});

test('faction-incompatible hulls are rejected and older wrecks retain salvage-only behavior', () => {
  const incompatible = setup({ defId: 'stealthTank', faction: 'aegis' });
  assert.equal(incompatible.game.canRecommissionWreck(incompatible.wreck.id).ok, false);
  assert.equal(incompatible.game.canRecommissionWreck(incompatible.wreck.id).reason,
    'This wreck cannot be recommissioned by your faction.');

  const old = arena({ replayVersion: WRECK_RECOMMISSION_RULES_VERSION - 1 });
  const vehicle = old._createUnit('enemy', 'buggy', 20.5, 20.5);
  vehicle.hp = 0;
  old._destroyEntity(vehicle, 'player', null);
  assert.equal(Object.hasOwn(old.wrecks[0], 'restoreDefId'), false);
  const engineer = old._createUnit('player', 'engineer', 20.5, 20.5);
  old.select(engineer.id);
  assert.equal(old.canRecommissionWreck(old.wrecks[0].id).ok, false);
});

test('save/load preserves current marker, wreck metadata, channel progress, and rejects legacy orders', () => {
  const { game, wreck, engineer } = setup();
  game.issueRecommissionWreck(wreck.id);
  advance(game, engineer, 5);
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.replayVersion == null, true);
  assert.equal(loaded.wreckRecommissionRulesVersion, WRECK_RECOMMISSION_RULES_VERSION);
  assert.equal(loaded.wrecks[0].restoreDefId, 'buggy');
  assert.ok(Math.abs(loaded.getEntity(engineer.id)._wreckRecommissionProgress - 5) < 1e-8);
  advance(loaded, loaded.getEntity(engineer.id), 7);
  assert.equal(loaded.wrecks.length, 0);

  const legacyData = JSON.parse(game.serialize());
  delete legacyData.wreckRecommissionRulesVersion;
  const legacy = Game.deserialize(legacyData);
  assert.equal(legacy.replayVersion, WRECK_RECOMMISSION_RULES_VERSION - 1);
  assert.equal(legacy.wrecks[0].restoreDefId, undefined);
  assert.deepEqual(legacy.getEntity(engineer.id).order, { type: 'idle' });
});

test('normal and hard skirmish AI chooses affordable local recommissioning and legacy AI keeps salvage', () => {
  for (const difficulty of ['normal', 'hard']) {
    const game = arena({ mode: 'skirmish', difficulty });
    const engineer = game._createUnit('enemy', 'engineer', 20.5, 20.5);
    game._createBuilding('enemy', 'serviceBay', 16, 19).powered = true;
    game.credits.enemy = 2000;
    game.wrecks.push({ id: 'wreck1', x: 20.5, y: 20.5, value: 50, faction: 'aegis',
      expiresAt: 120, restoreDefId: 'buggy', restoreUsed: false });
    game._aiRecoverWrecks();
    assert.deepEqual(engineer.order, { type: 'recommissionWreck', wreckId: 'wreck1' });
    assert.equal(engineer._aiWreckRecommission, true);
  }
  const old = arena({ mode: 'skirmish', difficulty: 'normal', replayVersion: WRECK_RECOMMISSION_RULES_VERSION - 1 });
  const engineer = old._createUnit('enemy', 'engineer', 20.5, 20.5);
  old.wrecks.push({ id: 'wreck1', x: 20.5, y: 20.5, value: 50, faction: 'aegis', expiresAt: 120 });
  old._aiRecoverWrecks();
  assert.deepEqual(engineer.order, { type: 'recoverWreck', wreckId: 'wreck1' });
});

test('AI recommission funding is protected from discretionary spending and released when assignment ends', () => {
  const game = arena({ mode: 'skirmish', difficulty: 'normal' });
  const first = game._createUnit('enemy', 'engineer', 20.5, 20.5);
  const second = game._createUnit('enemy', 'engineer', 22.5, 20.5);
  const workshop = game._createBuilding('enemy', 'serviceBay', 16, 19);
  workshop.powered = true;
  game.credits.enemy = 2000;
  game.wrecks.push(
    { id: 'wreck1', x: 20.5, y: 20.5, value: 50, faction: 'aegis', expiresAt: 120,
      restoreDefId: 'buggy', restoreUsed: false },
    { id: 'wreck2', x: 22.5, y: 20.5, value: 50, faction: 'aegis', expiresAt: 120,
      restoreDefId: 'buggy', restoreUsed: false });

  game._aiRecoverWrecks();
  const cost = Math.ceil(UNIT_DEFS.buggy.cost * WRECK_RECOMMISSION_COST_FRACTION);
  assert.deepEqual(first.order, { type: 'recommissionWreck', wreckId: 'wreck1' });
  assert.deepEqual(second.order, { type: 'idle' });
  assert.equal(game._aiRecommissionCreditReserve('enemy'), cost + 600);
  assert.equal(game._aiCanSpendCredits('enemy', 2000 - cost - 600), true);
  assert.equal(game._aiCanSpendCredits('enemy', 2001 - cost - 600), false);
  assert.equal(game._repairCreditsAvailable('enemy'), 2000 - cost - 600);

  first.order = { type: 'move', x: 25, y: 25 };
  assert.equal(game._aiRecommissionCreditReserve('enemy'), 0);
  assert.equal(game._aiCanSpendCredits('enemy', 2000), true);
  game._aiRecoverWrecks();
  assert.deepEqual(second.order, { type: 'recommissionWreck', wreckId: 'wreck2' });
});

test('missing AI Harvester reserve cancels an underfunded restoration so the replacement can queue', () => {
  const game = arena({ mode: 'skirmish', difficulty: 'normal' });
  const engineer = game._createUnit('enemy', 'engineer', 20.5, 20.5);
  game._createUnit('enemy', 'harvester', 54.5, 18.5);
  const workshop = game._createBuilding('enemy', 'serviceBay', 16, 19);
  workshop.powered = true;
  game._createBuilding('enemy', 'factory', 30, 18, 1);
  game._createBuilding('enemy', 'refinery', 35, 18, 1);
  game.credits.enemy = 2000;
  game.wrecks.push({ id: 'wreck1', x: 20.5, y: 20.5, value: 50, faction: 'aegis', expiresAt: 120,
    restoreDefId: 'buggy', restoreUsed: false });
  game._aiRecoverWrecks();
  assert.equal(engineer.order.type, 'recommissionWreck');

  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId !== 'harvester');
  game.credits.enemy = 1300;
  assert.equal(game._aiEconomyReserve('enemy'), UNIT_DEFS.harvester.cost);
  game._aiCancelInvalidRecommissionOrders();

  assert.deepEqual(engineer.order, { type: 'idle' });
  assert.equal(game._aiRecommissionCreditReserve('enemy'), 0);
  assert.equal(game._queueUnit('enemy', 'harvester').ok, true);

  game.credits.enemy = 2000;
  game._aiRecoverWrecks();
  assert.equal(engineer.order.type, 'recommissionWreck');
  workshop.powered = false;
  game._aiCancelInvalidRecommissionOrders();
  assert.deepEqual(engineer.order, { type: 'idle' });
  game._aiRecoverWrecks();
  assert.deepEqual(engineer.order, { type: 'recoverWreck', wreckId: 'wreck1' });
});
