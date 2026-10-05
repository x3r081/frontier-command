// Dense battle diagnostic for the simulation engine (no renderer/server).
// Seeds mirrored armies through the engine's unit factory, then uses public
// selection/move APIs for the player force and update() for all simulation.
// Usage: node scripts/dense-battle-stress.js [--maps=a,b] [--factions=aegis,vesper]
//        [--seconds=240] [--units=24] [--seed=7351] [--dt=0.1]
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';
import { performance } from 'node:perf_hooks';

function option(name, fallback) {
  const value = process.argv.find(arg => arg.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}
const mapIds = option('maps', SKIRMISH_MAPS.map(map => map.id).join(',')).split(',').filter(Boolean);
const factions = option('factions', 'aegis,vesper').split(',').filter(Boolean);
const seconds = Math.max(30, Number(option('seconds', 240)) || 240);
const perSide = Math.max(4, Math.min(80, Number(option('units', 24)) || 24));
const seed = Number(option('seed', 7351)) || 7351;
const dt = Math.max(0.02, Math.min(0.5, Number(option('dt', 0.1)) || 0.1));
const composition = ['lightTank', 'rifle', 'rocket', 'scout', 'flamer', 'artillery'];

function run(mapId, faction, runSeed) {
  const game = new Game({ seed: runSeed, mapId, faction, difficulty: 'normal', victoryMode: 'dominion' });
  const center = { x: game.width / 2, y: game.height / 2 };
  // Direct setup is limited to adding units. Keep the mirrored forces near the
  // open center lane while resolving each spawn to a distinct passable tile.
  const spawnPoints = [];
  const findSpawn = (x, y) => {
    for (let radius = 0; radius <= 8; radius++) {
      const candidates = [];
      for (let ty = Math.floor(y) - radius; ty <= Math.floor(y) + radius; ty++) {
        for (let tx = Math.floor(x) - radius; tx <= Math.floor(x) + radius; tx++) {
          if (radius && Math.max(Math.abs(tx - Math.floor(x)), Math.abs(ty - Math.floor(y))) !== radius) continue;
          if (!game._isPassable(tx, ty)) continue;
          const point = { x: tx + 0.5, y: ty + 0.5 };
          if (spawnPoints.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 0.8)) continue;
          candidates.push(point);
        }
      }
      if (candidates.length) {
        candidates.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
        const point = candidates[0];
        spawnPoints.push(point);
        return point;
      }
    }
    throw new Error(`No passable spawn near ${x},${y} on ${mapId}`);
  };
  for (const owner of ['player', 'enemy']) {
    for (let i = 0; i < perSide; i++) {
      const row = Math.floor(i / 6), col = i % 6;
      const sign = owner === 'player' ? -1 : 1;
      const nominalX = center.x + sign * (8 + row * 0.65);
      const nominalY = center.y - 3.5 + col * 1.4;
      const { x, y } = findSpawn(nominalX, nominalY);
      game._createUnit(owner, composition[i % composition.length], x, y,
        owner === 'enemy' ? { type: 'move', x: center.x - 1, y: center.y, attackMove: true } : undefined);
    }
  }
  const playerIds = game.units.filter(unit => unit.owner === 'player').map(unit => unit.id);
  game.select(playerIds);
  const orderResult = game.issueMove(center.x + 1, center.y, true);
  const samples = [];
  let peakUnits = game.units.length, peakEffects = game.effects.length;
  let contactSeconds = null, noContactEnd = null, maxStagnant = 0;
  let maxCombatHold = 0, maxHardStall = 0, nextStuckSample = 1;
  let previousPositions = new Map();
  const stagnantFor = new Map();
  const combatHoldFor = new Map();
  const hardStallFor = new Map();
  const start = performance.now();
  let steps = 0;
  try {
    while (game.status === 'playing' && game.time < seconds) {
      const before = performance.now();
      game.update(dt);
      samples.push(performance.now() - before);
      steps++;
      peakUnits = Math.max(peakUnits, game.units.length);
      peakEffects = Math.max(peakEffects, game.effects.length);
      const player = game.units.filter(unit => unit.owner === 'player');
      const enemy = game.units.filter(unit => unit.owner === 'enemy');
      const nearest = player.length && enemy.length ? Math.min(...player.map(a =>
        Math.min(...enemy.map(b => Math.hypot(a.x - b.x, a.y - b.y))))) : Infinity;
      if (contactSeconds === null && nearest <= 3.5) contactSeconds = game.time;
      if (contactSeconds === null) noContactEnd = game.time;
      if (game.time >= nextStuckSample) {
        nextStuckSample = Math.floor(game.time) + 1;
        const currentPositions = new Map();
        for (const unit of game.units) {
          currentPositions.set(unit.id, { x: unit.x, y: unit.y });
          if (unit.order?.type !== 'move' && unit.order?.type !== 'attackMove') {
            stagnantFor.delete(unit.id);
            continue;
          }
          const previous = previousPositions.get(unit.id);
          const hasUnreachedDestination = Number.isFinite(unit.order.x) && Number.isFinite(unit.order.y) &&
            Math.hypot(unit.x - unit.order.x, unit.y - unit.order.y) > 1.5;
          const definition = game.unitDefs[unit.defId];
          const engagementRadius = Math.max(definition?.weapon?.range || 0, definition?.sight || 0) + 1;
          const engaged = game.units.some(other => other.owner !== unit.owner && other.hp > 0 &&
            !other.embarkedIn && Math.hypot(unit.x - other.x, unit.y - other.y) <= engagementRadius) ||
            game.buildings.some(other => other.owner !== unit.owner && other.hp > 0 && other.progress >= 1 &&
              game._distanceToEntity(unit.x, unit.y, other) <= engagementRadius);
          const stationary = hasUnreachedDestination && !engaged && previous &&
            Math.hypot(unit.x - previous.x, unit.y - previous.y) < 0.12;
          const duration = stationary ? (stagnantFor.get(unit.id) || 0) + 1 : 0;
          stagnantFor.set(unit.id, duration);
          maxStagnant = Math.max(maxStagnant, duration);
          if (hasUnreachedDestination && previous && Math.hypot(unit.x - previous.x, unit.y - previous.y) < 0.12) {
            const combatHold = engaged ? (combatHoldFor.get(unit.id) || 0) + 1 : 0;
            const hardStall = engaged ? 0 : (hardStallFor.get(unit.id) || 0) + 1;
            combatHoldFor.set(unit.id, combatHold);
            hardStallFor.set(unit.id, hardStall);
            maxCombatHold = Math.max(maxCombatHold, combatHold);
            maxHardStall = Math.max(maxHardStall, hardStall);
          } else {
            combatHoldFor.set(unit.id, 0);
            hardStallFor.set(unit.id, 0);
          }
        }
        previousPositions = currentPositions;
      }
    }
  } catch (error) {
    return { mapId, faction, seed: runSeed, status: game.status, time: +game.time.toFixed(1), error: String(error) };
  }
  samples.sort((a, b) => a - b);
  const percentile = p => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] ?? 0;
  const elapsedMs = performance.now() - start;
  return { mapId, faction, seed: runSeed, status: game.status, simulatedSeconds: +game.time.toFixed(1),
    wallSeconds: +(elapsedMs / 1000).toFixed(2), steps, unitPeak: peakUnits, effectPeak: peakEffects,
    stepMs: { p50: +percentile(0.5).toFixed(3), p95: +percentile(0.95).toFixed(3), p99: +percentile(0.99).toFixed(3),
      max: +percentile(1).toFixed(3) },
    contactSeconds: contactSeconds === null ? null : +contactSeconds.toFixed(1),
    noContactThrough: noContactEnd === null ? null : +noContactEnd.toFixed(1),
    survivors: { player: game.units.filter(unit => unit.owner === 'player').length,
      enemy: game.units.filter(unit => unit.owner === 'enemy').length },
    issuedPlayerOrder: orderResult.ok, errors: game.events.filter(event => event.type === 'error').length,
    maxObservedStagnationSeconds: maxStagnant,
    maxObservedCombatHoldSeconds: maxCombatHold,
    maxObservedHardStallSeconds: maxHardStall };
}

for (const mapId of mapIds) {
  if (!SKIRMISH_MAPS.some(map => map.id === mapId)) {
    console.error(`Unknown map: ${mapId}`);
    process.exitCode = 2;
    continue;
  }
  for (const faction of factions) {
    if (!['aegis', 'vesper'].includes(faction)) {
      console.error(`Unknown faction: ${faction}`);
      process.exitCode = 2;
      continue;
    }
    console.log(JSON.stringify(run(mapId, faction, seed)));
  }
}
