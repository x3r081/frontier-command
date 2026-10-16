// Ordinary, untouched-start rules-81 skirmish route for mobile production rally.
// Only public player commands and fixed-step simulation updates change the game.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Game, MOBILE_RALLY_RULES_VERSION } from '../src/game/engine.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const ENVELOPE = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };
const MAX_SECONDS = 70;

function publicSnapshot(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, credits: game.credits,
    terrain: game.terrain, effects: game.effects, time: game.time, status: game.status });
}

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

export function runMobileRallyPublicPlaytest() {
  const game = new Game({ ...ENVELOPE, mapId: ENVELOPE.scenarioId,
    replayVersion: MOBILE_RALLY_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const leader = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle' && unit.hp > 0);
  assert.ok(factory && leader, 'seed 24 opening should retain its player Factory and Rifle');
  const startingCredits = game.credits.player;

  requireOk(game.setRallyTarget(factory.id, leader.id), 'anchor the Factory to the original Rifle');
  requireOk(game.queueUnit('buggy', factory.id), 'pay for the first moving-front reinforcement');
  requireOk(game.queueUnit('buggy', factory.id), 'pay for the second moving-front reinforcement');
  requireOk(game.queueUnit('apc', factory.id), 'pay for a carrier to board the original leader');
  const creditsAfterPaidQueues = game.credits.player;

  // Move the leader before production completes. Recruits must assemble beside it,
  // transition to normal follow orders, and track a later leader move.
  game.select(leader.id);
  requireOk(game.issueMove(22.5, 38.5), 'move the original leader to the first front position');
  const initialUnitIds = new Set(game.units.map(unit => unit.id));
  const firstMove = { x: 26.5, y: 37.5 };
  const secondMove = { x: 29.5, y: 38.5 };
  let firstBuggy = null;
  let secondBuggy = null;
  let apc = null;
  let firstBuggyManualOrder = false;
  let boardedAt = null;
  let boardOrderIssued = false;
  let secondRelease = null;
  let observedMovingFollow = false;
  let previousLeader = { x: leader.x, y: leader.y };
  const milestones = [];
  let queuedLeaderMove = false;

  for (let tick = 0; tick < Math.round(MAX_SECONDS / SOLO_STEP_SECONDS) && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;

    const newPlayerUnits = game.units.filter(unit => unit.owner === 'player' && !initialUnitIds.has(unit.id));
    firstBuggy ??= newPlayerUnits.find(unit => unit.defId === 'buggy') || null;
    secondBuggy ??= newPlayerUnits.find(unit => unit.defId === 'buggy' && unit.id !== firstBuggy?.id) || null;
    apc ??= newPlayerUnits.find(unit => unit.defId === 'apc') || null;

    if (!queuedLeaderMove && firstBuggy?._productionRally?.stage === 'follow') {
      game.select(leader.id);
      requireOk(game.issueMove(firstMove.x, firstMove.y), 'move the leader after first reinforcement joins');
      queuedLeaderMove = true;
      milestones.push({ type: 'leaderMovedWhileFollowed', time: +game.time.toFixed(2), unitId: firstBuggy.id,
        from: previousLeader, to: firstMove });
    }
    if (queuedLeaderMove && !firstBuggyManualOrder && secondBuggy?._productionRally?.stage === 'follow') {
      // One recruit stays attached to the moving leader; the other demonstrates
      // that a normal manual order releases the private production-follow marker.
      game.select(firstBuggy.id);
      requireOk(game.issueMove(17.5, 41.5), 'give one joined reinforcement a normal move order');
      firstBuggyManualOrder = true;
      milestones.push({ type: 'manualOrderReleasedFirst', time: +game.time.toFixed(2), unitId: firstBuggy.id,
        order: 'move' });
      game.select(leader.id);
      requireOk(game.issueMove(secondMove.x, secondMove.y), 'move the leader again while a recruit follows');
      previousLeader = { ...firstMove };
      milestones.push({ type: 'leaderMovedAgain', time: +game.time.toFixed(2), unitId: secondBuggy.id,
        from: previousLeader, to: secondMove });
    }
    if (secondBuggy?._productionRally?.stage === 'follow' &&
        Math.hypot(leader.x - secondMove.x, leader.y - secondMove.y) < 0.4) {
      observedMovingFollow = true;
    }

    if (apc && boardedAt === null && !leader.embarkedIn && !boardOrderIssued) {
      // Boarding is a normal player-issued carrier order; it invalidates the
      // anchor and lets active production-follow units release to regular rally.
      game.select(leader.id);
      requireOk(game.issueBoard(apc.id), 'board the leader into the paid APC');
      boardOrderIssued = true;
    }
    if (leader.embarkedIn === apc?.id && boardedAt === null) {
      boardedAt = +game.time.toFixed(2);
      milestones.push({ type: 'leaderBoarded', time: boardedAt, apcId: apc.id });
    }
    if (boardedAt !== null && secondBuggy && !secondBuggy._productionRally &&
        secondBuggy.order?.type === 'move') {
      secondRelease ??= { time: +game.time.toFixed(2), order: { ...secondBuggy.order },
        targetNoLongerVisible: game.getEntity(leader.id)?.embarkedIn === apc.id };
    }
  }

  recorder.dispose();
  assert.ok(firstBuggy && secondBuggy && apc, 'all three paid factory jobs should complete');
  assert.ok(firstBuggyManualOrder && !firstBuggy._productionRally,
    'manual move should remove the first recruit from mobile-rally following');
  assert.ok(observedMovingFollow, 'second recruit should remain on follow while leader changes position');
  assert.ok(boardedAt !== null, 'original leader should board the paid APC');
  assert.ok(secondRelease?.targetNoLongerVisible,
    'remaining recruit should release after the target boards, without depending on hidden passenger coordinates');
  assert.equal(factory.rallyTargetId, null, 'invalid mobile anchor should clear after the leader boards');
  assert.equal(startingCredits - creditsAfterPaidQueues, 450 * 2 + 600,
    'all reinforcement jobs should pay their normal costs at insertion');
  assert.ok(game.credits.player > creditsAfterPaidQueues,
    'ordinary live economy should continue while the paid reinforcements train');
  assert.deepEqual(recorder.commands.map(command => command.method), [
    'setRallyTarget', 'queueUnit', 'queueUnit', 'queueUnit', 'issueMove',
    'issueMove', 'issueMove', 'issueMove', 'issueBoard',
  ]);
  validateSoloReplay(ENVELOPE, recorder.commands, clock.completedTicks, MOBILE_RALLY_RULES_VERSION);
  const playback = createSoloPlayback(ENVELOPE, recorder.commands, clock.completedTicks, MOBILE_RALLY_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(publicSnapshot(playback.game), publicSnapshot(game),
    'the paid rally, changing leader, manual release, boarding fallback and economy must replay exactly');

  return { seconds: +game.time.toFixed(2), startingCredits, creditsAfterPaidQueues, finalCredits: game.credits.player,
    factoryId: factory.id, leaderId: leader.id, leaderEmbarkedIn: leader.embarkedIn,
    firstBuggyId: firstBuggy.id, firstBuggyOrder: firstBuggy.order,
    firstBuggyMetadataCleared: !firstBuggy._productionRally,
    secondBuggyId: secondBuggy.id, secondBuggyOrder: secondBuggy.order,
    secondBuggyMetadataCleared: !secondBuggy._productionRally,
    secondRelease, apcId: apc.id, milestones, commands: recorder.commands, replayMatches: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runMobileRallyPublicPlaytest(), null, 2));
}
