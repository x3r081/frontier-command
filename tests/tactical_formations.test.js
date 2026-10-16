import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, TACTICAL_FORMATION_RULES_VERSION } from '../src/game/engine.js';

function arena(replayVersion = TACTICAL_FORMATION_RULES_VERSION) {
  const game = new Game({ seed: 7621, replayVersion });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function add(game, types = ['rifle', 'rifle', 'rifle', 'rifle'], positions) {
  return types.map((type, index) => {
    const [x, y] = positions?.[index] || [10.5 + (index % 2) * 1.5, 10.5 + Math.floor(index / 2) * 1.5];
    return game._createUnit('player', type, x, y);
  });
}

function byId(units) { return Object.fromEntries(units.map(unit => [unit.id, [unit.order.x, unit.order.y]])); }

test('line and column formations orient toward travel and assign independently of selection order', () => {
  for (const formation of ['line', 'column']) {
    const game = arena();
    const units = add(game, Array(10).fill('lightTank'));
    game.select(units.map(unit => unit.id).reverse());
    const preview = game.getFormationPreview(30.5, 25.5, formation);
    assert.ok(Math.abs(preview.facing - Math.atan2(12, 19.25)) < 0.01);
    assert.equal(preview.slots.length, units.length);
    assert.equal(new Set(preview.slots.map(slot => `${slot.x},${slot.y}`)).size, units.length);
    assert.deepEqual(game.issueFormationMove(30.5, 25.5, formation), { ok: true });
    const reverseOrder = arena();
    const otherUnits = add(reverseOrder, Array(10).fill('lightTank'));
    reverseOrder.select(otherUnits.map(unit => unit.id));
    reverseOrder.issueFormationMove(30.5, 25.5, formation);
    assert.deepEqual(byId(units), byId(otherUnits));
    for (const unit of units) {
      assert.equal(unit.order.formationFacing, preview.facing);
      assert.equal(game._isPassable(Math.floor(unit.order.x), Math.floor(unit.order.y)), true);
    }
    const right = [-Math.sin(preview.facing), Math.cos(preview.facing)];
    const lateral = preview.slots.map(slot => slot.x * right[0] + slot.y * right[1]);
    if (formation === 'column') assert.ok(Math.max(...lateral) - Math.min(...lateral) < 5, 'column stays narrow');
    else assert.ok(Math.max(...lateral) - Math.min(...lateral) > 7, 'line uses broad ranks');
  }
});

test('screen places armor, general infantry and support in front-to-rear bands', () => {
  const game = arena();
  const units = add(game, ['lightTank', 'artillery', 'rocket', 'rifle', 'flamer', 'scout', 'medic', 'harvester']);
  game.select(units.map(unit => unit.id));
  const preview = game.getFormationPreview(30.5, 10.5, 'screen');
  const slots = Object.fromEntries(preview.slots.map(slot => [slot.id, slot]));
  assert.equal(slots[units[0].id].role, 'front');
  for (const i of [3, 4, 5]) assert.equal(slots[units[i].id].role, 'middle');
  for (const i of [1, 2, 6, 7]) assert.equal(slots[units[i].id].role, 'rear');
  const forward = [Math.cos(preview.facing), Math.sin(preview.facing)];
  const depth = unit => (slots[unit.id].x - 30.5) * forward[0] + (slots[unit.id].y - 10.5) * forward[1];
  assert.ok(depth(units[0]) > depth(units[3]));
  assert.ok(depth(units[3]) > depth(units[1]));

  const infantry = arena();
  const onlyMiddle = add(infantry, Array(4).fill('rifle'));
  infantry.select(onlyMiddle.map(unit => unit.id));
  const compactScreen = infantry.getFormationPreview(30.5, 10.5, 'screen');
  const compactForward = [Math.cos(compactScreen.facing), Math.sin(compactScreen.facing)];
  const frontDepth = compactScreen.slots.map(slot =>
    (slot.x - 30.5) * compactForward[0] + (slot.y - 10.5) * compactForward[1]);
  assert.ok(frontDepth.every(value => Math.abs(value) < 1e-9),
    'an absent front role does not leave an empty band ahead of the middle');
});

test('army-size columns limit depth without overlapping vehicle slots', () => {
  const game = arena();
  const units = add(game, Array(128).fill('lightTank'));
  game.select(units.map(unit => unit.id));
  const preview = game.getFormationPreview(30.5, 24.5, 'column');
  const forward = [Math.cos(preview.facing), Math.sin(preview.facing)];
  const right = [-forward[1], forward[0]];
  const depths = preview.slots.map(slot => (slot.x - 30.5) * forward[0] + (slot.y - 24.5) * forward[1]);
  const lateral = preview.slots.map(slot =>
    (slot.x - 30.5) * right[0] + (slot.y - 24.5) * right[1]);
  assert.ok(Math.max(...lateral) - Math.min(...lateral) <= 9.001);
  assert.ok(Math.max(...depths) - Math.min(...depths) <= 30.001);
  for (let i = 0; i < preview.slots.length; i++) for (let j = i + 1; j < preview.slots.length; j++)
    assert.ok(Math.hypot(preview.slots[i].x - preview.slots[j].x,
      preview.slots[i].y - preview.slots[j].y) >= 1.49, 'nominal tank positions retain clearance');
});

test('placements remain passable and connected around a wall and reservation blockers', () => {
  const game = arena();
  const units = add(game, Array(6).fill('rifle'));
  for (let y = 0; y < game.height; y++) game.terrain[y][20].walkable = false;
  game._createUnit('enemy', 'rifle', 18.5, 24.5);
  game.select(units.map(unit => unit.id));
  game.issueFormationMove(20.5, 24.5, 'line');
  const destinations = units.map(unit => [unit.order.x, unit.order.y]);
  assert.equal(new Set(destinations.map(p => p.join(','))).size, units.length);
  for (const [x, y] of destinations) {
    assert.ok(x < 20);
    assert.equal(game._isPassable(Math.floor(x), Math.floor(y)), true);
    assert.ok(game._findPath(units[0].x, units[0].y, x, y).length > 0);
  }
});

test('queued orientation persists, only final arrival turns to formation facing, and markerless v75 pins', () => {
  const game = arena();
  game.status = 'playing';
  const units = add(game, ['rifle', 'rifle']);
  game.select(units.map(unit => unit.id));
  game.issueFormationMove(20.5, 10.5, 'line');
  const first = units.map(unit => ({ ...unit.order }));
  game.issueFormationMove(10.5, 25.5, 'column', 'move', true);
  const queued = units.map(unit => ({ ...unit.order.queue[0] }));
  assert.ok(queued.every(order => Number.isFinite(order.formationFacing)));
  for (let i = 0; i < units.length; i++) {
    units[i].x = first[i].x; units[i].y = first[i].y; units[i].facing = 0;
  }
  for (const unit of units) game._updateUnit(unit, 0.1);
  assert.ok(units.every((unit, index) => unit.order.formationFacing === queued[index].formationFacing));
  assert.ok(units.every(unit => unit.facing === 0), 'intermediate arrival keeps its facing');
  const saved = Game.deserialize(game.serialize());
  assert.deepEqual(units.map(unit => unit.order), units.map(unit => saved.getEntity(unit.id).order));
  for (const unit of units) {
    unit.x = unit.order.x; unit.y = unit.order.y;
  }
  for (const unit of units) game._updateUnit(unit, 0.1);
  assert.ok(units.every((unit, index) => Math.abs(unit.facing - queued[index].formationFacing) < 1e-9));

  const replacement = arena();
  const movers = add(replacement, ['rifle', 'rifle']);
  replacement.select(movers.map(unit => unit.id));
  replacement.issueFormationMove(40.5, 10.5, 'line');
  const actualFacing = Math.atan2(25.5 - 10.5, 20.5 - 11.25);
  replacement.issueFormationMove(20.5, 25.5, 'line');
  assert.ok(movers.every(unit => Math.abs(unit.order.formationFacing - actualFacing) < 0.01),
    'a replacement order orients from current positions, not the pending destination');

  const v75 = arena(75);
  const markerless = JSON.parse(v75.serialize());
  markerless.replayVersion = null;
  delete markerless.tacticalFormationRulesVersion;
  const loaded = Game.deserialize(markerless);
  assert.equal(loaded.replayVersion, 75);
  assert.equal(loaded.tacticalFormationRulesVersion, TACTICAL_FORMATION_RULES_VERSION);
  assert.equal(loaded.issueFormationMove(20.5, 20.5, 'line').ok, false);
});

test('mixed air gets independent destinations and Match Pace applies only to ground', () => {
  const game = arena();
  const ground = add(game, ['lightTank', 'rifle']);
  const air = game._createUnit('player', 'orca', 15.5, 10.5);
  game.select([...ground, air].map(unit => unit.id));
  assert.deepEqual(game.issueFormationMove(28.5, 20.5, 'line', 'forceMove', false, true), { ok: true });
  assert.ok(ground.every(unit => Number.isFinite(unit.order.pace)));
  assert.equal(air.order.pace, undefined);
  assert.deepEqual([air.order.x, air.order.y], [28.5, 20.5]);
  assert.ok(ground.every(unit => Math.hypot(unit.order.x - 28.5, unit.order.y - 20.5) > 0.5));
});

test('formation calls reject malformed parameters without changing orders or event log', () => {
  const game = arena();
  const units = add(game, ['rifle', 'rifle']);
  game.select(units.map(unit => unit.id));
  const orders = units.map(unit => structuredClone(unit.order));
  const eventCount = game.events.length;
  for (const args of [
    [20.5, 20.5, 'wedge'], [20.5, 20.5, 'line', 'attack'],
    [20.5, 20.5, 'line', 'move', 1], [20.5, 20.5, 'line', 'move', false, 1],
    [Infinity, 20.5, 'line'],
  ]) assert.equal(game.issueFormationMove(...args).ok, false);
  assert.deepEqual(units.map(unit => unit.order), orders);
  assert.equal(game.events.length, eventCount);
  assert.equal(game.getFormationPreview(20.5, 20.5, 'unknown'), null);
});
