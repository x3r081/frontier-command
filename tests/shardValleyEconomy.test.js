import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { createSoloPlayback } from '../src/game/replay.js';

const SEEDS = [80217, 80218, 80219, 80220, 80221];

function measureStock(game) {
  const refineries = Object.fromEntries(['player', 'enemy'].map(owner => [owner,
    game.buildings.find(building => building.owner === owner && building.defId === 'refinery')]));
  const stock = { player: 0, enemy: 0, contested: 0 };
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    const tile = game.terrain[y][x];
    if (tile.type !== 'crystal' || tile.resource <= 0) continue;
    const px = x + 0.5, py = y + 0.5;
    const playerDistance = Math.hypot(px - (refineries.player.x + refineries.player.w / 2),
      py - (refineries.player.y + refineries.player.h / 2));
    const enemyDistance = Math.hypot(px - (refineries.enemy.x + refineries.enemy.w / 2),
      py - (refineries.enemy.y + refineries.enemy.h / 2));
    stock[playerDistance + 2 <= enemyDistance ? 'player' : enemyDistance + 2 <= playerDistance ? 'enemy' : 'contested'] += tile.resource;
  }
  return stock;
}

function startingStock(seed, replayVersion) {
  return measureStock(new Game({ seed, mapId: 'shard-valley', replayVersion }));
}

test('Shard Valley v56 keeps its legacy starting resource layout', () => {
  assert.deepEqual(startingStock(80217, 56), { player: 14058, enemy: 29807, contested: 5470 });
});

test('solo playback uses its replay version for Shard Valley map generation', () => {
  const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 80217, scenarioId: 'shard-valley' };
  for (const replayVersion of [56, 57]) {
    const playback = createSoloPlayback(envelope, [], 0, replayVersion);
    assert.deepEqual(measureStock(playback.game), startingStock(80217, replayVersion));
  }
});

test('Shard Valley v57 improves starting-side stock while retaining contested crystal', () => {
  for (const seed of SEEDS) {
    const legacy = startingStock(seed, 56);
    const current = startingStock(seed, 57);
    const ratio = current.player / current.enemy;
    assert.ok(ratio >= 0.6 && ratio <= 1,
      `seed ${seed}: player/enemy stock ratio ${ratio.toFixed(2)} should be between 0.60 and 1`);
    assert.ok(Math.abs(current.player - current.enemy) < Math.abs(legacy.player - legacy.enemy) * 0.6,
      `seed ${seed}: starting-side stock gap should shrink by at least 40%`);
    assert.ok(current.contested >= legacy.contested * 0.8,
      `seed ${seed}: contested crystal should retain at least 80% of legacy stock`);
  }
});
