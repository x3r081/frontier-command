import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS, BUILDING_DEFS, VESPER_AMBUSH_SUPPRESSION_SECONDS } from '../src/game/engine.js';

function clearArena(game) {
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
}

function harvestRate(faction, { owner = 'player', refineryOwner = owner, powered = true, refineryX = 10 } = {}) {
  const game = new Game({ faction, seed: 824 });
  clearArena(game);
  const refinery = game._createBuilding(refineryOwner, 'refinery', refineryX, 10);
  refinery.powered = powered;
  const field = { x: 16, y: 11 };
  Object.assign(game.terrain[field.y][field.x], { type: 'crystal', resource: 1000, buildable: false });
  const harvester = game._createUnit(owner, 'harvester', field.x + 0.5, field.y + 0.5, { type: 'harvest' });
  harvester._harvestTile = field;
  game._updateHarvester(harvester, 0.5);
  return harvester.cargo;
}

test('Aegis harvesters extract 20% faster near their own powered refinery', () => {
  assert.equal(harvestRate('aegis'), 67.2);
  assert.equal(harvestRate('vesper'), 56);
  assert.equal(harvestRate('aegis', { powered: false }), 56);
  assert.equal(harvestRate('aegis', { refineryX: 22 }), 56);
  assert.equal(harvestRate('aegis', { refineryOwner: 'enemy' }), 56,
    'enemy refinery does not support a player Aegis harvester');
});

function landAmbush(game, source, target) {
  source.cooldown = 0;
  game._fireAt(source, { x: target.x, y: target.y }, {
    damage: 1, range: 5, cooldown: 1, projectileSpeed: 100, damageType: 'ion', splash: 0,
  }, target.id);
  game._updateEffects(0.1);
}

test('Vesper stealth tank ambush suppresses a mobile ground weapon for two seconds once', () => {
  const game = new Game({ seed: 829 });
  clearArena(game);
  const source = game._createUnit('enemy', 'stealthTank', 20.5, 20.5);
  const target = game._createUnit('player', 'lightTank', 24.5, 20.5);
  landAmbush(game, source, target);
  assert.equal(source.faction, 'vesper');
  assert.equal(target.suppressedUntil, game.time + VESPER_AMBUSH_SUPPRESSION_SECONDS);

  const saved = Game.deserialize(game.serialize());
  const savedTarget = saved.getEntity(target.id);
  assert.equal(savedTarget.suppressedUntil, target.suppressedUntil);
  savedTarget.cooldown = 0;
  saved.time += 1;
  saved._updateUnit(savedTarget, 1);
  assert.equal(saved.effects.some(effect => effect.type === 'projectile' && effect.sourceId === target.id), false,
    'weapon fire is blocked during suppression even with a ready cooldown');
  saved.time += 1.1;
  savedTarget.cooldown = 0;
  saved._updateUnit(savedTarget, 0.1);
  assert.equal(saved.effects.some(effect => effect.type === 'projectile' && effect.sourceId === target.id), true,
    'weapon fire resumes after the suppression window');

  const firstUntil = target.suppressedUntil;
  game.time += 0.5;
  source.revealedUntil = game.time; // A later re-cloak can create another ambush shot.
  landAmbush(game, source, target);
  assert.equal(target.suppressedUntil, firstUntil, 'an active suppression cannot be refreshed');
});

test('real Specter splash projectile suppresses only its direct target, even through shields', () => {
  const game = new Game({ seed: 832 });
  clearArena(game);
  const source = game._createUnit('enemy', 'stealthTank', 20.5, 20.5);
  const target = game._createUnit('player', 'lightTank', 24.5, 20.5);
  const bystander = game._createUnit('player', 'rifle', 24.5, 20.75);
  target.shieldUntil = 10;
  target.shieldHp = 1000;
  const hpBefore = target.hp;
  game._fireAt(source, game._entityCenter(target), UNIT_DEFS.stealthTank.weapon, target.id);
  game._updateEffects(1);
  assert.equal(target.hp, hpBefore, 'shield absorbs the direct hit');
  assert.equal(target.suppressedUntil, VESPER_AMBUSH_SUPPRESSION_SECONDS);
  assert.equal(bystander.suppressedUntil, 0, 'splash bystanders are not disrupted');
});

test('Vesper ambush disruption excludes aircraft, buildings, and unarmed units', () => {
  const game = new Game({ seed: 830 });
  clearArena(game);
  const source = game._createUnit('enemy', 'stealthTank', 20.5, 20.5);
  const aircraft = game._createUnit('player', 'orca', 22.5, 20.5);
  const medic = game._createUnit('player', 'medic', 22.5, 21.5);
  const building = game._createBuilding('player', 'power', 24, 20);
  for (const target of [aircraft, medic, building]) {
    landAmbush(game, source, target);
    assert.equal(target.suppressedUntil || 0, 0);
    source.revealedUntil = game.time; // Reset concealment to produce a new first shot.
  }
});

test('legacy units default to no active Vesper suppression after loading', () => {
  const game = new Game({ seed: 831 });
  const unit = game._createUnit('player', 'lightTank', 20.5, 20.5);
  const data = JSON.parse(game.serialize());
  delete data.units.find(candidate => candidate.id === unit.id).suppressedUntil;
  assert.equal(Game.deserialize(data).getEntity(unit.id).suppressedUntil, 0);
});

test('new ordinary armed units fire with suppression initialized inactive', () => {
  const game = new Game({ seed: 833 });
  clearArena(game);
  const shooter = game._createUnit('player', 'rifle', 20.5, 20.5);
  const target = game._createUnit('enemy', 'rifle', 23.5, 20.5);
  for (const row of game.fog) row.fill(2);
  shooter.cooldown = 0;
  game._updateUnit(shooter, 0.1);
  assert.ok(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === shooter.id),
    'a new rifle is not blocked by an undefined suppression timer');
  assert.equal(shooter.suppressedUntil, 0);
  assert.ok(target.hp > 0);
});

function destroyWithUnit(game, target, source, damage = 10000, splash = false) {
  if (splash) game._damageArea(target.x + target.w / 2, target.y + target.h / 2, 1, damage, 'ion', source.owner, source.id);
  else game._applyDamage(target, damage, 'ion', source.owner, source.id);
}

test('Vesper salvage pays once for completed enemy structures destroyed by its armed unit', () => {
  const game = new Game({ faction: 'vesper', enemyFaction: 'aegis', seed: 839 });
  clearArena(game);
  const source = game._createUnit('player', 'flamer', 20.5, 20.5);
  const target = game._createBuilding('enemy', 'barracks', 24, 20);
  destroyWithUnit(game, target, source);
  assert.equal(game.credits.player, 3800 + Math.round(BUILDING_DEFS.barracks.cost * 0.12));
  assert.deepEqual(game.salvageEarned, { player: 60, enemy: 0 });
  const rewards = game.events.filter(event => event.type === 'vesperSalvage');
  assert.equal(rewards.length, 1);
  const { owner, targetId, defId, amount, x, y } = rewards[0];
  assert.deepEqual({ owner, targetId, defId, amount, x, y }, {
    owner: 'player', targetId: target.id, defId: 'barracks', amount: 60, x: 25, y: 21,
  });
  assert.equal(typeof rewards[0].message, 'string');
  assert.equal(game.effects.filter(effect => effect.type === 'salvage').length, 1);
  destroyWithUnit(game, target, source);
  assert.equal(game.events.filter(event => event.type === 'vesperSalvage').length, 1);
});

test('Vesper salvage uses the lethal splash source and respects award and storage caps', () => {
  const game = new Game({ faction: 'vesper', enemyFaction: 'aegis', seed: 840 });
  clearArena(game);
  const source = game._createUnit('player', 'stealthTank', 20.5, 20.5);
  const target = game._createBuilding('enemy', 'warhead', 24, 20);
  game.credits.player = 5900;
  destroyWithUnit(game, target, source, 10000, true);
  assert.equal(game.credits.player, 6000);
  assert.equal(game.events.filter(event => event.type === 'vesperSalvage')[0].amount, 100,
    'available storage is applied after the 180 credit reward cap');
  assert.equal(game.effects.filter(effect => effect.type === 'salvage')[0].amount, 100);
  assert.equal(game.salvageEarned.player, 100);
  game.credits.player = 0;
  const second = game._createBuilding('enemy', 'warhead', 32, 20);
  destroyWithUnit(game, second, source);
  assert.equal(game.events.filter(event => event.type === 'vesperSalvage').at(-1).amount, 180);
  assert.equal(game.salvageEarned.player, 280);
});

test('Vesper salvage excludes noncombat, non-Vesper, friendly, incomplete, zero-cost, and environmental destruction', () => {
  const game = new Game({ faction: 'vesper', enemyFaction: 'aegis', seed: 841 });
  clearArena(game);
  const target = game._createBuilding('enemy', 'barracks', 30, 20);
  const unarmed = game._createUnit('player', 'engineer', 20.5, 20.5);
  destroyWithUnit(game, target, unarmed);
  const nonVesper = game._createUnit('enemy', 'rifle', 20.5, 20.5);
  destroyWithUnit(game, target, nonVesper);
  const friendly = game._createBuilding('player', 'barracks', 30, 26);
  const armed = game._createUnit('player', 'flamer', 20.5, 20.5);
  destroyWithUnit(game, friendly, armed);
  const incomplete = game._createBuilding('enemy', 'power', 36, 20, 0.5);
  destroyWithUnit(game, incomplete, armed);
  const free = game._createBuilding('enemy', 'command', 40, 20);
  destroyWithUnit(game, free, armed);
  const env = game._createBuilding('enemy', 'power', 44, 20);
  game._applyDamage(env, 10000, 'ion', null, null);
  const sold = game._createBuilding('player', 'power', 48, 20);
  game.sellBuilding(sold.id);
  const captured = game._createBuilding('enemy', 'power', 52, 20);
  captured.hp = captured.maxHp * 0.7;
  const engineer = game._createUnit('player', 'engineer', 53.5, 21);
  game._updateEngineer(engineer, captured, 0.1);
  assert.equal(captured.owner, 'player', 'engineer capture transfers the structure without destroying it');
  assert.equal(game.events.filter(event => event.type === 'vesperSalvage').length, 0);
  assert.equal(game.effects.filter(effect => effect.type === 'salvage').length, 0);
});

test('Vesper salvage requires its source to survive and pays no zero-credit reward', () => {
  const game = new Game({ faction: 'vesper', enemyFaction: 'aegis', seed: 842 });
  clearArena(game);
  const source = game._createUnit('player', 'flamer', 20.5, 20.5);
  const target = game._createBuilding('enemy', 'barracks', 24, 20);
  source.hp = 0;
  destroyWithUnit(game, target, source);
  assert.equal(game.events.filter(event => event.type === 'vesperSalvage').length, 0);
  const another = game._createBuilding('enemy', 'power', 28, 20);
  source.hp = UNIT_DEFS.flamer.health;
  game.credits.player = game.creditCapacity.player;
  destroyWithUnit(game, another, source);
  assert.equal(game.events.filter(event => event.type === 'vesperSalvage').length, 0);
  assert.equal(game.effects.filter(effect => effect.type === 'salvage').length, 0);
});

test('in-flight Vesper structure kill awards identical salvage after save and reload', () => {
  const game = new Game({ faction: 'vesper', enemyFaction: 'aegis', seed: 843 });
  clearArena(game);
  const source = game._createUnit('player', 'flamer', 20.5, 20.5);
  const target = game._createBuilding('enemy', 'barracks', 23, 20);
  target.hp = 2;
  game._fireAt(source, game._entityCenter(target), { ...UNIT_DEFS.flamer.weapon, projectileSpeed: 100 }, target.id);
  const loaded = Game.deserialize(game.serialize());
  game._updateEffects(0.1);
  loaded._updateEffects(0.1);
  assert.equal(game.credits.player, loaded.credits.player);
  assert.deepEqual(game.events.filter(event => event.type === 'vesperSalvage'), loaded.events.filter(event => event.type === 'vesperSalvage'));
  assert.deepEqual(game.effects.filter(effect => effect.type === 'salvage'), loaded.effects.filter(effect => effect.type === 'salvage'));
  assert.deepEqual(loaded.salvageEarned, game.salvageEarned);
});

test('salvage-earned totals restore safely and legacy saves default both sides to zero', () => {
  const game = new Game({ faction: 'vesper', seed: 844 });
  const save = JSON.parse(game.serialize());
  save.salvageEarned = { player: 123, enemy: 45 };
  assert.deepEqual(Game.deserialize(save).salvageEarned, { player: 123, enemy: 45 });
  delete save.salvageEarned;
  assert.deepEqual(Game.deserialize(save).salvageEarned, { player: 0, enemy: 0 });
  save.salvageEarned = { player: -20, enemy: NaN };
  assert.deepEqual(Game.deserialize(save).salvageEarned, { player: 0, enemy: 0 });
  save.salvageEarned = { player: Infinity, enemy: '12' };
  assert.deepEqual(Game.deserialize(save).salvageEarned, { player: 0, enemy: 0 });
});
