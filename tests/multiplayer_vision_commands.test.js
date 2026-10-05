import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

test('both multiplayer seats place through their own live vision, including a tactical scan', () => {
  const game = new Game({ mode: 'multiplayer', seed: 80217 });
  const unseenGuestSite = { x: 42, y: 4 };
  assert.equal(game._tileVisibleToOwner('enemy', unseenGuestSite.x, unseenGuestSite.y), false);

  game.commandOwner = 'enemy';
  assert.equal(game.startConstruction('wall').ok, true);
  game.update(3.1);
  assert.equal(game.enemyConstruction?.ready, true);
  assert.deepEqual(game.issueBuild('wall', unseenGuestSite.x, unseenGuestSite.y),
    { ok: false, reason: 'Reveal the area before building.' });
  assert.equal(game.useCommandAbility('scan', unseenGuestSite.x + 0.5, unseenGuestSite.y + 0.5).ok, true);
  assert.equal(game._tileVisibleToOwner('enemy', unseenGuestSite.x, unseenGuestSite.y), true);
  assert.equal(game.issueBuild('wall', unseenGuestSite.x, unseenGuestSite.y).ok, true);

  game.commandOwner = 'player';
  const hostSite = { x: 7, y: 33 };
  assert.equal(game._tileVisibleToOwner('player', hostSite.x, hostSite.y), true);
  assert.equal(game.startConstruction('wall').ok, true);
  game.update(3.1);
  assert.equal(game.issueBuild('wall', hostSite.x, hostSite.y).ok, true);
});

test('guest strategic strike needs actual multiplayer vision and accepts a public scan', () => {
  const game = new Game({ mode: 'multiplayer', seed: 80217 });
  game.commandOwner = 'enemy';
  game._createBuilding('enemy', 'warhead', 58, 30, 1);
  game.superweapon.enemy = 1;
  const target = { x: 48, y: 3 };
  assert.equal(game._tileVisibleToOwner('enemy', target.x, target.y), false);
  assert.deepEqual(game.useSuperweapon(target.x, target.y),
    { ok: false, reason: 'Target must be visible.' });
  assert.equal(game.superweapon.enemy, 1, 'an invalid strike keeps its charge');
  assert.equal(game.useCommandAbility('scan', target.x + 0.5, target.y + 0.5).ok, true);
  assert.equal(game.useSuperweapon(target.x, target.y).ok, true);
  assert.equal(game.superweapon.enemy, 0);
});
