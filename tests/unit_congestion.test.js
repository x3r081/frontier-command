import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function runFourUnitQueue(replayVersion) {
  const game = new Game({ seed: 1, difficulty: 'normal' });
  game.mode = 'skirmish';
  game.replayVersion = replayVersion;
  game.units = [];
  const starts = [[0.25, 0.45], [0.5, 0.45], [0.75, 0.45], [0.5, 0.7]];
  const units = starts.map(([x, y], index) => game._createUnit('player',
    ['rifle', 'rocket', 'flamer', 'lightTank'][index], x, y,
    { type: 'move', x: 4.5, y: 0.5 }));

  for (let step = 0; step < 30; step++) {
    for (const unit of units) game._moveUnit(unit, 4.5, 0.5, 0.1);
    game._resolveUnitSeparation();
    for (const unit of units) {
      assert.equal(game._isPassable(Math.floor(unit.x), Math.floor(unit.y)), true,
        `version ${replayVersion} step ${step} must keep ${unit.id} at ${unit.x},${unit.y} on passable terrain`);
    }
  }
  return { starts, units };
}

test('v16 units sharing a waypoint pass through a four-unit queue without losing path progress', () => {
  const legacy = runFourUnitQueue(15);
  const current = runFourUnitQueue(16);
  const legacyProgress = legacy.units[0].x - legacy.starts[0][0];
  const currentProgress = current.units[0].x - current.starts[0][0];

  assert.ok(legacyProgress < 1.5, `v15 keeps historical congestion behavior (${legacyProgress})`);
  assert.ok(currentProgress > 3, `v16 clears the jam and advances (${currentProgress})`);
});

test('v19 crowded Storm Basin attack-move route escapes soft-separation deadlock', () => {
  const run = replayVersion => {
    const game = new Game({ seed: 7351, mapId: 'storm-basin', faction: 'aegis' });
    game.replayVersion = replayVersion;
    const center = { x: 32, y: 24 }, reserved = [];
    const spawn = (x, y) => {
      for (let radius = 0; radius <= 8; radius++) {
        const candidates = [];
        for (let ty = Math.floor(y) - radius; ty <= Math.floor(y) + radius; ty++) {
          for (let tx = Math.floor(x) - radius; tx <= Math.floor(x) + radius; tx++) {
            if (radius && Math.max(Math.abs(tx - Math.floor(x)), Math.abs(ty - Math.floor(y))) !== radius) continue;
            if (!game._isPassable(tx, ty)) continue;
            const point = { x: tx + 0.5, y: ty + 0.5 };
            if (reserved.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 0.8)) continue;
            candidates.push(point);
          }
        }
        if (candidates.length) {
          candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
          reserved.push(candidates[0]);
          return candidates[0];
        }
      }
      throw new Error(`No spawn near ${x},${y}`);
    };
    const composition = ['lightTank', 'rifle', 'rocket', 'scout', 'flamer', 'artillery'];
    for (const owner of ['player', 'enemy']) for (let i = 0; i < 24; i++) {
      const row = Math.floor(i / 6), col = i % 6, sign = owner === 'player' ? -1 : 1;
      const point = spawn(center.x + sign * (8 + row * 0.65), center.y - 3.5 + col * 1.4);
      game._createUnit(owner, composition[i % composition.length], point.x, point.y,
        owner === 'enemy' ? { type: 'move', x: center.x - 1, y: center.y, attackMove: true } : undefined);
    }
    game.select(game.units.filter(unit => unit.owner === 'player').map(unit => unit.id));
    game.issueMove(center.x + 1, center.y, true);
    while (game.status === 'playing' && game.time < 110) game.update(0.1);
    return game.getEntity('u18');
  };

  const legacy = run(18);
  const current = run(19);
  assert.ok(legacy.x < 23, `v18 retains its recorded congestion outcome (${legacy.x})`);
  assert.ok(current.x > 24, `v19 detours around the jam and advances (${current.x})`);
});

test('v19 detour yields immediately to a new player order', () => {
  const game = new Game({ seed: 1, difficulty: 'normal' });
  game.replayVersion = 19;
  game.units = [];
  game.buildings = [];
  const unit = game._createUnit('player', 'rifle', 2.5, 5.5,
    { type: 'move', x: 6.5, y: 5.5 });
  unit._jamWaypoint = { x: 4.5, y: 5.5, goalX: 6.5, goalY: 5.5 };
  unit.order = { type: 'move', x: 1.5, y: 5.5 };

  game._updateUnit(unit, 0.1);
  assert.equal(unit._jamWaypoint, null);
  assert.deepEqual(unit.order, { type: 'move', x: 1.5, y: 5.5 });
});

test('v57 mixed attack orders close in around LOS blockers while v56 keeps its recorded behavior', () => {
  const run = replayVersion => {
    const game = new Game({ seed: 2, difficulty: 'normal' });
    game.mode = 'skirmish';
    game.replayVersion = replayVersion;
    game.units = [];
    game.buildings = [];
    for (const row of game.terrain) for (const tile of row) {
      tile.type = 'sand'; tile.walkable = true;
    }
    const rifle = game._createUnit('player', 'rifle', 5.5, 5.5,
      { type: 'attack', targetId: 'target' });
    const rocket = game._createUnit('player', 'rocket', 5.5, 6.5,
      { type: 'attack', targetId: 'target' });
    const target = game._createUnit('enemy', 'rifle', 7.5, 5.5);
    target.id = 'target';
    game.terrain[5][6].type = 'rock';
    game.terrain[5][6].walkable = false;
    game.terrain[6][6].type = 'rock';
    game.terrain[6][6].walkable = false;
    const starts = [rifle, rocket].map(unit => [unit.x, unit.y]);
    for (let i = 0; i < 10; i++) {
      game._updateUnit(rifle, 0.1);
      game._updateUnit(rocket, 0.1);
      for (const unit of [rifle, rocket])
        assert.equal(game._isPassable(Math.floor(unit.x), Math.floor(unit.y)), true,
          `${unit.defId} stays off the blocked rock tiles`);
    }
    return { starts, units: [rifle, rocket] };
  };
  const legacy = run(56);
  const current = run(57);
  assert.ok(legacy.units.every((unit, index) =>
    unit.x === legacy.starts[index][0] && unit.y === legacy.starts[index][1]),
  'v56 retains its recorded false in-range hold');
  assert.ok(current.units.every((unit, index) =>
    unit.x > current.starts[index][0] || unit.y !== current.starts[index][1]),
  'both unit types leave their false in-range holding points');
  assert.ok(current.units.every(unit => Math.hypot(unit.x - 7.5, unit.y - 5.5) < 2.5),
    'both unit types make progress around the rock wall');
});

test('v19 attack-move combat hold is not treated as a movement jam', () => {
  const game = new Game({ seed: 1, difficulty: 'normal' });
  game.replayVersion = 19;
  game.units = [];
  game.buildings = [];
  const unit = game._createUnit('player', 'rifle', 5.5, 5.5,
    { type: 'move', x: 10.5, y: 5.5, attackMove: true });
  game._createUnit('enemy', 'rifle', 6.5, 5.5, { type: 'idle' });
  unit.cooldown = 999;

  for (let step = 0; step < 30; step++) {
    const before = new Map([[unit.id, { x: unit.x, y: unit.y }]]);
    game._updateUnit(unit, 0.1);
    game._updateMovementJams(before, 0.1);
  }
  assert.equal(unit._jamWaypoint, undefined);
  assert.equal(unit._jamSeconds, 0);
  assert.equal(unit.x, 5.5);
});

test('v17 finishes a move at the nearest reachable tile when the requested tile is blocked', () => {
  const run = (replayVersion, mode = 'skirmish') => {
    const game = new Game({ seed: 1, difficulty: 'normal' });
    game.mode = mode;
    game.replayVersion = replayVersion;
    game.terrain[5][4].walkable = false;
    const unit = game._createUnit('player', 'rifle', 2.5, 5.5,
      { type: 'move', x: 4.5, y: 5.5 });
    let arrived = false;
    for (let step = 0; step < 40 && !arrived; step++) arrived = game._moveUnit(unit, 4.5, 5.5, 0.1);
    return { unit, arrived };
  };

  const legacy = run(15);
  const current = run(17);
  const v16 = run(16);
  const campaign = run(17, 'campaign');
  assert.equal(legacy.arrived, false, 'v15 preserves the historical unreachable destination behavior');
  assert.equal(v16.arrived, false, 'v16 replay playback keeps its recorded movement rules');
  assert.equal(campaign.arrived, false, 'campaign movement keeps its recorded behavior');
  assert.equal(current.arrived, true, 'v17 completes at the snapped, reachable endpoint');
  assert.ok(current.unit.x < 4, `unit stops on the reachable side of the blocked tile (${current.unit.x})`);
});
