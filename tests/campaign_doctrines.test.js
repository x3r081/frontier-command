import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, UNIT_DEFS, BUILDING_DEFS } from '../src/game/engine.js';
import { CAMPAIGN_DOCTRINES, CAMPAIGN_MISSIONS, createCampaignGame } from '../src/game/campaign.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);

test('doctrine IDs are stable, frozen, and validated', () => {
  assert.deepEqual(CAMPAIGN_DOCTRINES.map(doctrine => doctrine.id),
    ['standard', 'rapid', 'reinforced', 'precision']);
  assert.ok(Object.isFrozen(CAMPAIGN_DOCTRINES));
  for (const doctrine of CAMPAIGN_DOCTRINES) {
    assert.ok(Object.isFrozen(doctrine));
    assert.ok(doctrine.name && doctrine.description);
  }
  assert.throws(() => createCampaignGame(0, 'normal', 123, 'unknown'), RangeError);
});

test('all fifteen missions apply reinforced health to player starting units only', () => {
  for (let index = 0; index < CAMPAIGN_MISSIONS.length; index++) {
    const standard = createCampaignGame(index, 'normal', 1234, 'standard');
    const reinforced = createCampaignGame(index, 'normal', 1234, 'reinforced');
    assert.equal(reinforced.campaignDoctrineId, 'reinforced');
    assert.equal(standard.units.length, reinforced.units.length);
    for (let i = 0; i < standard.units.length; i++) {
      const before = standard.units[i], after = reinforced.units[i];
      assert.equal(after.defId, before.defId);
      assert.equal(after.owner, before.owner);
      close(after.maxHp, before.maxHp * (before.owner === 'player' ? 1.12 : 1));
      close(after.hp / after.maxHp, before.hp / before.maxHp);
    }
    assert.equal(standard.serialize(), createCampaignGame(index, 'normal', 1234).serialize());
  }
});

test('produced units inherit reinforced health and promotion retains its multiplier', () => {
  const game = createCampaignGame(0, 'normal', 88, 'reinforced');
  assert.equal(game.queueUnit('rifle').ok, true);
  const initialIds = new Set(game.units.map(unit => unit.id));
  for (let i = 0; i < 60 && !game.units.some(unit => !initialIds.has(unit.id) && unit.owner === 'player'); i++)
    game.update(0.5);
  const produced = game.units.find(unit => !initialIds.has(unit.id) && unit.owner === 'player' && unit.defId === 'rifle');
  assert.ok(produced);
  close(produced.maxHp, UNIT_DEFS.rifle.health * 1.12);
  produced.hp = produced.maxHp / 2;
  const enemy = game._createUnit('enemy', 'lightTank', 30, 30);
  game._applyDamage(enemy, 180, 'ion', 'player', produced.id);
  assert.equal(produced.veterancy, 1);
  close(produced.maxHp, UNIT_DEFS.rifle.health * 1.05 * 1.12);
  close(produced.hp / produced.maxHp, 0.5);
});

test('rapid movement and precision projectiles affect only player campaign units', () => {
  const rapid = createCampaignGame(0, 'normal', 90, 'rapid');
  const normal = createCampaignGame(0, 'normal', 90);
  for (const [game, owner] of [[rapid, 'player'], [normal, 'player'], [rapid, 'enemy']]) {
    const unit = game._createUnit(owner, 'dropship', 30, 30);
    game._moveUnit(unit, 40, 30, 1);
    close(unit.x - 30, UNIT_DEFS.dropship.speed * (game === rapid && owner === 'player' ? 1.12 : 1));
  }
  const precision = createCampaignGame(0, 'normal', 91, 'precision');
  for (const owner of ['player', 'enemy']) {
    const unit = precision._createUnit(owner, 'rifle', 30, 30);
    precision._fireAt(unit, { x: 34, y: 30 }, UNIT_DEFS.rifle.weapon);
    close(precision.effects.findLast(effect => effect.type === 'projectile').damage,
      UNIT_DEFS.rifle.weapon.damage * (owner === 'player' ? 1.1 : 1));
  }
  const building = precision._createBuilding('player', 'turret', 30, 30);
  precision._fireAt(building, { x: 34, y: 30 }, BUILDING_DEFS.turret.weapon);
  close(precision.effects.findLast(effect => effect.type === 'projectile').damage, BUILDING_DEFS.turret.weapon.damage);
});

test('save/load preserves doctrine behavior; legacy and invalid IDs become standard', () => {
  const game = createCampaignGame(1, 'normal', 92, 'reinforced');
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  const standard = createCampaignGame(1, 'normal', 92, 'standard');
  const standardEngineer = standard.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  close(engineer.maxHp, standardEngineer.maxHp * 1.12);
  engineer.hp = engineer.maxHp * 0.4;
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.campaignDoctrineId, 'reinforced');
  close(loaded.getEntity(engineer.id).hp / loaded.getEntity(engineer.id).maxHp, 0.4);
  close(loaded._createUnit('player', 'rifle', 30, 30).maxHp, UNIT_DEFS.rifle.health * 1.12);

  for (const id of [undefined, 'invalid']) {
    const oldSave = JSON.parse(createCampaignGame(0, 'normal', 93).serialize());
    if (id === undefined) delete oldSave.campaignDoctrineId;
    else oldSave.campaignDoctrineId = id;
    const restored = Game.deserialize(oldSave);
    assert.equal(restored.campaignDoctrineId, 'standard');
    close(restored._createUnit('player', 'rifle', 30, 30).maxHp, UNIT_DEFS.rifle.health);
  }
  const skirmish = new Game({ mode: 'skirmish', campaignDoctrineId: 'reinforced', seed: 94 });
  assert.equal(skirmish.campaignDoctrineId, 'standard');
  close(skirmish._createUnit('player', 'rifle', 30, 30).maxHp, UNIT_DEFS.rifle.health);
});
