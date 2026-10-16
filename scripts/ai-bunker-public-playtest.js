// Bounded, untouched-start skirmish probe for the rules-80 AI Field Bunker.
// The player issues only public stance/move orders with original units; all
// economy, terrain, starting forces, and AI handlers remain live.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Game, AI_FIELD_BUNKER_RULES_VERSION } from '../src/game/engine.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MAX_SECONDS = 150;
export const AI_BUNKER_PUBLIC_ROUTES = [
  { seed: 24, difficulty: 'normal', faction: 'aegis', approach: [42.5, 16.5],
    unitDefs: ['scout'], stance: 'holdFire' },
  { seed: 24, difficulty: 'hard', faction: 'vesper', approach: [40.5, 18.5],
    unitDefs: ['scout', 'rifle', 'lightTank'], stance: 'aggressive' },
  { seed: 24, difficulty: 'hard', faction: 'vesper', approach: [40.5, 18.5],
    unitDefs: ['scout', 'rifle', 'lightTank'], stance: 'aggressive', reinforcement: 'rocket',
    reinforcementAt: 45, reinforcementApproach: [44.5, 19.5] },
];
const ROUTES = AI_BUNKER_PUBLIC_ROUTES;

function publicSnapshot(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, credits: game.credits,
    terrain: game.terrain, effects: game.effects, time: game.time, status: game.status });
}

function comparePlayback(game, envelope, commands, ticks) {
  const playback = createSoloPlayback(envelope, commands, ticks, AI_FIELD_BUNKER_RULES_VERSION);
  playback.step(ticks);
  assert.deepEqual(publicSnapshot(playback.game), publicSnapshot(game), 'rules-80 replay must match live simulation');
  return true;
}

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

export function runAiBunkerPublicPlaytest(route = ROUTES[2]) {
  const envelope = { mode: 'skirmish', difficulty: route.difficulty, faction: route.faction,
    seed: route.seed, scenarioId: 'shard-valley', victoryMode: 'elimination' };
  const game = new Game({ ...envelope, mapId: envelope.scenarioId,
    replayVersion: AI_FIELD_BUNKER_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const startingEnemyCredits=game.credits.enemy;
  const recorder = createSoloRecorder(game, clock);
  const timeline = [];
  let previousTickCredits = game.credits.enemy;
  let observedBunker = null;
  let constructionEvent = null;
  let firstOccupancy = null;
  let checkpointSerialized = null;
  let firstShotAt = null;
  let crewProjectiles = 0;
  let scoutFirstSeenByEnemyAt = null;
  let scoutSeenByEnemyTicks = 0;
  const projectileIds = new Set();
  const originalOnEvent = game.onEvent;
  game.onEvent = event => {
    originalOnEvent?.(event);
    if (event.type === 'constructionStarted' && event.owner === 'enemy' && event.defId === 'bunker') {
      constructionEvent = { time: +game.time.toFixed(2), x: event.x, y: event.y,
        creditsBeforeTick: previousTickCredits, creditsAfter: game.credits.enemy,
        spentThisTick: +(previousTickCredits - game.credits.enemy).toFixed(2) };
      timeline.push({ type: 'enemyPaidBunkerConstruction', ...constructionEvent });
    }
  };

  const force = (route.unitDefs || ['scout']).map(defId => game.units.find(unit =>
    unit.owner === 'player' && unit.defId === defId && unit.hp > 0)).filter(Boolean);
  assert.equal(force.length, (route.unitDefs || ['scout']).length,
    `seed ${route.seed} should retain the original ${route.unitDefs?.join(', ') || 'scout'}`);
  const scout = force.find(unit => unit.defId === 'scout');
  const initialUnitIds = new Set(game.units.map(unit => unit.id));
  game.select(force.map(unit => unit.id));
  if (route.stance) requireOk(game.issueSetStance(route.stance), 'set the public scouting force stance');
  requireOk(game.issueMove(route.approach[0], route.approach[1]), 'scout the enemy industry approach');
  let reinforcementOrdered = false;
  if (route.reinforcement) {
    const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
    assert.ok(barracks, 'untouched opening must retain the player Barracks');
    requireOk(game.queueUnit(route.reinforcement, barracks.id), `pay to train ${route.reinforcement}`);
  }
  timeline.push({ type: 'playerPublicOrders', unitIds: force.map(unit => unit.id),
    orders: recorder.commands.map(command => ({ method: command.method, args: command.args })) });

  const deadline = Math.round(MAX_SECONDS / SOLO_STEP_SECONDS);
  for (let tick = 0; tick < deadline && game.status === 'playing'; tick++) {
    previousTickCredits = game.credits.enemy;
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
    if (route.reinforcement && !reinforcementOrdered && game.time >= route.reinforcementAt) {
      const reinforcement = game.units.find(unit => unit.owner === 'player' &&
        unit.defId === route.reinforcement && !initialUnitIds.has(unit.id) && unit.hp > 0 && !unit.embarkedIn);
      if (reinforcement) {
        game.select(reinforcement.id);
        requireOk(game.issueMove(route.reinforcementApproach[0], route.reinforcementApproach[1]),
          'move the paid reinforcement toward the bunker approach');
        reinforcementOrdered = true;
        timeline.push({ type: 'playerPaidReinforcementMove', time: +game.time.toFixed(2),
          unitId: reinforcement.id, defId: reinforcement.defId, destination: route.reinforcementApproach });
      }
    }
    if (scout.hp > 0 && game.isVisible(scout, 'enemy')) {
      scoutFirstSeenByEnemyAt ??= +game.time.toFixed(2);
      scoutSeenByEnemyTicks++;
    }
    if (!observedBunker) observedBunker = game.buildings.find(building => building.owner === 'enemy' &&
      building.defId === 'bunker') || null;
    if (observedBunker && !firstOccupancy && observedBunker.garrisonIds?.length) {
      firstOccupancy = { time: +game.time.toFixed(2), occupants: [...observedBunker.garrisonIds] };
      timeline.push({ type: 'enemyCrewBoarded', ...firstOccupancy });
    }
    if (observedBunker && firstOccupancy && observedBunker.garrisonIds?.length) {
      const crewSet = new Set(observedBunker.garrisonIds);
      for (const effect of game.effects) {
        if (effect.type === 'projectile' && crewSet.has(effect.sourceId) && !projectileIds.has(effect.id)) {
          projectileIds.add(effect.id);
          crewProjectiles++;
        }
      }
      if (firstShotAt === null && Number.isFinite(observedBunker.garrisonFireUntil) &&
          observedBunker.garrisonFireUntil > game.time) {
        firstShotAt = +game.time.toFixed(2);
        timeline.push({ type: 'enemyBunkerCrewFired', time: firstShotAt,
          occupants: [...observedBunker.garrisonIds] });
      }
      if (firstShotAt !== null && !checkpointSerialized) {
        checkpointSerialized = game.serialize();
        timeline.push({ type: 'enemyBunkerFiringCheckpoint', time: +game.time.toFixed(2),
          occupants: [...observedBunker.garrisonIds], bytes: checkpointSerialized.length });
      }
    }
  }
  recorder.dispose();

  // The new policy must remain an AI-only behavior. Internal enemy garrison
  // orders are intentionally absent from the player's public command log.
  assert.equal(recorder.commands.some(command => command.method === 'issueGarrison'), false,
    'AI crew boarding must not leak into the player replay');
  validateSoloReplay(envelope, recorder.commands, clock.completedTicks);
  const replayMatches = comparePlayback(game, envelope, recorder.commands, clock.completedTicks);
  const bunker = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'bunker') || null;
  const result = {
    route: { ...route, secondsLimit: MAX_SECONDS },
    outcome: game.status,
    seconds: +game.time.toFixed(2),
    startingEnemyCredits,
    enemyCreditsRemaining: +game.credits.enemy.toFixed(2),
    scoutFinal: scout ? { x: +scout.x.toFixed(2), y: +scout.y.toFixed(2), hp: +scout.hp.toFixed(2),
      order: scout.order?.type || null, firstSeenByEnemyAt: scoutFirstSeenByEnemyAt,
      seenByEnemyTicks: scoutSeenByEnemyTicks } : null,
    forceFinal: force.map(unit => ({ id: unit.id, defId: unit.defId, hp: +unit.hp.toFixed(2),
      x: +unit.x.toFixed(2), y: +unit.y.toFixed(2), embarkedIn: unit.embarkedIn || null })),
    reinforcementOrdered,
    constructionEvent,
    bunker: bunker ? { id: bunker.id, x: bunker.x, y: bunker.y, progress: +bunker.progress.toFixed(3),
      hp: +bunker.hp.toFixed(2), garrisonIds: [...(bunker.garrisonIds || [])] } : null,
    firstOccupancy,
    firstShotAt,
    crewProjectiles,
    playerCommands: recorder.commands.map(({ tick, method, args, selectedIds }) => ({ tick, method, args, selectedIds })),
    replayMatches,
    timeline,
    checkpointSerialized,
  };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = process.argv.includes('--all');
  const routes = all ? ROUTES : [ROUTES[2]];
  for (const route of routes) {
    const result = runAiBunkerPublicPlaytest(route);
    const compact = { ...result, checkpointSerialized: result.checkpointSerialized ?
      `[omitted ${result.checkpointSerialized.length} byte checkpoint; available from exported function]` : null };
    console.log(JSON.stringify(compact, null, 2));
    if (result.firstShotAt !== null) break;
  }
}
