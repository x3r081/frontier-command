import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, createSoloRecorder, SOLO_REPLAY_VERSION, validateSoloReplay } from '../src/game/replay.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MISSION_INDEX = 15;
const MAX_TICKS = 90 * 30;
const ENVELOPE = Object.freeze({ mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 79103,
  scenarioId: 'iron-reclaimed', doctrineId: 'standard', fieldOrderId: 'none', carryoverId: 'none',
  supplyId: 'none', routePayoffId: 'none', campaignVeteran: null });

function issue(game, method, ids, ...args) {
  game.select(ids);
  const result = game[method](...args);
  if (!result?.ok) throw new Error(`${method} rejected: ${result?.reason || 'unknown reason'}`);
  return result;
}

function checkpoint(game, clock, label, engineer, vehicle, workshop) {
  assert.equal(game.status, 'playing', `${label} checkpoint must remain in live gameplay`);
  return {
    label,
    tick: clock.completedTicks,
    time: Number(game.time.toFixed(3)),
    status: game.status,
    playerCredits: Number(game.credits.player.toFixed(3)),
    engineer: { id: engineer.id, hp: Number(engineer.hp.toFixed(2)), kits: engineer.fieldRepairKits,
      order: structuredClone(engineer.order) },
    vehicle: { id: vehicle.id, hp: Number(vehicle.hp.toFixed(2)), maxHp: vehicle.maxHp,
      x: Number(vehicle.x.toFixed(2)), y: Number(vehicle.y.toFixed(2)), order: structuredClone(vehicle.order),
      waiting: vehicle._serviceWaiting || null },
    workshopId: workshop.id,
    serialized: game.serialize(),
  };
}

/**
 * Run one bounded, ordinary Normal Iron Reclaimed field-service route.
 * All post-creation changes come from public player commands and simulation ticks.
 */
export function runWorkshopServicePublicPlaytest() {
  const game = createCampaignGame(MISSION_INDEX, 'normal', ENVELOPE.seed, 'standard', 'none', 'none',
    'none', 'none', null, SOLO_REPLAY_VERSION);
  game.replayVersion = SOLO_REPLAY_VERSION;
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const state = game.campaignState;
  const engineer = game.getEntity(state.engineerId);
  const wreck = game.wrecks.find(item => item.id === state.wreckId);
  const workshop = game.buildings.find(building => building.owner === 'player' && building.defId === 'serviceBay');
  const initialPlayerBudget = game.credits.player;
  const initialArmy = game.units.filter(unit => unit.owner === 'player').map(unit =>
    ({ id: unit.id, defId: unit.defId, hp: unit.hp, x: unit.x, y: unit.y }));
  const initialFog = game.fog.map(row => row.join('')).join('');
  const checkpoints = {};
  let kitsAfterFieldRepair = null;
  let hpAfterFieldRepair = null;
  let recommissionCost = null;
  const step = () => clock.advance(SOLO_STEP_SECONDS, dt => {
    game.update(dt);
    updateCampaign(game, MISSION_INDEX, dt, SOLO_REPLAY_VERSION);
    return game.status === 'playing';
  });
  const advanceUntil = (predicate, maxTicks = MAX_TICKS) => {
    const deadline = Math.min(MAX_TICKS, clock.completedTicks + maxTicks);
    while (!predicate() && game.status === 'playing' && clock.completedTicks < deadline) step();
    return predicate();
  };

  try {
    issue(game, 'issueRecommissionWreck', [engineer.id], wreck.id);
    const restored = advanceUntil(() => game.events.some(event => event.type === 'wreckRecommissioned' && event.id === wreck.id));
    if (!restored) throw new Error('Paid Guardian recommission did not finish within the bounded run.');
    const restoreEvent = game.events.find(event => event.type === 'wreckRecommissioned' && event.id === wreck.id);
    recommissionCost = restoreEvent.cost;
    const vehicle = game.getEntity(restoreEvent.vehicleId);
    if (!vehicle) throw new Error('The recommissioned Guardian did not remain alive.');

    issue(game, 'issueFieldRepair', [engineer.id], vehicle.id);
    const kitsBefore = engineer.fieldRepairKits;
    const repaired = advanceUntil(() => engineer.fieldRepairKits < kitsBefore, 60 * 30);
    if (!repaired) throw new Error('The Engineer did not complete one finite-kit repair within 60 seconds.');
    kitsAfterFieldRepair = engineer.fieldRepairKits;
    hpAfterFieldRepair = vehicle.hp;

    // The Engineer retains one kit and would otherwise continue its field
    // repair order. Bring it back behind the Workshop before moving the target.
    issue(game, 'issueMove', [engineer.id], 9.5, 36.5);
    const engineerWithdrawn = advanceUntil(() => Math.hypot(engineer.x - 9.5, engineer.y - 36.5) <= 0.9, 15 * 30);
    if (!engineerWithdrawn) throw new Error('Engineer did not withdraw to the safe Workshop staging point.');
    issue(game, 'issueGuard', [engineer.id]);

    // Take the Guardian out of automatic Workshop range, then make its original
    // meaningful order explicit before issuing/reissuing Service.
    issue(game, 'issueMove', [vehicle.id], 17.5, 34.5);
    const movedOutside = advanceUntil(() => Math.hypot(vehicle.x - 17.5, vehicle.y - 34.5) <= 0.9, 25 * 30);
    if (!movedOutside) throw new Error('Guardian did not reach the safe staging point outside Workshop range.');
    issue(game, 'issueGuard', [vehicle.id]);
    assert.equal(vehicle.order.type, 'guard');
    checkpoints.beforeService = checkpoint(game, clock, 'beforeService', engineer, vehicle, workshop);

    issue(game, 'issueServiceAtWorkshop', [vehicle.id], workshop.id);
    issue(game, 'issueServiceAtWorkshop', [vehicle.id], workshop.id);
    assert.equal(vehicle.order.type, 'service');
    assert.equal(vehicle.order.resumeOrder.type, 'guard', 'repeated Service retains the original Guard order');
    const serviceHpStart = vehicle.hp;

    const arrived = advanceUntil(() => game._distanceToEntity(vehicle.x, vehicle.y, workshop) <= 2.5, 30 * 30);
    if (!arrived) throw new Error('Guardian did not arrive inside Workshop repair range.');
    checkpoints.arriving = checkpoint(game, clock, 'arriving', engineer, vehicle, workshop);

    const healed = advanceUntil(() => vehicle.hp > serviceHpStart, 30 * 30);
    if (!healed) throw new Error('Workshop service did not apply a paid repair tick.');
    checkpoints.healing = checkpoint(game, clock, 'healing', engineer, vehicle, workshop);

    const serviceWaitStartTick = clock.completedTicks;
    const serviceTerminalReached = advanceUntil(() => vehicle.hp >= vehicle.maxHp || vehicle._serviceWaiting === 'credits' ||
      vehicle.order.type !== 'service', 35 * 30);
    const outcome = vehicle.hp >= vehicle.maxHp ? 'fully-repaired' :
      vehicle._serviceWaiting === 'credits' ? 'credit-paused' : vehicle.order.type;
    if (outcome === 'credit-paused') checkpoints.creditPaused = checkpoint(game, clock,
      'creditPaused', engineer, vehicle, workshop);
    else if (outcome !== 'fully-repaired' || vehicle.order.type !== 'guard')
      throw new Error(`Service did not reach a terminal checkpoint: reached=${serviceTerminalReached}, ticks=${serviceWaitStartTick}->${clock.completedTicks}, status=${game.status}, order=${vehicle.order.type}, waiting=${vehicle._serviceWaiting}, hp=${vehicle.hp}, credits=${game.credits.player}, distance=${game._distanceToEntity(vehicle.x, vehicle.y, workshop)}, time=${game.time}, engineerHp=${engineer.hp}, playerSurvivors=${JSON.stringify(game.units.filter(unit => unit.owner === 'player').map(unit => [unit.id,unit.defId,Math.round(unit.hp)]))}, recent=${JSON.stringify(game.events.slice(-5))}`);

    if (game.status !== 'playing') throw new Error(`Run left gameplay before checkpoint completion: ${game.status}`);
  } finally {
    recorder.dispose();
  }

  const completedTicks = clock.completedTicks;
  const commands = recorder.commands;
  validateSoloReplay(ENVELOPE, commands, completedTicks, SOLO_REPLAY_VERSION);
  const playback = createSoloPlayback(ENVELOPE, commands, completedTicks, SOLO_REPLAY_VERSION);
  playback.step(completedTicks);
  const actualState = JSON.parse(game.serialize());
  const replayState = JSON.parse(playback.game.serialize());
  const differentFields = [...new Set([...Object.keys(actualState), ...Object.keys(replayState)])]
    .filter(key => !isDeepStrictEqual(actualState[key], replayState[key]));
  assert.ok(isDeepStrictEqual(replayState, actualState), `full serialized replay differs in: ${differentFields.join(', ')}`);

  const vehicle = game.getEntity(state.recommissionedVehicleId);
  const summary = {
    mission: 'iron-reclaimed', difficulty: 'normal', seed: ENVELOPE.seed, status: game.status,
    outcome: vehicle?._serviceWaiting === 'credits' ? 'credit-paused' : vehicle?.hp >= vehicle?.maxHp ? 'fully-repaired' : 'unknown',
    elapsedSeconds: Number(game.time.toFixed(3)), completedTicks, commandCount: commands.length,
    recommissionCost, initialPlayerBudget, creditsBeforeService: Number(checkpoints.beforeService.playerCredits.toFixed(3)),
    creditsAfterService: Number(game.credits.player.toFixed(3)), serviceCreditSpend: Number((checkpoints.beforeService.playerCredits - game.credits.player).toFixed(3)),
    vehicleId: vehicle?.id, vehicleHpBeforeService: Number(checkpoints.beforeService.vehicle.hp.toFixed(2)),
    vehicleHpAfterFieldRepair: Number(hpAfterFieldRepair.toFixed(2)), vehicleHpFinal: Number(vehicle?.hp.toFixed(2)),
    engineerKitsBeforeFieldRepair: 2, engineerKitsAfterFieldRepair: kitsAfterFieldRepair,
    serviceWaiting: vehicle?._serviceWaiting || null, serviceResumeOrder: vehicle?.order?.resumeOrder || vehicle?.order,
    replayMatches: true, fullSerializedReplayMatches: true,
    checkpoints: Object.fromEntries(Object.entries(checkpoints).map(([name, cp]) => [name, {
      label: cp.label, time: cp.time, tick: cp.tick, status: cp.status, playerCredits: cp.playerCredits,
      engineer: cp.engineer, vehicle: cp.vehicle,
    }])),
    noManualPostCreationFixtureEdits: true,
    initialArmyCount: initialArmy.length, initialFogTileCount: initialFog.length,
    commands,
  };
  return { game, commands, completedTicks, envelope: ENVELOPE, checkpoints, summary, replayMatches: true };
}

async function cli() {
  const result = runWorkshopServicePublicPlaytest();
  const writeAt = process.argv.indexOf('--write');
  if (writeAt >= 0) {
    const path = process.argv[writeAt + 1];
    if (!path) throw new Error('--write requires an output path');
    await writeFile(path, `${JSON.stringify({ envelope: result.envelope, commands: result.commands,
      completedTicks: result.completedTicks, checkpoints: result.checkpoints, summary: result.summary })}\n`, 'utf8');
  }
  const { game, ...printable } = result;
  process.stdout.write(`${JSON.stringify(printable.summary)}\n`);
}

if (process.argv[1]?.endsWith('/workshop-service-public-playtest.js')) {
  cli().catch(error => { console.error(error); process.exitCode = 1; });
}
