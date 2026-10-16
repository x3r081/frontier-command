import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, INFANTRY_DIG_IN_DAMAGE_MULTIPLIER, INFANTRY_DIG_IN_RULES_VERSION,
  INFANTRY_DIG_IN_SETUP_SECONDS, INFANTRY_DIG_IN_DURATION_SECONDS } from '../src/game/engine.js';

function arena({ mode = 'multiplayer', replayVersion = null, difficulty = 'normal' } = {}) {
  const game = new Game({ seed: 7421, mode, replayVersion, difficulty });
  game.units = []; game.buildings = []; game.bridges = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function issueDigIn(game, unit, x = unit.x + 1, y = unit.y) {
  game.select(unit.id);
  return game.issueDigIn(x, y);
}

function applyDirectShot({ damageType = 'ballistic', areaDamage = false, flank = false, wall = false,
  digIn = true } = {}) {
  const game = arena();
  const target = game._createUnit('player', 'rifle', 20.5, 20.5);
  const attacker = game._createUnit('enemy', 'buggy', flank ? 20.5 : 23.5, flank ? 23.5 : 20.5);
  if (wall) game._createBuilding('player', 'wall', 21, 20, 1);
  if (digIn) assert.equal(issueDigIn(game, target).ok, true);
  game.time = 2;
  const sourcePosition = { x: attacker.x, y: attacker.y, sourceId: attacker.id,
    owner: attacker.owner, defId: attacker.defId, projectile: true };
  const before = target.hp;
  game._applyDamage(target, 10, damageType, attacker.owner, attacker.id, sourcePosition, areaDamage);
  return { damage: before - target.hp, target, game };
}

test('Dig In channels without firing, then holds its clicked front and fires only inside its cone', () => {
  const game = arena();
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 23.5, 20.5);
  rifle.cooldown = 0;
  assert.deepEqual(issueDigIn(game, rifle), { ok: true });
  assert.equal(rifle.order.type, 'digIn');
  assert.equal(rifle.order.facing, 0);
  assert.equal(rifle.order.readyAt, INFANTRY_DIG_IN_SETUP_SECONDS);
  assert.equal(rifle.order.expiresAt, INFANTRY_DIG_IN_SETUP_SECONDS + INFANTRY_DIG_IN_DURATION_SECONDS);
  game._updateUnit(rifle, 0.1);
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === rifle.id), false,
    'setup blocks firing');
  rifle.stance = 'holdFire';
  game.time = rifle.order.readyAt;
  game._updateUnit(rifle, 0.1);
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === rifle.id), false,
    'Dig In respects the persistent Hold Fire stance');
  rifle.stance = 'aggressive';
  game._updateUnit(rifle, 0.1);
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === rifle.id), true,
    'a visible target in range and in the fixed front cone is engaged');
  assert.equal(rifle.facing, 0, 'firing does not turn the dig-in front');

  enemy.x = rifle.x;
  enemy.y = rifle.y + 3;
  rifle.cooldown = 0;
  const shots = game.effects.filter(effect => effect.type === 'projectile' && effect.sourceId === rifle.id).length;
  game._updateUnit(rifle, 0.1);
  assert.equal(game.effects.filter(effect => effect.type === 'projectile' && effect.sourceId === rifle.id).length, shots,
    'a target outside the front cone is ignored without chasing');
  assert.equal(rifle.x, 20.5);
  assert.equal(rifle.y, 20.5);
});

test('Dig In protects only its frontal direct ballistic and cannon hits, without multiplying wall cover', () => {
  const frontal = applyDirectShot();
  const baseline = arena();
  const baselineTarget = baseline._createUnit('player', 'rifle', 20.5, 20.5);
  const baselineAttacker = baseline._createUnit('enemy', 'buggy', 23.5, 20.5);
  baseline._applyDamage(baselineTarget, 10, 'ballistic', baselineAttacker.owner, baselineAttacker.id,
    { x: baselineAttacker.x, y: baselineAttacker.y, sourceId: baselineAttacker.id,
      owner: baselineAttacker.owner, defId: baselineAttacker.defId, projectile: true });
  assert.equal(frontal.damage, (baselineTarget.maxHp - baselineTarget.hp) * INFANTRY_DIG_IN_DAMAGE_MULTIPLIER);
  const cannon = applyDirectShot({ damageType: 'cannon' });
  const cannonBaseline = applyDirectShot({ damageType: 'cannon', digIn: false });
  assert.ok(Math.abs(cannon.damage - cannonBaseline.damage * INFANTRY_DIG_IN_DAMAGE_MULTIPLIER) < 1e-9);
  assert.equal(applyDirectShot({ flank: true }).damage, baselineTarget.maxHp - baselineTarget.hp,
    'flank fire bypasses the arc');
  for (const damageType of ['explosive', 'flame', 'ion'])
    assert.equal(applyDirectShot({ damageType }).damage, applyDirectShot({ damageType, digIn: false }).damage,
      `${damageType} damage bypasses Dig In`);
  assert.equal(applyDirectShot({ areaDamage: true }).damage,
    applyDirectShot({ areaDamage: true, digIn: false }).damage, 'area damage bypasses cover');

  const withWall = applyDirectShot({ wall: true });
  const wallBaseline = arena();
  const wallTarget = wallBaseline._createUnit('player', 'rifle', 20.5, 20.5);
  const wallAttacker = wallBaseline._createUnit('enemy', 'buggy', 23.5, 20.5);
  wallBaseline._createBuilding('player', 'wall', 21, 20, 1);
  wallBaseline._applyDamage(wallTarget, 10, 'ballistic', wallAttacker.owner, wallAttacker.id,
    { x: wallAttacker.x, y: wallAttacker.y, sourceId: wallAttacker.id,
      owner: wallAttacker.owner, defId: wallAttacker.defId, projectile: true });
  assert.equal(withWall.damage, wallTarget.maxHp - wallTarget.hp,
    'the stronger wall multiplier applies once instead of stacking with Dig In');
});

test('movement orders interrupt setup while retaining the cooldown, and the stance expires to idle', () => {
  const game = arena();
  const rocket = game._createUnit('player', 'rocket', 20.5, 20.5);
  assert.equal(issueDigIn(game, rocket).ok, true);
  assert.equal(rocket.abilityCooldown, 30);
  game.select(rocket.id);
  assert.equal(game.issueMove(24.5, 20.5, false, true).ok, true,
    'a queued move replaces Dig In because stance orders are not queueable');
  assert.equal(rocket.order.type, 'move');
  assert.equal(rocket.order.queue, undefined);
  assert.equal(rocket.abilityCooldown, 30, 'replacing the order does not refund the cooldown');

  const other = game._createUnit('player', 'rifle', 10.5, 10.5);
  assert.equal(issueDigIn(game, other).ok, true);
  game.time = other.order.expiresAt;
  game._updateUnit(other, 0.1);
  assert.deepEqual(other.order, { type: 'idle' });
});

test('both factions can use Dig In with Rifle Squads and Rocket Troopers', () => {
  const game = new Game({ faction: 'vesper', seed: 74, mode: 'multiplayer' });
  game.units = []; game.buildings = []; game.bridges = []; game.relays = [];
  const rifle = game._createUnit('player', 'rifle', 12.5, 12.5);
  const rocket = game._createUnit('player', 'rocket', 14.5, 12.5);
  game.select([rifle.id, rocket.id]);
  assert.equal(game.issueDigIn(16.5, 12.5).ok, true);
  assert.equal(rifle.order.type, 'digIn');
  assert.equal(rocket.order.type, 'digIn');
});

test('Dig In order, facing, cooldown, and legacy save pin survive serialization safely', () => {
  const game = arena();
  const unit = game._createUnit('player', 'rifle', 20.5, 20.5);
  assert.equal(issueDigIn(game, unit).ok, true);
  game.time = 0.5;
  const restored = Game.deserialize(game.serialize());
  const savedUnit = restored.getEntity(unit.id);
  assert.deepEqual(savedUnit.order, unit.order);
  assert.equal(savedUnit.abilityCooldown, unit.abilityCooldown);

  const legacyData = JSON.parse(game.serialize());
  delete legacyData.infantryDigInRulesVersion;
  const legacy = Game.deserialize(legacyData);
  assert.equal(legacy.replayVersion, INFANTRY_DIG_IN_RULES_VERSION - 1);
  assert.equal(legacy.canDigIn(20.5, 20.5).ok, false);

  const malformed = JSON.parse(game.serialize());
  const malformedUnit = malformed.units.find(candidate => candidate.id === unit.id);
  malformedUnit.order.expiresAt = Number.MAX_SAFE_INTEGER;
  const sanitized = Game.deserialize(malformed).getEntity(unit.id);
  assert.deepEqual(sanitized.order, { type: 'idle' }, 'malformed time bounds cannot preserve cover indefinitely');
});

test('normal/hard skirmish AI digs in at most one idle or guarding rifle for a visible threat', () => {
  const game = arena({ mode: 'skirmish', difficulty: 'normal' });
  const defender = game._createUnit('enemy', 'rifle', 20.5, 20.5, { type: 'guard', x: 20.5, y: 20.5 });
  const attacker = game._createUnit('player', 'rifle', 23.5, 20.5);
  const selection = [...game.selection];
  assert.equal(game._aiUseInfantryDigIn(), true);
  assert.equal(defender.order.type, 'digIn');
  assert.equal(defender.order.facing, 0);
  assert.deepEqual(game.selection, selection, 'enemy command selection is restored after the public command');
  assert.equal(attacker.order.type, 'idle');

  const assaulting = game._createUnit('enemy', 'rocket', 30.5, 20.5, { type: 'move', x: 31.5, y: 20.5 });
  const distantThreat = game._createUnit('player', 'rifle', 40.5, 20.5);
  assert.equal(game._aiUseInfantryDigIn(), false);
  assert.equal(assaulting.order.type, 'move', 'assaulting units are not diverted into a defensive stance');
  assert.equal(distantThreat.order.type, 'idle');

  const easy = arena({ mode: 'skirmish', difficulty: 'easy' });
  const easyDefender = easy._createUnit('enemy', 'rifle', 20.5, 20.5, { type: 'guard', x: 20.5, y: 20.5 });
  easy._createUnit('player', 'rifle', 23.5, 20.5);
  assert.equal(easy._aiUseInfantryDigIn(), false, 'Easy AI keeps its simpler defensive policy');
  assert.equal(easyDefender.order.type, 'guard');
});
