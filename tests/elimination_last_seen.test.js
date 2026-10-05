import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function eliminationGame() {
  const game = new Game({ seed: 3417, mode: 'skirmish', victoryMode: 'elimination' });
  game.units = [];
  game.buildings = [];
  game.fog = Array.from({ length: game.height }, () => Array(game.width).fill(1));
  return game;
}

function reveal(game, x, y) { game.fog[y][x] = 2; }
function refreshIntel(game) { game._refreshLastSeenHostileUnits(); }

test('Elimination remembers only an enemy mobile unit when it is actually visible', () => {
  const game = eliminationGame();
  const enemy = game._createUnit('enemy', 'lightTank', 20.25, 14.5);
  reveal(game, 20, 14);
  refreshIntel(game);
  const beforeRead = JSON.stringify(game.lastSeenHostileUnits);
  assert.deepEqual(game.getLastSeenHostileUnits(), [], 'live visible units are rendered by the ordinary enemy path');
  assert.equal(JSON.stringify(game.lastSeenHostileUnits), beforeRead, 'reading intel does not update serialized game state');
  game.fog[14][20] = 1;
  const [contact] = game.getLastSeenHostileUnits();
  assert.deepEqual(contact, { entityId: enemy.id, defId: 'lightTank', x: 20.25, y: 14.5, lastSeenAt: game.time });
  contact.x = 0;
  assert.equal(game.getLastSeenHostileUnits()[0].x, 20.25, 'getter returns cloned contact records');
});

test('a sighted unit retains its last position after it moves into fog', () => {
  const game = eliminationGame();
  const enemy = game._createUnit('enemy', 'engineer', 20.25, 14.5);
  reveal(game, 20, 14);
  refreshIntel(game);
  game.fog[14][20] = 1;
  enemy.x = 38.25;
  enemy.y = 25.5;
  const [contact] = game.getLastSeenHostileUnits();
  assert.deepEqual([contact.x, contact.y], [20.25, 14.5]);
});

test('the real fog update records a sighting and turns it stale after the scout leaves', () => {
  const game = eliminationGame();
  game.relays = [];
  const scout = game._createUnit('player', 'scout', 12.5, 10.5);
  const enemy = game._createUnit('enemy', 'lightTank', 15.25, 10.5);
  game.fog = Array.from({ length: game.height }, () => Array(game.width).fill(0));
  game._updateFog();
  assert.equal(game.getLastSeenHostileUnits().length, 0, 'currently visible contact is not duplicated');

  scout.x = 45.5;
  scout.y = 35.5;
  game._updateFog();
  const [contact] = game.getLastSeenHostileUnits();
  assert.equal(contact.entityId, enemy.id);
  assert.deepEqual([contact.x, contact.y], [15.25, 10.5]);
});

test('hidden death does not erase or relocate the remembered contact', () => {
  const game = eliminationGame();
  const enemy = game._createUnit('enemy', 'lightTank', 20.25, 14.5);
  reveal(game, 20, 14);
  refreshIntel(game);
  game.fog[14][20] = 1;
  game.units = game.units.filter(unit => unit.id !== enemy.id);
  refreshIntel(game);
  const [contact] = game.getLastSeenHostileUnits();
  assert.equal(contact.entityId, enemy.id);
  assert.deepEqual([contact.x, contact.y], [20.25, 14.5]);
});

test('rediscovery updates the contact and rescouting the old tile clears it', () => {
  const game = eliminationGame();
  const enemy = game._createUnit('enemy', 'mcv', 20.25, 14.5);
  reveal(game, 20, 14);
  refreshIntel(game);
  assert.deepEqual(game.getLastSeenHostileUnits(), []);
  game.fog[14][20] = 1;
  game.getLastSeenHostileUnits();
  enemy.x = 38.25;
  enemy.y = 25.5;
  reveal(game, 38, 25);
  refreshIntel(game);
  assert.deepEqual(game.getLastSeenHostileUnits(), [], 'rediscovered units leave the stale contact layer');
  game.fog[25][38] = 1;
  const [rediscovered] = game.getLastSeenHostileUnits();
  assert.deepEqual([rediscovered.x, rediscovered.y], [38.25, 25.5]);
  game.fog[25][38] = 2;
  enemy.x = 48.25;
  enemy.y = 30.5;
  refreshIntel(game);
  assert.deepEqual(game.getLastSeenHostileUnits(), []);
});

test('last-seen contacts survive save/load and are sanitized', () => {
  const game = eliminationGame();
  game.time = 12;
  const enemy = game._createUnit('enemy', 'buggy', 20.25, 14.5);
  reveal(game, 20, 14);
  refreshIntel(game);
  game.fog[14][20] = 1;
  const loaded = Game.deserialize(game.serialize());
  assert.deepEqual(loaded.getLastSeenHostileUnits(), game.getLastSeenHostileUnits());

  const malformed = JSON.parse(game.serialize());
  malformed.lastSeenHostileUnits.push({ entityId: 'bad', defId: 'harvester', x: 4, y: 4, lastSeenAt: 12 });
  malformed.lastSeenHostileUnits.push({ entityId: 'future', defId: 'lightTank', x: 4, y: 4, lastSeenAt: 99 });
  assert.deepEqual(Game.deserialize(malformed).getLastSeenHostileUnits().map(item => item.entityId), [enemy.id]);
});

test('contacts are disabled outside solo skirmish Elimination', () => {
  for (const options of [
    { mode: 'skirmish', victoryMode: 'dominion' },
    { mode: 'campaign', victoryMode: 'elimination' },
    { mode: 'multiplayer', victoryMode: 'elimination' },
  ]) {
    const game = new Game({ seed: 3418, ...options });
    game.lastSeenHostileUnits = [{ entityId: 'u99', defId: 'lightTank', x: 1, y: 1, lastSeenAt: 0 }];
    assert.deepEqual(game.getLastSeenHostileUnits(), []);
    assert.deepEqual(Game.deserialize(game.serialize()).getLastSeenHostileUnits(), []);
  }
});

test('contact memory is bounded by count and retains old unconfirmed sightings', () => {
  const game = eliminationGame();
  game.fog[10][10] = 1;
  for (let index = 0; index < 110; index++) {
    const enemy = game._createUnit('enemy', 'lightTank', 10.1 + index / 100, 10.1);
    game.time = index;
    game.lastSeenHostileUnits.push({ entityId: enemy.id, defId: 'lightTank', x: 10.1, y: 10.1, lastSeenAt: index });
  }
  refreshIntel(game);
  assert.equal(game.getLastSeenHostileUnits().length, 96);
  game.time += 1000;
  refreshIntel(game);
  assert.equal(game.getLastSeenHostileUnits().length, 96);
});
