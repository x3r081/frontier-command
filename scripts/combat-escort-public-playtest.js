// One bounded rules-89 public-command route using Iron Reclaimed's authored
// opening. No unit, enemy, terrain, health, credit, or fog state is edited.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { COMBAT_ESCORT_RULES_VERSION, UNIT_DEFS } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MISSION_INDEX = 15;
const SEED = 41073;
const MAX_SECONDS = 110;
const ENVELOPE = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: SEED,
  scenarioId: 'iron-reclaimed', doctrineId: 'standard', fieldOrderId: 'none',
  carryoverId: 'none', supplyId: 'none', routePayoffId: 'none', campaignVeteran: null };

function issue(game, method, ids, ...args) {
  game.select(ids);
  const result = game[method](...args);
  assert.equal(result?.ok, true, `${method}: ${result?.reason || 'command rejected'}`);
  return result;
}

function advanceOne(game, clock) {
  clock.advance(SOLO_STEP_SECONDS, dt => {
    game.update(dt);
    updateCampaign(game, MISSION_INDEX, dt, COMBAT_ESCORT_RULES_VERSION);
    return game.status === 'playing';
  });
}

function advanceUntil(game, clock, predicate, description) {
  while (game.status === 'playing' && game.time < MAX_SECONDS && !predicate()) advanceOne(game, clock);
  assert.ok(predicate(), `${description} before the ${MAX_SECONDS}-second bound`);
}

export function runCombatEscortPublicPlaytest() {
  assert.equal(COMBAT_ESCORT_RULES_VERSION, 89);
  const game = createCampaignGame(MISSION_INDEX, 'normal', SEED, 'standard', 'none', 'none',
    'none', 'none', null, COMBAT_ESCORT_RULES_VERSION);
  game.replayVersion = COMBAT_ESCORT_RULES_VERSION;
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const commands = recorder.commands;
  const state = game.campaignState;
  const engineer = game.getEntity(state.engineerId);
  const escort = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle' && unit.hp > 0);
  assert.ok(engineer?.hp > 0 && escort, 'authored opening includes its Engineer and Rifle escort');
  assert.equal(game.credits.player, 600, 'use the ordinary authored campaign budget');

  let guardian = null;
  let shot = null;
  let retreat = null;
  let preFollowCheckpointSerialized = null;
  let checkpointSerialized = null;
  const originalFire = game._fire.bind(game);
  game._fire = (source, target, weapon) => {
    const isAmbushTarget = game.campaignState.routeAmbushFired &&
      game.campaignState.routeAmbushUnitIds?.includes(target.id);
    const shouldRecord = !shot && source.id === escort.id && isAmbushTarget;
    const leader = shouldRecord ? game.getEntity(state.recommissionedVehicleId) : null;
    const result = originalFire(source, target, weapon);
    if (shouldRecord) {
      shot = { time: +game.time.toFixed(2), sourceId: source.id, sourceDefId: source.defId,
        targetId: target.id, targetDefId: target.defId, sourceX: +source.x.toFixed(2),
        sourceY: +source.y.toFixed(2), targetX: +target.x.toFixed(2), targetY: +target.y.toFixed(2),
        sourceOrder: structuredClone(source.order), leaderId: leader?.id,
        leaderOrder: structuredClone(leader?.order), leaderX: leader && +leader.x.toFixed(2),
        leaderY: leader && +leader.y.toFixed(2),
        leashDistance: leader ? +Math.hypot(source.x - leader.x, source.y - leader.y).toFixed(2) : null,
        targetVisible: game.isVisible(target, source.owner),
        targetDomainAllowed: game._weaponCanTarget(UNIT_DEFS[source.defId]?.weapon, target),
        projectile: game.effects.find(effect => effect.type === 'projectile' &&
          effect.sourceId === source.id && effect.targetId === target.id) || null };
    }
    return result;
  };

  try {
    issue(game, 'issueRecommissionWreck', [engineer.id], state.wreckId);
    advanceUntil(game, clock, () => !!game.campaignState.recommissionedVehicleId,
      'the normal 520-credit Guardian recommission');
    guardian = game.getEntity(game.campaignState.recommissionedVehicleId);
    assert.ok(guardian?.hp > 0 && guardian.owner === 'player');
    const recommission = game.events.find(event => event.type === 'wreckRecommissioned' &&
      event.id === state.wreckId && event.owner === 'player' && event.unitId === engineer.id);
    assert.equal(recommission?.cost, 520);
    assert.equal(game.credits.player, 80, 'recommission uses its ordinary price');

    preFollowCheckpointSerialized = game.serialize();
    issue(game, 'issueFollow', [escort.id], guardian.id);
    issue(game, 'issueMove', [guardian.id], 31.5, 35.5);
    advanceUntil(game, clock, () => game.campaignState.routeChoice === 'south',
      'the Guardian publicly chooses the south pass');
    const rendezvous = game.campaignState.rendezvous;
    assert.deepEqual(rendezvous, { x: 48.5, y: 37.5, radius: 3.2 },
      'use the authored public rendezvous marker for the escort move');
    issue(game, 'issueMove', [guardian.id], rendezvous.x, rendezvous.y);
    advanceUntil(game, clock, () => !!shot,
      'the Rifle escort fires at a currently visible south-pass interceptor');

    assert.equal(shot.sourceOrder.type, 'follow');
    assert.equal(shot.sourceOrder.targetId, guardian.id);
    assert.equal(shot.leaderOrder.type, 'move');
    assert.equal(shot.targetVisible, true);
    assert.equal(shot.targetDomainAllowed, true);
    assert.ok(shot.leashDistance <= 4.0001, 'shot occurs within the leader-centered pursuit leash');
    const projectile = shot.projectile;
    assert.ok(projectile, 'escort attack emits the normal projectile from the visible Rifle');
    assert.deepEqual({ x: +projectile.launchX.toFixed(2), y: +projectile.launchY.toFixed(2) },
      { x: shot.sourceX, y: shot.sourceY }, 'projectile starts at the escort unit position');

    checkpointSerialized = game.serialize();
    const beforeRetreat = Math.hypot(escort.x - guardian.x, escort.y - guardian.y);
    const leaderAtRetreat = { x: guardian.x, y: guardian.y };
    issue(game, 'issueMove', [guardian.id], 20.5, 35.5);
    advanceUntil(game, clock, () => game.status !== 'playing' ||
      Math.hypot(leaderAtRetreat.x - guardian.x, leaderAtRetreat.y - guardian.y) >= 1.25,
    'the leader makes a meaningful public retreat after contact');
    retreat = { time: +game.time.toFixed(2), leaderOrder: structuredClone(guardian.order),
      escortOrder: structuredClone(escort.order), leashDistanceBefore: +beforeRetreat.toFixed(2),
      leaderMoved: +Math.hypot(leaderAtRetreat.x - guardian.x, leaderAtRetreat.y - guardian.y).toFixed(2),
      leashDistanceAfter: +Math.hypot(escort.x - guardian.x, escort.y - guardian.y).toFixed(2) };
    assert.deepEqual(escort.order, { type: 'follow', targetId: guardian.id });
    assert.equal(guardian.order.type, 'move', 'escort behavior leaves the public leader order intact');
    assert.ok(retreat.leashDistanceAfter <= 4.0001,
      'the Rifle remains inside the leader-centered leash during retreat');
    assert.ok(game.time <= MAX_SECONDS);

    validateSoloReplay(ENVELOPE, commands, clock.completedTicks, COMBAT_ESCORT_RULES_VERSION);
    const playback = createSoloPlayback(ENVELOPE, commands, clock.completedTicks, COMBAT_ESCORT_RULES_VERSION);
    playback.step(clock.completedTicks);
    assert.equal(playback.game.serialize(), game.serialize(), 'the full route matches exact recorded playback');
    return { envelope: ENVELOPE, mission: 'iron-reclaimed', difficulty: 'normal', seed: SEED,
      rulesVersion: COMBAT_ESCORT_RULES_VERSION, seconds: +game.time.toFixed(2),
      completedTicks: clock.completedTicks, startingCredits: 600, recommissionCost: recommission.cost,
      creditsAfterRecommission: 80, guardian: { id: guardian.id, orderAtShot: shot.leaderOrder,
        orderAfterRetreat: structuredClone(guardian.order) }, escort: { id: escort.id,
        orderAtShot: shot.sourceOrder, orderAfterRetreat: structuredClone(escort.order), shot, retreat },
      commands: commands.map(({ tick, sequence, method, args, selectedIds }) =>
        ({ tick, sequence, method, args, selectedIds })), replayMatches: true,
      preFollowCheckpointSerialized, checkpointSerialized };
  } finally {
    recorder.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCombatEscortPublicPlaytest();
  console.log(JSON.stringify({ ...result,
    preFollowCheckpointSerialized: `[omitted ${result.preFollowCheckpointSerialized.length} byte checkpoint; returned by exported function]`,
    checkpointSerialized: `[omitted ${result.checkpointSerialized.length} byte checkpoint; returned by exported function]`,
  }, null, 2));
}
