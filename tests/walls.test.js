import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_DEFS, Game } from '../src/game/engine.js';

function findWallSite(game) {
  for (let y = 2; y < game.height - 2; y++) for (let x = 2; x < game.width - 2; x++) {
    if (game.canPlaceBuilding('wall', x, y).ok) return { x, y };
  }
  throw new Error('No legal wall site');
}

function buildWall(game) {
  assert.equal(game.startConstruction('wall').ok, true);
  for (let i = 0; i < 100 && !game.construction.ready; i++) game.update(0.1);
  assert.equal(game.construction.ready, true);
  const site = findWallSite(game);
  const result = game.issueBuild('wall', site.x, site.y);
  assert.equal(result.ok, true);
  return game.getEntity(result.id);
}

test('wall is buildable through the normal construction and placement flow', () => {
  const game = new Game({ seed: 902 });
  const initialCredits = game.credits.player;
  const initialConsumption = game.power.player.consumption;
  const wall = buildWall(game);

  assert.equal(wall.defId, 'wall');
  assert.equal(wall.progress, 1);
  assert.equal(game.credits.player, initialCredits - BUILDING_DEFS.wall.cost);
  assert.equal(game.power.player.consumption, initialConsumption);
  assert.equal(game.hasBuilding('player', 'wall'), true);
  assert.equal(game.hasBuilding('player', 'command'), true);

  wall.hp = 100;
  assert.equal(game.toggleRepair(wall.id).ok, true);
  game.update(0.1);
  assert.ok(wall.hp > 100);
  assert.equal(game.sellBuilding(wall.id).ok, true);
  assert.equal(wall.hp, 0);
});

test('wall blocks a ground route, then opens it when destroyed and survives save/load', () => {
  const game = new Game({ seed: 903, mode: 'multiplayer' });
  const wall = buildWall(game);
  const source = { x: wall.x - 2 + 0.5, y: wall.y + 0.5 };
  const destination = { x: wall.x + 2 + 0.5, y: wall.y + 0.5 };
  const blockedPath = game._findPath(source.x, source.y, destination.x, destination.y);
  assert.ok(blockedPath.length > 2);
  assert.equal(blockedPath.some(point => Math.floor(point.x) === wall.x && Math.floor(point.y) === wall.y), false);

  const loaded = Game.deserialize(game.serialize());
  const loadedWall = loaded.getEntity(wall.id);
  assert.equal(loadedWall.defId, 'wall');
  assert.deepEqual(loaded._findPath(source.x, source.y, destination.x, destination.y), blockedPath);

  game._applyDamage(wall, 1000, 'ion', 'enemy');
  assert.equal(wall.hp, 0);
  assert.equal(game._isPassable(wall.x, wall.y), true);
  assert.ok(game._findPath(source.x, source.y, destination.x, destination.y).length < blockedPath.length);
});

test('walls cannot replace a command yard or keep a defeated side alive', () => {
  const game = new Game({ seed: 904, mode: 'multiplayer' });
  const wall = buildWall(game);
  game.buildings = game.buildings.filter(building => building.id === wall.id || building.owner === 'enemy');
  game.units = game.units.filter(unit => unit.owner === 'enemy');
  assert.equal(game.hasBuilding('player', 'command'), false);
  assert.equal(game.canBuild('refinery', 'player').ok, false);

  game.update(0.1);
  assert.equal(game.status, 'defeat');
  assert.equal(game.winner, 'enemy');
});
