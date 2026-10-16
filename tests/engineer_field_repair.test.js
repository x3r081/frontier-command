import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINEER_FIELD_REPAIR_RULES_VERSION, Game } from '../src/game/engine.js';

function arena(replayVersion) {
  const game = new Game({ seed: 8501, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  game.status = 'playing';
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function select(game, unit) {
  game.select([unit.id]);
  game.commandOwner = unit.owner;
}

function channel(game, engineer, method, seconds) {
  if (method === 'repair') {
    const steps = Math.ceil(seconds / 0.1);
    for (let i = 0; i < steps; i++) game.update(seconds / steps);
    return;
  }
  const update = game._updateRepairKitRefill.bind(game);
  const steps = Math.ceil(seconds / 0.1);
  for (let i = 0; i < steps; i++) update(engineer, seconds / steps);
}

test('field repair approaches, channels, consumes a kit, and repeats only while needed', () => {
  const game = arena();
  game.mode = 'multiplayer';
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const tank = game._createUnit('player', 'lightTank', 21.5, 20.5);
  game._createUnit('enemy', 'rifle', 40.5, 40.5);
  tank.hp = tank.maxHp - 190;
  select(game, engineer);

  assert.deepEqual(game.issueFieldRepair(tank.id), {
    ok: true, engineerId: engineer.id, targetId: tank.id, kits: 2,
  });
  assert.equal(engineer.order.type, 'fieldRepair');
  channel(game, engineer, 'repair', 5);
  assert.equal(tank.hp, tank.maxHp - 70);
  assert.equal(engineer.fieldRepairKits, 1);
  assert.equal(engineer.order.type, 'fieldRepair');
  const heal = game.effects.at(-1);
  assert.deepEqual(game.effects.at(-1), {
    id: heal.id, type: 'heal', x: tank.x, y: tank.y,
    radius: 0.7, ttl: heal.ttl, maxTtl: 0.75,
    sourceId: engineer.id, targetId: tank.id, owner: 'player', kind: 'fieldRepair',
  });

  channel(game, engineer, 'repair', 5);
  assert.equal(tank.hp, tank.maxHp);
  assert.equal(engineer.fieldRepairKits, 0);
  assert.deepEqual(engineer.order, { type: 'idle' });
});

test('moving target resets field channel; Stop cancels without spending a kit', () => {
  const game = arena();
  game.mode = 'multiplayer';
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const vehicle = game._createUnit('player', 'buggy', 21.5, 20.5);
  game._createUnit('enemy', 'rifle', 40.5, 40.5);
  vehicle.hp -= 80;
  select(game, engineer);
  assert.equal(game.issueFieldRepair(vehicle.id).ok, true);

  channel(game, engineer, 'repair', 4.9);
  assert.ok(engineer._fieldRepairProgress > 4.8);
  vehicle.x += 0.2;
  game._updateFieldRepair(engineer, 0.1);
  assert.equal(engineer._fieldRepairProgress, 0);
  assert.equal(engineer.fieldRepairKits, 2);
  assert.equal(vehicle.hp, vehicle.maxHp - 80);

  select(game, engineer);
  assert.equal(game.issueStop().ok, true);
  channel(game, engineer, 'repair', 6);
  assert.equal(engineer.fieldRepairKits, 2);
  assert.equal(vehicle.hp, vehicle.maxHp - 80);
  assert.deepEqual(engineer.order, { type: 'idle' });
});

test('field repair rejects unsupported targets, duplicate assignment, and archived rules', () => {
  const game = arena();
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const otherEngineer = game._createUnit('player', 'engineer', 20.5, 21.5);
  const tank = game._createUnit('player', 'apc', 21.5, 20.5);
  tank.hp -= 40;
  select(game, engineer);
  assert.equal(game.issueFieldRepair(tank.id).ok, true);

  select(game, otherEngineer);
  assert.match(game.issueFieldRepair(tank.id).reason, /already repairing/);
  const rifle = game._createUnit('player', 'rifle', 22.5, 20.5);
  rifle.hp -= 10;
  assert.match(game.issueFieldRepair(rifle.id).reason, /ground vehicle/);
  const enemyVehicle = game._createUnit('enemy', 'buggy', 22.5, 21.5);
  enemyVehicle.hp -= 10;
  assert.match(game.issueFieldRepair(enemyVehicle.id).reason, /friendly ground vehicle/);

  const old = arena(ENGINEER_FIELD_REPAIR_RULES_VERSION - 1);
  const oldEngineer = old._createUnit('player', 'engineer', 20.5, 20.5);
  const oldTank = old._createUnit('player', 'lightTank', 21.5, 20.5);
  oldTank.hp -= 40;
  select(old, oldEngineer);
  assert.match(old.issueFieldRepair(oldTank.id).reason, /replay version/);
  assert.equal('fieldRepairKits' in oldEngineer, false);
});

test('kit refill pauses for power and credits, charges per completed kit, then idles', () => {
  const game = arena();
  const workshop = game._createBuilding('player', 'serviceBay', 20, 20, 1);
  workshop.progress = 1;
  workshop.powered = true;
  const engineer = game._createUnit('player', 'engineer', 21, 21);
  engineer.fieldRepairKits = 0;
  game.credits.player = 3000;
  select(game, engineer);
  assert.deepEqual(game.issueRefillRepairKits(), { ok: true, ids: [engineer.id] });

  workshop.powered = false;
  channel(game, engineer, 'refill', 9);
  assert.equal(engineer._fieldRepairWaiting, 'power');
  assert.equal(engineer._fieldRepairRefillProgress, 0);
  assert.equal(engineer.fieldRepairKits, 0);
  assert.equal(game.credits.player, 3000);

  workshop.powered = true;
  game.credits.player = 79;
  channel(game, engineer, 'refill', 9);
  assert.equal(engineer._fieldRepairWaiting, 'credits');
  assert.equal(engineer.fieldRepairKits, 0);
  assert.equal(game.credits.player, 79);

  game.credits.player = 200;
  channel(game, engineer, 'refill', 8);
  assert.equal(engineer.fieldRepairKits, 1);
  assert.equal(game.credits.player, 120);
  assert.equal(engineer.order.type, 'refillRepairKits');
  channel(game, engineer, 'refill', 8);
  assert.equal(engineer.fieldRepairKits, 2);
  assert.equal(game.credits.player, 40);
  assert.deepEqual(engineer.order, { type: 'idle' });
});

test('save/load preserves current channel state; markerless v84 saves stay archived', () => {
  const game = arena();
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const tank = game._createUnit('player', 'lightTank', 21.5, 20.5);
  tank.hp -= 100;
  select(game, engineer);
  assert.equal(game.issueFieldRepair(tank.id).ok, true);
  channel(game, engineer, 'repair', 2.4);
  const loaded = Game.deserialize(game.serialize());
  assert.ok(loaded.replayVersion == null);
  assert.equal(loaded.engineerFieldRepairRulesVersion, ENGINEER_FIELD_REPAIR_RULES_VERSION);
  assert.equal(loaded.getEntity(engineer.id).fieldRepairKits, 2);
  assert.equal(loaded.getEntity(engineer.id)._fieldRepairProgress, engineer._fieldRepairProgress);
  assert.deepEqual(loaded.getEntity(engineer.id).order, { type: 'fieldRepair', targetId: tank.id });

  const legacy = arena(ENGINEER_FIELD_REPAIR_RULES_VERSION - 1);
  const oldEngineer = legacy._createUnit('player', 'engineer', 20.5, 20.5);
  const oldTank = legacy._createUnit('player', 'lightTank', 21.5, 20.5);
  oldTank.hp -= 40;
  oldEngineer.fieldRepairKits = 2;
  oldEngineer.order = { type: 'fieldRepair', targetId: oldTank.id };
  const legacyData = JSON.parse(legacy.serialize());
  legacyData.replayVersion = null;
  delete legacyData.engineerFieldRepairRulesVersion;
  const legacyLoaded = Game.deserialize(legacyData);
  assert.equal(legacyLoaded.replayVersion, ENGINEER_FIELD_REPAIR_RULES_VERSION - 1);
  assert.deepEqual(legacyLoaded.getEntity(oldEngineer.id).order, { type: 'idle' });
  assert.equal('fieldRepairKits' in legacyLoaded.getEntity(oldEngineer.id), false);
});
