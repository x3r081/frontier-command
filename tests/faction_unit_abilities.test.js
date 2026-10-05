import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GUARDIAN_BRACE_DAMAGE_MULTIPLIER, GUARDIAN_BRACE_SECONDS,
  SPECTER_GHOST_RUN_SPEED_MULTIPLIER, SPECTER_GHOST_RUN_SECONDS } from '../src/game/engine.js';

function arena(faction = 'aegis') {
  const game = new Game({ faction, seed: 914 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

test('Guardian Brace protects nearby allied vehicles from direct fire and anchors movement', () => {
  const game = arena();
  const guardian = game._createUnit('player', 'guardian', 20.5, 20.5);
  const ally = game._createUnit('player', 'lightTank', 22.5, 20.5);
  const outside = game._createUnit('player', 'lightTank', 24, 20.5);
  guardian.order = { type: 'move', x: 30.5, y: 20.5 };
  assert.deepEqual(game.useUnitAbility(guardian.id, 'brace'), { ok: true });
  assert.equal(guardian.braceUntil, GUARDIAN_BRACE_SECONDS);
  const startX = guardian.x;
  game._moveUnit(guardian, 30.5, 20.5, 1);
  assert.equal(guardian.x, startX, 'Brace pins the Guardian in place');

  const allyBefore = ally.hp;
  const outsideBefore = outside.hp;
  game._applyDamage(ally, 100, 'ion', 'enemy');
  game._applyDamage(outside, 100, 'ion', 'enemy');
  assert.ok(Math.abs((allyBefore - ally.hp) / (outsideBefore - outside.hp) -
    GUARDIAN_BRACE_DAMAGE_MULTIPLIER) < 0.001);
  const splashBefore = ally.hp;
  game._applyDamage(ally, 100, 'ion', 'enemy', null, null, true);
  assert.ok(Math.abs((splashBefore - ally.hp) - (outsideBefore - outside.hp)) < 0.001,
    'splash bypasses the field');
  assert.match(game.useUnitAbility(guardian.id, 'brace').reason, /cooling/);
});

test('Specter Ghost Run speeds up its move order while suppressing fire, then expires', () => {
  const game = arena('vesper');
  const specter = game._createUnit('player', 'stealthTank', 20.5, 20.5);
  const threat = game._createUnit('enemy', 'rifle', 23.5, 20.5);
  specter.cooldown = 0;
  specter.order = { type: 'move', x: 30.5, y: 20.5, attackMove: true };
  assert.deepEqual(game.useUnitAbility(specter.id, 'ghostRun'), { ok: true });
  assert.equal(specter.ghostRunUntil, SPECTER_GHOST_RUN_SECONDS);
  const baselineGame = arena('vesper');
  const control = baselineGame._createUnit('player', 'stealthTank', 20.5, 20.5);
  control.order = { type: 'move', x: 30.5, y: 20.5 };
  game._updateUnit(specter, 1);
  baselineGame._updateUnit(control, 1);
  assert.ok(Math.hypot(specter.x - 20.5, specter.y - 20.5) >
    Math.hypot(control.x - 20.5, control.y - 20.5) * (SPECTER_GHOST_RUN_SPEED_MULTIPLIER - 0.04));
  assert.equal(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === specter.id), false,
    'Ghost Run suppresses weapons even when a visible enemy is in range');
  assert.ok(threat.hp > 0);

  const saved = Game.deserialize(game.serialize());
  const savedSpecter = saved.getEntity(specter.id);
  assert.equal(savedSpecter.ghostRunUntil, specter.ghostRunUntil);
  assert.equal(savedSpecter.abilityCooldown, specter.abilityCooldown);
  saved.time = savedSpecter.ghostRunUntil;
  savedSpecter.abilityCooldown = 0;
  savedSpecter.order = { type: 'idle' };
  assert.deepEqual(saved.canUseUnitAbility(savedSpecter.id, 'ghostRun'),
    { ok: false, reason: 'Ghost Run requires a move order.' },
    'expired Ghost Run requires a fresh move order');
});

test('unit abilities validate ownership, unit type, and legacy replay rules', () => {
  const game = arena();
  const tank = game._createUnit('player', 'guardian', 20.5, 20.5);
  assert.equal(game.canUseUnitAbility(tank.id, 'ghostRun').ok, false);
  assert.equal(game.canUseUnitAbility(tank.id, 'brace', 'enemy').ok, false);
  game.replayVersion = 35;
  assert.match(game.canUseUnitAbility(tank.id, 'brace').reason, /unavailable in this replay/);
  game.replayVersion = 36;
  assert.deepEqual(game.useUnitAbility(tank.id, 'brace'), { ok: true });

  const legacyData = JSON.parse(game.serialize());
  delete legacyData.units[0].abilityCooldown;
  delete legacyData.units[0].braceUntil;
  delete legacyData.units[0].ghostRunUntil;
  const loaded = Game.deserialize(legacyData).getEntity(tank.id);
  assert.equal(loaded.abilityCooldown, 0);
  assert.equal(loaded.braceUntil, 0);
  assert.equal(loaded.ghostRunUntil, 0);
});

test('an in-progress save from before faction actions keeps its historical combat rules', () => {
  const game = arena();
  const guardian = game._createUnit('player', 'guardian', 20.5, 20.5);
  const oldSave = JSON.parse(game.serialize());
  delete oldSave.unitAbilityRulesVersion;
  delete oldSave.relayResponseRulesVersion;
  delete oldSave.units[0].abilityCooldown;
  delete oldSave.units[0].braceUntil;
  delete oldSave.units[0].ghostRunUntil;
  const resumed = Game.deserialize(oldSave);
  assert.equal(resumed.replayVersion, 35);
  assert.equal(resumed.canUseUnitAbility(guardian.id, 'brace').ok, false);
  assert.equal(Game.deserialize(resumed.serialize()).replayVersion, 35,
    'resaving the battle must not silently switch it to version 36');
});

test('enemy AI activates faction abilities for a visible fight and legacy AI remains unchanged', () => {
  const aegis = arena();
  const guardian = aegis._createUnit('enemy', 'guardian', 20.5, 20.5);
  aegis._createUnit('enemy', 'lightTank', 22.5, 20.5);
  aegis._createUnit('player', 'lightTank', 24.5, 20.5);
  aegis._aiUseFactionUnitAbilities();
  assert.ok(guardian.braceUntil > aegis.time);

  const vesper = arena('vesper');
  const specter = vesper._createUnit('enemy', 'stealthTank', 20.5, 20.5,
    { type: 'move', x: 30.5, y: 20.5, attackMove: true });
  vesper._createUnit('player', 'lightTank', 25.5, 20.5);
  vesper._aiUseFactionUnitAbilities();
  assert.ok(specter.ghostRunUntil > vesper.time);

  const legacy = arena();
  legacy.replayVersion = 35;
  const oldGuardian = legacy._createUnit('enemy', 'guardian', 20.5, 20.5);
  legacy._createUnit('enemy', 'lightTank', 22.5, 20.5);
  legacy._createUnit('player', 'lightTank', 24.5, 20.5);
  legacy._aiUseFactionUnitAbilities();
  assert.equal(oldGuardian.braceUntil, 0);
});
