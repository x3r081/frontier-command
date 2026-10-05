import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS, VETERANCY_RANKS, UNIT_PROMOTION_DEFS, unitWeaponRange } from '../src/game/engine.js';

test('combat XP uses effective enemy health loss and a small finishing award', () => {
  const game = new Game({ seed: 71 });
  const shooter = game._createUnit('player', 'rifle', 30, 30);
  const first = game._createUnit('enemy', 'rifle', 31, 30);
  game._applyDamage(first, 60, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 60);
  game._applyDamage(first, 1000, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 130); // 110 real damage + 20 for the kill; no overkill XP.
  assert.equal(shooter.kills, 1);
  const second = game._createUnit('enemy', 'rifle', 31, 31);
  shooter.hp = 60;
  game._applyDamage(second, 50, 'ion', 'player', shooter.id);
  assert.equal(shooter.veterancy, 1);
  assert.equal(shooter.xp, VETERANCY_RANKS[1].xp);
  assert.equal(shooter.maxHp, UNIT_DEFS.rifle.health * 1.05);
  assert.equal(shooter.hp, 60 + UNIT_DEFS.rifle.health * 0.05);
  assert.equal(game.events.at(-1).type, 'veterancy');

  const third = game._createUnit('enemy', 'lightTank', 32, 30);
  game._applyDamage(third, 270, 'ion', 'player', shooter.id);
  assert.equal(shooter.veterancy, 2);
  assert.equal(shooter.xp, VETERANCY_RANKS[2].xp);
  assert.equal(shooter.maxHp, UNIT_DEFS.rifle.health * 1.1);
  game._fireAt(shooter, { x: 31, y: 30 }, UNIT_DEFS.rifle.weapon);
  const projectile = game.effects.findLast(effect => effect.type === 'projectile');
  assert.equal(projectile.damage, UNIT_DEFS.rifle.weapon.damage * 1.1);
});

test('friendly fire, shields, environment and invalid sources grant no combat XP', () => {
  const game = new Game({ seed: 72 });
  const shooter = game._createUnit('player', 'rifle', 30, 30);
  const friendly = game._createUnit('player', 'rifle', 31, 30);
  game._applyDamage(friendly, 1000, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 0);
  assert.equal(shooter.kills, 0);

  const enemy = game._createUnit('enemy', 'rifle', 31, 31);
  enemy.shieldUntil = game.time + 5;
  enemy.shieldHp = 30;
  game._applyDamage(enemy, 20, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 0);
  game._applyDamage(enemy, 20, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 10);
  game._applyDamage(enemy, 20, 'ion', 'player', friendly.id); // Friendly has been destroyed.
  game._applyDamage(enemy, 20, 'ion', 'enemy', shooter.id); // Spoofed attacker owner.
  game._applyDamage(enemy, 20, 'ion', null, null);
  assert.equal(shooter.xp, 10);
});

test('structure damage earns reduced XP and saves preserve rank and progress', () => {
  const game = new Game({ seed: 73 });
  const shooter = game._createUnit('player', 'rocket', 30, 30);
  const building = game._createBuilding('enemy', 'power', 32, 30);
  game._applyDamage(building, 100, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 40);
  game._applyDamage(building, 500, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 560 * 0.4 + 35);
  assert.equal(shooter.veterancy, 1);
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.getEntity(shooter.id).xp, shooter.xp);
  assert.equal(loaded.getEntity(shooter.id).veterancy, shooter.veterancy);
  assert.equal(loaded.getEntity(shooter.id).kills, 1);
  assert.equal(loaded.getEntity(shooter.id).maxHp, shooter.maxHp);
});

test('repairing the same target cannot generate unlimited XP', () => {
  const game = new Game({ seed: 75 });
  const shooter = game._createUnit('player', 'rocket', 30, 30);
  const building = game._createBuilding('enemy', 'power', 32, 30);
  game._applyDamage(building, 300, 'ion', 'player', shooter.id);
  building.hp = building.maxHp;
  game._applyDamage(building, 300, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 560 * 0.4);
  building.hp = building.maxHp;
  game._applyDamage(building, 300, 'ion', 'player', shooter.id);
  assert.equal(shooter.xp, 560 * 0.4);
  assert.equal(building._xpDamageAwarded, building.maxHp);
});

test('legacy saves gain coherent XP and health without changing current damage taken', () => {
  const game = new Game({ seed: 74 });
  const shooter = game._createUnit('player', 'rifle', 30, 30);
  shooter.veterancy = 3;
  shooter.maxHp = UNIT_DEFS.rifle.health * 1.08 ** 3;
  shooter.hp = shooter.maxHp - 17;
  const data = JSON.parse(game.serialize());
  delete data.units.find(unit => unit.id === shooter.id).xp;
  const loaded = Game.deserialize(data).getEntity(shooter.id);
  assert.equal(loaded.veterancy, 2);
  assert.equal(loaded.xp, VETERANCY_RANKS[2].xp);
  assert.equal(loaded.maxHp, UNIT_DEFS.rifle.health * 1.1);
  assert.ok(Math.abs(loaded.maxHp - loaded.hp - 17) < 1e-10);

  const barelyAlive = JSON.parse(game.serialize());
  const oldUnit = barelyAlive.units.find(unit => unit.id === shooter.id);
  oldUnit.hp = 1;
  delete oldUnit.xp;
  assert.equal(Game.deserialize(barelyAlive).getEntity(shooter.id).hp, 1);
});

test('Elite ground units choose one promotion and Bulwark reduces post-mitigation damage', () => {
  const game = new Game({ seed: 76 });
  const rifle = game._createUnit('player', 'rifle', 30, 30);
  rifle.veterancy = 2;
  rifle.xp = 450;
  assert.deepEqual(game.issuePromoteUnit(rifle.id, 'bulwark'), { ok: true, promotionId: 'bulwark' });
  const hp = rifle.hp;
  game._applyDamage(rifle, 100, 'ion', 'enemy');
  assert.equal(hp - rifle.hp, 85, 'Bulwark multiplies damage after the existing armor modifiers');
  assert.equal(game.issuePromoteUnit(rifle.id, 'rangefinder').ok, false, 'promotion is one-time');
  assert.equal(UNIT_PROMOTION_DEFS.bulwark.damageTakenMultiplier, 0.85);
});

test('Rangefinder extends actual unit firing range and promotion state survives saves', () => {
  const game = new Game({ seed: 77 });
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const target = game._createUnit('enemy', 'rifle', 24.5, 20.5);
  rifle.veterancy = 2;
  rifle.xp = 450;
  rifle.order = { type: 'attack', targetId: target.id };
  rifle.cooldown = 0;
  assert.equal(unitWeaponRange(rifle, UNIT_DEFS.rifle.weapon), UNIT_DEFS.rifle.weapon.range);
  assert.equal(game.issuePromoteUnit(rifle.id, 'rangefinder').ok, true);
  assert.equal(unitWeaponRange(rifle, UNIT_DEFS.rifle.weapon), UNIT_DEFS.rifle.weapon.range + 1);
  game._updateUnit(rifle, 0.1);
  assert.ok(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === rifle.id),
    'the promotion lets this rifle fire at a target beyond its base range');
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.getEntity(rifle.id).promotion, 'rangefinder');
  const malformed = JSON.parse(game.serialize());
  malformed.units.find(unit => unit.id === rifle.id).promotion = 'unknown';
  assert.equal(Game.deserialize(malformed).getEntity(rifle.id).promotion, null,
    'invalid save data cannot grant a promotion');
});

test('promotion commands validate replay version, ownership, Elite rank, target class, and choice', () => {
  const game = new Game({ seed: 78 });
  const rifle = game._createUnit('player', 'rifle', 20.5, 20.5);
  const enemy = game._createUnit('enemy', 'rifle', 22.5, 20.5);
  const aircraft = game._createUnit('player', 'orca', 20.5, 21.5);
  for (const [id, choice] of [[rifle.id, 'bulwark'], [enemy.id, 'bulwark'],
    [aircraft.id, 'bulwark'], [rifle.id, 'bad-choice'], ['u999999', 'bulwark']])
    assert.equal(game.issuePromoteUnit(id, choice).ok, false);
  rifle.veterancy = 2;
  assert.equal(game.issuePromoteUnit(rifle.id, 'bulwark').ok, true);
  game.commandOwner = 'enemy';
  enemy.veterancy = 2;
  assert.equal(game.issuePromoteUnit(enemy.id, 'rangefinder').ok, true,
    'the active command owner can promote its own eligible units');
  game.replayVersion = 28;
  assert.equal(game.issuePromoteUnit(rifle.id, 'rangefinder').ok, false);
  assert.equal(unitWeaponRange({ promotion: 'rangefinder' }, UNIT_DEFS.rifle.weapon, 28),
    UNIT_DEFS.rifle.weapon.range, 'legacy replay rules suppress promotion bonuses');
});

test('current skirmish AI picks deterministic role-based Elite promotions', () => {
  const game = new Game({ seed: 79 });
  const rifle = game._createUnit('enemy', 'rifle', 20.5, 20.5);
  const rocket = game._createUnit('enemy', 'rocket', 21.5, 20.5);
  const rifleTarget = game._createUnit('player', 'guardian', 22.5, 20.5);
  const rocketTarget = game._createUnit('player', 'guardian', 23.5, 20.5);
  game._awardVeterancyXp(rifle.id, 'enemy', rifleTarget, 450, false);
  game._awardVeterancyXp(rocket.id, 'enemy', rocketTarget, 450, false);
  assert.equal(rifle.promotion, 'bulwark', 'frontline infantry receive survivability');
  assert.equal(rocket.promotion, 'rangefinder', 'antiarmor troops receive reach');
  const legacy = new Game({ seed: 79 });
  legacy.replayVersion = 28;
  const oldRifle = legacy._createUnit('enemy', 'rifle', 20.5, 20.5);
  const oldTarget = legacy._createUnit('player', 'guardian', 22.5, 20.5);
  legacy._awardVeterancyXp(oldRifle.id, 'enemy', oldTarget, 450, false);
  assert.equal(oldRifle.promotion, null, 'older replay AI retains the historical rank-only behavior');
});
