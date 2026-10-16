// Exploratory rules-92 Counterbattery approach probe; currently fails to assemble its screen.
// This is not the successful Siege Anchor playtest. The only state changes are recorded
// player commands and ordinary fixed-step campaign simulation.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { COUNTERBATTERY_RULES_VERSION, createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { SIEGE_ANCHOR_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MISSION_INDEX = 16;
const SEED = 24;
const MAX_SIM_SECONDS = 180;
const MAX_ROUTE_ATTEMPTS = 1;
const PER_ATTEMPT_SECONDS = MAX_SIM_SECONDS;
const PRIOR_FAILED_UNESCORTED_ROUTES = Object.freeze([
  { route: 'north-pass-center', obstacle: 'crawler destroyed while approaching north pass' },
  { route: 'north-pass-upper', obstacle: 'crawler destroyed while approaching north pass' },
  { route: 'north-pass-west', obstacle: 'crawler destroyed while approaching north pass' },
]);
const ENVELOPE = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: SEED,
  scenarioId: 'counterbattery', doctrineId: 'standard', fieldOrderId: 'none', carryoverId: 'none',
  supplyId: 'none', routePayoffId: 'none', campaignVeteran: null };
const ROUTE = { name: 'north-pass-escorted', screen: { x: 35.5, y: 19.5 },
  position: { x: 37.5, y: 18.5 } };

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function fullSerializedState(game) {
  return JSON.parse(game.serialize());
}

function makeGame() {
  const rulesVersion = Math.max(COUNTERBATTERY_RULES_VERSION, SIEGE_ANCHOR_RULES_VERSION);
  const game = createCampaignGame(MISSION_INDEX, ENVELOPE.difficulty, SEED, 'standard', 'none', 'none',
    'none', 'none', null, rulesVersion);
  game.replayVersion = SIEGE_ANCHOR_RULES_VERSION;
  return game;
}

function summarizeEvent(event) {
  return { type: event.type, time: event.time, id: event.id, unitId: event.unitId,
    abilityId: event.abilityId, released: event.released, readyAt: event.readyAt,
    targetId: event.targetId, defId: event.defId, owner: event.owner };
}

function drainNotifications(game, log) {
  // Mirror the live UI notification queue; notifications are observed once and
  // removed from serialized game state on both source and replay.
  const events = game.events.splice(0);
  for (const event of events) {
    if (['unitAbility', 'unitCreated', 'unitLost', 'buildingLost', 'order'].includes(event.type))
      log.push(summarizeEvent(event));
  }
}

function snapshotCheckpoint(game, label, metadata = {}) {
  return { label, time: +game.time.toFixed(3), metadata, serialized: game.serialize() };
}

function runRoute(route) {
  const game = makeGame();
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const notifications = [];
  const checkpoints = {};
  const initialCredits = game.credits.player;
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const spotter = game.buildings.find(building => building.owner === 'player' && building.defId === 'radar');
  const guardian = game.units.find(unit => unit.owner === 'player' && unit.defId === 'guardian' && unit.hp > 0);
  const medic = game.units.find(unit => unit.owner === 'player' && unit.defId === 'medic' && unit.hp > 0);
  const screenUnits = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    ['guardian', 'rifle', 'rocket'].includes(unit.defId));
  assert.ok(factory?.progress >= 1 && spotter?.powered,
    'Counterbattery should expose its paid Factory and powered forward Radar');
  assert.ok(guardian && medic && screenUnits.some(unit => unit.defId === 'rifle') &&
    screenUnits.some(unit => unit.defId === 'rocket'),
    'Counterbattery should expose its starting Guardian, Medic, Rifle and Rocket screen');
  const target = game.visibleEnemies.find(unit => unit.owner === 'enemy' && unit.defId === 'artillery' && unit.y < 26);
  assert.ok(target?.hp > 0, 'the powered forward Radar should reveal the north Siege Crawler');

  const step = () => {
    if (game.time + SOLO_STEP_SECONDS > PER_ATTEMPT_SECONDS + 1e-6)
      return false;
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, MISSION_INDEX, SOLO_STEP_SECONDS, SIEGE_ANCHOR_RULES_VERSION);
    clock.completedTicks++;
    drainNotifications(game, notifications);
    return game.status === 'playing';
  };
  const command = (method, ids, ...args) => {
    game.select(ids);
    return requireOk(game[method](...args), method);
  };

  try {
    command('queueUnit', factory.id, 'artillery', factory.id);
    const creditsAfterQueue = game.credits.player;
    assert.equal(initialCredits - creditsAfterQueue, game.unitDefs.artillery.cost,
      'the normal queue command should pay the full artillery cost immediately');
    command('issueMove', screenUnits.map(unit => unit.id), ROUTE.screen.x, ROUTE.screen.y, true);
    command('issueFollow', medic.id, guardian.id);
    const crawlerIdBefore = new Set(game.units.map(unit => unit.id));
    const closeToScreen = unit => Math.hypot(unit.x - ROUTE.screen.x, unit.y - ROUTE.screen.y) <= 3.5;
    let crawler = null;
    let screenStaged = false;
    while (game.time < PER_ATTEMPT_SECONDS && game.status === 'playing') {
      crawler = game.units.find(unit => unit.owner === 'player' && unit.defId === 'artillery' &&
        !crawlerIdBefore.has(unit.id)) || null;
      const livingScreen = screenUnits.filter(unit => unit.hp > 0);
      screenStaged = guardian.hp > 0 && closeToScreen(guardian) &&
        livingScreen.some(unit => unit.defId === 'rifle' && closeToScreen(unit)) &&
        livingScreen.some(unit => unit.defId === 'rocket' && closeToScreen(unit));
      if (crawler && screenStaged) break;
      if (!step()) break;
    }
    if (!crawler) return { route: route.name, reached: false,
      obstacle: 'paid crawler did not finish within this route budget',
      simulationSeconds: +game.time.toFixed(2), creditsAfterQueue: game.credits.player };
    const creditsAfterProduction = game.credits.player;
    if (!screenStaged) return { route: route.name, reached: false,
      obstacle: 'starting Guardian, Rifle and Rocket did not assemble at the north-pass screen',
      simulationSeconds: +game.time.toFixed(2), crawler: { id: crawler.id, hp: crawler.hp,
        x: +crawler.x.toFixed(2), y: +crawler.y.toFixed(2) },
      screen: screenUnits.map(unit => ({ id: unit.id, defId: unit.defId, hp: +unit.hp.toFixed(1),
        x: +unit.x.toFixed(2), y: +unit.y.toFixed(2), order: structuredClone(unit.order) })) };
    const guardingScreen = screenUnits.filter(unit => unit.hp > 0 && closeToScreen(unit));
    command('issueGuard', guardingScreen.map(unit => unit.id));
    assert.ok(medic.hp > 0 && medic.order.type === 'follow' && medic.order.targetId === guardian.id,
      'the Medic should remain on its normal follow order behind the Guardian');
    checkpoints.screen = snapshotCheckpoint(game, 'screen', { guardianId: guardian.id,
      screenUnits: guardingScreen.map(unit => unit.id), medicId: medic.id, medicOrder: structuredClone(medic.order),
      position: { x: +ROUTE.screen.x.toFixed(2), y: +ROUTE.screen.y.toFixed(2) } });

    const moveResult = command('issueMove', crawler.id, route.position.x, route.position.y);
    assert.ok(moveResult.ok);
    const movementStartedAt = game.time;
    while (game.time < PER_ATTEMPT_SECONDS && game.status === 'playing' && crawler.hp > 0 &&
        Math.hypot(crawler.x - route.position.x, crawler.y - route.position.y) > 0.55) {
      if (!step()) break;
    }
    if (crawler.hp <= 0) return { route: route.name, reached: false,
      obstacle: 'crawler destroyed while approaching north pass', simulationSeconds: +game.time.toFixed(2),
      crawler: { id: crawler.id, hp: crawler.hp, x: +crawler.x.toFixed(2), y: +crawler.y.toFixed(2),
        order: structuredClone(crawler.order) },
      visibleHostilesNearLoss: game.visibleEnemies.filter(enemy => enemy.hp > 0 &&
        Math.hypot(enemy.x - crawler.x, enemy.y - crawler.y) <= 8).map(enemy => ({ id: enemy.id,
          defId: enemy.defId, x: +enemy.x.toFixed(2), y: +enemy.y.toFixed(2) })),
      crawlerLossNotification: notifications.filter(event => event.type === 'unitLost' &&
        event.id === crawler.id).at(-1) || null };
    if (Math.hypot(crawler.x - route.position.x, crawler.y - route.position.y) > 0.55)
      return { route: route.name, reached: false, obstacle: 'crawler could not reach the requested north-pass position' };

    checkpoints.approach = snapshotCheckpoint(game, 'approach', {
      crawlerId: crawler.id, position: { x: crawler.x, y: crawler.y }, targetId: target.id,
      targetDistance: Math.hypot(crawler.x - target.x, crawler.y - target.y),
    });
    assert.ok(game.visibleEnemies.some(enemy => enemy.id === target.id),
      'the target must remain in the visible enemy list at the firing position');
    assert.ok(game.isVisible(target), 'the target must be actually visible under normal fog rules');
    const spotterDistance = Math.hypot(spotter.x + spotter.w / 2 - target.x,
      spotter.y + spotter.h / 2 - target.y);
    assert.ok(spotterDistance <= game.buildingDefs.radar.sight,
      'the powered forward Radar must remain close enough to spot the target');

    command('issueSetTargetPriority', crawler.id, 'vehicles');
    const targetDistance = Math.hypot(crawler.x - target.x, crawler.y - target.y);
    const ordinaryRange = game._unitWeaponRange(crawler, game.unitDefs.artillery.weapon);
    assert.ok(targetDistance > ordinaryRange && targetDistance <= ordinaryRange + 2,
      `target must be outside ordinary range but inside anchored range (${targetDistance.toFixed(2)} vs ${ordinaryRange.toFixed(2)})`);
    command('useUnitAbility', crawler.id, crawler.id, 'siegeAnchor');
    const anchorOrder = structuredClone(crawler.order);
    assert.deepEqual(Object.keys(anchorOrder).sort(), ['facing', 'readyAt', 'type', 'x', 'y']);
    assert.equal(anchorOrder.type, 'siegeAnchor');
    assert.equal(anchorOrder.readyAt, game.time + 2.5);
    assert.equal(crawler.path.length, 0, 'anchoring should stop the crawler without retaining a movement path');
    checkpoints.setup = snapshotCheckpoint(game, 'setup', { crawlerId: crawler.id,
      anchorOrder, targetId: target.id, targetDistance, ordinaryRange, anchoredRange: ordinaryRange + 2,
      spotterId: spotter.id, spotterDistance });

    const targetHpBefore = target.hp;
    while (game.time < anchorOrder.readyAt - 1e-6 && game.time < PER_ATTEMPT_SECONDS &&
        game.status === 'playing' && crawler.hp > 0 && target.hp > 0) {
      if (!step()) break;
    }
    assert.ok(crawler.hp > 0 && target.hp > 0 && crawler.order.type === 'siegeAnchor',
      'the normal setup should complete with the target and crawler alive');
    assert.ok(game.time >= anchorOrder.readyAt);
    assert.equal(game._unitWeaponRange(crawler, game.unitDefs.artillery.weapon), ordinaryRange + 2,
      'the anchor should add exactly two tiles of range after setup');
    assert.equal(crawler.x, anchorOrder.x);
    assert.equal(crawler.y, anchorOrder.y);
    checkpoints.anchored = snapshotCheckpoint(game, 'anchored', { crawlerId: crawler.id,
      targetId: target.id, targetDistance, effectiveRange: ordinaryRange + 2,
      targetHpBefore, spotterId: spotter.id, spotterDistance });

    let projectile = null;
    let contact = null;
    const impactDeadline = Math.min(PER_ATTEMPT_SECONDS, game.time + 22);
    while (game.time < impactDeadline && game.status === 'playing' && crawler.hp > 0 && target.hp > 0) {
      if (!step()) break;
      const fired = game.effects.find(effect => effect.type === 'projectile' &&
        effect.sourceId === crawler.id && effect.targetId === target.id);
      if (fired && !projectile) projectile = { id: fired.id, firedAt: +game.time.toFixed(3),
        targetId: fired.targetId, distance: targetDistance };
      if (projectile && target.hp < targetHpBefore) {
        contact = { time: +game.time.toFixed(3), hpBefore: targetHpBefore, hpAfter: +target.hp.toFixed(2),
          damage: +(targetHpBefore - target.hp).toFixed(2) };
        break;
      }
    }
    assert.ok(projectile, 'the anchored crawler should launch an actual projectile at the visible selected target');
    assert.ok(contact?.damage > 0, 'the crawler projectile should impact and damage its target');
    checkpoints.contact = snapshotCheckpoint(game, 'contact', { crawlerId: crawler.id, targetId: target.id,
      projectile, contact, targetDistance, spotterId: spotter.id, spotterDistance });

    command('issueMove', crawler.id, route.position.x - 1.5, route.position.y + 0.5);
    assert.equal(crawler.order.type, 'move', 'an ordinary new move order should immediately release the anchor');
    assert.equal(crawler.path.length > 0, true, 'the released crawler should begin its ordinary move path');
    checkpoints.released = snapshotCheckpoint(game, 'released', { crawlerId: crawler.id,
      order: structuredClone(crawler.order), position: { x: crawler.x, y: crawler.y } });
    // The release command is timestamped at the current completed tick, so one
    // final fixed step makes it part of the complete replay interval.
    assert.equal(step(), true, 'the campaign should remain playable for the release verification tick');
    recorder.dispose();
    validateSoloReplay(ENVELOPE, recorder.commands, clock.completedTicks, SIEGE_ANCHOR_RULES_VERSION);

    const playback = createSoloPlayback(ENVELOPE, recorder.commands, clock.completedTicks,
      SIEGE_ANCHOR_RULES_VERSION);
    const playbackNotifications = [];
    drainNotifications(playback.game, playbackNotifications);
    for (let tick = 0; tick < clock.completedTicks; tick++) {
      playback.step(1);
      drainNotifications(playback.game, playbackNotifications);
    }
    const sourceState = fullSerializedState(game);
    const playbackState = fullSerializedState(playback.game);
    assert.deepEqual(playbackState, sourceState,
      'the complete parsed serialized campaign state should match after the exact replay');
    assert.deepEqual(playbackNotifications, notifications,
      'source and playback notifications should be consumed with the same UI queue behavior');

    return { reached: true, route: route.name, mission: 'counterbattery', seed: SEED,
      difficulty: 'normal', seconds: +game.time.toFixed(2), completedTicks: clock.completedTicks,
      initialCredits, creditsAfterQueue, creditsAfterProduction, productionCost: initialCredits - creditsAfterQueue,
      factoryId: factory.id, crawlerId: crawler.id, targetId: target.id,
      targetDefId: target.defId, targetDistance: +targetDistance.toFixed(3), ordinaryRange,
      anchoredRange: ordinaryRange + 2, spotter: { id: spotter.id, defId: spotter.defId,
        targetDistance: +spotterDistance.toFixed(3), powered: spotter.powered },
      anchorOrder, projectile, contact, releasedOrder: structuredClone(crawler.order),
      movementElapsed: +(game.time - movementStartedAt).toFixed(2), commands: recorder.commands,
      notifications, replayMatches: true, replayNotificationMatch: true, checkpoints,
      serializedFinalState: game.serialize() };
  } finally {
    recorder.dispose();
  }
}

export function runSiegeAnchorCounterbatteryProbe() {
  assert.ok(MAX_ROUTE_ATTEMPTS <= 3 && PER_ATTEMPT_SECONDS * MAX_ROUTE_ATTEMPTS <= MAX_SIM_SECONDS);
  const attempts = [];
  for (let index = 0; index < MAX_ROUTE_ATTEMPTS; index++) {
    try {
      const result = runRoute(ROUTE);
      attempts.push({ route: result.route, reached: result.reached, obstacle: result.obstacle || null,
        simulationSeconds: result.simulationSeconds, crawler: result.crawler,
        visibleHostilesNearLoss: result.visibleHostilesNearLoss,
        crawlerLossNotification: result.crawlerLossNotification, screen: result.screen });
      if (result.reached) return { mission: 'counterbattery', seed: SEED, difficulty: 'normal',
        maxSimSeconds: MAX_SIM_SECONDS, maxRouteAttempts: MAX_ROUTE_ATTEMPTS,
        priorFailedUnescortedRoutes: PRIOR_FAILED_UNESCORTED_ROUTES, attempts, ...result };
    } catch (error) {
      attempts.push({ route: ROUTE.name, reached: false, obstacle: error.message });
    }
  }
  return { mission: 'counterbattery', seed: SEED, difficulty: 'normal',
    maxSimSeconds: MAX_SIM_SECONDS, maxRouteAttempts: MAX_ROUTE_ATTEMPTS,
    priorFailedUnescortedRoutes: PRIOR_FAILED_UNESCORTED_ROUTES, attempts,
    reached: false, obstacle: attempts.at(-1)?.obstacle || 'no route reached firing contact' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runSiegeAnchorCounterbatteryProbe();
  const { checkpoints, serializedFinalState, ...compact } = result;
  console.log(JSON.stringify({ ...compact,
    checkpoints: Object.fromEntries(Object.entries(checkpoints || {}).map(([key, checkpoint]) =>
      [key, { label: checkpoint.label, time: checkpoint.time, metadata: checkpoint.metadata,
        serializedBytes: Buffer.byteLength(checkpoint.serialized) }])),
    finalSerializedBytes: serializedFinalState ? Buffer.byteLength(serializedFinalState) : 0,
  }, null, 2));
}
