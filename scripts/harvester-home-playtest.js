// Public-command economic route probe for the harvester home-refinery order.
// The arena is authored once before play begins. Both measured routes start
// from the same serialized checkpoint after a paid forward refinery build.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Game, HARVESTER_HOME_RULES_VERSION } from '../src/game/engine.js';

const STEP = 0.2;
const FIELD = { x: 30.5, y: 24.5 };
const HOME_REFINERY = { x: 3, y: 3 };
const COMMAND_YARD = { x: 24, y: 18 };
const FORWARD_REFINERY = { x: 22, y: 22 };

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function authorArena(seed = 77001) {
  const game = new Game({ seed, difficulty: 'normal', faction: 'aegis', mapId: 'shard-valley',
    mode: 'multiplayer', victoryMode: 'dominion', replayVersion: HARVESTER_HOME_RULES_VERSION });

  // A flat, revealed arena removes unrelated terrain and fog from the route
  // measurement. The crystal field itself is authored before the first tick.
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
    delete tile.bridgeId;
  }
  const fieldTile = game.terrain[24][30];
  fieldTile.type = 'crystal'; fieldTile.resource = 3500;
  fieldTile.walkable = true; fieldTile.buildable = false;

  const playerBuildings = game.buildings.filter(building => building.owner === 'player');
  const at = defId => playerBuildings.find(building => building.defId === defId);
  Object.assign(at('command'), COMMAND_YARD);
  Object.assign(at('power'), { x: 7, y: 3 });
  Object.assign(at('refinery'), HOME_REFINERY);
  Object.assign(at('barracks'), { x: 28, y: 22 });
  Object.assign(at('factory'), { x: 28, y: 18 });

  const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  assert.ok(harvester, 'authored arena has a player harvester');
  harvester.x = 29.5; harvester.y = 24.5;
  harvester.order = { type: 'harvest' };
  harvester._harvestPhase = 'field';
  harvester._harvestTile = null;
  harvester.homeRefineryId = null;
  harvester.cargo = 0;

  // Keep the opposing base as inert scenery so the game remains alive while
  // the multiplayer simulation runs without AI orders or combat pressure.
  for (const unit of game.units) if (unit.owner === 'enemy') {
    unit.x = 53.5; unit.y = 5.5;
    unit.order = { type: 'idle' };
    unit.path = [];
  }
  game.fog = Array.from({ length: game.height }, () => Array(game.width).fill(2));
  game._refreshPower();

  game.select(harvester.id);
  requireOk(game.issueMove(FIELD.x, FIELD.y), 'order harvester to authored crystal field');
  requireOk(game.startConstruction('refinery'), 'pay for forward refinery');
  return { game, harvesterId: harvester.id, baseRefineryId: at('refinery').id,
    field: { ...FIELD }, forwardSite: { ...FORWARD_REFINERY } };
}

function findById(game, id) {
  return game.units.find(unit => unit.id === id) || game.buildings.find(building => building.id === id);
}

function advance(game, condition, maxSeconds, step = STEP) {
  const deadline = game.time + maxSeconds;
  while (game.status === 'playing' && game.time < deadline && !condition()) game.update(step);
  return condition();
}

function measureDelivery(snapshot, harvesterId, assignRefineryId = undefined) {
  const game = Game.deserialize(snapshot);
  const harvester = findById(game, harvesterId);
  const start = game.time;
  const startingCredits = game.credits.player;
  const field = harvester._harvestTile;
  const stockAtStart = field ? game.terrain[field.y][field.x].resource : null;
  let observedDeliveryRefineryId = null;
  if (assignRefineryId !== undefined) {
    game.select(harvester.id);
    requireOk(game.issueAssignRefinery(assignRefineryId), 'assign current loaded trip to forward refinery');
  }

  const deliveryObserved = advance(game, () => {
    const unit = findById(game, harvesterId);
    if (unit?._unloadRefineryId) observedDeliveryRefineryId = unit._unloadRefineryId;
    return unit && unit.cargo <= 0 && game.time > start + 0.5;
  }, 150);
  const deliveredUnit = findById(game, harvesterId);
  const stockAtDelivery = field ? game.terrain[field.y][field.x].resource : null;
  return {
    game,
    deliveryObserved,
    deliverySeconds: deliveryObserved ? +(game.time - start).toFixed(1) : null,
    cargoAtCheckpoint: harvester.cargo,
    cargoAfterDelivery: deliveredUnit?.cargo ?? null,
    creditDelta: game.credits.player - startingCredits,
    assignedRefineryId: deliveredUnit?.homeRefineryId ?? null,
    deliveryRefineryId: observedDeliveryRefineryId,
    fieldStockAtStart: stockAtStart == null ? null : +stockAtStart.toFixed(1),
    fieldStockAtDelivery: stockAtDelivery == null ? null : +stockAtDelivery.toFixed(1),
  };
}

export function createHomeRefineryCheckpoint(seed = 77001) {
  const { game, harvesterId, baseRefineryId, field, forwardSite } = authorArena(seed);
  return {
    serialized: game.serialize(),
    seed,
    harvesterId,
    baseRefineryId,
    assignedHomeRefineryId: null,
    field,
    forwardSite,
    replayVersion: HARVESTER_HOME_RULES_VERSION,
    mode: game.mode,
  };
}

export function runHarvesterHomePlaytest(seed = 77001) {
  const authored = authorArena(seed);
  const { game, harvesterId, baseRefineryId, field, forwardSite } = authored;
  const harvester = findById(game, harvesterId);
  const home = findById(game, baseRefineryId);
  assert.ok(home?.powered && home.progress === 1, 'remote starting refinery is completed and powered');

  // Production progresses during the ordinary harvest trip. The player only
  // places the already-paid refinery after a full load starts returning.
  const fullLoadReturning = advance(game, () => {
    const unit = findById(game, harvesterId);
    return unit?.cargo >= game.unitDefs.harvester.capacity && unit._harvestPhase === 'return';
  }, 180);
  assert.equal(fullLoadReturning, true, 'harvester reaches a full load and returns to its home refinery');
  const readyBeforeDock = advance(game, () => game.construction?.ready === true, 50);
  assert.equal(readyBeforeDock, true, 'paid forward refinery becomes ready during the first loaded return');
  const built = requireOk(game.issueBuild('refinery', forwardSite.x, forwardSite.y),
    'place forward refinery beside the command yard');
  const forward = findById(game, built.id);
  assert.ok(forward?.progress === 1 && forward.powered, 'forward refinery is completed and powered');
  assert.ok(game.credits.player <= 2400, 'the 1400-credit forward refinery was paid from player credits');

  const stillReturning = findById(game, harvesterId);
  assert.equal(stillReturning._harvestPhase, 'return', 'the loaded harvester is still returning at the fork');
  assert.equal(stillReturning.homeRefineryId, null,
    'the harvester starts with automatic routing and no explicit home assignment');
  assert.ok(stillReturning._unloadRefineryId === baseRefineryId,
    'automatic routing has cached the distant starting refinery for this loaded trip');
  const cargoAtCheckpoint = stillReturning.cargo;
  const stockAtCheckpoint = game.terrain[Math.floor(field.y)][Math.floor(field.x)].resource;
  const checkpoint = game.serialize();

  const baseline = measureDelivery(checkpoint, harvesterId);
  const preferred = measureDelivery(checkpoint, harvesterId, forward.id);
  assert.equal(baseline.deliveryObserved, true, 'baseline completes its actual return and unload');
  assert.equal(preferred.deliveryObserved, true, 'assigned route completes its actual return and unload');
  assert.equal(preferred.assignedRefineryId, forward.id, 'assignment remains the selected home refinery');
  assert.ok(preferred.deliverySeconds < baseline.deliverySeconds,
    'forward assignment shortens the measured full-load delivery');
  assert.ok(preferred.creditDelta > 0, 'the preferred route banks credits from the delivered crystal');

  const preferredGame = preferred.game;
  const preferredHarvester = findById(preferredGame, harvesterId);
  const fieldPreservedAfterDelivery = preferredHarvester._harvestTile?.x === Math.floor(field.x) &&
    preferredHarvester._harvestTile?.y === Math.floor(field.y) &&
    preferredGame.terrain[Math.floor(field.y)][Math.floor(field.x)].resource > 0;
  const nextFullLoadReturning = advance(preferredGame, () => {
    const unit = findById(preferredGame, harvesterId);
    return unit?.cargo >= preferredGame.unitDefs.harvester.capacity && unit._harvestPhase === 'return';
  }, 180);
  const secondTrip = findById(preferredGame, harvesterId);
  const nextTripPreserved = nextFullLoadReturning && secondTrip.homeRefineryId === forward.id &&
    secondTrip._harvestTile?.x === Math.floor(field.x) && secondTrip._harvestTile?.y === Math.floor(field.y) &&
    preferredGame.terrain[Math.floor(field.y)][Math.floor(field.x)].resource > 0;
  assert.equal(fieldPreservedAfterDelivery, true, 'delivery preserves the authored harvest field coordinates');
  assert.equal(nextTripPreserved, true, `the next full trip returns to assigned home and preserves its field ` +
    `(observed=${nextFullLoadReturning}, home=${secondTrip.homeRefineryId}, ` +
    `field=${JSON.stringify(secondTrip._harvestTile)}, stock=${preferredGame.terrain[24][30].resource.toFixed(1)})`);

  return {
    seed,
    mode: game.mode,
    replayVersion: HARVESTER_HOME_RULES_VERSION,
    status: game.status,
    arena: { field, baseRefineryId, baseRefineryPosition: HOME_REFINERY, forwardRefineryId: forward.id,
      forwardPosition: forwardSite, commandYard: COMMAND_YARD },
    checkpoint: { time: +game.time.toFixed(1), harvesterId, cargo: cargoAtCheckpoint,
      homeRefineryId: stillReturning.homeRefineryId,
      cachedReturnRefineryId: stillReturning._unloadRefineryId,
      field: { x: Math.floor(field.x), y: Math.floor(field.y) },
      fieldStock: +stockAtCheckpoint.toFixed(1), serialized: checkpoint },
    baseline: { deliverySeconds: baseline.deliverySeconds, creditDelta: baseline.creditDelta,
      homeRefineryId: baseline.assignedRefineryId, deliveryRefineryId: baseline.deliveryRefineryId,
      fieldStockAtStart: baseline.fieldStockAtStart, fieldStockAtDelivery: baseline.fieldStockAtDelivery },
    preferred: { deliverySeconds: preferred.deliverySeconds, creditDelta: preferred.creditDelta,
      deliveryRefineryId: preferred.deliveryRefineryId, assignedRefineryId: preferred.assignedRefineryId,
      fieldStockAtStart: preferred.fieldStockAtStart, fieldStockAtDelivery: preferred.fieldStockAtDelivery },
    secondsSaved: +(baseline.deliverySeconds - preferred.deliverySeconds).toFixed(1),
    fieldPreservedAfterDelivery,
    secondTrip: { observedFullLoadReturn: nextFullLoadReturning, assignedRefineryId: secondTrip.homeRefineryId,
      field: secondTrip._harvestTile ? { ...secondTrip._harvestTile } : null,
      remainingStock: +preferredGame.terrain[24][30].resource.toFixed(1), preserved: nextTripPreserved },
    initialCheckpoint: createHomeRefineryCheckpoint(seed),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = runHarvesterHomePlaytest(Number(process.argv[2]) || 77001);
  const { checkpoint, initialCheckpoint, ...compact } = report;
  console.log(JSON.stringify({ ...compact,
    checkpoint: { ...checkpoint, serialized: `[${checkpoint.serialized.length} chars]` },
    initialCheckpoint: { ...initialCheckpoint, serialized: `[${initialCheckpoint.serialized.length} chars]` },
  }));
}
