import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MAX_BATTLEFIELD_WRECKS, WRECK_LIFETIME_SECONDS } from '../src/game/engine.js';

function arena() {
  const game = new Game({ seed: 4312 });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function advanceEngineer(game, engineer, seconds) {
  for (let i = 0; i < seconds * 10; i++) {
    game.time += 0.1;
    game._updateUnit(engineer, 0.1);
  }
}

test('ground vehicle losses create bounded, expiring non-blocking wrecks only', () => {
  const game = arena();
  const buggy = game._createUnit('enemy', 'buggy', 20.5, 20.5);
  buggy.hp = 0;
  game._destroyEntity(buggy, 'player', null);
  assert.deepEqual(game.wrecks[0], { id: 'wreck1', x: 20.5, y: 20.5, value: 68,
    faction: 'vesper', expiresAt: WRECK_LIFETIME_SECONDS });
  assert.equal(game._isPassable(20, 20), true, 'wrecks do not alter movement passability');

  for (const defId of ['rifle', 'apc', 'dropship']) {
    const unit = game._createUnit('enemy', defId, 22.5, 20.5);
    unit.hp = 0;
    game._destroyEntity(unit, 'player', null);
  }
  assert.equal(game.wrecks.length, 1, 'infantry and transports leave no salvage wreck');

  for (let index = 0; index < MAX_BATTLEFIELD_WRECKS + 2; index++) {
    const unit = game._createUnit('enemy', 'lightTank', 25.5, 20.5);
    unit.hp = 0;
    game._destroyEntity(unit, 'player', null);
  }
  assert.equal(game.wrecks.length, MAX_BATTLEFIELD_WRECKS);
  assert.equal(game.wrecks[0].id, 'wreck4', 'oldest wrecks are removed first at the cap');
  const wreckCount = game.wrecks.length;
  const nextWreckId = game._nextWreckId;
  game.terrain[30][30].walkable = false;
  const stranded = game._createUnit('enemy', 'lightTank', 30.5, 30.5);
  stranded.hp = 0;
  game._destroyEntity(stranded, 'player', null);
  assert.equal(game.wrecks.length, wreckCount, 'units lost on impassable collapsed spans leave no unreachable wreck');
  assert.equal(game._nextWreckId, nextWreckId);
  game._tick(0.01);
  assert.ok(game.wrecks.every(wreck => wreck.expiresAt > game.time));
});

test('either side can reclaim a visible wreck with a selected Engineer, with capped credits', () => {
  const game = arena();
  const wreck = { id: 'wreck1', x: 20.5, y: 20.5, value: 68, faction: 'vesper', expiresAt: 120 };
  game.wrecks.push(wreck);
  game._nextWreckId = 2;
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  game.credits.player = game.creditCapacity.player - 10;
  game.select(engineer.id);
  assert.deepEqual(game.issueRecoverWreck(wreck.id), { ok: true });
  assert.deepEqual(engineer.order, { type: 'recoverWreck', wreckId: wreck.id });
  advanceEngineer(game, engineer, 3.9);
  assert.equal(game.wrecks.length, 1);
  advanceEngineer(game, engineer, 0.1);
  assert.equal(game.wrecks.length, 0);
  assert.equal(game.credits.player, game.creditCapacity.player);
  assert.equal(game.events.at(-1).type, 'wreckRecovered');
  assert.equal(game.events.at(-1).value, 10, 'event value is the actual capped credit reward');

  const waitingWreck = { id: 'wreck3', x: 20.5, y: 20.5, value: 40, faction: 'vesper', expiresAt: 120 };
  game.wrecks.push(waitingWreck);
  game.credits.player = game.creditCapacity.player - 30;
  game.select(engineer.id);
  assert.deepEqual(game.issueRecoverWreck(waitingWreck.id), { ok: true });
  advanceEngineer(game, engineer, 3.9);
  game.credits.player = game.creditCapacity.player;
  advanceEngineer(game, engineer, 0.1);
  assert.equal(game.wrecks.some(item => item.id === waitingWreck.id), true,
    'the wreck remains when storage fills during channeling');
  assert.equal(game.events.at(-1).type, 'wreckRecoveryWaiting');
  game.credits.player = game.creditCapacity.player - 20;
  advanceEngineer(game, engineer, 0.1);
  assert.equal(game.wrecks.some(item => item.id === waitingWreck.id), false);
  assert.equal(game.events.at(-1).value, 20);

  const enemyWreck = { id: 'wreck2', x: 24.5, y: 20.5, value: 50, faction: 'aegis', expiresAt: 120 };
  game.wrecks.push(enemyWreck);
  const enemyEngineer = game._createUnit('enemy', 'engineer', 24.5, 20.5);
  game.commandOwner = 'enemy';
  game.select(enemyEngineer.id);
  assert.deepEqual(game.issueRecoverWreck(enemyWreck.id), { ok: true });
  advanceEngineer(game, enemyEngineer, 4);
  assert.ok(game.credits.enemy > 0, 'enemy Engineer also reclaims wrecks');
});

test('wreck commands require a selected Engineer and visible live wreck; save/load keeps active recovery', () => {
  const game = arena();
  const engineer = game._createUnit('player', 'engineer', 20.5, 20.5);
  const wreck = { id: 'wreck7', x: 20.5, y: 20.5, value: 40, faction: 'aegis', expiresAt: 100 };
  game.wrecks.push(wreck); game._nextWreckId = 8;
  assert.equal(game.issueRecoverWreck(wreck.id).ok, false);
  game.select(engineer.id);
  game.credits.player = game.creditCapacity.player;
  assert.deepEqual(game.issueRecoverWreck(wreck.id), { ok: false, reason: 'Command storage is full.' });
  game.credits.player = 0;
  assert.equal(game.issueRecoverWreck('wreck8').ok, false);
  assert.equal(game.issueRecoverWreck(wreck.id).ok, true);
  const loaded = Game.deserialize(game.serialize());
  assert.deepEqual(loaded.wrecks, [wreck]);
  assert.equal(loaded._nextWreckId, 8);
  const loadedEngineer = loaded.getEntity(engineer.id);
  advanceEngineer(loaded, loadedEngineer, 4);
  assert.equal(loaded.wrecks.length, 0);

  const legacy = Game.deserialize({ ...JSON.parse(game.serialize()), wrecks: undefined, _nextWreckId: undefined });
  assert.deepEqual(legacy.wrecks, [], 'old saves default to no wrecks');
  legacy.replayVersion = 9;
  const vehicle = legacy._createUnit('enemy', 'buggy', 22.5, 22.5);
  vehicle.hp = 0; legacy._destroyEntity(vehicle, 'player', null);
  assert.deepEqual(legacy.wrecks, [], 'older replays retain historical loss behavior');
});

test('solo AI sends only idle Engineers to nearby visible wrecks', () => {
  const game = arena();
  const engineer = game._createUnit('enemy', 'engineer', 20.5, 20.5);
  game.wrecks.push({ id: 'wreck1', x: 22.5, y: 20.5, value: 30,
    faction: 'aegis', expiresAt: 100 });
  const busy = game._createUnit('enemy', 'engineer', 21.5, 20.5, { type: 'move', x: 30, y: 20 });
  game._aiRecoverWrecks();
  assert.deepEqual(engineer.order, { type: 'recoverWreck', wreckId: 'wreck1' });
  assert.deepEqual(busy.order, { type: 'move', x: 30, y: 20 });
  game.credits.enemy = game.creditCapacity.enemy;
  const secondEngineer = game._createUnit('enemy', 'engineer', 21.5, 21.5);
  game.wrecks.push({ id: 'wreck2', x: 24.5, y: 20.5, value: 30,
    faction: 'aegis', expiresAt: 100 });
  game._aiRecoverWrecks();
  assert.deepEqual(secondEngineer.order, { type: 'idle' }, 'AI does not seek salvage with full storage');
});
