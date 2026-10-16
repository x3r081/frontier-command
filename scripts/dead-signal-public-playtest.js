// Rules-90 Dead Signal public-command routes: source contest and shelter response.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createCampaignGame, DEAD_SIGNAL_RULES_VERSION, getCampaignFieldOrderView, getDeadSignalView, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const ENVELOPE = { mode: 'campaign', difficulty: 'normal', faction: 'vesper', seed: 41090,
  scenarioId: 'dead-signal' };
const HZ = Math.round(1 / SOLO_STEP_SECONDS);
const MAX_SECONDS = 210;

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function snapshot(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, relays: game.relays,
    credits: game.credits, terrain: game.terrain, effects: game.effects, storm: game.storm,
    commandEnergy: game.commandEnergy, commandCooldowns: game.commandCooldowns, time: game.time,
    status: game.status, winner: game.winner, campaignState: game.campaignState,
    campaignComplete: game.campaignComplete, campaignResult: game.campaignResult });
}

function makeGame(fieldOrderId) {
  const game = createCampaignGame(17, ENVELOPE.difficulty, ENVELOPE.seed,
    'standard', fieldOrderId, 'none', 'none', 'none', null, DEAD_SIGNAL_RULES_VERSION);
  game.replayVersion = DEAD_SIGNAL_RULES_VERSION;
  return game;
}

function runRoute(response) {
  const fieldOrderId = response === 'contest' ? 'dead-signal-intercept' : 'dead-signal-signal';
  const routeEnvelope = { ...ENVELOPE, fieldOrderId };
  const game = makeGame(fieldOrderId);
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const checkpoints = { opening: game.serialize() };
  const view = getDeadSignalView(game);
  const striker = game.getEntity(game.campaignState.strikerId);
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  const scout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  const armed = game.units.filter(unit => unit.owner === 'player' && game.unitDefs[unit.defId]?.weapon).map(unit => unit.id);
  const shelter = view.shelterRelay;
  const source = view.sourceRelay;
  assert.ok(striker && engineer && scout && armed.length >= 4, 'the fixed Vesper force should include the key vehicle and its support team');
  const responseLog = [];
  const damageLog = [];
  const originalApplyDamage = game._applyDamage.bind(game);
  game._applyDamage = (target, damage, damageType, attackerOwner, sourceId, sourcePosition, ...rest) => {
    const before = target?.hp;
    const result = originalApplyDamage(target, damage, damageType, attackerOwner, sourceId, sourcePosition, ...rest);
    const actual = Number.isFinite(before) && Number.isFinite(target?.hp) ? Math.max(0, before - target.hp) : 0;
    if (actual > 0 && target.owner === 'player') damageLog.push({ time: +game.time.toFixed(2), target: target.id,
      defId: target.defId || target.type, sourceId: sourceId ?? null, attackerOwner: attackerOwner ?? null,
      damageType, damage: +actual.toFixed(1), hp: +target.hp.toFixed(1) });
    return result;
  };
  const originalCreateUnit = game._createUnit.bind(game);
  const unitCreationLog = [];
  game._createUnit = (owner, defId, x, y, order, ...rest) => {
    const unit = originalCreateUnit(owner, defId, x, y, order, ...rest);
    if (owner === 'enemy') unitCreationLog.push({ time: +game.time.toFixed(2), id: unit.id, defId, x: +x.toFixed(1), y: +y.toFixed(1) });
    return unit;
  };
  let currentDirectTargetId = null;
  let sourceOrderIssued = false;
  let engineerFollowStopped = false;
  let pushedToSource = false;
  const issueMove = (ids, x, y, attackMove = false, label = 'move') => {
    game.select(ids);
    requireOk(game.issueMove(x, y, attackMove), label);
    responseLog.push({ time: +game.time.toFixed(2), label, ids: [...ids], x, y, attackMove });
  };
  const step = () => {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 17, SOLO_STEP_SECONDS, DEAD_SIGNAL_RULES_VERSION);
    clock.completedTicks++;
    if (!engineerFollowStopped && engineer.fieldRepairKits === 1 && engineer.order?.type === 'follow') {
      game.select([engineer.id]);
      requireOk(game.issueStop(), 'stop the Engineer after spending one repair kit');
      responseLog.push({ time: +game.time.toFixed(2), label: 'stop Engineer Follow with one kit remaining' });
      issueMove([engineer.id], 10.5, 36.5, false, 'retreat Engineer to the rear service area');
      engineerFollowStopped = true;
    }
    if (!checkpoints.shelter && (game.campaignState.callStatus === 'cancelled' || game.storm.lure?.pulseResolved))
      checkpoints.shelter = game.serialize();
    if (!checkpoints.nearWin && game.campaignState.holdElapsed >= 5)
      checkpoints.nearWin = game.serialize();
    if (game.campaignState.callThreatEnded && game.status === 'playing') {
      const target = game.visibleEnemies.filter(enemy => !enemy.w && enemy.hp > 0 &&
        game.unitDefs[enemy.defId]?.weapon && Math.hypot(enemy.x - source.x, enemy.y - source.y) <= 9)
        .sort((a, b) => (a.defId === 'lightTank' ? 0 : a.defId === 'rocket' ? 1 : 2) -
          (b.defId === 'lightTank' ? 0 : b.defId === 'rocket' ? 1 : 2) ||
          Math.hypot(a.x - source.x, a.y - source.y) - Math.hypot(b.x - source.x, b.y - source.y))[0];
      if (target && target.id !== currentDirectTargetId) {
        const aliveArmed = armed.filter(id => game.getEntity(id)?.hp > 0);
        if (aliveArmed.length) {
          game.select(aliveArmed);
          requireOk(game.issueAttack(target.id), 'attack the visible relay guard');
          currentDirectTargetId = target.id;
          sourceOrderIssued = false;
          responseLog.push({ time: +game.time.toFixed(2), label: 'attack visible guard', targetId: target.id,
            targetDefId: target.defId, x: +target.x.toFixed(1), y: +target.y.toFixed(1) });
          checkpoints.contact ||= game.serialize();
        }
      } else if (!target) {
        currentDirectTargetId = null;
        const aliveArmed = armed.filter(id => game.getEntity(id)?.hp > 0);
        if (aliveArmed.length && !sourceOrderIssued) {
          game.select(aliveArmed);
          requireOk(game.issueMove(source.x, source.y, true), 'continue attack-moving to the source relay');
          responseLog.push({ time: +game.time.toFixed(2), label: 'continue attack-move to source after contact' });
          sourceOrderIssued = true;
          pushedToSource = true;
        }
      }
    }
  };

  game.select([engineer.id]);
  requireOk(game.issueFollow(striker.id), 'keep the Engineer with the Striker');
  if (response === 'contest') {
    issueMove([scout.id], source.x, source.y, false, 'contest source before pulse');
    issueMove(armed.filter(id => id !== scout.id), shelter.x, shelter.y, false,
      'rally the armed force at the friendly shelter relay');
    checkpoints.armed = game.serialize();
    while (!['cancelled', 'preempted'].includes(game.campaignState.callStatus) &&
        game.time < 8 && game.status === 'playing') step();
    assert.ok(['cancelled', 'preempted'].includes(game.campaignState.callStatus),
      'the Scout should contest the source before the ordinary pulse');
    issueMove([scout.id], shelter.x, shelter.y, false, 'withdraw source-contesting Scout');
    responseLog.push({ time: +game.time.toFixed(2), label: 'Stormcall canceled before pulse' });
  } else {
    issueMove(armed, shelter.x, shelter.y, false, 'shelter the armed force through the Stormcall');
    checkpoints.armed = game.serialize();
    while (!(game.storm.lure?.pulseResolved || game.campaignState.callStatus === 'fired') &&
        game.time < 18 && game.status === 'playing') step();
    assert.equal(game.campaignState.callStatus, 'fired', 'the ordinary Stormcall pulse should resolve');
    responseLog.push({ time: +game.time.toFixed(2), label: 'Force sheltered through Stormcall pulse' });
  }
  while (game.storm.phase !== 'recovery' && game.time < 40 && game.status === 'playing') step();
  assert.equal(game.storm.phase, 'recovery', 'the ion front should pass before the relay hold begins');
  const deadlineTicks = Math.round(MAX_SECONDS * HZ);
  while (clock.completedTicks < deadlineTicks && game.status === 'playing') step();
  recorder.dispose();

  assert.ok(game.campaignComplete, `${response} response should complete the objective with ordinary public commands`);
  assert.equal(getCampaignFieldOrderView(game)?.status, 'completed',
    `${response} route should complete its selected optional Field Order`);
  checkpoints.victory = game.serialize();

  validateSoloReplay(routeEnvelope, recorder.commands, clock.completedTicks, DEAD_SIGNAL_RULES_VERSION);
  const playback = createSoloPlayback(routeEnvelope, recorder.commands, clock.completedTicks,
    DEAD_SIGNAL_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(snapshot(playback.game), snapshot(game), `${response} response must replay exactly`);
  assert.deepEqual(playback.game.serialize(), game.serialize(), `${response} response must reproduce the full serialized state`);
  return { response, outcome: game.campaignComplete ? 'victory' : game.status,
    elapsed: +game.campaignState.elapsed.toFixed(2), seconds: +game.time.toFixed(2),
    callStatus: game.campaignState.callStatus, holdElapsed: +game.campaignState.holdElapsed.toFixed(2),
    sourceOwner: game.relays.find(relay => relay.id === source.id)?.owner,
    strikerHp: +(game.getEntity(striker.id)?.hp || 0).toFixed(1), engineerKits: engineer.fieldRepairKits,
    fieldOrder: getCampaignFieldOrderView(game),
    kills: game.kills.player, survivors: game.units.filter(unit => unit.owner === 'player' && unit.hp > 0).length,
    commands: recorder.commands, responseLog, damageLog, unitCreationLog, pushedToSource,
    checkpoints, replayMatches: true, fullSerializedReplayMatches: true };
}

export function runDeadSignalPublicPlaytest() {
  return { mission: 'dead-signal', rulesVersion: DEAD_SIGNAL_RULES_VERSION,
    routes: [runRoute('contest'), runRoute('shelter')] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runDeadSignalPublicPlaytest();
  console.log(JSON.stringify({ mission: result.mission, rulesVersion: result.rulesVersion,
    routes: result.routes.map(route => ({ response: route.response, outcome: route.outcome, elapsed: route.elapsed,
      callStatus: route.callStatus, holdElapsed: route.holdElapsed, sourceOwner: route.sourceOwner,
      strikerHp: route.strikerHp, kills: route.kills, survivors: route.survivors, engineerKits: route.engineerKits,
      fieldOrderStatus: route.fieldOrder?.status, replayMatches: route.fullSerializedReplayMatches,
      commandCount: route.commands.length, responseLog: route.responseLog,
      casualties: route.damageLog.filter(item => item.hp === 0), checkpointNames: Object.keys(route.checkpoints) })) }, null, 2));
}
