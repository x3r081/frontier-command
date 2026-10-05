import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER, GROUND_ARMOR_REAR_DAMAGE_MULTIPLIER }
  from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 412 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function origin(unit, x, y) { return { x, y, sourceId: unit.id, owner: unit.owner }; }

test('armored vehicles take less damage in their front arc and more from behind', () => {
  const game = arena();
  const source = game._createUnit('enemy', 'buggy', 10.5, 10.5);
  const front = game._createUnit('player', 'lightTank', 20.5, 20.5);
  const side = game._createUnit('player', 'lightTank', 20.5, 20.5);
  const rear = game._createUnit('player', 'lightTank', 20.5, 20.5);
  front.facing = 0;
  side.facing = 0;
  rear.facing = 0;
  const amount = 100;
  game._applyDamage(front, amount, 'cannon', 'enemy', source.id, origin(source, 24.5, 20.5));
  game._applyDamage(side, amount, 'cannon', 'enemy', source.id, origin(source, 20.5, 16.5));
  game._applyDamage(rear, amount, 'cannon', 'enemy', source.id, origin(source, 16.5, 20.5));
  assert.ok(Math.abs(front.maxHp - front.hp - amount * GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER) < 1e-9);
  assert.equal(side.maxHp - side.hp, amount);
  assert.ok(Math.abs(rear.maxHp - rear.hp - amount * GROUND_ARMOR_REAR_DAMAGE_MULTIPLIER) < 1e-9);

  const wrapped = game._createUnit('player', 'guardian', 20.5, 25.5);
  wrapped.facing = Math.PI - 0.05;
  game._applyDamage(wrapped, amount, 'cannon', 'enemy', source.id,
    origin(source, wrapped.x - 4.5, wrapped.y + 0.2));
  assert.ok(Math.abs(wrapped.maxHp - wrapped.hp - amount * GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER) < 1e-9,
    'front-arc math wraps cleanly around ±π');
});

test('front and rear arcs apply only to known-source armed ground armor', () => {
  const game = arena();
  const source = game._createUnit('enemy', 'buggy', 10.5, 10.5);
  const target = game._createUnit('player', 'lightTank', 20.5, 20.5);
  target.facing = 0;
  const rearOrigin = origin(source, 16.5, 20.5);
  for (const defId of ['rifle', 'orca', 'harvester']) {
    const unit = game._createUnit('player', defId, 20.5, 20.5);
    unit.facing = 0;
    const before = unit.hp;
    game._applyDamage(unit, 100, 'ion', 'enemy', source.id, rearOrigin);
    assert.equal(before - unit.hp, 100, `${defId} receives ordinary damage`);
  }
  const building = game._createBuilding('player', 'refinery', 20, 20, 1);
  const buildingHp = building.hp;
  game._applyDamage(building, 100, 'ion', 'enemy', source.id, rearOrigin);
  assert.equal(buildingHp - building.hp, 100, 'buildings have no directional armor');
  const unknown = game._createUnit('player', 'lightTank', 25.5, 20.5);
  unknown.facing = 0;
  game._applyDamage(unknown, 100, 'ion', 'enemy', 'u99999',
    { x: 21.5, y: 20.5, sourceId: 'u99999', owner: 'enemy' });
  assert.equal(unknown.maxHp - unknown.hp, 100, 'an unresolved source does not establish attack direction');
  const environment = game._createUnit('player', 'lightTank', 30.5, 20.5);
  environment.facing = 0;
  game._applyDamage(environment, 100, 'ion', null, null,
    { x: 26.5, y: 20.5, sourceId: null, owner: null });
  assert.equal(environment.maxHp - environment.hp, 100, 'environment damage has no directional bonus');
});

test('projectile impact uses launch bearing, and splash checks each vehicle facing independently', () => {
  const game = arena();
  const source = game._createUnit('enemy', 'artillery', 10.5, 20.5);
  const rear = game._createUnit('player', 'lightTank', 20.5, 20.5);
  const front = game._createUnit('player', 'lightTank', 20.5, 20.5);
  rear.facing = 0;
  front.facing = Math.PI;
  game._fireAt(source, { x: 20.5, y: 20.5 }, game.unitDefs.artillery.weapon, rear.id);
  const saved = Game.deserialize(game.serialize());
  saved._updateEffects(10);
  const restoredRear = saved.getEntity(rear.id), restoredFront = saved.getEntity(front.id);
  const rearLoss = restoredRear.maxHp - restoredRear.hp;
  const frontLoss = restoredFront.maxHp - restoredFront.hp;
  assert.ok(rearLoss > frontLoss, 'same splash is amplified at the rear and reduced at the front');
  assert.ok(Math.abs(rearLoss - 111.552) < 0.001);
  assert.ok(Math.abs(frontLoss - 79.016) < 0.001);
});

test('legacy replay damage keeps the pre-arc rule while current play uses directional armor', () => {
  const makeTarget = replayVersion => {
    const game = arena();
    game.replayVersion = replayVersion;
    const source = game._createUnit('enemy', 'buggy', 10.5, 10.5);
    const target = game._createUnit('player', 'lightTank', 20.5, 20.5);
    target.facing = 0;
    game._applyDamage(target, 100, 'cannon', 'enemy', source.id, origin(source, 16.5, 20.5));
    return target.maxHp - target.hp;
  };
  assert.equal(makeTarget(11), 100, 'version 11 playback uses historical damage');
  assert.equal(makeTarget(12), 120, 'version 12 playback applies the rear arc');
  const current = arena();
  const source = current._createUnit('enemy', 'buggy', 10.5, 10.5);
  const target = current._createUnit('player', 'lightTank', 20.5, 20.5);
  target.facing = 0;
  current._applyDamage(target, 100, 'cannon', 'enemy', source.id, origin(source, 16.5, 20.5));
  assert.equal(target.maxHp - target.hp, 120, 'fresh games use the current rule');
});
