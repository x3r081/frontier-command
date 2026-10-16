// Paired Normal Shard Valley scouting demonstration. Each route starts from
// an untouched skirmish and uses only public selection and movement commands.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Game, UNIT_DEFS, SIEGE_ANCHOR_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MAX_SECONDS = 120;
// Keep this measured route reproducible when newer game rules are introduced.
const SOLO_REPLAY_VERSION = SIEGE_ANCHOR_RULES_VERSION;
const CHECKPOINT_SECONDS = 6;
const POST_CONTACT_SECONDS = 1.5;
export const PATHFINDER_RECON_ROUTES = Object.freeze([
  { seed: 24, destination: [42.5, 16.5] },
  { seed: 25, destination: [42.5, 16.5] },
  { seed: 26, destination: [42.5, 16.5] },
]);

const envelopeFor = route => ({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
  seed: route.seed, scenarioId: 'shard-valley', victoryMode: 'elimination' });

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
}

function parsedSerializedState(game) {
  return JSON.parse(game.serialize());
}

function runRoute(route, tactic) {
  const envelope = envelopeFor(route);
  const game = new Game({ ...envelope, mapId: envelope.scenarioId, replayVersion: SOLO_REPLAY_VERSION });
  const scout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout' && unit.hp > 0);
  assert.ok(scout, 'the untouched Normal skirmish should contain its original Pathfinder');
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const origin = { x: scout.x, y: scout.y };
  const destination = { x: route.destination[0], y: route.destination[1] };
  const scoutShots = [];
  let firstContact = null;
  let preContactCheckpointSerialized = null;
  const originalFire = game._fire.bind(game);
  game._fire = (source, target, weapon) => {
    if (source.id === scout.id) scoutShots.push({ time: +game.time.toFixed(2), targetId: target.id,
      targetDefId: target.defId });
    return originalFire(source, target, weapon);
  };

  game.select(scout.id);
  if (tactic === 'attackMove') requireOk(game.issueMove(destination.x, destination.y, true), 'Attack Move Pathfinder');
  else requireOk(game.issueForceMove(destination.x, destination.y), 'Force Move Pathfinder');

  const checkpointTick = Math.round(CHECKPOINT_SECONDS / SOLO_STEP_SECONDS);
  const maxTicks = Math.round(MAX_SECONDS / SOLO_STEP_SECONDS);
  for (let tick = 0; tick < maxTicks && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;

    if (clock.completedTicks === checkpointTick) {
      assert.equal(firstContact, null, 'the pre-contact checkpoint must be captured before an enemy is visible');
      preContactCheckpointSerialized = game.serialize();
    }

    if (!firstContact) {
      const enemy = game.visibleEnemies.find(entity => entity.owner === 'enemy' && entity.hp > 0);
      if (enemy) firstContact = { time: +game.time.toFixed(2), enemyId: enemy.id,
        enemyDefId: enemy.defId, enemyPosition: { x: +enemy.x.toFixed(2), y: +enemy.y.toFixed(2) },
        scoutPosition: { x: +scout.x.toFixed(2), y: +scout.y.toFixed(2) },
        fogAtContact: game.fog[Math.floor(enemy.y)]?.[Math.floor(enemy.x)] ?? 0 };
    }
    if (firstContact && game.time >= firstContact.time + POST_CONTACT_SECONDS) break;
  }
  recorder.dispose();
  assert.ok(preContactCheckpointSerialized, 'the six-second live pre-contact checkpoint should exist');

  const commands = recorder.commands.map(({ tick, sequence, method, args, selectedIds }) =>
    ({ tick, sequence, method, args, selectedIds }));
  validateSoloReplay(envelope, commands, clock.completedTicks, SOLO_REPLAY_VERSION);
  const playback = createSoloPlayback(envelope, commands, clock.completedTicks, SOLO_REPLAY_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(parsedSerializedState(playback.game), parsedSerializedState(game),
    `${tactic} full serialized game state should replay exactly`);

  const scoutAtEnd = game.getEntity(scout.id);
  return { tactic, route, envelope, seconds: +game.time.toFixed(2), completedTicks: clock.completedTicks,
    scout: { id: scout.id, origin, destination, finalPosition: { x: +scoutAtEnd.x.toFixed(2),
      y: +scoutAtEnd.y.toFixed(2) }, finalHealth: +scoutAtEnd.hp.toFixed(1), orderAtEnd: scoutAtEnd.order,
      shots: scoutShots },
    firstContact, fogRevealedAtContact: firstContact?.fogAtContact === 2,
    destinationDistanceAtContact: firstContact ? +Math.hypot(destination.x - firstContact.scoutPosition.x,
      destination.y - firstContact.scoutPosition.y).toFixed(2) : null,
    destinationDistanceAtEnd: +Math.hypot(destination.x - scoutAtEnd.x, destination.y - scoutAtEnd.y).toFixed(2),
    preContactCheckpoint: { label: 'pathfinder-before-contact', time: CHECKPOINT_SECONDS,
      completedTicks: checkpointTick, serializedBytes: Buffer.byteLength(preContactCheckpointSerialized),
      serialized: preContactCheckpointSerialized },
    commands, replayMatches: true, fullSerializedReplayMatches: true };
}

function isPairedProof(attackMove, forceMove) {
  return attackMove.firstContact?.enemyId === forceMove.firstContact?.enemyId &&
    attackMove.fogRevealedAtContact && forceMove.fogRevealedAtContact &&
    attackMove.scout.shots.length > 0 && forceMove.scout.shots.length === 0 &&
    forceMove.destinationDistanceAtEnd < forceMove.destinationDistanceAtContact;
}

export function runPathfinderReconPlaytest() {
  const attempts = [];
  for (const route of PATHFINDER_RECON_ROUTES) {
    const attackMove = runRoute(route, 'attackMove');
    const forceMove = runRoute(route, 'forceMove');
    assert.equal(attackMove.firstContact?.enemyId, forceMove.firstContact?.enemyId,
      `seed ${route.seed} paired runs should reveal the same first contact`);
    attempts.push({ route, attackMove, forceMove, pairedProof: isPairedProof(attackMove, forceMove) });
    if (attempts.at(-1).pairedProof) break;
  }

  const successful = attempts.find(attempt => attempt.pairedProof);
  const bestForceMove = attempts.find(attempt => attempt.forceMove.fogRevealedAtContact &&
    attempt.forceMove.scout.shots.length === 0 &&
    attempt.forceMove.destinationDistanceAtEnd < attempt.forceMove.destinationDistanceAtContact);
  return { result: successful ? 'paired-behavior-demonstrated' : bestForceMove
      ? 'force-move-scout-and-reveal-only' : 'no-route-demonstrated',
    maxSecondsPerRoute: MAX_SECONDS, attempts: attempts.map(attempt => ({
      route: attempt.route, pairedProof: attempt.pairedProof,
      attackMove: attempt.attackMove, forceMove: attempt.forceMove })),
    pathfinderStats: { maxHealth: UNIT_DEFS.scout.health, speed: UNIT_DEFS.scout.speed,
      sight: UNIT_DEFS.scout.sight, weaponRange: UNIT_DEFS.scout.weapon.range },
    recoveryMetadata: { scenario: 'Normal Aegis Shard Valley skirmish, elimination objective',
      originalOpeningPathfinder: true, modifiedUnitsResourcesTerrainOrAI: false,
      replayVersion: SOLO_REPLAY_VERSION,
      maximumRouteAttempts: PATHFINDER_RECON_ROUTES.length, maximumSecondsPerRoute: MAX_SECONDS,
      checkpointUsage: 'Use preContactCheckpoint.serialized with Game.deserialize(...) to restore the six-second live approach.',
      replayUsage: 'Each route exports its envelope, commands, completedTicks, replay version, and full serialized replay match.' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runPathfinderReconPlaytest();
  const compact = { ...result, attempts: result.attempts.map(attempt => ({
    route: attempt.route, pairedProof: attempt.pairedProof,
    attackMove: { seconds: attempt.attackMove.seconds, firstContact: attempt.attackMove.firstContact,
      fogRevealedAtContact: attempt.attackMove.fogRevealedAtContact,
      shots: attempt.attackMove.scout.shots, orderAtEnd: attempt.attackMove.scout.orderAtEnd,
      destinationDistanceAtContact: attempt.attackMove.destinationDistanceAtContact,
      destinationDistanceAtEnd: attempt.attackMove.destinationDistanceAtEnd,
      preContactCheckpoint: { ...attempt.attackMove.preContactCheckpoint,
        serialized: `[omitted ${attempt.attackMove.preContactCheckpoint.serializedBytes} bytes; available from exported function]` },
      commands: attempt.attackMove.commands, replayMatches: attempt.attackMove.replayMatches },
    forceMove: { seconds: attempt.forceMove.seconds, firstContact: attempt.forceMove.firstContact,
      fogRevealedAtContact: attempt.forceMove.fogRevealedAtContact,
      shots: attempt.forceMove.scout.shots, orderAtEnd: attempt.forceMove.scout.orderAtEnd,
      destinationDistanceAtContact: attempt.forceMove.destinationDistanceAtContact,
      destinationDistanceAtEnd: attempt.forceMove.destinationDistanceAtEnd,
      preContactCheckpoint: { ...attempt.forceMove.preContactCheckpoint,
        serialized: `[omitted ${attempt.forceMove.preContactCheckpoint.serializedBytes} bytes; available from exported function]` },
      commands: attempt.forceMove.commands, replayMatches: attempt.forceMove.replayMatches },
  })) };
  process.stdout.write(`${JSON.stringify(compact, null, 2)}\n`);
}
