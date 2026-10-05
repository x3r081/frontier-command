import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';
import { createSoloPlayback, SOLO_REPLAY_VERSION } from '../src/game/replay.js';

const terrainSignature = game => createHash('sha256')
  .update(game.terrain.map(row => row.map(tile => `${tile.type}:${Math.round(tile.resource)}`).join(',')).join('|'))
  .digest('hex');

function hasRefinerySite(game, owner) {
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    if (game.canPlaceBuilding('refinery', x, y, owner).ok) return true;
  }
  return false;
}

function routeDistance(game, unit, target) {
  const path = game._findPath(unit.x, unit.y, target.x, target.y);
  if (!path.length) return Infinity;
  return Math.hypot(path[0].x - unit.x, path[0].y - unit.y) +
    path.slice(1).reduce((total, point, index) => total +
      Math.hypot(point.x - path[index].x, point.y - path[index].y), 0);
}

test('solo map archetypes have distinct terrain and relay layouts', () => {
  assert.deepEqual(SKIRMISH_MAPS.map(map => map.id), ['shard-valley', 'twin-passes', 'delta-crossing', 'canyon-ring', 'storm-basin']);
  const games = SKIRMISH_MAPS.map(map => new Game({ seed: 80217, mapId: map.id }));
  assert.equal(new Set(games.map(terrainSignature)).size, games.length);
  assert.equal(new Set(games.map(game => game.relays.map(relay => `${relay.x},${relay.y}`).join('|'))).size,
    games.length);
  const twin = games[1], delta = games[2];
  assert.equal(twin.terrain[10][29].type, 'rock');
  assert.equal(twin.terrain[18][29].walkable, true);
  assert.equal(twin.terrain[34][29].walkable, true);
  assert.equal(delta.terrain[22][30].type, 'water');
  assert.equal(delta.terrain[22][20].walkable, true);
  assert.equal(delta.terrain[22][42].walkable, true);
  assert.equal(games[3].terrain[5][31].type, 'rock');
  assert.equal(games[3].terrain[5][31].walkable, false);
  assert.equal(games[4].terrain[22][10].type, 'water');
  assert.equal(games[4].terrain[22][15].walkable, true);
  assert.equal(games[4].terrain[22][48].walkable, true);
});

test('alternate maps are deterministic by seed and retain their identity through saves', () => {
  for (const map of SKIRMISH_MAPS.slice(1)) {
    const first = new Game({ seed: 99173, mapId: map.id, faction: 'vesper' });
    const replay = new Game({ seed: 99173, mapId: map.id, faction: 'vesper' });
    const differentSeed = new Game({ seed: 99174, mapId: map.id, faction: 'vesper' });
    assert.deepEqual(first.terrain, replay.terrain);
    assert.deepEqual(first.relays, replay.relays);
    assert.notEqual(terrainSignature(first), terrainSignature(differentSeed));
    const restored = Game.deserialize(first.serialize());
    assert.equal(restored.mapId, map.id);
    assert.deepEqual(restored.terrain, first.terrain);
    assert.deepEqual(restored.relays, first.relays);
    assert.match(restored.mission.title, new RegExp(map.name));
  }
});

test('Twin Passes and Canyon Ring variants change routes while preserving access and resource parity', () => {
  for (const mapId of ['twin-passes', 'canyon-ring']) {
    const variants = [0, 1].map(mapVariant => new Game({ seed: 80218, mapId, mapVariant }));
    assert.equal(new Set(variants.map(game => game.mapVariant)).size, 2);
    assert.notEqual(terrainSignature(variants[0]), terrainSignature(variants[1]), `${mapId} route and resource layout differ`);
    assert.notDeepEqual(variants[0].relays.map(relay => [relay.x, relay.y]),
      variants[1].relays.map(relay => [relay.x, relay.y]), `${mapId} relay sites move with the variant`);
    for (const game of variants) {
      const playerTank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
      const enemyTank = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
      assert.ok(game._findPath(playerTank.x, playerTank.y, enemyTank.x, enemyTank.y).length > 0,
        `${mapId} variant ${game.mapVariant}: player can reach the enemy`);
      assert.ok(game._findPath(enemyTank.x, enemyTank.y, playerTank.x, playerTank.y).length > 0,
        `${mapId} variant ${game.mapVariant}: enemy can reach the player`);
      for (const relay of game.relays) {
        assert.ok(game._findPath(playerTank.x, playerTank.y, relay.x + 0.5, relay.y + 0.5).length > 0);
        assert.ok(game._findPath(enemyTank.x, enemyTank.y, relay.x + 0.5, relay.y + 0.5).length > 0);
      }
      assert.equal(hasRefinerySite(game, 'player'), true);
      assert.equal(hasRefinerySite(game, 'enemy'), true);
      const sides = [0, 0];
      for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++)
        sides[x < game.width / 2 ? 0 : 1] += game.terrain[y][x].resource;
      assert.ok(Math.min(...sides) > 35000, `${mapId} variant ${game.mapVariant}: both sides have useful crystal`);
      assert.ok(Math.max(...sides) / Math.min(...sides) < 1.25,
        `${mapId} variant ${game.mapVariant}: crystal access remains comparable`);
      const restored = Game.deserialize(game.serialize());
      assert.equal(restored.mapVariant, game.mapVariant);
      assert.deepEqual(restored.terrain, game.terrain);
    }
  }
});

test('seed chooses a repeatable variant and version 10 replay preserves the classic topology', () => {
  const seed = 80218;
  const selected = new Game({ seed, mapId: 'twin-passes' });
  const repeated = new Game({ seed, mapId: 'twin-passes' });
  assert.equal(selected.mapVariant, 1);
  assert.deepEqual(selected.terrain, repeated.terrain);
  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed,
    scenarioId: 'twin-passes' };
  const legacy = createSoloPlayback(envelope, [], 0, 10).game;
  const classic = new Game({ seed, mapId: 'twin-passes', mapVariant: 0 });
  assert.equal(legacy.mapVariant, 0);
  assert.deepEqual(legacy.terrain, classic.terrain);
  assert.equal(createSoloPlayback(envelope, [], 0, SOLO_REPLAY_VERSION).game.mapVariant, 1);
});

test('Canyon Ring variant 1 balances the middle relay and v43 replays retain the old route', () => {
  assert.equal(SOLO_REPLAY_VERSION, 57);
  const seed = 80218;
  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed,
    scenarioId: 'canyon-ring' };
  const oldPlayback = createSoloPlayback(envelope, [], 0, 43);
  const oldReplay = oldPlayback.game;
  const v44Playback = createSoloPlayback(envelope, [], 0, 44);
  const v44Replay = v44Playback.game;
  const currentReplay = createSoloPlayback(envelope, [], 0, SOLO_REPLAY_VERSION).game;
  const legacyLayout = new Game({ seed, mapId: 'canyon-ring', mapVariant: 1, legacyCanyonRingVariant1: true });
  assert.equal(oldReplay.mapVariant, 1);
  assert.deepEqual(oldReplay.terrain, legacyLayout.terrain);
  assert.deepEqual(oldPlayback.reset().terrain, legacyLayout.terrain,
    'reset reconstructs the archived layout');
  assert.deepEqual(v44Replay.terrain, currentReplay.terrain,
    'version 44 playback retains the revised Canyon Ring route');
  assert.deepEqual(v44Playback.reset().terrain, currentReplay.terrain,
    'version 44 reset reconstructs its archived terrain');
  assert.notDeepEqual(currentReplay.terrain, oldReplay.terrain);
  assert.deepEqual(Game.deserialize(currentReplay.serialize()).terrain, currentReplay.terrain,
    'a save preserves the terrain layout it was created with');
  const multiplayer = new Game({ seed, mode: 'multiplayer', mapId: 'canyon-ring', mapVariant: 1 });
  assert.deepEqual(multiplayer.terrain, currentReplay.terrain,
    'ranked multiplayer uses the revised variant-1 topology');

  for (const testSeed of [1, 80217, 123456789, 4294967295]) {
    for (const legacyCanyonRingVariant1 of [false, true]) {
      const game = new Game({ seed: testSeed, mapId: 'canyon-ring', mapVariant: 1,
        legacyCanyonRingVariant1 });
      const playerTank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
      const enemyTank = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
      const centerRelay = game.relays[1];
      const playerRoute = routeDistance(game, playerTank, centerRelay);
      const enemyRoute = routeDistance(game, enemyTank, centerRelay);
      assert.ok(Number.isFinite(playerRoute) && Number.isFinite(enemyRoute),
        `seed ${testSeed}, legacy=${legacyCanyonRingVariant1}: both sides reach the middle relay`);
      if (legacyCanyonRingVariant1) assert.ok(playerRoute - enemyRoute >= 25,
        `seed ${testSeed}: legacy disadvantage remains measurable for replay fidelity`);
      else assert.ok(playerRoute - enemyRoute <= 10,
        `seed ${testSeed}: revised middle-relay route gap is at most 10 tiles`);

      for (const relay of game.relays) {
        assert.ok(Number.isFinite(routeDistance(game, playerTank, relay)), `seed ${testSeed}: player reaches relay`);
        assert.ok(Number.isFinite(routeDistance(game, enemyTank, relay)), `seed ${testSeed}: enemy reaches relay`);
      }
      assert.equal(hasRefinerySite(game, 'player'), true, `seed ${testSeed}: player expansion site`);
      assert.equal(hasRefinerySite(game, 'enemy'), true, `seed ${testSeed}: enemy expansion site`);
      const sides = [0, 0];
      for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++)
        sides[x < game.width / 2 ? 0 : 1] += game.terrain[y][x].resource;
      assert.ok(Math.min(...sides) > 35000, `seed ${testSeed}: both sides have useful crystal`);
      assert.ok(Math.max(...sides) / Math.min(...sides) < 1.25,
        `seed ${testSeed}: crystal access remains comparable`);
    }
  }
});

test('Delta Crossing opens with equal, usable airlift groups on every difficulty', () => {
  for (const seed of [1, 80217, 99173, 4294967295]) for (const difficulty of ['easy', 'normal', 'hard']) {
    const game = new Game({ seed, difficulty, mapId: 'delta-crossing' });
    const replay = new Game({ seed, difficulty, mapId: 'delta-crossing' });
    assert.deepEqual(game.units, replay.units);
    for (const owner of ['player', 'enemy']) {
      const carrier = game.units.find(unit => unit.owner === owner && unit.defId === 'dropship');
      assert.ok(carrier, `${difficulty} ${owner} receives a dropship`);
      assert.equal(carrier.passengerIds.length, 0);
      assert.equal(game._isPassable(Math.floor(carrier.x), Math.floor(carrier.y)), true);
      const nearby = game.units.filter(unit => unit.owner === owner && unit.defId === 'rifle' &&
        Math.hypot(unit.x - carrier.x, unit.y - carrier.y) <= 1.15);
      assert.equal(nearby.length, 2);
      assert.ok(nearby.every(unit => game._isPassable(Math.floor(unit.x), Math.floor(unit.y))));
      if (owner === 'enemy') assert.ok(nearby.every(unit => unit.order.type ===
        (difficulty === 'easy' ? 'idle' : 'board')));
    }
    assert.deepEqual(Game.deserialize(game.serialize()).units, game.units);
  }
  for (const mapId of ['shard-valley', 'twin-passes', 'canyon-ring', 'storm-basin']) {
    assert.equal(new Game({ mapId }).units.filter(unit => unit.defId === 'dropship').length, 0);
  }
  assert.equal(new Game({ mapId: 'delta-crossing', mode: 'multiplayer' }).units
    .filter(unit => unit.defId === 'dropship').length, 0);
});

test('new layouts have two-way ground routes, expansion space, and comparable crystal access', () => {
  for (const map of SKIRMISH_MAPS.slice(1)) for (const seed of [1, 80217, 123456789, 4294967295]) {
    const game = new Game({ seed, mapId: map.id });
    const playerTank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
    const enemyTank = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
    assert.ok(game._findPath(playerTank.x, playerTank.y, enemyTank.x, enemyTank.y).length > 0,
      `${map.id} seed ${seed}: player can reach the opposing force`);
    assert.ok(game._findPath(enemyTank.x, enemyTank.y, playerTank.x, playerTank.y).length > 0,
      `${map.id} seed ${seed}: enemy can reach the opposing force`);
    assert.equal(hasRefinerySite(game, 'player'), true);
    assert.equal(hasRefinerySite(game, 'enemy'), true);
    const sides = [0, 0];
    for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
      sides[x < game.width / 2 ? 0 : 1] += game.terrain[y][x].resource;
    }
    assert.ok(Math.min(...sides) > 35000, `${map.id} seed ${seed}: each side has substantial crystal`);
    assert.ok(Math.max(...sides) / Math.min(...sides) < 1.25,
      `${map.id} seed ${seed}: starting sides have comparable crystal`);
  }
});

test('legacy and multiplayer games keep the historical Shard Valley default', () => {
  const seed = 4422;
  const historical = new Game({ seed });
  const explicit = new Game({ seed, mapId: 'shard-valley' });
  const multiplayer = new Game({ seed, mode: 'multiplayer' });
  assert.deepEqual(historical.terrain, explicit.terrain);
  assert.deepEqual(historical.relays, explicit.relays);
  assert.equal(multiplayer.mapId, 'shard-valley');
  assert.deepEqual(multiplayer.terrain, historical.terrain);
  assert.deepEqual(multiplayer.relays, historical.relays);
  const legacy = JSON.parse(historical.serialize());
  delete legacy.mapId;
  assert.equal(Game.deserialize(legacy).mapId, 'shard-valley');
});

test('multiplayer uses validated map topology and mode-specific objectives from either seat', () => {
  for (const map of SKIRMISH_MAPS) for (const victoryMode of ['dominion', 'elimination']) {
    const solo = new Game({ seed: 711, mapId: map.id, victoryMode });
    const multiplayer = new Game({ seed: 711, mode: 'multiplayer', mapId: map.id, victoryMode });
    for (const seat of ['player', 'enemy']) {
      multiplayer.commandOwner = seat;
      assert.equal(multiplayer.mapId, map.id);
      assert.deepEqual(multiplayer.terrain, solo.terrain, `${map.id} ${seat}: selected terrain`);
      assert.deepEqual(multiplayer.relays, solo.relays, `${map.id} ${seat}: selected relay layout`);
      assert.match(multiplayer.mission.title, new RegExp(`Multiplayer at ${map.name}`));
      if (victoryMode === 'elimination')
        assert.match(multiplayer.mission.objective, /Eliminate enemy combat units/);
      else assert.match(multiplayer.mission.objective, /hold two of three relays for 90 seconds/);
    }
    const restored = Game.deserialize(multiplayer.serialize());
    assert.equal(restored.mapId, map.id);
    assert.equal(restored.victoryMode, victoryMode);
    assert.deepEqual(restored.terrain, multiplayer.terrain);
    assert.deepEqual(restored.relays, multiplayer.relays);
    assert.equal(restored.mission.objective, multiplayer.mission.objective);
  }

  const delta = new Game({ seed: 712, mode: 'multiplayer', mapId: 'delta-crossing' });
  assert.equal(delta.bridges.length, 2);
  assert.equal(delta.terrain[22][30].type, 'water');
  for (const owner of ['player', 'enemy']) {
    const start = delta.units.find(unit => unit.owner === owner && unit.defId === 'lightTank');
    const opponent = delta.units.find(unit => unit.owner !== owner && unit.defId === 'lightTank');
    assert.ok(delta._findPath(start.x, start.y, opponent.x, opponent.y).length > 0,
      `${owner} can cross Delta Crossing`);
  }
  const restoredDelta = Game.deserialize(delta.serialize());
  assert.deepEqual(restoredDelta.bridges, delta.bridges);
});

test('ordinary orders ignore stale selections from the other command owner', () => {
  const game = new Game({ seed: 71 });
  const playerRifle = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle');
  const enemyRifle = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'rifle');
  game.selection = [playerRifle.id, enemyRifle.id];
  assert.equal(game.issueMove(20, 33).ok, true);
  assert.equal(playerRifle.order.type, 'move');
  assert.equal(enemyRifle.order.type, 'idle');
  assert.equal(game.issueStop().ok, true);
  assert.equal(playerRifle.order.type, 'idle');
  assert.equal(enemyRifle.order.type, 'idle');

  const target = game._createUnit('enemy', 'rifle', 18.5, 36.5);
  game._updateFog();
  assert.equal(game.issueAttack(target.id).ok, true);
  assert.equal(playerRifle.order.type, 'attack');
  assert.equal(enemyRifle.order.type, 'idle');

  const playerEngineer = game._createUnit('player', 'engineer', 18.5, 38.5);
  const enemyEngineer = game._createUnit('enemy', 'engineer', 42.5, 12.5);
  game.selection = [playerEngineer.id, enemyEngineer.id];
  const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  assert.equal(game.issueEngineer(yard.id).ok, true);
  assert.equal(playerEngineer.order.type, 'engineer');
  assert.equal(enemyEngineer.order.type, 'idle');

  const playerHarvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  const enemyHarvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
  playerHarvester.order = { type: 'idle' }; enemyHarvester.order = { type: 'idle' };
  game.selection = [playerHarvester.id, enemyHarvester.id];
  assert.equal(game.issueHarvest().ok, true);
  assert.equal(playerHarvester.order.type, 'harvest');
  assert.equal(enemyHarvester.order.type, 'idle');
});
