// Bounded public-order proof for simultaneous, separated tactical damage fronts.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { SIEGE_ANCHOR_RULES_VERSION } from '../src/game/engine.js';
import { createSoloRecorder, createSoloPlayback } from '../src/game/replay.js';
import { createTacticalDamageMonitor } from '../src/game/tacticalDamage.js';
import { createTacticalFronts } from '../src/game/tacticalFronts.js';

const VERSION = SIEGE_ANCHOR_RULES_VERSION;
const ENVELOPE = { mode: 'campaign', scenarioId: 'dawnfall', difficulty: 'normal',
  faction: 'aegis', seed: 941 };
const ROUTES = [
  [['u10', 26.5, 34.5], ['u11', 37.5, 24.5]],
  [['u10', 34.5, 37.5], ['u11', 42.5, 25.5]],
  [['u10', 37.5, 24.5], ['u11', 29.5, 37.5]],
];
const MAX_TICKS = 120 * 30;
const CHECKPOINT_LEAD_TICKS = 45;
const HISTORY_TICKS = CHECKPOINT_LEAD_TICKS + 8;

function runAttempt(route, routeIndex) {
  const game = createCampaignGame(6, 'normal', 941, 'standard', 'none', 'none', 'none', 'none', null, VERSION);
  game.replayVersion = VERSION;
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const monitor = createTacticalDamageMonitor();
  const fronts = createTacticalFronts();
  const history = [];
  const alerts = [];
  let proof = null;
  let recoveryApproachIssued = false;

  try {
    monitor.observeAll(game); // Seed the monitor's baseline from the authored deployment.
    for (const [unitId, x, y] of route) {
      game.select([unitId]);
      const result = game.issueMove(x, y, true); // Public attack-move orders on separate forward routes.
      assert.equal(result.ok, true, `route ${routeIndex + 1} order for ${unitId}: ${result.reason || ''}`);
    }

    while (clock.completedTicks < MAX_TICKS && game.status === 'playing' && !proof) {
      if (!recoveryApproachIssued && game.time >= 42) {
        // Keep a public route order live in the eventual recovery checkpoint.
        game.select(['u10']);
        const result = game.issueMove(48.5, 39.5, true);
        assert.equal(result.ok, true, `recovery approach order: ${result.reason || ''}`);
        recoveryApproachIssued = true;
      }
      history.push({ game: game.serialize(), completedTicks: clock.completedTicks, time: game.time });
      if (history.length > HISTORY_TICKS) history.shift();

      game.update(1 / 30);
      updateCampaign(game, 6, 1 / 30, VERSION);
      clock.completedTicks += 1;

      const observed = monitor.observeAll(game);
      if (observed.length) {
        const entries = fronts.ingest(observed, game.time);
        const targetTime = game.time - CHECKPOINT_LEAD_TICKS / 30;
        const saved = [...history].reverse().find((entry) => entry.time <= targetTime + 1e-8) || null;
        for (const alert of observed) alerts.push({ at: game.time, id: alert.id,
          kind: alert.kind, defId: alert.defId, x: alert.x, y: alert.y, checkpoint: saved });

        const recent = alerts.filter((alert) => game.time - alert.at <= 12);
        outer: for (let i = 0; i < recent.length; i += 1) {
          for (let j = i + 1; j < recent.length; j += 1) {
            if (recent[i].id === recent[j].id) continue;
            const distance = Math.hypot(recent[i].x - recent[j].x, recent[i].y - recent[j].y);
            if (distance > 5 && (recent[i].checkpoint || recent[j].checkpoint)) {
              proof = { first: recent[i], second: recent[j], distance,
                activeFronts: entries.length,
                checkpoint: recent[i].checkpoint || recent[j].checkpoint };
              break outer;
            }
          }
        }
      }
      game.events.splice(0);
    }

    const playback = createSoloPlayback(ENVELOPE, recorder.commands, clock.completedTicks, VERSION);
    playback.step(clock.completedTicks);
    playback.game.events.splice(0);
    game.events.splice(0);
    const replayMatches = isDeepStrictEqual(JSON.parse(playback.game.serialize()), JSON.parse(game.serialize()));
    assert.ok(replayMatches, `route ${routeIndex + 1} full parsed replay state matches after event consumption`);

    return {
      routeIndex: routeIndex + 1,
      seconds: +game.time.toFixed(3),
      status: game.status,
      proof: proof && { first: { ...proof.first, checkpoint: undefined },
        second: { ...proof.second, checkpoint: undefined },
        distance: +proof.distance.toFixed(3), activeFronts: proof.activeFronts },
      alertCount: alerts.length,
      alerts,
      commands: recorder.commands,
      completedTicks: clock.completedTicks,
      replayMatches,
      checkpoint: proof?.checkpoint ? {
        game: proof.checkpoint.game,
        completedTicks: proof.checkpoint.completedTicks,
        seconds: +proof.checkpoint.time.toFixed(3),
      } : null,
    };
  } finally {
    recorder.dispose();
  }
}

export function runTacticalFrontsDawnfallPlaytest() {
  const attempts = [];
  for (let i = 0; i < ROUTES.length; i += 1) {
    const attempt = runAttempt(ROUTES[i], i);
    attempts.push(attempt);
    if (attempt.proof && attempt.checkpoint) {
      return {
        summary: { success: true, version: VERSION, envelope: ENVELOPE,
          routeAttempt: attempt.routeIndex, seconds: attempt.seconds,
          proof: attempt.proof, replayMatches: attempt.replayMatches },
        checkpoint: {
          game: attempt.checkpoint.game,
          gameSeconds: attempt.checkpoint.seconds,
          simulationTick: attempt.checkpoint.completedTicks,
          completedTicks: attempt.checkpoint.completedTicks,
          faction: 'aegis', difficulty: 'normal', groups: {},
          mode: 'campaign', missionIndex: 6,
          doctrineId: 'standard', fieldOrderId: 'none', carryoverId: 'none',
          supplyId: 'none', routePayoffId: 'none',
        },
        commands: attempt.commands,
      };
    }
  }
  return {
    summary: { success: false, reason: 'No two distinct own-force damage alerts more than five tiles apart occurred within twelve seconds in three bounded routes.',
      version: VERSION, envelope: ENVELOPE,
      attempts: attempts.map(({ routeIndex, seconds, status, proof, alertCount, alerts, completedTicks, replayMatches }) =>
        ({ routeIndex, seconds, status, proof, alertCount,
          alerts: alerts.map(({ at, id, kind, defId, x, y }) => ({ at, id, kind, defId, x, y })),
          completedTicks, replayMatches })) },
    checkpoint: null,
    commands: attempts.map(({ routeIndex, commands }) => ({ routeIndex, commands })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runTacticalFrontsDawnfallPlaytest();
  const compact = { ...result,
    checkpoint: result.checkpoint && { completedTicks: result.checkpoint.completedTicks,
      simulationTick: result.checkpoint.simulationTick,
      gameSeconds: result.checkpoint.gameSeconds,
      mode: result.checkpoint.mode, missionIndex: result.checkpoint.missionIndex,
      bytes: result.checkpoint.game.length },
    commands: Array.isArray(result.commands) && result.commands.length && result.commands[0]?.commands
      ? result.commands.map((entry) => ({ routeIndex: entry.routeIndex, count: entry.commands.length }))
      : { count: result.commands.length },
  };
  console.log(JSON.stringify(compact, null, 2));
}
