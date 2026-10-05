import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, WALL_COVER_DAMAGE_MULTIPLIER } from '../src/game/engine.js';

function arena(replayVersion = 20) {
  const game = new Game({ seed: 9142, mode: 'multiplayer' });
  game.replayVersion = replayVersion;
  game.units = []; game.buildings = []; game.bridges = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function shot({ replayVersion = 20, wallOwner = 'player', wallX = 10, wallY = 10,
  attackerX = 7.5, attackerY = 10.5, targetX = 11.5, targetY = 10.5,
  wallHp = 360, weapon = 'buggy' } = {}) {
  const game = arena(replayVersion);
  const attacker = game._createUnit('enemy', weapon, attackerX, attackerY);
  const target = game._createUnit('player', 'rifle', targetX, targetY);
  const wall = game._createBuilding(wallOwner, 'wall', wallX, wallY, 1);
  wall.hp = wallHp;
  game._fireAt(attacker, { x: target.x, y: target.y }, game.unitDefs[weapon].weapon, target.id);
  const restored = Game.deserialize(game.serialize());
  restored._updateEffects(1);
  return { damage: target.maxHp - restored.getEntity(target.id).hp, restored };
}

test('friendly wall immediately between a ground unit and direct fire provides bounded cover', () => {
  const base = shot({ wallHp: 0 }).damage;
  const sheltered = shot().damage;
  assert.ok(Math.abs(sheltered - base * WALL_COVER_DAMAGE_MULTIPLIER) < 1e-9);
  assert.equal(base, 18);
  assert.equal(shot({ wallOwner: 'enemy' }).damage, base, 'an enemy wall is not friendly cover');
  assert.equal(shot({ wallX: 12 }).damage, base, 'a wall behind the target does not help');
  assert.equal(shot({ wallX: 9, wallY: 10 }).damage, base, 'a distant wall does not help');
  assert.equal(shot({ attackerX: 11.5, attackerY: 7.5 }).damage, base,
    'flanking around the wall removes its cover');
});

test('area weapons and older replays retain their damage rules', () => {
  assert.equal(shot({ replayVersion: 19 }).damage, 18);
  const game = arena();
  const attacker = game._createUnit('enemy', 'artillery', 7.5, 10.5);
  const target = game._createUnit('player', 'rifle', 11.5, 10.5);
  game._createBuilding('player', 'wall', 10, 10, 1);
  const sourcePosition = { x: attacker.x, y: attacker.y, owner: attacker.owner,
    sourceId: attacker.id, projectile: true, defId: attacker.defId };
  game._damageArea(target.x, target.y, 1.45, 40, 'cannon', 'enemy', attacker.id, sourcePosition);
  assert.ok(Math.abs(target.maxHp - target.hp - 26.4) < 1e-9,
    'splash at the target bypasses cover while retaining normal armor');
});

test('a public attack order gains the cover benefit during an actual game update', () => {
  const run = cover => {
    const game = arena();
    const attacker = game._createUnit('enemy', 'buggy', 7.5, 10.5);
    const target = game._createUnit('player', 'rifle', 11.5, 10.5);
    if (cover) game._createBuilding('player', 'wall', 10, 10, 1);
    game.commandOwner = 'enemy';
    game.select([attacker.id]);
    assert.equal(game.issueAttack(target.id).ok, true);
    for (let i = 0; i < 4; i++) game.update(0.1);
    assert.equal(game.effects.some(effect => effect.type === 'wallCover'), cover,
      'only an absorbed direct shot produces a wall ricochet cue');
    for (let i = 4; i < 8; i++) game.update(0.1);
    return target.maxHp - target.hp;
  };
  assert.ok(Math.abs(run(true) - run(false) * WALL_COVER_DAMAGE_MULTIPLIER) < 1e-9);
});
