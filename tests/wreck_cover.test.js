import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, WRECK_COVER_DAMAGE_MULTIPLIER, WRECK_COVER_PROXIMITY,
  WRECK_COVER_RADIUS, WRECK_COVER_RULES_VERSION,
} from '../src/game/engine.js';

function arena(replayVersion = WRECK_COVER_RULES_VERSION) {
  const game = new Game({ seed: 1554, mode: 'multiplayer' });
  game.replayVersion = replayVersion;
  game.units = []; game.buildings = []; game.bridges = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function addWreck(game, x, y, { id = 'wreck-test', owner = 'enemy', expiresAt = 120,
  campaignFreightCache = false } = {}) {
  const wreck = { id, x, y, owner, expiresAt, campaignFreightCache, value: 40 };
  game.wrecks.push(wreck);
  return wreck;
}

function directHit({ targetDef = 'rifle', targetOwner = 'player', sourceX = 7.5, sourceY = 10.5,
  targetX = 11.5, targetY = 10.5, damageType = 'ballistic', wrecks = [], replayVersion = 75,
} = {}) {
  const game = arena(replayVersion);
  const attackerOwner = targetOwner === 'player' ? 'enemy' : 'player';
  const source = game._createUnit(attackerOwner, 'buggy', sourceX, sourceY);
  const target = game._createUnit(targetOwner, targetDef, targetX, targetY);
  for (const wreck of wrecks) addWreck(game, wreck.x, wreck.y, wreck);
  const sourcePosition = { x: source.x, y: source.y, owner: source.owner,
    sourceId: source.id, projectile: true, defId: source.defId };
  game._applyDamage(target, 20, damageType, attackerOwner, source.id, sourcePosition);
  return { game, target, damage: target.maxHp - target.hp };
}

test('a vehicle wreck intercepts direct fire by circle geometry and the live projectile path', () => {
  assert.equal(WRECK_COVER_RULES_VERSION, 75);
  assert.equal(WRECK_COVER_RADIUS, 0.55);
  assert.equal(WRECK_COVER_PROXIMITY, 1.6);
  const run = withWreck => {
    const game = arena();
    const attacker = game._createUnit('enemy', 'buggy', 7.5, 10.5);
    const target = game._createUnit('player', 'rifle', 11.5, 10.5);
    if (withWreck) addWreck(game, 10.3, 10.5);
    game._fireAt(attacker, { x: target.x, y: target.y }, game.unitDefs.buggy.weapon, target.id);
    for (let i = 0; i < 4; i++) game._updateEffects(0.1);
    return { target, game };
  };
  const exposed = run(false), sheltered = run(true);
  const baseDamage = exposed.target.maxHp - exposed.target.hp;
  assert.equal(baseDamage, 18);
  assert.ok(Math.abs(sheltered.target.maxHp - sheltered.target.hp -
    baseDamage * WRECK_COVER_DAMAGE_MULTIPLIER) < 1e-9);
  const cue = sheltered.game.effects.find(effect => effect.type === 'wreckCover');
  assert.deepEqual({ wreckId: cue.wreckId, owner: cue.owner, maxTtl: cue.maxTtl },
    { wreckId: 'wreck-test', owner: 'player', maxTtl: 0.28 });
  assert.ok(cue.ttl > 0 && cue.ttl <= 0.28);
  assert.ok(Math.abs(cue.x - (10.3 - WRECK_COVER_RADIUS)) < 1e-9);
  const flank = directHit({ sourceX: 7.5, sourceY: 7.5, targetX: 11.5, targetY: 11.5,
    wrecks: [{ x: 10.3, y: 11.1 }] });
  assert.equal(flank.damage, 20, 'a segment missing the circular cover radius is exposed');
  assert.equal(flank.game.effects.some(effect => effect.type === 'wreckCover'), false);
  const stackedWrecks = directHit({ wrecks: [
    { id: 'farther', x: 10.3, y: 10.5 }, { id: 'nearer', x: 10, y: 10.5 },
  ] });
  assert.equal(stackedWrecks.game.effects.find(effect => effect.type === 'wreckCover')?.wreckId, 'nearer');
});

test('wreck cover is neutral to either owner and applies to engineers, while vehicles bypass it', () => {
  for (const targetOwner of ['player', 'enemy']) {
    const shot = directHit({ targetOwner, targetDef: 'engineer',
      wrecks: [{ x: 10.3, y: 10.5, owner: targetOwner }] });
    assert.equal(shot.damage, 16);
    assert.equal(shot.game.effects.find(effect => effect.type === 'wreckCover')?.owner, targetOwner);
  }
  const vehicle = directHit({ targetDef: 'lightTank', wrecks: [{ x: 10.3, y: 10.5 }] });
  assert.ok(Math.abs(vehicle.damage - 20 * 0.264) < 1e-9, 'vehicle armor applies without wreck cover');
  assert.equal(vehicle.game.effects.some(effect => effect.type === 'wreckCover'), false);
});

test('expired, removed, freight, and source- or target-side wrecks do not shelter; splash bypasses', () => {
  assert.equal(directHit({ wrecks: [{ x: 10.3, y: 10.5, expiresAt: 0 }] }).damage, 20);
  assert.equal(directHit({ sourceX: 10.3, wrecks: [{ x: 10.3, y: 10.5 }] }).damage, 20,
    'a source starting inside the .55 cover circle is not protected');
  assert.equal(directHit({ targetX: 10.55, wrecks: [{ x: 10.3, y: 10.5 }] }).damage, 20,
    'a target inside the .55 cover circle is not treated as sheltering behind the wreck');
  assert.equal(directHit({ wrecks: [{ x: 10.3, y: 10.5, campaignFreightCache: true }] }).damage, 20);
  const splash = directHit({ wrecks: [{ x: 10.3, y: 10.5 }], damageType: 'explosive' });
  assert.equal(splash.damage, 16, 'explosive armor applies while the cover bypasses');
  const removed = directHit({ wrecks: [{ x: 10.3, y: 10.5 }] });
  removed.game.wrecks = removed.game.wrecks.filter(wreck => wreck.id !== 'wreck-test');
  const target = removed.game.getEntity(removed.target.id);
  const before = target.hp;
  const attacker = removed.game.units.find(unit => unit.owner === 'enemy');
  removed.game._applyDamage(target, 20, 'ballistic', 'enemy', attacker.id,
    { x: attacker.x, y: attacker.y, owner: 'enemy', sourceId: attacker.id, projectile: true, defId: attacker.defId });
  assert.equal(before - target.hp, 20);
});

test('wreck protection selects the strongest cover and does not multiply with a wall', () => {
  const game = arena();
  const attacker = game._createUnit('enemy', 'buggy', 7.5, 10.5);
  const target = game._createUnit('player', 'rifle', 11.5, 10.5);
  addWreck(game, 10.3, 10.5);
  game._createBuilding('player', 'wall', 10, 10, 1);
  const source = { x: attacker.x, y: attacker.y, owner: 'enemy', sourceId: attacker.id,
    projectile: true, defId: attacker.defId };
  game._applyDamage(target, 20, 'ballistic', 'enemy', attacker.id, source);
  assert.ok(Math.abs(target.maxHp - target.hp - 20 * 0.72) < 1e-9);
  assert.equal(game.effects.filter(effect => ['wreckCover', 'wallCover'].includes(effect.type)).length, 1);
  assert.equal(game.effects.find(effect => effect.type === 'wallCover')?.type, 'wallCover');
});

test('new saves carry v75 while markerless v74 saves retain pre-wreck damage', () => {
  const fresh = new Game({ mode: 'multiplayer' });
  assert.equal(fresh.wreckCoverRulesVersion, 75);
  const migratedData = JSON.parse(fresh.serialize());
  delete migratedData.wreckCoverRulesVersion;
  migratedData.replayVersion = null;
  const migrated = Game.deserialize(migratedData);
  assert.equal(migrated.replayVersion, 74);
  assert.equal(migrated.wreckCoverRulesVersion, 75);
  const legacy = directHit({ replayVersion: 74, wrecks: [{ x: 10.3, y: 10.5 }] });
  assert.equal(legacy.damage, 20);
  assert.equal(legacy.game.effects.some(effect => effect.type === 'wreckCover'), false);
  const current = directHit({ replayVersion: 75, wrecks: [{ x: 10.3, y: 10.5 }] });
  assert.equal(current.damage, 16);
});
