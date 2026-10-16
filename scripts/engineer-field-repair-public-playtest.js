// Bounded rules-85 field-repair route using Iron Reclaimed's authored public
// recommission objective. Two earlier ordinary-skirmish probes reached live
// AI contact but lost the damaged tank during its return; this demonstrates
// the paid repair loop in its designed campaign setting, not general balance.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { ENGINEER_FIELD_REPAIR_RULES_VERSION } from '../src/game/engine.js';
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

function fullPublicState(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, wrecks: game.wrecks,
    credits: game.credits, terrain: game.terrain, effects: game.effects, events: game.events,
    campaignState: game.campaignState, campaignResult: game.campaignResult,
    time: game.time, status: game.status, winner: game.winner });
}

function advanceOne(game, clock) {
  return clock.advance(SOLO_STEP_SECONDS, dt => {
    game.update(dt);
    updateCampaign(game, MISSION_INDEX, dt, ENGINEER_FIELD_REPAIR_RULES_VERSION);
    return game.status === 'playing';
  });
}

export function runEngineerFieldRepairPublicPlaytest() {
  assert.equal(ENGINEER_FIELD_REPAIR_RULES_VERSION, 85);
  const game = createCampaignGame(MISSION_INDEX, 'normal', SEED, 'standard', 'none', 'none',
    'none', 'none', null, ENGINEER_FIELD_REPAIR_RULES_VERSION);
  game.replayVersion = ENGINEER_FIELD_REPAIR_RULES_VERSION;
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const startingCredits = game.credits.player;
  const state = game.campaignState;
  const engineer = game.getEntity(state.engineerId);
  const workshop = game.buildings.find(building => building.owner === 'player' && building.defId === 'serviceBay');
  assert.ok(engineer?.hp > 0 && workshop?.hp > 0 && workshop.progress >= 1 && workshop.powered,
    'Iron Reclaimed should start with a living signal Engineer and completed powered Field Workshop');
  assert.equal(startingCredits, 600, 'the mission provides its authored 600-credit repair budget');
  assert.equal(workshop.x, 8); assert.equal(workshop.y, 34);
  const wreck = game.wrecks.find(item => item.id === state.wreckId);
  assert.ok(wreck && wreck.x === 14.5 && wreck.y === 34.5, 'the marked wreck remains at its authored location');

  try {
    issue(game, 'issueRecommissionWreck', [engineer.id], state.wreckId);
    while (game.status === 'playing' && !game.campaignState.recommissionedVehicleId &&
        game.time < MAX_SECONDS) advanceOne(game, clock);
    const recommissionEvent = game.events.find(event => event.type === 'wreckRecommissioned' &&
      event.id === state.wreckId && event.owner === 'player' && event.unitId === engineer.id);
    assert.ok(recommissionEvent, 'the Engineer should perform the normal paid marked-wreck recommission');
    const guardian = game.getEntity(game.campaignState.recommissionedVehicleId);
    assert.ok(guardian?.hp > 0 && guardian.defId === 'guardian', 'the event should restore a living Guardian');
    assert.equal(recommissionEvent.cost, 520, 'the authored recovery costs 520 credits');
    assert.equal(startingCredits - game.credits.player, 520, 'no extra credits are spent before field repair');
    assert.ok(Math.abs(guardian.hp / guardian.maxHp - 0.4) < 0.02,
      'the recovered Guardian starts at the authored 40% health');
    assert.ok(game._distanceToEntity(guardian.x, guardian.y, workshop) > 2.5,
      'the marked wreck is outside the Workshop vehicle-repair aura');

    // Keep an exact recovery point immediately before the field-repair command
    // so the parent task can open a real browser checkpoint for UI review.
    const preRepairCheckpointSerialized = game.serialize();
    const guardianOrderBeforeRepair = structuredClone(guardian.order);
    const guardianHpBeforeRepair = guardian.hp;
    const engineerKitsBeforeRepair = engineer.fieldRepairKits;
    issue(game, 'issueFieldRepair', [engineer.id], guardian.id);
    const repairIssuedAt = +game.time.toFixed(2);
    while (game.status === 'playing' && !game.events.some(event => event.type === 'fieldRepairCompleted' &&
        event.engineerId === engineer.id && event.targetId === guardian.id) && game.time < MAX_SECONDS)
      advanceOne(game, clock);
    const repairEvent = game.events.find(event => event.type === 'fieldRepairCompleted' &&
      event.engineerId === engineer.id && event.targetId === guardian.id);
    assert.ok(repairEvent, 'the Engineer should complete a normal stationary field-repair channel');
    assert.ok(repairEvent.amount >= 40, 'the field repair should restore a meaningful amount of HP');
    assert.equal(guardian.hp, guardianHpBeforeRepair + repairEvent.amount,
      'the Guardian should receive the exact field-repair amount');
    assert.equal(engineer.fieldRepairKits, engineerKitsBeforeRepair - 1,
      'one kit is consumed only when the repair completes');
    assert.deepEqual(guardian.order, guardianOrderBeforeRepair,
      'field repair leaves the patient vehicle order unchanged');

    const refillCreditsBefore = game.credits.player;
    const kitsBeforeRefill = engineer.fieldRepairKits;
    issue(game, 'issueRefillRepairKits', [engineer.id]);
    const refillIssuedAt = +game.time.toFixed(2);
    while (game.status === 'playing' && engineer.fieldRepairKits < 2 && game.time < MAX_SECONDS)
      advanceOne(game, clock);
    const refillEvent = game.events.find(event => event.type === 'fieldRepairKitsChanged' &&
      event.engineerId === engineer.id && event.workshopId === workshop.id);
    assert.ok(refillEvent, 'the Engineer should return to the powered Workshop and complete one paid refill');
    assert.equal(refillEvent.cost, 80, 'the refill uses its normal 80-credit cost');
    assert.equal(refillEvent.kits, 2, 'the refill returns the Engineer to the two-kit cap');
    assert.equal(engineer.fieldRepairKits, 2);
    assert.deepEqual(engineer.order, { type: 'idle' }, 'the Engineer idles after refilling to capacity');
    assert.ok(game.time - refillIssuedAt >= 8, 'the Workshop refill observes its eight-second channel');
    assert.ok(game.time <= MAX_SECONDS, 'repair and refill finish within the bounded 80-second route');

    const commands = recorder.commands;
    validateSoloReplay(ENVELOPE, commands, clock.completedTicks, ENGINEER_FIELD_REPAIR_RULES_VERSION);
    const playback = createSoloPlayback(ENVELOPE, commands, clock.completedTicks,
      ENGINEER_FIELD_REPAIR_RULES_VERSION);
    playback.step(clock.completedTicks);
    assert.deepEqual(fullPublicState(playback.game), fullPublicState(game),
      'recommission, repair, paid refill, and campaign state should replay exactly');

    return { envelope: ENVELOPE, mission: 'iron-reclaimed', seed: SEED, difficulty: 'normal',
      startingCredits, creditsAfterRecommission: startingCredits - recommissionEvent.cost,
      recommissionedAt: +recommissionEvent.time.toFixed(2), recommissionCost: recommissionEvent.cost,
      guardian: { id: guardian.id, hpBeforeRepair: +guardianHpBeforeRepair.toFixed(2),
        hpAfterRepair: +guardian.hp.toFixed(2), maxHp: guardian.maxHp,
        repairAmount: repairEvent.amount, orderBefore: guardianOrderBeforeRepair,
        orderAfter: structuredClone(guardian.order) },
      engineer: { id: engineer.id, kitsBeforeRepair: engineerKitsBeforeRepair,
        kitsAfterRepair: kitsBeforeRefill, kitsAfterRefill: engineer.fieldRepairKits,
        repairIssuedAt, repairCompletedAt: +repairEvent.time.toFixed(2),
        repairElapsed: +(repairEvent.time - repairIssuedAt).toFixed(2), refillIssuedAt,
        refillCompletedAt: +game.time.toFixed(2),
        refillElapsed: +(game.time - refillIssuedAt).toFixed(2), refillCost: refillEvent.cost,
        creditsBeforeRefill: refillCreditsBefore, creditsAfterRefill: game.credits.player,
        finalOrder: engineer.order.type },
      workshop: { id: workshop.id, x: workshop.x, y: workshop.y, powered: workshop.powered },
      seconds: +game.time.toFixed(2), completedTicks: clock.completedTicks,
      commands: commands.map(({ tick, sequence, method, args, selectedIds }) =>
        ({ tick, sequence, method, args, selectedIds })),
      publicReplayState: fullPublicState(game), replayMatches: true,
      preRepairCheckpointSerialized };
  } finally {
    recorder.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEngineerFieldRepairPublicPlaytest();
  const compact = { ...result,
    publicReplayState: '[omitted from CLI; returned by exported function]',
    preRepairCheckpointSerialized: `[omitted ${result.preRepairCheckpointSerialized.length} byte checkpoint; available from exported function]` };
  console.log(JSON.stringify(compact, null, 2));
}
