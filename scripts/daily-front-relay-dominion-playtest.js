// Bounded public-command playtest for the 2026-10-16 Daily Front contract.
// Uses the ordinary v91 simulation, AI, economy, production and recorded orders.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Game } from '../src/game/engine.js';
import { currentDailyFront } from '../src/game/dailyFront.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const CONTRACT_DATE = '2026-10-16';
const EXPECTED_RULES_VERSION = 91;
const MAX_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 1;

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function bestRevealedBuildSite(game, defId, home) {
  const def = game.buildingDefs[defId];
  let best = null;
  for (let y = 1; y <= game.height - def.h - 1; y++) for (let x = 1; x <= game.width - def.w - 1; x++) {
    let revealed = true;
    for (let yy = y; yy < y + def.h; yy++) for (let xx = x; xx < x + def.w; xx++)
      if (game.fog[yy]?.[xx] !== 2) revealed = false;
    if (!revealed || !game.canPlaceBuilding(defId, x, y).ok) continue;
    const score = Math.hypot(x + def.w / 2 - home.x, y + def.h / 2 - home.y);
    if (!best || score < best.score || score === best.score && (y < best.y || y === best.y && x < best.x))
      best = { x, y, score };
  }
  return best;
}

function runAttempt(attempt, { captureCheckpoints = false } = {}) {
  assert.equal(attempt, 1, 'the winning route should finish on its first attempt');
  const daily = currentDailyFront(Date.parse(`${CONTRACT_DATE}T12:00:00.000Z`), EXPECTED_RULES_VERSION);
  assert.equal(daily.date, CONTRACT_DATE);
  assert.equal(daily.rulesVersion, EXPECTED_RULES_VERSION);
  assert.deepEqual(daily.setup, { mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 1104776032, scenarioId: 'delta-crossing', skirmishOpening: 'established',
    victoryMode: 'dominion', aiCommanderProfileId: 'relay-marshal' });
  const envelope = { mode: 'skirmish', difficulty: daily.setup.difficulty, faction: daily.setup.faction,
    seed: daily.setup.seed, scenarioId: daily.setup.scenarioId, victoryMode: daily.setup.victoryMode,
    skirmishOpening: daily.setup.skirmishOpening, dailyChallengeId: daily.id, dailyChallengeDate: daily.date };
  const game = new Game({ ...daily.setup, mapId: daily.setup.scenarioId, replayVersion: daily.rulesVersion });
  const initialCredits = game.credits.player;
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const commandLog = recorder.commands;
  const events = [];
  const relayTimeline = [];
  const homeBuilding = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const home = { x: homeBuilding.x + homeBuilding.w / 2, y: homeBuilding.y + homeBuilding.h / 2 };
  const relayKnowledge = new Map(game.relays.map(relay => [relay.id, null]));
  const eventTypes = new Set(['relayCaptured', 'relayNeutralized', 'relayDominionStarted',
    'relayDominionBroken', 'relayDominionComplete', 'unitReady', 'constructionReady', 'victory', 'defeat']);
  let contactCheckpoint = false;
  let nearWinCheckpoint = null;
  game.onEvent = event => {
    if (!eventTypes.has(event.type)) return;
    if (['unitReady', 'constructionReady'].includes(event.type) && event.owner !== 'player') return;
    events.push({ time: +event.time.toFixed(1), type: event.type, owner: event.owner || null,
      relayId: event.id || null, defId: event.defId || null });
    if (event.type.startsWith('relay')) relayTimeline.push(events.at(-1));
    if (event.type === 'relayDominionStarted' && event.owner === 'player')
      relayTimeline.push({ time: +event.time.toFixed(1), type: 'dominion-start', owner: 'player' });
    if (event.type === 'victory') relayTimeline.push({ time: +event.time.toFixed(1), type: 'win', winner: event.winner });
  };

  const advance = () => {
    if (clock.completedTicks >= Math.floor(MAX_SECONDS / SOLO_STEP_SECONDS))
      throw new Error(`Simulation reached the ${MAX_SECONDS}-second cap.`);
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
    if (!nearWinCheckpoint && game.relayDominion?.owner === 'player' && game.relayDominion.elapsed >= 75) {
      nearWinCheckpoint = { ...(captureCheckpoints ? { game: game.serialize(),
        completedTicks: clock.completedTicks,
        dailyChallenge: { id: daily.id, date: daily.date, rulesVersion: daily.rulesVersion } } : {}) };
      relayTimeline.push({ time: +game.time.toFixed(1), type: 'near-win',
        dominionElapsed: +game.relayDominion.elapsed.toFixed(1), owner: game.relayDominion.owner });
    }
  };
  const move = (units, point) => {
    if (!units.length) return;
    game.select(units.map(unit => unit.id));
    requireOk(game.issueMove(point.x, point.y, true), 'move selected force');
  };
  const armyUnits = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
    ['buggy', 'lightTank', 'guardian', 'stealthTank', 'rifle', 'rocket', 'scout', 'flamer'].includes(unit.defId));
  const knownOwner = relay => game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2 ? relay.owner : relayKnowledge.get(relay.id);

  let nextOrders = 0;
  let nextProduction = 8;
  let nextConstruction = 8;
  let nextCheckpoint = 30;
  let constructionFor = null;
  let queuedExtraHarvesters = 0;
  let assaultStarted = false;
  const sentToRelay = new Map();
  const commandCountAtStart = commandLog.length;

  // The route uses real scouting, relay ownership visible through player fog,
  // ordinary attack/move commands, and paid queues/construction.
  while (game.status === 'playing' && game.time < MAX_SECONDS) {
    if (game.time >= nextOrders) {
      nextOrders = game.time + 8;
      for (const relay of game.relays) if (game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2)
        relayKnowledge.set(relay.id, relay.owner);
      const army = armyUnits();
      const enemies = game.visibleEnemies.filter(entity => entity.owner === 'enemy' && entity.hp > 0);
      const knownEnemyMajority = [...relayKnowledge.values()].filter(owner => owner === 'enemy').length >= 2;
      if (game.time >= 24 && army.length >= 3) assaultStarted = true;

      if (enemies.length && !contactCheckpoint) {
        contactCheckpoint = true;
        relayTimeline.push({ time: +game.time.toFixed(1), type: 'contact', visibleEnemyCount: enemies.length,
          playerArmy: army.length });
      }
      if (enemies.length && army.length) {
        const target = [...enemies].sort((a, b) => {
          const center = { x: game.width / 2, y: game.height / 2 };
          return Math.hypot((a.x + (a.w || 0) / 2) - center.x, (a.y + (a.h || 0) / 2) - center.y) -
            Math.hypot((b.x + (b.w || 0) / 2) - center.x, (b.y + (b.h || 0) / 2) - center.y);
        })[0];
        const tx = target.x + (target.w || 0) / 2, ty = target.y + (target.h || 0) / 2;
        const attackers = army.filter(unit => Math.hypot(unit.x - tx, unit.y - ty) < 9);
        if (attackers.length) {
          game.select(attackers.map(unit => unit.id));
          game.issueAttack(target.id);
        }
      }

      const sendCounts = new Map();
      for (const unit of army) {
        const ranked = [...game.relays].sort((a, b) => {
          const rank = owner => knownEnemyMajority
            ? owner === 'enemy' ? 0 : owner === 'player' ? 2 : 1
            : owner === 'player' ? 2 : owner === 'enemy' ? 0 : 1;
          return rank(knownOwner(a)) - rank(knownOwner(b)) ||
            (sentToRelay.get(a.id) || 0) - (sentToRelay.get(b.id) || 0) ||
            Math.hypot(unit.x - a.x, unit.y - a.y) - Math.hypot(unit.x - b.x, unit.y - b.y);
        });
        const relay = ranked[0];
        if (!relay) continue;
        sendCounts.set(relay.id, (sendCounts.get(relay.id) || 0) + 1);
        if (Math.hypot(unit.x - relay.x, unit.y - relay.y) > 2 &&
            (unit.order?.type !== 'move' || Math.hypot(unit.order.x - relay.x, unit.order.y - relay.y) > 2))
          move([unit], relay);
      }
      for (const [relayId, count] of sendCounts) sentToRelay.set(relayId, count);
    }

    if (game.time >= nextProduction) {
      nextProduction = game.time + 7;
      const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
      const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
      if (barracks?.queue.length < 2) {
        if (game.canQueueUnit('rocket').ok) game.queueUnit('rocket', barracks.id);
        else if (game.canQueueUnit('rifle').ok) game.queueUnit('rifle', barracks.id);
      }
      if (factory?.queue.length < 2) {
        const harvesters = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && unit.defId === 'harvester').length +
          factory.queue.filter(item => item.defId === 'harvester').length;
        if (harvesters < 3 && queuedExtraHarvesters < 2 && game.canQueueUnit('harvester').ok) {
          if (game.queueUnit('harvester', factory.id).ok) queuedExtraHarvesters++;
        } else if (game.canQueueUnit('lightTank').ok) game.queueUnit('lightTank', factory.id);
      }
    }

    if (game.time >= nextConstruction) {
      nextConstruction = game.time + 7;
      if (game.construction?.ready && constructionFor) {
        const site = bestRevealedBuildSite(game, constructionFor, home);
        if (site && game.issueBuild(constructionFor, site.x, site.y).ok) constructionFor = null;
      }
      if (!game.construction) {
        const wanted = game.hasBuilding('player', 'refinery') && game.buildings.filter(building =>
          building.owner === 'player' && building.defId === 'refinery').length < 2 ? 'refinery'
          : game.buildings.some(building => building.owner === 'player' && building.defId === 'refinery') &&
            game.buildings.filter(building => building.owner === 'player' && ['power', 'advancedPower'].includes(building.defId)).length < 2
            ? 'power' : null;
        if (wanted && game.canBuild(wanted).ok && game.startConstruction(wanted).ok) constructionFor = wanted;
      }
    }

    if (game.time >= nextCheckpoint) {
      nextCheckpoint += 30;
      const stable = game.relays.filter(relay => relayKnowledge.get(relay.id) === 'player' && !relay.contested);
      const captureRing = stable.filter(relay => armyUnits().some(unit => !unit.embarkedIn &&
        Math.hypot(unit.x - relay.x, unit.y - relay.y) <= 2.3)).length;
      // Keep an actionable checkpoint without inspecting hidden enemy state.
      relayTimeline.push({ time: +game.time.toFixed(0), type: 'checkpoint',
        playerRelays: stable.map(relay => relay.id), unitsInRelayRadius: captureRing,
        army: armyUnits().length, credits: Math.round(game.credits.player) });
    }
    advance();
  }

  recorder.dispose();
  const outcome = { attempt, date: daily.date, challengeId: daily.id, rulesVersion: daily.rulesVersion,
    setup: daily.setup, status: game.status, winner: game.winner || null, seconds: +game.time.toFixed(2),
    maxSeconds: MAX_SECONDS, initialCredits: Math.round(initialCredits), finalCredits: Math.round(game.credits.player),
    playerUnits: game.units.filter(unit => unit.owner === 'player' && unit.hp > 0).length,
    playerBuildings: game.buildings.filter(building => building.owner === 'player' && building.hp > 0)
      .map(building => building.defId),
    relayOwners: game.relays.map(relay => ({ id: relay.id, owner: relay.owner,
      lastObservedOwner: relayKnowledge.get(relay.id) })), events, checkpoints: relayTimeline,
    commandCount: commandLog.length - commandCountAtStart,
    commandCounts: Object.fromEntries([...new Set(commandLog.map(command => command.method))]
      .map(method => [method, commandLog.filter(command => command.method === method).length])) };
  if (captureCheckpoints) outcome.nearWinCheckpoint = nearWinCheckpoint;

  validateSoloReplay(envelope, commandLog, clock.completedTicks, daily.rulesVersion);
  const playback = createSoloPlayback(envelope, commandLog, clock.completedTicks, daily.rulesVersion);
  playback.step(clock.completedTicks);
  // Match the UI's ordinary notification consumption before comparing the
  // serialized simulation. This drains only the presentation event feed.
  game.events.splice(0);
  playback.game.events.splice(0);
  const replayState = JSON.parse(playback.game.serialize()), directState = JSON.parse(game.serialize());
  assert.ok(isDeepStrictEqual(replayState, directState),
    'the full Daily Front replay must match the exact parsed serialized simulation state');
  outcome.replayMatches = true;
  outcome.completedTicks = clock.completedTicks;
  if (game.status === 'victory') assert.equal(game.winner, 'player');
  return outcome;
}

export function runDailyFrontPlaytest({ captureCheckpoints = false } = {}) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = runAttempt(attempt, { captureCheckpoints });
    attempts.push(result);
    if (result.status !== 'playing') break;
  }
  return { maxAttempts: MAX_ATTEMPTS, attempts, result: attempts.at(-1) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runDailyFrontPlaytest(), null, 2));
}
