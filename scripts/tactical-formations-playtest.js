// Bounded public-command playtest for tactical unit formations (replay v76).
// Units are authored once in an empty deterministic arena; every movement after
// setup goes through issueFormationMove and Game.update.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Game, TACTICAL_FORMATION_RULES_VERSION } from '../src/game/engine.js';

const SEED = 76076;
const STEP_SECONDS = 0.1;
const PHASE_LIMIT_SECONDS = 75;
const MAX_SECONDS = 210;
const INITIAL_UNITS = [
  ['lightTank', 12.5, 22.5], ['lightTank', 12.5, 26.5],
  ['rifle', 10.5, 23.5], ['rifle', 10.5, 25.5],
  ['rocket', 8.5, 23.5], ['rocket', 8.5, 25.5],
  ['engineer', 6.5, 24.5],
];
const ROUTE = [
  { formation: 'screen', target: { x: 25.5, y: 24.5 }, label: 'open-field screen' },
  { formation: 'line', target: { x: 38.5, y: 24.5 }, label: 'line advance' },
  { formation: 'column', target: { x: 53.5, y: 24.5 }, label: 'column advance' },
];

function makeArena() {
  const game = new Game({ seed: SEED, mode: 'multiplayer', difficulty: 'normal', replayVersion: 76 });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand';
    tile.resource = 0;
    tile.walkable = true;
    tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  const units = INITIAL_UNITS.map(([type, x, y]) => game._createUnit('player', type, x, y));
  // Keep multiplayer elimination active without adding combat pressure: this
  // distant neutral garrison stays on guard beyond the route.
  game._createUnit('enemy', 'rifle', 60.5, 44.5, { type: 'guard', x: 60.5, y: 44.5 });
  return { game, units };
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rounded = value => Number(value.toFixed(3));

function summarizePreview(preview) {
  if (!preview || !Array.isArray(preview.slots)) return null;
  return {
    facing: Number.isFinite(preview.facing) ? rounded(preview.facing) : null,
    slots: preview.slots.map(slot => ({
      id: slot.id,
      x: rounded(slot.x),
      y: rounded(slot.y),
      role: slot.role,
    })),
  };
}

function phaseSnapshot(units, target) {
  const positions = units.map(unit => ({ id: unit.id, defId: unit.defId, x: unit.x, y: unit.y }));
  const front = positions.filter(unit => unit.defId === 'lightTank');
  const support = positions.filter(unit => unit.defId === 'rifle' || unit.defId === 'rocket' || unit.defId === 'engineer');
  const frontMean = front.reduce((sum, unit) => sum + unit.x, 0) / Math.max(1, front.length);
  const supportMean = support.reduce((sum, unit) => sum + unit.x, 0) / Math.max(1, support.length);
  return {
    units: positions.map(unit => ({ ...unit, x: rounded(unit.x), y: rounded(unit.y) })),
    meanFrontX: rounded(frontMean),
    meanSupportX: rounded(supportMean),
    frontLeadsSupport: frontMean > supportMean,
    frontTargetDistance: rounded(Math.min(...front.map(unit => distance(unit, target)))),
    supportTargetDistance: rounded(Math.min(...support.map(unit => distance(unit, target)))),
  };
}

export function runTacticalFormationPlaytest() {
  const wallStart = performance.now();
  assert.equal(TACTICAL_FORMATION_RULES_VERSION, 76, 'the v76 formation rules are available');
  const { game, units } = makeArena();
  const ids = units.map(unit => unit.id);
  const phases = [];
  let elapsed = 0;

  for (const phase of ROUTE) {
    game.select(ids);
    const preview = summarizePreview(game.getFormationPreview(
      phase.target.x, phase.target.y, phase.formation));
    const issued = game.issueFormationMove(phase.target.x, phase.target.y, phase.formation, 'move', false, false);
    assert.equal(issued?.ok, true, `${phase.label} command accepted: ${issued?.reason || ''}`);
    const start = elapsed;
    let arrivalSpread = null;
    let steps = 0;
    const arrivals = new Map();
    for (; steps < PHASE_LIMIT_SECONDS / STEP_SECONDS; steps++) {
      game.update(STEP_SECONDS);
      elapsed += STEP_SECONDS;
      for (const unit of units) {
        if (!arrivals.has(unit.id) && unit.order.type === 'idle') arrivals.set(unit.id, elapsed);
      }
      if (arrivals.size === units.length) {
        const times = [...arrivals.values()];
        arrivalSpread = Math.max(...times) - Math.min(...times);
        break;
      }
      assert.ok(elapsed <= MAX_SECONDS, `overall playtest exceeded ${MAX_SECONDS}s`);
    }
    const arrived = arrivals.size === units.length;
    phases.push({
      name: phase.label,
      formation: phase.formation,
      target: phase.target,
      issuedAtSeconds: rounded(start),
      arrivalSeconds: arrived ? rounded(elapsed) : null,
      durationSeconds: arrived ? rounded(elapsed - start) : null,
      arrivalSpreadSeconds: arrivalSpread === null ? null : rounded(arrivalSpread),
      allUnitsArrived: arrived,
      preview,
      finalPositions: phaseSnapshot(units, phase.target),
    });
    assert.ok(arrived, `${phase.label}: arrived ${arrivals.size}/${units.length} within ${PHASE_LIMIT_SECONDS}s; ` +
      units.filter(unit => !arrivals.has(unit.id)).map(unit => `${unit.defId}@${unit.x.toFixed(1)},${unit.y.toFixed(1)}:${unit.order.type}`).join(' | '));
  }

  const screen = phases.find(phase => phase.formation === 'screen').finalPositions;
  const line = phases.find(phase => phase.formation === 'line').finalPositions;
  const column = phases.find(phase => phase.formation === 'column').finalPositions;
  return {
    scenario: 'mixed-ground screen, line, and column route on open sand',
    replayVersion: game.replayVersion,
    seed: SEED,
    simulatedSeconds: rounded(game.time),
    stepSeconds: STEP_SECONDS,
    composition: units.map(unit => ({ id: unit.id, defId: unit.defId })),
    selection: { selectedUnitCount: ids.length, selectedIds: ids },
    phases,
    formationEvidence: {
      screenFrontArmorLeadsSupport: screen.frontLeadsSupport,
      lineFrontArmorLeadsSupport: line.frontLeadsSupport,
      columnFrontArmorLeadsSupport: column.frontLeadsSupport,
      screenPositions: screen.units,
      linePositions: line.units,
      columnPositions: column.units,
    },
    performance: {
      wallMilliseconds: rounded(performance.now() - wallStart),
      simulatedToWallRatio: rounded(game.time / Math.max(0.001, (performance.now() - wallStart) / 1000)),
    },
    result: 'completed',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(runTacticalFormationPlaytest(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ result: 'failed', error: error.message }));
    process.exitCode = 1;
  }
}
