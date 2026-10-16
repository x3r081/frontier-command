import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINEER_ESCORT_RULES_VERSION, Game, UNIT_DEFS } from '../src/game/engine.js';

function arena(replayVersion = ENGINEER_ESCORT_RULES_VERSION) {
  const game = new Game({ seed: 8701, mode: 'multiplayer', replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  game.status = 'playing';
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function follow(game, engineer, target) {
  game.select([engineer.id]);
  game.commandOwner = engineer.owner;
  return game.issueFollow(target.id);
}

function updateEngineer(game, engineer, seconds) {
  for (let elapsed = 0; elapsed + 0.000001 < seconds; elapsed += 0.1)
    game._updateUnit(engineer, Math.min(0.1, seconds - elapsed));
}

test('Engineer Follow closes to kit range and channels a real repair without replacing either unit order', () => {
  const game = arena();
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const tank = game._createUnit('player', 'lightTank', 23.5, 20.5);
  tank.hp -= 160;
  tank.order = { type: 'guard', x: tank.x, y: tank.y };
  assert.deepEqual(follow(game, engineer, tank), { ok: true });
  assert.equal(engineer.order.type, 'follow');

  const start = { x: engineer.x, y: engineer.y };
  game._updateUnit(engineer, 0.1);
  assert.ok(Math.hypot(engineer.x - start.x, engineer.y - start.y) <= UNIT_DEFS.engineer.speed * 0.1 + 0.001,
    'the far approach moves no faster than one normal Engineer step');
  updateEngineer(game, engineer, 8.9);
  assert.equal(tank.hp, tank.maxHp - 40);
  assert.equal(engineer.fieldRepairKits, 1);
  assert.deepEqual(engineer.order, { type: 'follow', targetId: tank.id });
  assert.deepEqual(tank.order, { type: 'guard', x: tank.x, y: tank.y });
  assert.ok(game.effects.some(effect => effect.kind === 'fieldRepair' &&
    effect.sourceId === engineer.id && effect.targetId === tank.id));
});

test('a moving followed vehicle resets channel progress without spending a kit', () => {
  const game = arena();
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const tank = game._createUnit('player', 'lightTank', 21.2, 20.5);
  tank.hp -= 100;
  follow(game, engineer, tank);
  updateEngineer(game, engineer, 4.8);
  assert.ok(engineer._fieldRepairProgress > 4.6);
  tank.x += 0.2;
  game._updateUnit(engineer, 0.1);
  assert.equal(engineer._fieldRepairProgress, 0);
  assert.equal(engineer._fieldRepairWaiting, 'target-moving');
  assert.equal(engineer.fieldRepairKits, 2);
  assert.equal(tank.hp, tank.maxHp - 100);
  assert.deepEqual(engineer.order, { type: 'follow', targetId: tank.id });

  engineer._fieldRepairProgress = 3;
  tank.owner = 'enemy';
  game._updateUnit(engineer, 0.1);
  assert.deepEqual(engineer.order, { type: 'idle' });
  assert.equal(engineer._fieldRepairProgress, 0, 'capture clears a stale escort channel');
});

test('finite kits do not trigger automatic refill and Follow persists when empty', () => {
  const game = arena();
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const tank = game._createUnit('player', 'lightTank', 21.2, 20.5);
  tank.hp -= 250;
  follow(game, engineer, tank);
  updateEngineer(game, engineer, 10.2);
  assert.equal(tank.hp, tank.maxHp - 10);
  assert.equal(engineer.fieldRepairKits, 0);
  assert.deepEqual(engineer.order, { type: 'follow', targetId: tank.id });
  updateEngineer(game, engineer, 4);
  assert.equal(tank.hp, tank.maxHp - 10);
  assert.equal(engineer.fieldRepairKits, 0);
});

test('rules 86 and markerless v86 saves preserve plain Follow without automatic repair', () => {
  assert.equal(ENGINEER_ESCORT_RULES_VERSION, 87);
  const old = arena(ENGINEER_ESCORT_RULES_VERSION - 1);
  const oldEngineer = old._createUnit('player', 'engineer', 20.5, 20.5);
  const oldTank = old._createUnit('player', 'lightTank', 21.2, 20.5);
  oldTank.hp -= 120;
  follow(old, oldEngineer, oldTank);
  updateEngineer(old, oldEngineer, 6);
  assert.equal(oldTank.hp, oldTank.maxHp - 120);
  assert.equal(oldEngineer.order.type, 'follow');

  const current = arena();
  const engineer = current._createUnit('player', 'engineer', 20.5, 20.5);
  const tank = current._createUnit('player', 'lightTank', 21.2, 20.5);
  tank.hp -= 120;
  follow(current, engineer, tank);
  updateEngineer(current, engineer, 2.4);
  const roundTrip = Game.deserialize(current.serialize());
  assert.equal(roundTrip.getEntity(engineer.id)._fieldRepairProgress, engineer._fieldRepairProgress);
  assert.equal(roundTrip.engineerEscortRulesVersion, ENGINEER_ESCORT_RULES_VERSION);

  const markerless = JSON.parse(current.serialize());
  markerless.replayVersion = null;
  delete markerless.engineerEscortRulesVersion;
  const legacy = Game.deserialize(markerless);
  assert.equal(legacy.replayVersion, ENGINEER_ESCORT_RULES_VERSION - 1);
  const legacyEngineer = legacy.getEntity(engineer.id);
  const legacyTank = legacy.getEntity(tank.id);
  const oldHp = legacyTank.hp;
  updateEngineer(legacy, legacyEngineer, 6);
  assert.equal(legacyTank.hp, oldHp);
});
