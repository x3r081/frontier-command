import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { ENGINEER_ESCORT_RULES_VERSION } from '../src/game/engine.js';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MISSION_INDEX = 15;
const SEED = 41073;
const MAX_SECONDS = 80;
const ENVELOPE = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: SEED,
  scenarioId: 'iron-reclaimed', doctrineId: 'standard', fieldOrderId: 'none',
  carryoverId: 'none', supplyId: 'none', routePayoffId: 'none', campaignVeteran: null };

function issue(game, method, ids, ...args) {
  game.select(ids);
  const result = game[method](...args);
  assert.equal(result?.ok, true, `${method}: ${result?.reason || 'command rejected'}`);
  return result;
}

function advanceOne(game, clock, observedHealing) {
  const trackedGuardian = game.getEntity(game.campaignState.recommissionedVehicleId);
  const hpBefore = trackedGuardian?.hp;
  const repairCountBefore = trackedGuardian ? game.events.filter(event => event.type === 'fieldRepairCompleted' &&
    event.targetId === trackedGuardian.id).length : 0;
  const timeBefore = game.time;
  const result = clock.advance(SOLO_STEP_SECONDS, dt => {
    game.update(dt);
    updateCampaign(game, MISSION_INDEX, dt, ENGINEER_ESCORT_RULES_VERSION);
    return game.status === 'playing';
  });
  if (trackedGuardian && trackedGuardian.hp > hpBefore + 0.000001) {
    const repairCountAfter = game.events.filter(event => event.type === 'fieldRepairCompleted' &&
      event.targetId === trackedGuardian.id).length;
    if (repairCountAfter === repairCountBefore) {
      observedHealing?.push({ time: +timeBefore.toFixed(2),
        amount: +(trackedGuardian.hp - hpBefore).toFixed(3), x: +trackedGuardian.x.toFixed(2),
        y: +trackedGuardian.y.toFixed(2), credits: game.credits.player });
    }
  }
  return result;
}

function advanceUntil(game, clock, predicate, description, observedHealing) {
  while (game.status === 'playing' && game.time < MAX_SECONDS && !predicate())
    advanceOne(game, clock, observedHealing);
  assert.ok(predicate(), `${description} within the ${MAX_SECONDS}-second bound`);
}

function exactPublicReplayState(game) {
  return game.serialize();
}

/**
 * Public-command Iron Reclaimed route proving Engineer Follow repairs a
 * recommissioned, stopped Guardian using finite kits, including movement
 * cancellation and ordinary following after the kit supply is exhausted.
 */
export function runEngineerEscortPublicPlaytest() {
  assert.equal(ENGINEER_ESCORT_RULES_VERSION, 87);
  const game = createCampaignGame(MISSION_INDEX, 'normal', SEED, 'standard', 'none', 'none',
    'none', 'none', null, ENGINEER_ESCORT_RULES_VERSION);
  game.replayVersion = ENGINEER_ESCORT_RULES_VERSION;
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const startingCredits = game.credits.player;
  const engineer = game.getEntity(game.campaignState.engineerId);
  const workshop = game.buildings.find(building => building.owner === 'player' && building.defId === 'serviceBay');
  const wreckId = game.campaignState.wreckId;
  assert.ok(engineer?.hp > 0 && workshop?.hp > 0 && workshop.progress >= 1 && workshop.powered,
    'the authored mission starts with its Engineer and powered Workshop');
  assert.equal(startingCredits, 600);
  const commands = recorder.commands;
  let duringChannelCheckpointSerialized = null;
  let preEscortCheckpointSerialized = null;
  let exhaustedCheckpointSerialized = null;
  let guardian;
  let partialKits;
  let movementResetAt = null;
  let moveStart;
  let completedRepairsBeforeFinalMove = 0;
  const observedHealing = [];

  try {
    issue(game, 'issueRecommissionWreck', [engineer.id], wreckId);
    advanceUntil(game, clock, () => !!game.campaignState.recommissionedVehicleId,
      'the marked Guardian recommissions through its normal paid channel', observedHealing);
    guardian = game.getEntity(game.campaignState.recommissionedVehicleId);
    const recommission = game.events.find(event => event.type === 'wreckRecommissioned' &&
      event.id === wreckId && event.owner === 'player' && event.unitId === engineer.id);
    assert.ok(guardian?.hp > 0 && guardian.defId === 'guardian');
    assert.equal(recommission?.cost, 520);
    assert.equal(startingCredits - game.credits.player, 520);
    const hpBeforeEscort = guardian.hp;
    const creditsBeforeEscort = game.credits.player;
    const orderBeforeEscort = structuredClone(guardian.order);
    preEscortCheckpointSerialized = game.serialize();

    issue(game, 'issueFollow', [engineer.id], guardian.id);
    advanceUntil(game, clock, () => engineer._fieldRepairProgress >= 2,
      'the Engineer reaches and starts a partial Follow repair channel', observedHealing);
    partialKits = engineer.fieldRepairKits;
    assert.equal(partialKits, 2, 'partial channel does not consume a kit');
    assert.equal(guardian.hp, hpBeforeEscort, 'partial channel does not change Guardian health');
    assert.deepEqual(guardian.order, orderBeforeEscort, 'following does not replace the Guardian order');
    duringChannelCheckpointSerialized = game.serialize();
    const partialProgress = engineer._fieldRepairProgress;
    const partialTime = game.time;

    moveStart = { x: guardian.x, y: guardian.y };
    issue(game, 'issueMove', [guardian.id], 18.5, 34.5);
    advanceUntil(game, clock, () => game.events.some(event => event.type === 'fieldRepairWaiting' &&
      event.engineerId === engineer.id && event.targetId === guardian.id && event.reason === 'target-moving'),
    'ordinary Guardian movement cancels the active repair channel', observedHealing);
    movementResetAt = game.time;
    assert.ok(Math.hypot(guardian.x - moveStart.x, guardian.y - moveStart.y) > 0.01,
      'the Guardian actually moved under the public move order');
    assert.equal(engineer._fieldRepairProgress, 0, 'movement resets the channel');
    assert.equal(engineer.fieldRepairKits, partialKits, 'movement does not spend a kit');
    assert.equal(guardian.hp, hpBeforeEscort, 'movement cancellation does not heal the patient');
    assert.deepEqual(engineer.order, { type: 'follow', targetId: guardian.id });

    advanceUntil(game, clock, () => guardian.order?.type === 'idle' &&
      Math.hypot(guardian.x - 18.5, guardian.y - 34.5) <= 0.55,
    'the Guardian reaches the nearby ground point and stops normally', observedHealing);
    issue(game, 'issueStop', [guardian.id]);
    const stoppedOrder = structuredClone(guardian.order);
    assert.deepEqual(stoppedOrder, { type: 'idle' });
    assert.equal(engineer.fieldRepairKits, 2);

    advanceUntil(game, clock, () => engineer.fieldRepairKits === 0,
      'the stopped Guardian receives both remaining Follow repairs', observedHealing);
    const repairEvents = game.events.filter(event => event.type === 'fieldRepairCompleted' &&
      event.engineerId === engineer.id && event.targetId === guardian.id);
    const repairedAmount = repairEvents.reduce((sum, event) => sum + event.amount, 0);
    assert.equal(repairEvents.length, 2);
    assert.equal(repairedAmount, 240);
    const hpAfterTwoKits = guardian.hp;
    const nonKitHealthDelta = hpAfterTwoKits - hpBeforeEscort - repairedAmount;
    assert.deepEqual(engineer.order, { type: 'follow', targetId: guardian.id },
      'empty kits leave Engineer Follow active');
    assert.equal(guardian.order.type, 'idle', 'repair does not alter the stopped vehicle order');
    exhaustedCheckpointSerialized = game.serialize();
    const refillEventsBefore = game.events.filter(event => event.type === 'fieldRepairKitsChanged' &&
      event.engineerId === engineer.id).length;
    completedRepairsBeforeFinalMove = repairEvents.length;

    moveStart = { x: guardian.x, y: guardian.y };
    issue(game, 'issueMove', [guardian.id], 20.5, 34.5);
    advanceUntil(game, clock, () => guardian.order?.type === 'idle' &&
      Math.hypot(guardian.x - 20.5, guardian.y - 34.5) <= 0.55,
    'the exhausted Engineer continues following after a second ordinary vehicle move', observedHealing);
    assert.ok(Math.hypot(guardian.x - moveStart.x, guardian.y - moveStart.y) > 0.5);
    assert.equal(engineer.fieldRepairKits, 0, 'no kits are created or refilled automatically');
    assert.equal(game.events.filter(event => event.type === 'fieldRepairCompleted' &&
      event.engineerId === engineer.id && event.targetId === guardian.id).length, completedRepairsBeforeFinalMove);
    assert.equal(game.events.filter(event => event.type === 'fieldRepairKitsChanged' &&
      event.engineerId === engineer.id).length, refillEventsBefore);
    assert.deepEqual(engineer.order, { type: 'follow', targetId: guardian.id });
    assert.ok(game._distanceToEntity(engineer.x, engineer.y, guardian) <= 3,
      'the Engineer remains near its followed vehicle');
    assert.ok(game.time <= MAX_SECONDS);

    validateSoloReplay(ENVELOPE, commands, clock.completedTicks, ENGINEER_ESCORT_RULES_VERSION);
    const playback = createSoloPlayback(ENVELOPE, commands, clock.completedTicks,
      ENGINEER_ESCORT_RULES_VERSION);
    playback.step(clock.completedTicks);
    assert.equal(exactPublicReplayState(playback.game), exactPublicReplayState(game),
      'the full campaign simulation state matches exact recorded playback');

    return {
      envelope: ENVELOPE, mission: 'iron-reclaimed', difficulty: 'normal', seed: SEED,
      rulesVersion: ENGINEER_ESCORT_RULES_VERSION, seconds: +game.time.toFixed(2),
      completedTicks: clock.completedTicks, startingCredits, recommissionCost: recommission.cost,
      guardian: { id: guardian.id, hpAtFollow: +hpBeforeEscort.toFixed(2), hpAfterTwoKits: +hpAfterTwoKits.toFixed(2), hpAfterRoute: +guardian.hp.toFixed(2),
        kitRepairTotal: repairedAmount, otherHealthDeltaWhileFollowing: +nonKitHealthDelta.toFixed(3),
        workshopCreditsWhileFollowing: +(creditsBeforeEscort - game.credits.player).toFixed(2),
        observedOtherHealing: observedHealing,
        promotions: game.events.filter(event => event.type === 'veterancy' && event.id === guardian.id)
          .map(event => ({ time: +event.time.toFixed(2), level: event.level })),
        repairEvents: repairEvents.map(event => ({ time: +event.time.toFixed(2),
          amount: event.amount, kits: event.kits })), orderAfterRoute: structuredClone(guardian.order) },
      engineer: { id: engineer.id, kitsAtPartialChannel: partialKits, partialChannelProgress: +partialProgress.toFixed(2),
        partialChannelAt: +partialTime.toFixed(2), moveResetAt: +movementResetAt.toFixed(2),
        kitsAtMovementReset: partialKits, kitsAfterRepair: engineer.fieldRepairKits,
        finalOrder: structuredClone(engineer.order) },
      commands: commands.map(({ tick, sequence, method, args, selectedIds }) =>
        ({ tick, sequence, method, args, selectedIds })),
      replayMatches: true,
      preEscortCheckpointSerialized,
      duringChannelCheckpointSerialized,
      exhaustedCheckpointSerialized,
    };
  } finally {
    recorder.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEngineerEscortPublicPlaytest();
  console.log(JSON.stringify({ ...result,
    preEscortCheckpointSerialized: `[omitted ${result.preEscortCheckpointSerialized.length} byte checkpoint; returned by exported function]`,
    duringChannelCheckpointSerialized: `[omitted ${result.duringChannelCheckpointSerialized.length} byte checkpoint; returned by exported function]`,
    exhaustedCheckpointSerialized: `[omitted ${result.exhaustedCheckpointSerialized.length} byte checkpoint; returned by exported function]`,
  }, null, 2));
}
