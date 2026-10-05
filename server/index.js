import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, UNIT_DEFS, BUILDING_DEFS, SKIRMISH_MAPS, AI_COMMANDER_PROFILES,
  aiCommanderProfileForSeed } from '../src/game/engine.js';
import { CAMPAIGN_MISSIONS, CAMPAIGN_DOCTRINES, CAMPAIGN_FIELD_ORDERS, CAMPAIGN_CARRYOVERS,
  CAMPAIGN_SUPPLIES, CAMPAIGN_ROUTE_PAYOFFS, getCampaignCarryoverUnlocks, getCampaignRequisitionBalance } from '../src/game/campaign.js';
import { validateCampaignVeteran, campaignVeteranSourceIds } from '../src/game/campaignVeteran.js';
import { validateSoloEnvelope, validateSoloReplay, MAX_SOLO_TICKS, SOLO_REPLAY_VERSION } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dataFile = process.env.FRONTIER_DATA_FILE || path.join(here, 'data.json');
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const token = () => randomBytes(32).toString('base64url');
const id = () => randomBytes(12).toString('hex');
const code = (length = 8) => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => Date.now();
// Ranked scores must use the same deterministic rules as the replay verifier.
const SCORE_VERSION = SOLO_REPLAY_VERSION;
// Multiplayer rating seasons are independent of solo replay versions.
// Increment only when ranked multiplayer balance or rules change.
const RANKED_SEASON = 52;
// Version 36 changed both solo modes through faction field actions. Version 42
// changed Last Light's victory rule; version 43 changes Ashes in Transit and skirmish AI.
// Version 44 changes Canyon Ring variant 1 terrain in solo and ranked multiplayer.
// Version 45 changes skirmish AI across all maps. Version 46 changes only the
// Red Ledger branch objectives. Version 47 adds deterministic AI commander
// profiles. Version 48 changes Raider reconnaissance and the Ashes in Transit
// uplink route payoff. Version 49 adds Logistics to the relay economy and AI.
// It can affect economic campaign sorties; v50 changes skirmish economy rules.
// Version 51 changes Ashes in Transit route-specific tactical rules. Skirmish
// results remain on v50 and economic campaign results remain on v49.
// Version 54 adds a defended-economy raid to First Harvest and fixes Siege
// Director's outpost expansion. Their older completions are no longer comparable.
// Version 55 turns Iron Current's final wave into a freight-relay assault;
// its public board starts at v55. Version 56 makes solo skirmish Harvesters
// retreat from visible ground threats, resetting all skirmish comparison floors.
// Queued orders enter solo replay verification and ranked multiplayer in v56;
// the latter starts Season 51. Version 57 corrects obstructed combat pursuit in
// both solo modes and multiplayer, and rebalances Shard Valley's starting crystal.
// Every solo public comparison floor restarts at 57; multiplayer starts Season 52.
const comparableRankedScore = score => Number.isInteger(score.scoreVersion) &&
  (score.mode === 'skirmish' ? score.scoreVersion >= 57 &&
      score.scoreVersion <= SCORE_VERSION &&
      AI_COMMANDER_PROFILES.some(commander => commander.id === score.aiCommanderProfileId)
    : score.mode === 'campaign' && score.scoreVersion >= 57 &&
        score.scoreVersion <= SCORE_VERSION);
const MAX_REPLAY_BODY_BYTES = 1_000_000;
const MAX_VERIFICATIONS = 2;
const MAX_HISTORY_RECORDS = 10_000;
const MAX_MULTIPLAYER_HISTORY_RECORDS = 10_000;
const VERIFY_TIMEOUT_MS = 30_000;
const verifyingRuns = new Set();
let activeVerifications = 0;
const scoreValue = score => Math.max(0, Math.round(5000 * ({ easy: 1, normal: 1.5, hard: 2 }[score.difficulty] || 1)
  - score.seconds * 3));
const validFieldOrder = (scenarioId, fieldOrderId) => fieldOrderId === 'none' ||
  CAMPAIGN_FIELD_ORDERS[CAMPAIGN_MISSIONS.findIndex(mission => mission.id === scenarioId)]
    ?.some(order => order.id === fieldOrderId) === true;
const knownFieldOrder = fieldOrderId => fieldOrderId === 'none' ||
  CAMPAIGN_FIELD_ORDERS.some(orders => orders.some(order => order.id === fieldOrderId));
const knownSupply = supplyId => CAMPAIGN_SUPPLIES.some(supply => supply.id === supplyId);
// Campaign progression is a ranked entitlement, so derive it from verified
// victories on this profile and difficulty rather than trusting the browser's
// local unlock counter. Pre-fork archives (rules < 30) retain their old linear
// route; completing Black Shard under the fork rules requires a branch victory.
function verifiedCampaignMissionIds(profileId, difficulty) {
  return store.scores.filter(score => score.profileId === profileId && score.mode === 'campaign' &&
    score.difficulty === difficulty && score.verified === true && score.result !== 'defeat' &&
    Number.isInteger(score.scoreVersion) && score.scoreVersion >= 4 && score.scoreVersion <= SCORE_VERSION &&
    CAMPAIGN_MISSIONS.some(mission => mission.id === score.scenarioId && mission.faction === score.faction))
    .map(score => score.scenarioId);
}
function verifiedCampaignScoresForProfile(profileId, difficulty) {
  return store.scores.filter(score => score.profileId === profileId && score.mode === 'campaign' &&
    score.difficulty === difficulty && score.verified === true && score.result !== 'defeat' &&
    Number.isInteger(score.scoreVersion) && score.scoreVersion >= 4 && score.scoreVersion <= SCORE_VERSION &&
    CAMPAIGN_MISSIONS.some(mission => mission.id === score.scenarioId && mission.faction === score.faction));
}
function campaignProgressForProfile(profileId, difficulty) {
  const scores = verifiedCampaignScoresForProfile(profileId, difficulty);
  const completed = new Set(scores.map(score => score.scenarioId));
  const legacyMax = scores.filter(score => score.scoreVersion < 30)
    .reduce((max, score) => Math.max(max, CAMPAIGN_MISSIONS.findIndex(mission => mission.id === score.scenarioId)), -1);
  const medalsByMission = {};
  const fieldOrdersByMission = {};
  for (const score of scores) {
    const stars = Number.isInteger(score.campaignStars) && score.campaignStars >= 1 && score.campaignStars <= 3
      ? score.campaignStars : 1;
    medalsByMission[score.scenarioId] = Math.max(medalsByMission[score.scenarioId] || 0, stars);
    if (score.fieldOrderStatus !== 'completed' || !validFieldOrder(score.scenarioId, score.fieldOrderId)) continue;
    const orders = fieldOrdersByMission[score.scenarioId] ||= [];
    if (score.fieldOrderId !== 'none' && !orders.includes(score.fieldOrderId)) orders.push(score.fieldOrderId);
  }
  for (const orders of Object.values(fieldOrdersByMission)) orders.sort();
  return {
    completedMissionIds: CAMPAIGN_MISSIONS.filter(mission => completed.has(mission.id)).map(mission => mission.id),
    unlockedMissionIds: CAMPAIGN_MISSIONS.filter((_, index) =>
      campaignMissionUnlockedFromLedger(completed, legacyMax, index)).map(mission => mission.id),
    medalsByMission,
    fieldOrdersByMission,
    chosenBranchId: verifiedCampaignRoutePayoff(profileId, difficulty) || null,
  };
}
function campaignMissionUnlockedFromLedger(completed, legacyMax, missionIndex) {
  if (missionIndex === 0) return true;
  // A verified archived victory at or beyond a mission proves that the profile
  // had reached it. A Black Shard score alone does not prove a pre-fork route:
  // versions before 30 also include the two branch missions.
  if (missionIndex >= 1 && missionIndex <= 12 && missionIndex !== 4 &&
      legacyMax >= missionIndex - 1) return true;
  if (missionIndex === 13 || missionIndex === 14)
    return completed.has('black-shard') || legacyMax >= 3;
  if (missionIndex === 4)
    return completed.has('ghost-channel') || completed.has('iron-current') || legacyMax >= 4;
  if (missionIndex >= 5 && missionIndex <= 12)
    return completed.has(CAMPAIGN_MISSIONS[missionIndex - 1].id);
  return completed.has(CAMPAIGN_MISSIONS[missionIndex - 1]?.id);
}
function campaignMissionUnlockedForProfile(profileId, difficulty, missionIndex) {
  const completed = new Set(verifiedCampaignMissionIds(profileId, difficulty));
  const legacyMax = store.scores.filter(score => score.profileId === profileId && score.mode === 'campaign' &&
    score.difficulty === difficulty && score.verified === true && score.result !== 'defeat' &&
    score.scoreVersion >= 4 && score.scoreVersion < 30 &&
    score.faction === CAMPAIGN_MISSIONS.find(mission => mission.id === score.scenarioId)?.faction)
    .reduce((max, score) => Math.max(max, CAMPAIGN_MISSIONS.findIndex(mission => mission.id === score.scenarioId)), -1);
  return campaignMissionUnlockedFromLedger(completed, legacyMax, missionIndex);
}
// Keep the ranked carryover source in one place so run validation and the
// profile's unlock preview use the same verified previous-mission ledger.
function completedPreviousFieldOrders(profileId, difficulty, missionIndex) {
  const verifiedMissionScores = store.scores.filter(score => score.profileId === profileId &&
    score.mode === 'campaign' && score.difficulty === difficulty && score.verified === true &&
    score.scoreVersion >= 4 && score.scoreVersion <= SCORE_VERSION);
  const branchIds = new Set(['ghost-channel', 'iron-current']);
  const hasVerifiedBranch = verifiedMissionScores.some(score => branchIds.has(score.scenarioId));
  const priorMissionIds = missionIndex === 13 || missionIndex === 14 ? ['black-shard']
    : missionIndex === 4 ? hasVerifiedBranch ? [...branchIds] : ['black-shard']
      : [CAMPAIGN_MISSIONS[missionIndex - 1]?.id];
  if (!priorMissionIds.some(Boolean)) return [];
  return store.scores.filter(score => score.profileId === profileId &&
    score.mode === 'campaign' && priorMissionIds.includes(score.scenarioId) &&
    score.difficulty === difficulty && score.verified === true &&
    score.scoreVersion >= 4 && score.scoreVersion <= SCORE_VERSION &&
    score.fieldOrderStatus === 'completed')
    .map(score => score.fieldOrderId);
}

// A veteran is earned only from a current-rules verified victory on the
// campaign route immediately preceding this ticket. Keep only the latest
// eligible result; clients never submit this manifest themselves.
function verifiedCampaignVeteran(profileId, difficulty, missionIndex) {
  const sources = new Set(campaignVeteranSourceIds(missionIndex));
  if (missionIndex === 4) {
    const chosenRoute = verifiedCampaignRoutePayoff(profileId, difficulty);
    sources.clear();
    sources.add(chosenRoute === 'none' ? 'black-shard' : chosenRoute);
  }
  if (!sources.size) return null;
  const score = store.scores.filter(item => item.profileId === profileId && item.mode === 'campaign' &&
    // Scores are written only for victories. Legacy score rows have no result field.
    item.difficulty === difficulty && item.verified === true && item.result !== 'defeat' &&
    item.scoreVersion >= 30 && item.scoreVersion <= SCORE_VERSION && sources.has(item.scenarioId) &&
    item.faction === CAMPAIGN_MISSIONS.find(mission => mission.id === item.scenarioId)?.faction)
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0) || String(b.id).localeCompare(String(a.id)))[0];
  return score && validateCampaignVeteran(score.campaignVeteran)
    ? structuredClone(score.campaignVeteran) : null;
}

function verifiedCampaignRoutePayoff(profileId, difficulty) {
  const branchIds = new Set(['ghost-channel', 'iron-current']);
  const firstVerifiedBranch = store.scores.find(score => score.profileId === profileId &&
    score.mode === 'campaign' && score.difficulty === difficulty && score.verified === true &&
    score.result !== 'defeat' && score.scoreVersion >= 4 && score.scoreVersion <= SCORE_VERSION &&
    branchIds.has(score.scenarioId));
  return CAMPAIGN_ROUTE_PAYOFFS.some(payoff => payoff.id === firstVerifiedBranch?.scenarioId)
    ? firstVerifiedBranch.scenarioId : 'none';
}

function requisitionBalance(profileId, difficulty, missionIndex) {
  const verifiedCampaignScores = store.scores.filter(score => score.profileId === profileId &&
    score.mode === 'campaign' && score.difficulty === difficulty && score.verified === true &&
    score.scoreVersion >= 4 && score.scoreVersion <= SCORE_VERSION);
  const completedOrderIds = verifiedCampaignScores.filter(score => score.fieldOrderStatus === 'completed' &&
    validFieldOrder(score.scenarioId, score.fieldOrderId)).map(score => score.fieldOrderId);
  const spentMissionIds = verifiedCampaignScores.filter(score => score.result !== 'defeat' &&
    score.supplyId && score.supplyId !== 'none' && knownSupply(score.supplyId))
    .map(score => score.scenarioId);
  return getCampaignRequisitionBalance(missionIndex, completedOrderIds, spentMissionIds);
}

function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const scores = Array.isArray(value.scores) ? value.scores : [];
    const history = Array.isArray(value.history) ? value.history.filter(record => record &&
      typeof record === 'object' && !Array.isArray(record) && typeof record.id === 'string' &&
      typeof record.profileId === 'string' && ['victory', 'defeat'].includes(record.result) &&
      Number.isFinite(record.completedAt)).slice(-MAX_HISTORY_RECORDS) : [];
    // Older stores used the victory-only scores list without personal history.
    // Verified scores from any recorded ruleset remain useful in personal history,
    // even when their score version is no longer comparable on the leaderboard.
    {
      const migrated = scores.filter(score => score && Number.isInteger(score.scoreVersion) && score.scoreVersion > 0 &&
        score.verified === true && typeof score.id === 'string' && typeof score.profileId === 'string' &&
        Number.isFinite(score.completedAt) && Number.isFinite(score.seconds) &&
        Number.isFinite(score.kills) && ['campaign', 'skirmish'].includes(score.mode) &&
        !history.some(record => record.scoreId === score.id || record.id === `score-${score.id}`))
        .map(score => ({ id: `score-${score.id}`, profileId: score.profileId, mode: score.mode,
          scenarioId: score.scenarioId, scenarioName: score.scenarioName, difficulty: score.difficulty,
          faction: score.faction, ...(score.mode === 'campaign' ? { doctrineId: score.doctrineId ?? 'standard',
            fieldOrderId: score.fieldOrderId ?? 'none', carryoverId: score.carryoverId ?? 'none',
            campaignVeteran: validateCampaignVeteran(score.campaignVeteran) ? score.campaignVeteran : null,
            deployedVeteran: validateCampaignVeteran(score.deployedVeteran) ? score.deployedVeteran : null } :
            { skirmishOpening: score.skirmishOpening ?? 'established',
              victoryMode: score.victoryMode ?? 'dominion',
              ...(AI_COMMANDER_PROFILES.some(commander => commander.id === score.aiCommanderProfileId)
                ? { aiCommanderProfileId: score.aiCommanderProfileId } : {}) }), seconds: score.seconds,
          kills: score.kills, result: 'victory', completedAt: score.completedAt, scoreId: score.id }));
      history.push(...migrated.sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id)));
      history.sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id));
      if (history.length > MAX_HISTORY_RECORDS) history.splice(0, history.length - MAX_HISTORY_RECORDS);
    }
    return {
      profiles: Array.isArray(value.profiles) ? value.profiles.map(profile => profile && typeof profile === 'object'
        ? { ...profile, ratingSeason: Number.isSafeInteger(profile.ratingSeason) ? profile.ratingSeason : 0,
          rating: Number.isSafeInteger(profile.rating) && profile.rating >= 0 ? profile.rating : 1200,
          wins: Number.isSafeInteger(profile.wins) && profile.wins >= 0 ? profile.wins : 0,
          losses: Number.isSafeInteger(profile.losses) && profile.losses >= 0 ? profile.losses : 0 }
        : profile) : [],
      requests: Array.isArray(value.requests) ? value.requests : [],
      friendships: Array.isArray(value.friendships) ? value.friendships : [],
      runs: Array.isArray(value.runs) ? value.runs : [],
      scores,
      history,
      multiplayerHistory: Array.isArray(value.multiplayerHistory) ? value.multiplayerHistory.filter(record => record &&
        typeof record.id === 'string' && typeof record.matchId === 'string' &&
        typeof record.profileId === 'string' && typeof record.winnerId === 'string' &&
        ['victory', 'defeat'].includes(record.result) &&
        ['victory', 'forfeit', 'disconnect', 'relayDominion'].includes(record.reason) &&
        typeof record.opponent?.id === 'string' && typeof record.opponent?.name === 'string' &&
        SKIRMISH_MAPS.some(map => map.id === record.mapId) &&
        ['dominion', 'elimination'].includes(record.victoryMode) &&
        Number.isFinite(record.durationSeconds) && record.durationSeconds >= 0 &&
        Number.isFinite(record.completedAt)).slice(-MAX_MULTIPLAYER_HISTORY_RECORDS) : [],
      activeMatches: Array.isArray(value.activeMatches) ? value.activeMatches : [],
      matchOutcomes: Array.isArray(value.matchOutcomes) ? value.matchOutcomes : [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { profiles: [], requests: [], friendships: [], runs: [], scores: [], history: [], multiplayerHistory: [],
      activeMatches: [], matchOutcomes: [] };
  }
}
const store = readStore();
function ensureCurrentRating(profile) {
  if (profile.ratingSeason !== RANKED_SEASON) {
    profile.ratingSeason = RANKED_SEASON;
    profile.rating = 1200;
    profile.wins = 0;
    profile.losses = 0;
  }
  if (!Number.isSafeInteger(profile.rating) || profile.rating < 0) profile.rating = 1200;
  if (!Number.isSafeInteger(profile.wins) || profile.wins < 0) profile.wins = 0;
  if (!Number.isSafeInteger(profile.losses) || profile.losses < 0) profile.losses = 0;
  return profile;
}
function publicRating(profile) {
  ensureCurrentRating(profile);
  return { season: RANKED_SEASON, rating: profile.rating, wins: profile.wins, losses: profile.losses,
    games: profile.wins + profile.losses };
}
function rankedTransfer(winner, loser) {
  ensureCurrentRating(winner);
  ensureCurrentRating(loser);
  const expected = 1 / (1 + 10 ** ((winner.rating - loser.rating) / 400));
  return Math.min(loser.rating, Math.max(0, Math.round(32 * expected)));
}
function persist() {
  // Snapshot live rooms and terminal results in the same atomic store write as
  // profiles and scores. Socket objects and timers are deliberately excluded.
  store.activeMatches = [...lobbies.values()].filter(lobby => lobby.game?.status === 'playing' && !lobby.ended)
    .map(lobby => ({ version: 1, code: lobby.code, matchId: lobby.matchId, hostId: lobby.hostId,
      matchmaking: lobby.matchmaking === true, ranked: lobby.ranked === true, settings: lobby.settings,
      game: lobby.game.serialize(), tick: lobby.tick || 0, members: lobby.members.map(member => ({
        profileId: member.profile.id, side: member.side, faction: member.faction, ready: member.ready,
        selection: member.selection || [], explored: member.explored,
        terrainMemory: member.terrainMemory || null, disconnectedAt: member.disconnectedAt || null,
      })) }));
  store.matchOutcomes = [...recentMatchOutcomes.entries()].map(([key, outcome]) => ({ key, ...outcome }));
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store));
  fs.renameSync(temporary, dataFile);
}

const publicProfile = profile => profile && ({ id: profile.id, name: profile.name, code: profile.code });
function nameFrom(value) {
  const cleaned = String(value || '').trim().replace(/[\p{C}<>]/gu, '').slice(0, 24);
  return cleaned || 'Commander';
}
function profileForToken(value) {
  if (typeof value !== 'string' || value.length < 30 || value.length > 128) return null;
  const digest = hash(value);
  return store.profiles.find(profile => profile.tokenHash === digest) || null;
}
function bearer(req) {
  const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || '');
  return profileForToken(match?.[1]);
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function fail(res, status, reason) { send(res, status, { error: reason }); }
async function bodyOf(req, limit = 16384) {
  let text = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Request body is too large.');
    text += chunk;
  }
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
  return parsed;
}

// A replay can run for thousands of updates. Keep simulation off the HTTP event
// loop, and cap both concurrent simulations and the time each worker may use.
function verifyReplay(envelope, commands, completedTicks) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        try {
          const { replaySoloRun } = await import(workerData.replayUrl);
          const { deriveCampaignVeteran } = await import(workerData.veteranUrl);
          const result = replaySoloRun(workerData.envelope, workerData.commands, workerData.completedTicks);
          parentPort.postMessage({ ok: true, status: result.status, winner: result.winner,
            seconds: result.seconds, kills: result.kills, campaignResult: result.campaignResult,
            campaignVeteran: result.status === 'victory' && workerData.envelope.mode === 'campaign'
              ? deriveCampaignVeteran(result.game) : null });
        } catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }
      })();`, { eval: true, workerData: { replayUrl: new URL('../src/game/replay.js', import.meta.url).href,
      veteranUrl: new URL('../src/game/campaignVeteran.js', import.meta.url).href,
      envelope, commands, completedTicks }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    activeVerifications++;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate().catch(() => {}).finally(() => { activeVerifications--; });
      if (error) reject(error); else resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error('Replay verification timed out.')), VERIFY_TIMEOUT_MS);
    worker.once('message', message => message.ok ? finish(null, message) : finish(new Error(message.error)));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (code !== 0) finish(new Error('Replay verification worker stopped.')); });
  });
}

const sockets = new Map(); // profile id -> Set<WebSocket>
const lobbies = new Map(); // invitation code -> lobby
const matchmakingQueue = new Map(); // profile id -> queue entry, insertion order is FIFO
const inviteCooldowns = new Map(); // inviter id + friend id -> last notification time
const INVITE_COOLDOWN_MS = 10_000;
const MAX_INVITE_COOLDOWNS = 10_000;
const pendingRematches = new Map(); // request id -> one-time consent offer
const rematchByMatch = new Map(); // completed match id -> pending request id
const rematchCooldowns = new Map(); // completed match + requester -> last request time
const REMATCH_REQUEST_TTL_MS = process.env.NODE_ENV === 'test'
  ? Math.max(100, Number(process.env.FRONTIER_REMATCH_TTL_MS) || 1000) : 60_000;
const REMATCH_MATCH_MAX_AGE_MS = 24 * 60 * 60_000;
const REMATCH_COOLDOWN_MS = 10_000;
const MAX_PENDING_REMATCHES = 1000;
const MATCHMAKING_WAIT_MS = process.env.NODE_ENV === 'test'
  ? Math.max(100, Number(process.env.FRONTIER_MATCHMAKING_WAIT_MS) || 60_000) : 10 * 60_000;
const MATCHMAKING_ACCEPT_MS = process.env.NODE_ENV === 'test'
  ? Math.max(100, Number(process.env.FRONTIER_MATCHMAKING_ACCEPT_MS) || 60_000) : 60_000;
const RANKED_INITIAL_RATING_RANGE = process.env.NODE_ENV === 'test'
  ? Math.max(0, Number(process.env.FRONTIER_RANKED_INITIAL_RANGE) || 100) : 100;
const RANKED_RATING_RANGE_STEP = process.env.NODE_ENV === 'test'
  ? Math.max(1, Number(process.env.FRONTIER_RANKED_RANGE_STEP) || 100) : 100;
const RANKED_RATING_RANGE_STEP_MS = process.env.NODE_ENV === 'test'
  ? Math.max(25, Number(process.env.FRONTIER_RANKED_RANGE_STEP_MS) || 10_000) : 10_000;
const RANKED_RATING_RANGE_FULL_MS = process.env.NODE_ENV === 'test'
  ? Math.max(100, Number(process.env.FRONTIER_RANKED_RANGE_FULL_MS) || 120_000) : 120_000;
const MATCHMAKING_STATUS_INTERVAL_MS = process.env.NODE_ENV === 'test'
  ? Math.max(25, Number(process.env.FRONTIER_MATCHMAKING_STATUS_MS) || 1_000) : 1_000;
const recentMatchOutcomes = new Map(); // profile id + lobby code -> terminal seat result
const MATCH_OUTCOME_TTL_MS = 5 * 60_000;
const MAX_MATCH_OUTCOMES = 1000;
const MATCH_CHECKPOINT_TICKS = 50; // Five seconds at the 10 Hz simulation rate.
const websocket = new WebSocketServer({ noServer: true, maxPayload: 16384 });
// Browser tabs can disappear without a clean TCP close (sleep, network loss,
// mobile handoff). Reap those sockets so presence, invitations, queue entries,
// and the existing reconnect/forfeit timers all converge promptly.
const SOCKET_HEARTBEAT_MS = process.env.NODE_ENV === 'test'
  ? Math.max(50, Number(process.env.FRONTIER_SOCKET_HEARTBEAT_MS) || 30_000) : 30_000;
const socketHeartbeat = setInterval(() => {
  for (const ws of websocket.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, SOCKET_HEARTBEAT_MS);
socketHeartbeat.unref();
function emit(ws, message) {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 2_000_000)
    ws.send(JSON.stringify(message.type === 'error' ? { ...message, message: message.error } : message));
}
function notify(profileId, message) {
  for (const ws of sockets.get(profileId) || []) emit(ws, message);
}
function online(profileId) { return (sockets.get(profileId)?.size || 0) > 0; }
function friendsFor(profile) {
  const ids = store.friendships.filter(pair => pair.includes(profile.id)).map(pair => pair.find(value => value !== profile.id));
  return {
    friends: ids.map(id => store.profiles.find(p => p.id === id)).filter(Boolean).map(p => ({ ...publicProfile(p), online: online(p.id) })),
    incoming: store.requests.filter(r => r.to === profile.id && r.status === 'pending')
      .map(r => ({ id: r.id, from: publicProfile(store.profiles.find(p => p.id === r.from)) })),
    outgoing: store.requests.filter(r => r.from === profile.id && r.status === 'pending')
      .map(r => ({ id: r.id, to: publicProfile(store.profiles.find(p => p.id === r.to)) })),
  };
}
function sendFriends(profileId) {
  const profile = store.profiles.find(p => p.id === profileId);
  if (profile) {
    notify(profileId, { type: 'friends', ...friendsFor(profile) });
    notify(profileId, { type: 'friends_changed' });
  }
}
function sendLobby(lobby) {
  const message = { type: 'lobby', code: lobby.code, inviteUrl: `/?join=${lobby.code}`,
    hostId: lobby.hostId, status: lobby.game ? 'playing' : 'waiting',
    ranked: lobby.ranked === true,
    ...(lobby.matchmaking ? { matchmaking: true } : {}),
    settings: { mapId: lobby.settings?.mapId || 'shard-valley',
      victoryMode: lobby.settings?.victoryMode || 'dominion' },
    players: lobby.members.map(m => ({ ...publicProfile(m.profile), faction: m.faction, ready: m.ready,
      connected: Boolean(m.ws && m.ws.readyState === WebSocket.OPEN) })) };
  for (const member of lobby.members) emit(member.ws, message);
}
function findMember(ws) { return ws.lobby?.members.find(m => m.profile.id === ws.profile.id); }
function matchmakingSeat(profileId) {
  for (const lobby of lobbies.values()) {
    const member = lobby.members.find(candidate => candidate.profile.id === profileId);
    if (member) return { lobby, member };
  }
  return null;
}
function rematchError(ws, message, matchId = undefined) {
  emit(ws, { type: 'rematch_error', ...(matchId ? { matchId } : {}), message });
}
function completedCasualMatch(matchId, profileId) {
  if (typeof matchId !== 'string' || !/^[a-f0-9]{24}$/.test(matchId)) return null;
  const seats = store.multiplayerHistory.filter(record => record.matchId === matchId);
  if (seats.length !== 2 || seats.some(record => record.ranked === true || !Number.isFinite(record.completedAt) ||
      now() - record.completedAt > REMATCH_MATCH_MAX_AGE_MS ||
      !['victory', 'defeat'].includes(record.result) ||
      !SKIRMISH_MAPS.some(map => map.id === record.mapId) ||
      !['dominion', 'elimination'].includes(record.victoryMode))) return null;
  const own = seats.find(record => record.profileId === profileId);
  const other = seats.find(record => record.profileId !== profileId);
  if (!own || !other || own.opponent?.id !== other.profileId || other.opponent?.id !== own.profileId ||
      own.mapId !== other.mapId || own.victoryMode !== other.victoryMode) return null;
  return { own, other };
}
function idleSocket(profileId) {
  if (matchmakingQueue.has(profileId) || matchmakingSeat(profileId)) return null;
  return [...(sockets.get(profileId) || [])].find(socket => socket.readyState === WebSocket.OPEN &&
    !socket.lobby && !socket.queueEntry) || null;
}
function settleRematch(request, type, reason = undefined) {
  if (!request || pendingRematches.get(request.id) !== request) return;
  pendingRematches.delete(request.id);
  rematchByMatch.delete(request.matchId);
  clearTimeout(request.timer);
  const message = { type, requestId: request.id, matchId: request.matchId,
    ...(reason ? { reason } : {}) };
  notify(request.fromId, message);
  notify(request.toId, message);
}
function requestRematch(ws, matchId) {
  if (ws.lobby || ws.queueEntry || matchmakingQueue.has(ws.profile.id) || matchmakingSeat(ws.profile.id)) {
    rematchError(ws, 'Leave your current room or matchmaking queue before requesting a rematch.', matchId); return;
  }
  const completed = completedCasualMatch(matchId, ws.profile.id);
  if (!completed) { rematchError(ws, 'That casual match is no longer eligible for a rematch.', matchId); return; }
  const counterpart = store.profiles.find(profile => profile.id === completed.other.profileId);
  if (!counterpart || !idleSocket(counterpart.id)) {
    rematchError(ws, 'Your previous opponent is offline or unavailable.', matchId); return;
  }
  if (rematchByMatch.has(matchId)) {
    rematchError(ws, 'A rematch request for this match is already pending.', matchId); return;
  }
  const cooldownKey = `${matchId}:${ws.profile.id}`;
  const requestedAt = now();
  for (const [key, sentAt] of rematchCooldowns)
    if (requestedAt - sentAt >= REMATCH_COOLDOWN_MS) rematchCooldowns.delete(key);
  if (requestedAt - (rematchCooldowns.get(cooldownKey) ?? -Infinity) < REMATCH_COOLDOWN_MS) {
    rematchError(ws, 'Please wait before asking for another rematch.', matchId); return;
  }
  if (pendingRematches.size >= MAX_PENDING_REMATCHES) {
    rematchError(ws, 'Rematch requests are busy. Please try again shortly.', matchId); return;
  }
  rematchCooldowns.set(cooldownKey, requestedAt);
  while (rematchCooldowns.size > MAX_INVITE_COOLDOWNS)
    rematchCooldowns.delete(rematchCooldowns.keys().next().value);
  const request = { id: id(), matchId, fromId: ws.profile.id, fromWs: ws, toId: counterpart.id,
    mapId: completed.own.mapId, victoryMode: completed.own.victoryMode,
    expiresAt: requestedAt + REMATCH_REQUEST_TTL_MS, timer: null };
  request.timer = setTimeout(() => settleRematch(request, 'rematch_expired', 'expired'), REMATCH_REQUEST_TTL_MS);
  request.timer.unref?.();
  pendingRematches.set(request.id, request);
  rematchByMatch.set(matchId, request.id);
  const response = { type: 'rematch_offer', requestId: request.id, matchId,
    from: publicProfile(ws.profile), mapId: request.mapId, victoryMode: request.victoryMode,
    expiresAt: request.expiresAt };
  notify(counterpart.id, response);
  emit(ws, { type: 'rematch_pending', requestId: request.id, matchId,
    to: publicProfile(counterpart), expiresAt: request.expiresAt });
}
function respondRematch(ws, requestId, accept) {
  const request = pendingRematches.get(requestId);
  if (!request || request.toId !== ws.profile.id) {
    rematchError(ws, 'That rematch request is no longer available.'); return;
  }
  if (request.expiresAt <= now()) {
    settleRematch(request, 'rematch_expired', 'expired');
    rematchError(ws, 'That rematch request has expired.', request.matchId); return;
  }
  if (!accept) { settleRematch(request, 'rematch_declined', 'declined'); return; }
  const socketAvailable = socket => socket?.readyState === WebSocket.OPEN && !socket.lobby && !socket.queueEntry;
  if (!socketAvailable(ws) || matchmakingQueue.has(request.toId) || matchmakingSeat(request.toId)) {
    rematchError(ws, 'This connection is already seated or searching. Accept from an available connection.',
      request.matchId); return;
  }
  const fromSocket = request.fromWs;
  const toSocket = ws;
  const match = completedCasualMatch(request.matchId, request.fromId);
  if (!socketAvailable(fromSocket) || matchmakingQueue.has(request.fromId) || matchmakingSeat(request.fromId) ||
      !match || match.other.profileId !== request.toId) {
    settleRematch(request, 'rematch_cancelled', 'seat_unavailable');
    rematchError(ws, 'A commander is already seated or the completed match is no longer available.', request.matchId);
    return;
  }
  const fromProfile = store.profiles.find(profile => profile.id === request.fromId);
  const toProfile = store.profiles.find(profile => profile.id === request.toId);
  if (!fromProfile || !toProfile) {
    settleRematch(request, 'rematch_cancelled', 'seat_unavailable');
    rematchError(ws, 'A commander is no longer available.', request.matchId); return;
  }
  settleRematch(request, 'rematch_accepted');
  let inviteCode;
  do { inviteCode = code(6); } while (lobbies.has(inviteCode));
  const lobby = { code: inviteCode, hostId: fromProfile.id, members: [], game: null, ended: false, ranked: false,
    settings: { mapId: request.mapId, victoryMode: request.victoryMode } };
  const first = { profile: fromProfile, ws: fromSocket, faction: 'aegis', ready: false };
  const second = { profile: toProfile, ws: toSocket, faction: 'vesper', ready: false };
  lobby.members.push(first, second);
  lobbies.set(inviteCode, lobby);
  attachMemberSocket(lobby, first, fromSocket);
  attachMemberSocket(lobby, second, toSocket);
  sendLobby(lobby);
}
function rankedRatingRange(entry, at = now()) {
  const elapsedMs = Math.max(0, at - entry.joinedAt);
  if (elapsedMs >= RANKED_RATING_RANGE_FULL_MS) return Number.MAX_SAFE_INTEGER;
  const steps = Math.floor(elapsedMs / RANKED_RATING_RANGE_STEP_MS);
  return Math.min(Number.MAX_SAFE_INTEGER, RANKED_INITIAL_RATING_RANGE + steps * RANKED_RATING_RANGE_STEP);
}
function queueStatus(entry, position, at = now()) {
  const ranked = entry.ranked === true;
  const status = { type: 'matchmaking', status: 'queued', position,
    elapsedMs: Math.max(0, at - entry.joinedAt), ranked };
  if (ranked) {
    // Calling publicRating applies the current-season baseline before this
    // search range is calculated; stale ratings cannot skew matchmaking.
    status.rating = publicRating(entry.ws.profile).rating;
    status.ratingRange = rankedRatingRange(entry, at);
  }
  return status;
}
function notifyQueuePositions() {
  const at = now();
  const positions = new Map([[false, 0], [true, 0]]);
  for (const entry of matchmakingQueue.values()) {
    const ranked = entry.ranked === true;
    const position = (positions.get(ranked) || 0) + 1;
    positions.set(ranked, position);
    emit(entry.ws, queueStatus(entry, position, at));
  }
}
function removeMatchmakingEntry(profileId, reason = null, requestingSocket = null) {
  const entry = matchmakingQueue.get(profileId);
  if (!entry || requestingSocket && entry.ws !== requestingSocket) return false;
  matchmakingQueue.delete(profileId);
  clearTimeout(entry.timer);
  if (entry.ws?.queueEntry === entry) entry.ws.queueEntry = null;
  if (reason) emit(entry.ws, { type: 'matchmaking', status: 'cancelled', reason, ranked: entry.ranked === true });
  notifyQueuePositions();
  return true;
}
function clearMatchmakingAcceptance(lobby, reason) {
  if (!lobby?.matchmaking || lobby.game) return false;
  if (lobby.acceptTimer) clearTimeout(lobby.acceptTimer);
  lobby.acceptTimer = null;
  for (const member of lobby.members) emit(member.ws, { type: 'matchmaking', status: 'match_cancelled', reason,
    ranked: lobby.ranked === true });
  clearLobby(lobby);
  return true;
}
function expireMatchmakingEntry(entry) {
  // Queue entries are replaceable; an old timer must never remove a later join.
  if (matchmakingQueue.get(entry.profileId) !== entry) return;
  removeMatchmakingEntry(entry.profileId);
  emit(entry.ws, { type: 'matchmaking', status: 'timeout', ranked: entry.ranked === true });
}
function createMatchmakingLobby(first, second) {
  if (matchmakingQueue.get(first.profileId) !== first || matchmakingQueue.get(second.profileId) !== second) return false;
  if (first.ws.readyState !== WebSocket.OPEN || second.ws.readyState !== WebSocket.OPEN ||
      matchmakingSeat(first.profileId) || matchmakingSeat(second.profileId)) return false;
  // Remove both entries before assigning either seat, keeping the occupancy
  // check atomic within this event loop turn.
  for (const entry of [first, second]) {
    matchmakingQueue.delete(entry.profileId);
    clearTimeout(entry.timer);
    if (entry.ws.queueEntry === entry) entry.ws.queueEntry = null;
  }
  let inviteCode;
  do { inviteCode = code(6); } while (lobbies.has(inviteCode));
  const host = first;
  const guest = second;
  if ((first.ranked === true) !== (second.ranked === true)) return false;
  const ranked = first.ranked === true;
  const map = SKIRMISH_MAPS[randomInt(SKIRMISH_MAPS.length)];
  const hostFaction = randomInt(2) === 0 ? 'aegis' : 'vesper';
  const lobby = { code: inviteCode, hostId: host.ws.profile.id, members: [], game: null, ended: false,
    matchmaking: true, ranked, settings: { mapId: map.id, victoryMode: 'dominion' } };
  const hostMember = { profile: host.ws.profile, ws: host.ws, faction: hostFaction, ready: false };
  const guestMember = { profile: guest.ws.profile, ws: guest.ws,
    faction: hostFaction === 'aegis' ? 'vesper' : 'aegis', ready: false };
  lobby.members.push(hostMember, guestMember);
  lobbies.set(inviteCode, lobby);
  for (const entry of [host, guest]) entry.ws.lobby = lobby;
  sendLobby(lobby);
  for (const member of lobby.members)
    emit(member.ws, { type: 'matchmaking', status: 'match_found', ranked });
  notifyQueuePositions();
  lobby.acceptTimer = setTimeout(() => {
    if (lobbies.get(lobby.code) === lobby && !lobby.game)
      clearMatchmakingAcceptance(lobby, 'acceptance_timeout');
  }, MATCHMAKING_ACCEPT_MS);
  return true;
}
function runMatchmakingCycle() {
  // Publish elapsed wait/rating bands before a newly eligible pair is removed
  // from the queue, so clients can render the widening that admitted them.
  notifyQueuePositions();
  const rankedEntries = [...matchmakingQueue.values()].filter(entry => entry.ranked === true &&
    entry.ws.readyState === WebSocket.OPEN && !matchmakingSeat(entry.profileId));
  const at = now();
  const ratings = new Map(rankedEntries.map(entry => [entry.profileId, publicRating(entry.ws.profile).rating]));
  for (const entry of rankedEntries) {
    if (!matchmakingQueue.has(entry.profileId)) continue;
    const range = rankedRatingRange(entry, at);
    const candidates = [...matchmakingQueue.values()].filter(candidate => candidate !== entry &&
      candidate.ranked === true && candidate.ws.readyState === WebSocket.OPEN &&
      !matchmakingSeat(candidate.profileId) && ratings.has(candidate.profileId))
      .map(candidate => ({ candidate, gap: Math.abs(ratings.get(entry.profileId) - ratings.get(candidate.profileId)) }))
      // A match is fair only when both searches include the other rating.
      .filter(({ candidate, gap }) => gap <= Math.min(range, rankedRatingRange(candidate, at)))
      .sort((a, b) => a.gap - b.gap || a.candidate.joinedAt - b.candidate.joinedAt ||
        a.candidate.profileId.localeCompare(b.candidate.profileId));
    const selected = candidates.find(({ candidate }) => matchmakingQueue.has(candidate.profileId));
    if (selected) createMatchmakingLobby(entry, selected.candidate);
  }

  // Casual remains a strict FIFO queue, independent of Ranked rating bands.
  const casualEntries = [...matchmakingQueue.values()].filter(entry => entry.ranked !== true &&
    entry.ws.readyState === WebSocket.OPEN && !matchmakingSeat(entry.profileId));
  while (casualEntries.length >= 2) {
    const first = casualEntries.shift();
    const second = casualEntries.shift();
    createMatchmakingLobby(first, second);
  }
}
const matchmakingStatusTimer = setInterval(runMatchmakingCycle, MATCHMAKING_STATUS_INTERVAL_MS);
matchmakingStatusTimer.unref();
function enqueueMatchmaking(ws, ranked = false) {
  if (ws.lobby || matchmakingSeat(ws.profile.id)) {
    emit(ws, { type: 'error', error: 'Leave your current room before searching for a match.' }); return;
  }
  if (matchmakingQueue.has(ws.profile.id)) {
    emit(ws, { type: 'error', error: 'This commander is already searching for a match.' }); return;
  }
  if ([...(sockets.get(ws.profile.id) || [])].some(socket => socket !== ws && socket.readyState === WebSocket.OPEN)) {
    emit(ws, { type: 'error', error: 'This commander is already connected in another tab.' }); return;
  }
  const entry = { profileId: ws.profile.id, ws, joinedAt: now(), timer: null, ranked: ranked === true };
  entry.timer = setTimeout(() => expireMatchmakingEntry(entry), MATCHMAKING_WAIT_MS);
  matchmakingQueue.set(entry.profileId, entry);
  ws.queueEntry = entry;
  runMatchmakingCycle();
}
function attachMemberSocket(lobby, member, ws) {
  const previous = member.ws;
  if (previous && previous !== ws) {
    previous.lobby = null;
    emit(previous, { type: 'error', error: 'This lobby was opened from another connection.' });
  }
  if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
  member.disconnectTimer = null;
  member.disconnectedAt = null;
  member.ws = ws;
  ws.lobby = lobby;
  if (lobby.game) persist();
}
function clearLobby(lobby) {
  if (lobby.timer) clearInterval(lobby.timer);
  if (lobby.acceptTimer) clearTimeout(lobby.acceptTimer);
  lobbies.delete(lobby.code);
  for (const member of lobby.members) {
    if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
    if (member.ws?.lobby === lobby) member.ws.lobby = null;
  }
  persist();
}
function leave(ws) {
  const lobby = ws.lobby;
  if (!lobby) return;
  const member = findMember(ws);
  if (lobby.matchmaking && !lobby.game) {
    clearMatchmakingAcceptance(lobby, 'declined');
    return;
  }
  ws.lobby = null;
  if (!member || member.ws !== ws) return;
  if (lobby.game && lobby.game.status === 'playing') {
    finishMatch(lobby, member.side === 'player' ? 'enemy' : 'player', 'forfeit');
    return;
  }
  lobby.members = lobby.members.filter(m => m !== member);
  if (!lobby.members.length) clearLobby(lobby);
  else {
    if (lobby.hostId === member.profile.id) lobby.hostId = lobby.members[0].profile.id;
    for (const m of lobby.members) m.ready = false;
    sendLobby(lobby);
  }
}

function sideFog(game, side, explored) {
  if (side === 'player') return game.fog;
  const fog = Array.from({ length: game.height }, () => Array(game.width).fill(0));
  const reveal = (x, y, radius, ignoreObstacles = false) => {
    for (let yy = Math.max(0, Math.floor(y - radius)); yy < Math.min(game.height, Math.ceil(y + radius + 1)); yy++)
      for (let xx = Math.max(0, Math.floor(x - radius)); xx < Math.min(game.width, Math.ceil(x + radius + 1)); xx++)
        if (Math.hypot(xx + 0.5 - x, yy + 0.5 - y) <= radius &&
          (ignoreObstacles || game._hasLineOfSight(x, y, xx + 0.5, yy + 0.5))) fog[yy][xx] = 2;
  };
  for (const entity of [...game.units, ...game.buildings]) if (entity.owner === side && entity.hp > 0 &&
    !entity.embarkedIn && (!entity.w || entity.progress >= 1)) {
    const def = UNIT_DEFS[entity.defId] || BUILDING_DEFS[entity.defId];
    const x = entity.x + (entity.w || 0) / 2, y = entity.y + (entity.h || 0) / 2;
    reveal(x, y, game._stormSight(x, y, def?.sight || 5));
  }
  for (const relay of game.relays) if (relay.owner === side)
    reveal(relay.x, relay.y, game._stormSight(relay.x, relay.y, 6));
  for (const scan of game.scans) if (scan.owner === side && scan.until > game.time)
    reveal(scan.x, scan.y, scan.radius, true);
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    if (fog[y][x] === 2) explored[y][x] = 1;
    else if (explored[y][x]) fog[y][x] = 1;
  }
  return fog;
}
function projectedState(lobby, member) {
  const game = lobby.game;
  const data = JSON.parse(game.serialize());
  // The seed, advanced PRNG state, and route variant can reveal unseen map
  // topology, so none belong in a client-readable multiplayer snapshot.
  delete data.seed;
  delete data.randomState;
  delete data.mapVariant;
  const side = member.side;
  const swap = owner => owner === 'player' ? 'enemy' : owner === 'enemy' ? 'player' : owner;
  const orient = owner => side === 'enemy' ? swap(owner) : owner;
  // Salvage drops are public objectives. Project only the public contract so
  // future engine-private fields cannot become a multiplayer information leak.
  if (data.salvageDrop && typeof data.salvageDrop === 'object') {
    const drop = data.salvageDrop;
    data.salvageDrop = {
      phase: drop.phase, x: drop.x, y: drop.y,
      warningAt: drop.warningAt, landsAt: drop.landsAt, expiresAt: drop.expiresAt,
      captureOwner: orient(drop.captureOwner), captureProgress: drop.captureProgress,
      claimedBy: orient(drop.claimedBy), contested: drop.contested === true,
    };
  }
  // The Bloom site and deadline are public, but keep its wire shape explicit
  // so later engine bookkeeping cannot leak through a projected snapshot.
  if (data.storm?.bloom) {
    const { x, y, radius, until } = data.storm.bloom;
    data.storm.bloom = { x, y, radius, until };
  }
  const fog = sideFog(game, side, member.explored);
  // Keep a per-seat copy of what this commander has actually seen. Unknown
  // cells use impassable neutral terrain so the client cannot infer resources
  // or terrain details, and does not offer pathing/build placement through it.
  if (!Array.isArray(member.terrainMemory) || member.terrainMemory.length !== game.height ||
      member.terrainMemory.some(row => !Array.isArray(row) || row.length !== game.width))
    member.terrainMemory = Array.from({ length: game.height }, () => Array(game.width).fill(null));
  const unknownTerrain = { type: 'sand', resource: 0, walkable: false, buildable: false, shade: 0, detail: 0 };
  data.terrain = data.terrain.map((row, y) => row.map((cell, x) => {
    if (fog[y]?.[x] === 2) member.terrainMemory[y][x] = { ...cell };
    return fog[y]?.[x] === 2 ? { ...member.terrainMemory[y][x] }
      : member.terrainMemory[y][x] ? { ...member.terrainMemory[y][x] } : { ...unknownTerrain };
  }));
  const visible = entity => entity.owner === side || (() => {
    const x = Math.floor(entity.x + (entity.w || 0) / 2), y = Math.floor(entity.y + (entity.h || 0) / 2);
    return fog[y]?.[x] === 2 && game.isVisible(entity, side);
  })();
  data.units = data.units.filter(visible);
  data.buildings = data.buildings.filter(visible);
  // Salvage is shared battlefield information only while in live sight.
  // An old explored tile must not report fresh losses or remote recovery.
  data.wrecks = (data.wrecks || []).filter(wreck =>
    fog[Math.floor(wreck.y)]?.[Math.floor(wreck.x)] === 2);
  // Visible hostile units may be shown for tactical feedback, but their
  // serialized orders and paths can point deep into terrain this commander
  // has never explored. Those are private command state, not visible state.
  const opponent = side === 'player' ? 'enemy' : 'player';
  for (const entity of [...data.units, ...data.buildings]) if (entity.owner === opponent) {
    // Engine-private fields can encode destinations, relay assignments,
    // pursuit targets, cargo routes, or unload pairing. None are needed to
    // render or inspect an opponent entity, so scrub the whole private set.
    for (const key of Object.keys(entity)) if (key.startsWith('_')) delete entity[key];
    if ('order' in entity) delete entity.order;
    if ('path' in entity) entity.path = [];
  }
  data.effects = data.effects.filter(effect => fog[Math.floor(effect.y)]?.[Math.floor(effect.x)] === 2);
  data.scans = data.scans.filter(scan => scan.owner === side);
  // Breach target zones persist longer than their visual effect. Keep an
  // opponent's hidden cast out of the serialized multiplayer state too.
  data.breachZones = (data.breachZones || []).filter(zone => zone.owner === side ||
    fog[Math.floor(zone.y)]?.[Math.floor(zone.x)] === 2);
  // Relay control is only tactical information while its tile is visible.
  // Keep the relay marker for client layout, but hide stale ownership and
  // capture state for unowned or opponent-held relays in fog.
  for (const relay of data.relays || []) {
    const x = Math.floor(relay.x), y = Math.floor(relay.y);
    if (relay.owner !== side && fog[y]?.[x] !== 2) {
      relay.owner = null;
      relay.progress = 0;
      relay.contested = false;
      // Protocols are tactical state. An explored relay must not reveal a
      // remote switch or its remaining lockout through the snapshot.
      relay.protocol = 'shelter';
      relay.protocolCooldown = 0;
    }
  }
  if (data.storm?.lure && data.storm.lure.owner !== side &&
      fog[Math.floor(data.storm.lure.y)]?.[Math.floor(data.storm.lure.x)] !== 2)
    data.storm.lure = null;
  data.fog = fog;
  // Only currently observed building losses are visual history for the seat.
  // Send explicit public fields so older event payloads cannot expose hidden
  // attacker or economy state through a multiplayer snapshot.
  data.events = data.events.filter(event => event.type === 'buildingLost' &&
    Number.isFinite(event.time) && game.time - event.time < 150 &&
    Number.isFinite(event.x) && Number.isFinite(event.y) &&
    fog[Math.floor(event.y)]?.[Math.floor(event.x)] === 2)
    .map(event => ({ type: 'buildingLost', time: event.time, id: event.id,
      owner: event.owner, defId: event.defId, x: event.x, y: event.y }));
  data.selection = member.selection || [];
  for (const entity of [...data.units, ...data.buildings]) entity.selected = data.selection.includes(entity.id);
  if (side === 'enemy') {
    for (const collection of [data.units, data.buildings, data.effects, data.scans,
      data.breachZones, data.relays, data.events])
      for (const item of collection || []) if ('owner' in item) item.owner = swap(item.owner);
    for (const key of ['credits', 'creditCapacity', 'power', 'radar', 'superweapon', 'commandEnergy',
      'commandCooldowns', 'salvageEarned', 'kills', 'research']) {
      const value = data[key];
      if (value) data[key] = { player: value.enemy, enemy: value.player };
    }
    if (data.relayDominion?.owner) data.relayDominion.owner = swap(data.relayDominion.owner);
    if (data.storm?.lure?.owner) data.storm.lure.owner = swap(data.storm.lure.owner);
    [data.faction, data.enemyFaction] = [data.enemyFaction, data.faction];
    [data.construction, data.enemyConstruction] = [data.enemyConstruction, data.construction];
    if (data.winner) data.winner = swap(data.winner);
    if (data.status === 'victory') data.status = 'defeat';
    else if (data.status === 'defeat') data.status = 'victory';
  }
  // Snapshots are client-readable. Keep only the receiving commander's private
  // strategic state after orienting the guest's side as "player".
  data.credits.enemy = 0;
  data.creditCapacity.enemy = 0;
  data.power.enemy = { production: 0, consumption: 0, ratio: 1 };
  data.radar.enemy = false;
  data.superweapon.enemy = 0;
  data.commandEnergy.enemy = 0;
  data.commandCooldowns.enemy = Object.fromEntries(Object.keys(data.commandCooldowns.enemy || {})
    .map(abilityId => [abilityId, 0]));
  // Research projects disclose an opponent's strategic choice and progress
  // before completion. Keep the completed doctrine visible, but redact the
  // opponent's private in-progress project just like construction orders.
  if (data.research?.enemy) {
    data.research.enemy.project = null;
    data.research.enemy.tacticalProject = null;
    data.research.enemy.replacementUsed = false;
  }
  if (data.salvageEarned) data.salvageEarned.enemy = 0;
  data.enemyConstruction = null;
  for (const building of data.buildings) if (building.owner === 'enemy') {
    building.queue = [];
    building.rally = null;
    building.repairing = false;
  }
  data.commandOwner = 'player';
  return data;
}
function sendState(lobby, type = 'state') {
  if (type === 'state' && now() - (lobby.lastStateAt || 0) < 100) return;
  lobby.lastStateAt = now();
  for (const member of lobby.members) if (member.ws?.readyState === WebSocket.OPEN)
    emit(member.ws, { type, code: lobby.code, side: member.side, owner: 'player',
      state: projectedState(lobby, member) });
}
function finishMatch(lobby, winner, reason = 'victory') {
  if (!lobby.game || lobby.ended) return;
  const priorRecords = store.multiplayerHistory.filter(record => record.matchId === lobby.matchId);
  const alreadyRated = priorRecords.some(record => record.ranked === true &&
    Number.isSafeInteger(record.ratingBefore) && Number.isSafeInteger(record.ratingAfter) &&
    Number.isSafeInteger(record.ratingDelta));
  lobby.ended = true;
  lobby.game.winner = winner;
  lobby.game.status = winner === 'player' ? 'victory' : 'defeat';
  sendState(lobby);
  const completedAt = now();
  const expiresAt = completedAt + MATCH_OUTCOME_TTL_MS;
  const notifications = [];
  for (const member of lobby.members) {
    const opponent = lobby.members.find(other => other !== member)?.profile;
    const outcome = { type: 'match_end', winner: member.side === winner ? 'player' : 'enemy', reason,
      matchId: lobby.matchId, ranked: lobby.ranked === true, rematchEligible: lobby.ranked !== true,
      ...(opponent?.code ? { opponentFriendCode: opponent.code } : {}),
      ...(opponent?.name ? { opponentName: opponent.name } : {}) };
    const key = `${member.profile.id}:${lobby.code}`;
    recentMatchOutcomes.delete(key);
    recentMatchOutcomes.set(key, { ...outcome, expiresAt });
    const recordId = `${lobby.matchId}:${member.profile.id}`;
    if (opponent && !store.multiplayerHistory.some(record => record.id === recordId)) {
      store.multiplayerHistory.push({ id: recordId, matchId: lobby.matchId,
        profileId: member.profile.id, result: member.side === winner ? 'victory' : 'defeat',
        winnerId: lobby.members.find(other => other.side === winner)?.profile.id,
        opponent: { id: opponent.id, name: opponent.name }, mapId: lobby.game.mapId,
        victoryMode: lobby.game.victoryMode, durationSeconds: Math.max(0, lobby.game.time),
        reason, completedAt, ranked: lobby.ranked === true });
    }
    notifications.push([member, outcome]);
  }
  if (lobby.ranked === true && lobby.members.length === 2 && !alreadyRated) {
    const winnerMember = lobby.members.find(member => member.side === winner);
    const loserMember = lobby.members.find(member => member.side !== winner);
    if (winnerMember && loserMember) {
      const winnerProfile = ensureCurrentRating(winnerMember.profile);
      const loserProfile = ensureCurrentRating(loserMember.profile);
      const beforeWinner = winnerProfile.rating;
      const beforeLoser = loserProfile.rating;
      const delta = rankedTransfer(winnerProfile, loserProfile);
      winnerProfile.rating += delta;
      loserProfile.rating -= delta;
      winnerProfile.wins++;
      loserProfile.losses++;
      for (const member of lobby.members) {
        const record = store.multiplayerHistory.find(item => item.matchId === lobby.matchId &&
          item.profileId === member.profile.id);
        const won = member === winnerMember;
        const values = { ranked: true, ratingBefore: won ? beforeWinner : beforeLoser,
          ratingAfter: won ? winnerProfile.rating : loserProfile.rating, ratingDelta: won ? delta : -delta };
        if (record) Object.assign(record, values);
        const notification = notifications.find(([candidate]) => candidate === member)?.[1];
        if (notification) Object.assign(notification, { rating: values.ratingAfter, ...values });
      }
    }
  } else if (lobby.ranked === true && lobby.members.length === 2 && alreadyRated) {
    // Complete a missing seat history row from the durable rating row while
    // keeping the already applied profile transfer untouched.
    const winnerMember = lobby.members.find(member => member.side === winner);
    const loserMember = lobby.members.find(member => member.side !== winner);
    const ratedRecord = priorRecords.find(record => record.ranked === true &&
      Number.isSafeInteger(record.ratingDelta));
    if (winnerMember && loserMember && ratedRecord) {
      const transfer = Math.abs(ratedRecord.ratingDelta);
      const winnerRecord = priorRecords.find(record => record.profileId === winnerMember.profile.id);
      const loserRecord = priorRecords.find(record => record.profileId === loserMember.profile.id);
      const winnerAfter = Number.isSafeInteger(winnerRecord?.ratingAfter)
        ? winnerRecord.ratingAfter : ensureCurrentRating(winnerMember.profile).rating;
      const loserAfter = Number.isSafeInteger(loserRecord?.ratingAfter)
        ? loserRecord.ratingAfter : ensureCurrentRating(loserMember.profile).rating;
      const winnerValues = { ranked: true,
        ratingBefore: Number.isSafeInteger(winnerRecord?.ratingBefore) ? winnerRecord.ratingBefore : winnerAfter - transfer,
        ratingAfter: winnerAfter, ratingDelta: transfer };
      const loserValues = { ranked: true,
        ratingBefore: Number.isSafeInteger(loserRecord?.ratingBefore) ? loserRecord.ratingBefore : loserAfter + transfer,
        ratingAfter: loserAfter, ratingDelta: -transfer };
      for (const [member, values] of [[winnerMember, winnerValues], [loserMember, loserValues]]) {
        const record = store.multiplayerHistory.find(item => item.matchId === lobby.matchId &&
          item.profileId === member.profile.id);
        if (record) Object.assign(record, values);
        const notification = notifications.find(([candidate]) => candidate === member)?.[1];
        if (notification) Object.assign(notification, { rating: values.ratingAfter, ...values });
      }
    }
  }
  // recentMatchOutcomes initially captures the base terminal message. Refresh
  // it after ranked Elo fields are attached so a reconnect sees the same result.
  for (const member of lobby.members) {
    const key = `${member.profile.id}:${lobby.code}`;
    const outcome = notifications.find(([candidate]) => candidate === member)?.[1];
    if (outcome) recentMatchOutcomes.set(key, { ...outcome, expiresAt });
  }
  if (store.multiplayerHistory.length > MAX_MULTIPLAYER_HISTORY_RECORDS)
    store.multiplayerHistory.splice(0, store.multiplayerHistory.length - MAX_MULTIPLAYER_HISTORY_RECORDS);
  while (recentMatchOutcomes.size > MAX_MATCH_OUTCOMES)
    recentMatchOutcomes.delete(recentMatchOutcomes.keys().next().value);
  clearLobby(lobby);
  // A terminal result must be durable before either seat is told it ended.
  for (const [member, outcome] of notifications) emit(member.ws, outcome);
}
function startMatch(lobby) {
  if (lobby.game || lobby.members.length !== 2 ||
    !lobby.members.every(m => m.ready && m.ws?.readyState === WebSocket.OPEN)) return false;
  if (lobby.acceptTimer) clearTimeout(lobby.acceptTimer);
  lobby.acceptTimer = null;
  const seed = randomInt(1, 0xffffffff);
  const hostMember = lobby.members.find(m => m.profile.id === lobby.hostId);
  const guestMember = lobby.members.find(m => m !== hostMember);
  hostMember.side = 'player'; guestMember.side = 'enemy';
  lobby.matchId = id();
  lobby.game = new Game({ seed, mode: 'multiplayer', faction: hostMember.faction, difficulty: 'normal',
    mapId: lobby.settings?.mapId || 'shard-valley', victoryMode: lobby.settings?.victoryMode || 'dominion' });
  for (const member of lobby.members) {
    member.selection = [];
    member.explored = Array.from({ length: lobby.game.height }, () => Array(lobby.game.width).fill(0));
  }
  sendState(lobby, 'match_start');
  persist();
  lobby.timer = setInterval(() => {
    if (lobby.ended) return;
    lobby.game.update(0.1);
    const reason = lobby.game.events.some(event => event.type === 'relayDominionComplete') ? 'relayDominion' : 'victory';
    // Events are only used locally; multiplayer sends snapshots. Discard them
    // each tick so long matches do not retain an ever-growing event history.
    lobby.game.events.length = 0;
    if (lobby.game.status !== 'playing') finishMatch(lobby, lobby.game.winner, reason);
    else {
      lobby.tick = (lobby.tick || 0) + 1;
      if (lobby.tick % 3 === 0) sendState(lobby);
      if (lobby.tick % MATCH_CHECKPOINT_TICKS === 0) persist();
    }
  }, 100);
  return true;
}

const commandNames = new Set(['issueMove', 'issueForceMove', 'issueAttack', 'issueHarvest', 'issueBloomExpedition', 'issueStop', 'issueGuard', 'issueSetStance', 'issuePatrol', 'issueFollow', 'issueBoard', 'issueUnload', 'issueForceFire', 'issueScatter', 'issueDeploy',
  'startConstruction', 'cancelConstruction', 'issueBuild', 'queueUnit', 'cancelQueuedUnit', 'setRally',
  'toggleRepair', 'useSuperweapon', 'useCommandAbility', 'useUnitAbility', 'issueEngineer', 'issueRecoverWreck', 'issueServiceAtWorkshop', 'issueReturnCargo', 'sellBuilding', 'chooseDoctrine', 'chooseTacticalPackage', 'setRelayProtocol', 'issuePromoteUnit']);
function command(lobby, member, message) {
  const game = lobby.game;
  if (!game || game.status !== 'playing') return { ok: false, reason: 'No active match.' };
  if (!commandNames.has(message.command)) return { ok: false, reason: 'Unknown command.' };
  if (message.queue !== undefined && (typeof message.queue !== 'boolean' ||
      !['issueMove', 'issueForceMove', 'issueAttack'].includes(message.command)))
    return { ok: false, reason: 'Invalid queued order.' };
  const ids = Array.isArray(message.ids) ? message.ids.filter(id => typeof id === 'string').slice(0, 100) : [];
  member.selection = ids.filter(id => game.getEntity(id)?.owner === member.side);
  game.commandOwner = member.side;
  game.select(member.selection);
  const n = value => Number(value);
  try {
    switch (message.command) {
      case 'issueMove': return game.issueMove(n(message.x), n(message.y), Boolean(message.attackMove), message.queue === true);
      case 'issueForceMove': return game.issueForceMove(n(message.x), n(message.y), message.queue === true);
      case 'issueAttack': return game.issueAttack(message.targetId, message.queue === true);
      case 'issueHarvest': return game.issueHarvest();
      case 'issueBloomExpedition': return game.issueBloomExpedition();
      case 'issueStop': return game.issueStop();
      case 'issueGuard': return game.issueGuard();
      case 'issueSetStance': return game.issueSetStance(message.stance);
      case 'issuePatrol': return game.issuePatrol(n(message.x), n(message.y));
      case 'issueFollow': return game.issueFollow(message.targetId);
      case 'issueBoard': return game.issueBoard(message.carrierId);
      case 'issueUnload': return game.issueUnload(n(message.x), n(message.y));
      case 'issueForceFire': return game.issueForceFire(n(message.x), n(message.y));
      case 'issueScatter': return game.issueScatter();
      case 'issueDeploy': return game.issueDeploy(message.unitId || null);
      case 'startConstruction': return game.startConstruction(message.defId);
      case 'cancelConstruction': return game.cancelConstruction();
      case 'issueBuild': return game.issueBuild(message.defId, n(message.x), n(message.y));
      case 'queueUnit': return game.queueUnit(message.defId);
      case 'cancelQueuedUnit': return game.cancelQueuedUnit(message.buildingId, Number.isInteger(message.index) ? message.index : -1);
      case 'setRally': return game.setRally(message.buildingId, n(message.x), n(message.y));
      case 'toggleRepair': return game.toggleRepair(message.buildingId);
      case 'useSuperweapon': return game.useSuperweapon(n(message.x), n(message.y));
      case 'useCommandAbility': return game.useCommandAbility(message.abilityId, n(message.x), n(message.y));
      case 'useUnitAbility': return game.useUnitAbility(message.unitId, message.abilityId);
      case 'issueEngineer': return game.issueEngineer(message.targetId);
      case 'issueRecoverWreck': return game.issueRecoverWreck(message.wreckId);
      case 'issueServiceAtWorkshop': return game.issueServiceAtWorkshop(message.workshopId);
      case 'issueReturnCargo': return game.issueReturnCargo();
      case 'sellBuilding': return game.sellBuilding(message.buildingId);
      case 'chooseDoctrine': return game.chooseDoctrine(message.doctrineId);
      case 'chooseTacticalPackage': return game.chooseTacticalPackage(message.packageId);
      case 'setRelayProtocol': return game.setRelayProtocol(message.relayId, message.protocol);
      case 'issuePromoteUnit': return game.issuePromoteUnit(message.unitId, message.promotionId);
    }
  } finally { game.commandOwner = 'player'; }
}

function handleSocket(ws, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  const time = now();
  if (time - ws.rateStart > 1000) { ws.rateStart = time; ws.rateCount = 0; }
  if (++ws.rateCount > 30) { emit(ws, { type: 'error', error: 'Too many messages.' }); return; }
  if (message.type === 'queue_join') {
    if (message.ranked !== undefined && typeof message.ranked !== 'boolean') {
      emit(ws, { type: 'error', error: 'Ranked must be a boolean.' }); return;
    }
    enqueueMatchmaking(ws, message.ranked === true); return;
  }
  if (message.type === 'queue_status') {
    const entry = matchmakingQueue.get(ws.profile.id);
    const seat = matchmakingSeat(ws.profile.id);
    const ranked = entry ? entry.ranked === true : seat ? seat.lobby.ranked === true : message.ranked === true;
    if (entry && entry.ws === ws) {
      const ownQueue = [...matchmakingQueue.values()].filter(candidate => candidate.ranked === ranked);
      emit(ws, queueStatus(entry, ownQueue.indexOf(entry) + 1));
    } else if (seat) {
      emit(ws, { type: 'matchmaking', status: seat.lobby.game ? 'match_found' : 'match_found', ranked });
    } else emit(ws, { type: 'matchmaking', status: 'idle', ranked });
    return;
  }
  if (message.type === 'queue_leave') {
    if (!removeMatchmakingEntry(ws.profile.id, 'commander_cancelled', ws))
      emit(ws, { type: 'matchmaking', status: 'idle', ranked: message.ranked === true });
    return;
  }
  if (message.type === 'rematch_request') {
    requestRematch(ws, message.matchId); return;
  }
  if (message.type === 'rematch_accept') {
    respondRematch(ws, message.requestId, true); return;
  }
  if (message.type === 'rematch_decline') {
    respondRematch(ws, message.requestId, false); return;
  }
  if (message.type === 'create_lobby') {
    if (ws.lobby?.game?.status === 'playing') {
      emit(ws, { type: 'error', error: 'Leave the current match before creating another room.' }); return;
    }
    removeMatchmakingEntry(ws.profile.id, 'private_room');
    leave(ws);
    let inviteCode;
    do { inviteCode = code(6); } while (lobbies.has(inviteCode));
    const lobby = { code: inviteCode, hostId: ws.profile.id, members: [], game: null, ended: false, ranked: false,
      settings: { mapId: 'shard-valley', victoryMode: 'dominion' } };
    const member = { profile: ws.profile, ws, faction: ['aegis', 'vesper'].includes(message.faction) ? message.faction : 'aegis', ready: false };
    lobby.members.push(member); lobbies.set(inviteCode, lobby); ws.lobby = lobby;
    sendLobby(lobby); return;
  }
  if (message.type === 'join_lobby') {
    const lobby = lobbies.get(String(message.code || '').toUpperCase().trim());
    if (!lobby || lobby.ended) { emit(ws, { type: 'error', error: 'Invitation code was not found.' }); return; }
    if (ws.lobby === lobby) {
      if (lobby.game) sendState(lobby, 'match_start'); else sendLobby(lobby);
      return;
    }
    if (ws.lobby?.game?.status === 'playing') {
      emit(ws, { type: 'error', error: 'Leave the current match before joining another room.' }); return;
    }
    const existing = lobby.members.find(m => m.profile.id === ws.profile.id);
    if (!existing && (lobby.matchmaking || lobby.game || lobby.members.length >= 2)) {
      emit(ws, { type: 'error', error: 'Lobby is full or already playing.' }); return;
    }
    removeMatchmakingEntry(ws.profile.id, 'private_room');
    leave(ws);
    const hostFaction = lobby.members.find(m => m.profile.id === lobby.hostId)?.faction || 'aegis';
    const member = existing || { profile: ws.profile, ws, faction: hostFaction === 'aegis' ? 'vesper' : 'aegis', ready: false };
    if (!existing) lobby.members.push(member);
    attachMemberSocket(lobby, member, ws);
    sendLobby(lobby);
    if (lobby.game) sendState(lobby, 'match_start');
    return;
  }
  if (message.type === 'resume_match') {
    const matchCode = String(message.code || '').toUpperCase().trim();
    // The connection handler already restores a live in-memory seat before the
    // client can send this probe. If it could not, the process no longer has
    // the room state needed to continue that match.
    if (ws.lobby?.code === matchCode && ws.lobby.game) return;
    const outcomeKey = `${ws.profile.id}:${matchCode}`;
    const outcome = recentMatchOutcomes.get(outcomeKey);
    if (outcome) {
      if (outcome.expiresAt > now()) {
        recentMatchOutcomes.delete(outcomeKey);
        const recovered = { type: 'match_end', winner: outcome.winner, reason: outcome.reason,
          matchId: outcome.matchId, ranked: outcome.ranked === true,
          rematchEligible: outcome.rematchEligible === true };
        if (outcome.ranked === true) recovered.ranked = true;
        if (typeof outcome.opponentFriendCode === 'string') recovered.opponentFriendCode = outcome.opponentFriendCode;
        if (typeof outcome.opponentName === 'string') recovered.opponentName = outcome.opponentName;
        for (const key of ['rating', 'ratingDelta', 'ratingBefore', 'ratingAfter'])
          if (Number.isSafeInteger(outcome[key])) recovered[key] = outcome[key];
        emit(ws, recovered);
        return;
      }
      recentMatchOutcomes.delete(outcomeKey);
    }
    emit(ws, { type: 'match_session_lost', code: matchCode, reason: 'room_unavailable' });
    return;
  }
  if (message.type === 'leave_lobby') {
    if (!ws.lobby) removeMatchmakingEntry(ws.profile.id, 'commander_cancelled', ws);
    leave(ws); return;
  }
  const lobby = ws.lobby;
  const member = findMember(ws);
  if (!lobby || !member || member.ws !== ws) { emit(ws, { type: 'error', error: 'Join a lobby first.' }); return; }
  if (message.type === 'set_ready') {
    if (lobby.game) return;
    member.ready = message.ready === true;
    sendLobby(lobby);
    return;
  }
  if (message.type === 'set_settings') {
    if (lobby.game) { emit(ws, { type: 'error', error: 'Match settings cannot change after the match starts.' }); return; }
    if (lobby.matchmaking) { emit(ws, { type: 'error', error: 'Matchmaking settings are fixed.' }); return; }
    if (lobby.hostId !== ws.profile.id) { emit(ws, { type: 'error', error: 'Only the host can change match settings.' }); return; }
    const mapId = message.mapId === undefined ? lobby.settings.mapId : message.mapId;
    const victoryMode = message.victoryMode === undefined ? lobby.settings.victoryMode : message.victoryMode;
    if (typeof mapId !== 'string' || !SKIRMISH_MAPS.some(map => map.id === mapId)) {
      emit(ws, { type: 'error', error: 'Invalid multiplayer map.' }); return;
    }
    if (!['dominion', 'elimination'].includes(victoryMode)) {
      emit(ws, { type: 'error', error: 'Invalid multiplayer victory mode.' }); return;
    }
    const changed = mapId !== lobby.settings.mapId || victoryMode !== lobby.settings.victoryMode;
    lobby.settings = { mapId, victoryMode };
    if (changed) for (const player of lobby.members) player.ready = false;
    sendLobby(lobby); return;
  }
  if (message.type === 'start_match') {
    if (lobby.hostId !== ws.profile.id) emit(ws, { type: 'error', error: 'Only the host can start.' });
    else if (!startMatch(lobby)) emit(ws, { type: 'error', error: 'Both commanders must be ready.' });
    return;
  }
  if (message.type === 'invite_friend') {
    if (lobby.matchmaking) {
      emit(ws, { type: 'error', error: 'Matchmade games cannot invite friends.' }); return;
    }
    if (lobby.game || lobby.members.length >= 2) {
      emit(ws, { type: 'error', error: 'Lobby is full or already playing.' }); return;
    }
    const friendId = String(message.friendId || '');
    if (friendId === ws.profile.id || !store.friendships.some(pair => pair.includes(ws.profile.id) && pair.includes(friendId))) {
      emit(ws, { type: 'error', error: 'That commander is not your friend.' }); return;
    }
    if (!online(friendId)) {
      emit(ws, { type: 'error', error: 'That commander is offline.' }); return;
    }
    const invitedAt = now();
    for (const [key, sentAt] of inviteCooldowns)
      if (invitedAt - sentAt >= INVITE_COOLDOWN_MS) inviteCooldowns.delete(key);
    const inviteKey = `${ws.profile.id}:${friendId}`;
    if (invitedAt - (inviteCooldowns.get(inviteKey) ?? -Infinity) < INVITE_COOLDOWN_MS) {
      emit(ws, { type: 'error', error: 'Please wait before inviting that commander again.' }); return;
    }
    inviteCooldowns.set(inviteKey, invitedAt);
    while (inviteCooldowns.size > MAX_INVITE_COOLDOWNS)
      inviteCooldowns.delete(inviteCooldowns.keys().next().value);
    notify(friendId, { type: 'invite', code: lobby.code, from: publicProfile(ws.profile) });
    emit(ws, { type: 'invite_sent', friendId }); return;
  }
  if (message.type === 'command') {
    const result = command(lobby, member, message);
    const requestId = typeof message.requestId === 'string' && message.requestId.length <= 40 &&
      /^[A-Za-z0-9_-]+$/.test(message.requestId) ? message.requestId : undefined;
    emit(ws, { type: 'command_result', command: message.command, ...result, requestId });
    if (result?.ok) { sendState(lobby); persist(); }
  }
}

function restorePersistedMatch(record) {
  if (!record || record.version !== 1 || typeof record.code !== 'string' ||
      !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(record.code) ||
      typeof record.hostId !== 'string' || lobbies.has(record.code) ||
      !record.settings || !SKIRMISH_MAPS.some(map => map.id === record.settings.mapId) ||
      !['dominion', 'elimination'].includes(record.settings.victoryMode) ||
      !Array.isArray(record.members) || record.members.length !== 2 || typeof record.game !== 'string') return null;
  let data;
  try { data = JSON.parse(record.game); } catch { return null; }
  if (!data || data.mode !== 'multiplayer' || data.status !== 'playing' ||
      !Number.isFinite(data.time) || !Number.isInteger(data.seed) || !Number.isInteger(data.randomState) ||
      !Array.isArray(data.terrain) || !Array.isArray(data.units) || !Array.isArray(data.buildings)) return null;
  let game;
  try { game = Game.deserialize(data); } catch { return null; }
  if (game.mode !== 'multiplayer' || game.status !== 'playing' ||
      game.mapId !== record.settings.mapId || game.victoryMode !== record.settings.victoryMode ||
      !Number.isFinite(game.time) || !Number.isInteger(game.seed) || !Number.isInteger(game.randomState)) return null;
  const members = [];
  const seen = new Set();
  for (const saved of record.members) {
    const profile = store.profiles.find(item => item.id === saved?.profileId);
    if (!profile || seen.has(profile.id) || !['player', 'enemy'].includes(saved.side) ||
        !['aegis', 'vesper'].includes(saved.faction) || typeof saved.ready !== 'boolean' ||
        !Array.isArray(saved.selection) || saved.selection.some(id => typeof id !== 'string') ||
        !Array.isArray(saved.explored) || saved.explored.length !== game.height ||
        saved.explored.some(row => !Array.isArray(row) || row.length !== game.width ||
          row.some(cell => cell !== 0 && cell !== 1))) return null;
    if (saved.terrainMemory !== null && saved.terrainMemory !== undefined &&
        (!Array.isArray(saved.terrainMemory) || saved.terrainMemory.length !== game.height ||
         saved.terrainMemory.some(row => !Array.isArray(row) || row.length !== game.width ||
           row.some(cell => cell !== null && (!cell || typeof cell !== 'object' ||
             typeof cell.type !== 'string' || !Number.isFinite(cell.resource) ||
             typeof cell.walkable !== 'boolean' || typeof cell.buildable !== 'boolean' ||
             !Number.isFinite(cell.shade) || !Number.isFinite(cell.detail)))))) return null;
    if (saved.disconnectedAt !== null && saved.disconnectedAt !== undefined &&
        !Number.isFinite(saved.disconnectedAt)) return null;
    seen.add(profile.id);
    members.push({ profile, ws: null, side: saved.side, faction: saved.faction, ready: saved.ready,
      selection: saved.selection.slice(0, 100), explored: saved.explored,
      terrainMemory: saved.terrainMemory || null, disconnectedAt: saved.disconnectedAt || now(),
      disconnectTimer: null });
  }
  if (new Set(members.map(member => member.side)).size !== 2 ||
      !members.some(member => member.profile.id === record.hostId && member.side === 'player') ||
      members.some(member => member.side === 'player' ? member.faction !== game.faction : member.faction !== game.enemyFaction))
    return null;
  const lobby = { code: record.code, matchId: typeof record.matchId === 'string' && /^[a-f0-9]{24}$/.test(record.matchId)
    ? record.matchId : id(), hostId: record.hostId, settings: record.settings,
    members, game, ended: false, matchmaking: record.matchmaking === true, ranked: record.ranked === true,
    tick: Number.isSafeInteger(record.tick) && record.tick >= 0 ? record.tick : 0 };
  lobbies.set(lobby.code, lobby);
  lobby.timer = setInterval(() => {
    if (lobby.ended) return;
    lobby.game.update(0.1);
    const reason = lobby.game.events.some(event => event.type === 'relayDominionComplete') ? 'relayDominion' : 'victory';
    lobby.game.events.length = 0;
    if (lobby.game.status !== 'playing') finishMatch(lobby, lobby.game.winner, reason);
    else {
      lobby.tick++;
      if (lobby.tick % 3 === 0) sendState(lobby);
      if (lobby.tick % MATCH_CHECKPOINT_TICKS === 0) persist();
    }
  }, 100);
  for (const member of members) {
    const remaining = 20_000 - (now() - member.disconnectedAt);
    if (remaining <= 0) {
      finishMatch(lobby, member.side === 'player' ? 'enemy' : 'player', 'disconnect');
      break;
    }
    member.disconnectTimer = setTimeout(() => {
      if (!member.ws && !lobby.ended)
        finishMatch(lobby, member.side === 'player' ? 'enemy' : 'player', 'disconnect');
    }, remaining);
  }
  return lobby;
}

function restorePersistedNetworkState() {
  const cutoff = now();
  recentMatchOutcomes.clear();
  for (const saved of store.matchOutcomes) {
    const profileId = typeof saved?.key === 'string' ? saved.key.slice(0, saved.key.lastIndexOf(':')) : '';
    const matchCode = typeof saved?.key === 'string' ? saved.key.slice(saved.key.lastIndexOf(':') + 1) : '';
    if (!store.profiles.some(profile => profile.id === profileId) ||
        !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(matchCode) ||
        !Number.isFinite(saved.expiresAt) || saved.expiresAt <= cutoff ||
        !['player', 'enemy'].includes(saved.winner) ||
        !['victory', 'forfeit', 'disconnect', 'relayDominion'].includes(saved.reason)) continue;
    const restoredOutcome = { type: 'match_end', winner: saved.winner,
      reason: saved.reason, expiresAt: saved.expiresAt,
      ranked: saved.ranked === true, rematchEligible: saved.rematchEligible === true };
    if (typeof saved.matchId === 'string' && /^[a-f0-9]{24}$/.test(saved.matchId))
      restoredOutcome.matchId = saved.matchId;
    if (typeof saved.opponentFriendCode === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(saved.opponentFriendCode))
      restoredOutcome.opponentFriendCode = saved.opponentFriendCode;
    if (typeof saved.opponentName === 'string' && saved.opponentName.length <= 20)
      restoredOutcome.opponentName = saved.opponentName;
    for (const key of ['rating', 'ratingDelta', 'ratingBefore', 'ratingAfter'])
      if (Number.isSafeInteger(saved[key])) restoredOutcome[key] = saved[key];
    recentMatchOutcomes.set(saved.key, restoredOutcome);
  }
  for (const saved of store.activeMatches) restorePersistedMatch(saved);
  store.matchOutcomes = [...recentMatchOutcomes.entries()].map(([key, outcome]) => ({ key, ...outcome }));
  store.activeMatches = [...lobbies.values()].map(lobby => ({ version: 1, code: lobby.code, matchId: lobby.matchId,
    hostId: lobby.hostId, matchmaking: lobby.matchmaking === true, ranked: lobby.ranked === true,
    settings: lobby.settings, game: lobby.game.serialize(), tick: lobby.tick,
    members: lobby.members.map(member => ({ profileId: member.profile.id, side: member.side,
      faction: member.faction, ready: member.ready, selection: member.selection || [],
      explored: member.explored, terrainMemory: member.terrainMemory || null,
      disconnectedAt: member.disconnectedAt || null })) }));
  persist();
}

restorePersistedNetworkState();
websocket.on('connection', (ws, req, profile) => {
  ws.profile = profile; ws.rateStart = now(); ws.rateCount = 0; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  if (!sockets.has(profile.id)) sockets.set(profile.id, new Set());
  sockets.get(profile.id).add(ws);
  emit(ws, { type: 'hello', profile: publicProfile(profile) });
  sendFriends(profile.id);
  for (const pair of store.friendships.filter(pair => pair.includes(profile.id))) sendFriends(pair.find(id => id !== profile.id));
  for (const lobby of lobbies.values()) {
    const member = lobby.members.find(m => m.profile.id === profile.id);
    if (!member) continue;
    attachMemberSocket(lobby, member, ws);
    sendLobby(lobby);
    if (lobby.game) sendState(lobby, 'match_start');
    break;
  }
  ws.on('message', raw => {
    try { handleSocket(ws, JSON.parse(raw.toString())); }
    catch { emit(ws, { type: 'error', error: 'Invalid message.' }); }
  });
  ws.on('close', () => {
    sockets.get(profile.id)?.delete(ws);
    if (!sockets.get(profile.id)?.size) sockets.delete(profile.id);
    for (const pair of store.friendships.filter(pair => pair.includes(profile.id))) sendFriends(pair.find(id => id !== profile.id));
    if (ws.queueEntry) removeMatchmakingEntry(profile.id);
    const lobby = ws.lobby;
    if (!lobby) return;
    const member = findMember(ws);
    if (!member || member.ws !== ws) return;
    member.ws = null;
    member.disconnectedAt = now();
    if (lobby.game) persist();
    if (!lobby.game) {
      sendLobby(lobby);
      member.disconnectTimer = setTimeout(() => {
        if (member.ws || lobby.ended || lobby.game) return;
        if (lobby.matchmaking) {
          clearMatchmakingAcceptance(lobby, 'declined');
          return;
        }
        lobby.members = lobby.members.filter(m => m !== member);
        if (!lobby.members.length) clearLobby(lobby);
        else {
          if (lobby.hostId === profile.id) lobby.hostId = lobby.members[0].profile.id;
          for (const remaining of lobby.members) remaining.ready = false;
          sendLobby(lobby);
        }
      }, 20000);
    } else {
      sendLobby(lobby);
      member.disconnectTimer = setTimeout(() => {
        if (!member.ws && !lobby.ended) finishMatch(lobby, member.side === 'player' ? 'enemy' : 'player', 'disconnect');
      }, 20000);
    }
  });
});

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2', '.json': 'application/json' };
function staticFile(req, res, pathname) {
  const dist = path.join(root, 'dist');
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(dist, relative);
  if (!target.startsWith(`${dist}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (pathname !== '/' && !path.extname(pathname) && fs.existsSync(path.join(dist, 'index.html')))
      return staticFile(req, res, '/');
    return fail(res, 404, 'Not found.');
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) return staticFile(req, res, pathname);
    if (pathname === '/api/health' && req.method === 'GET')
      return send(res, 200, { ok: true, rulesVersion: SCORE_VERSION });
    if (pathname === '/api/profile' && req.method === 'POST') {
      const body = await bodyOf(req);
      const supplied = body.token || /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
      if (supplied) {
        const profile = profileForToken(supplied);
        if (profile) return send(res, 200, { token: supplied, profile: publicProfile(profile) });
      }
      const value = token();
      let friendCode;
      do { friendCode = code(); } while (store.profiles.some(p => p.code === friendCode));
      const profile = { id: id(), name: nameFrom(body.name), code: friendCode, tokenHash: hash(value), createdAt: now() };
      store.profiles.push(profile); persist();
      return send(res, 201, { token: value, profile: publicProfile(profile) });
    }
    const profile = bearer(req);
    if (!profile) return fail(res, 401, 'Bearer profile token required.');
    if (pathname === '/api/profile' && req.method === 'GET') return send(res, 200, { profile: publicProfile(profile) });
    if (pathname === '/api/profile' && req.method === 'PATCH') {
      const body = await bodyOf(req);
      profile.name = nameFrom(body.name); persist();
      sendFriends(profile.id);
      for (const pair of store.friendships.filter(pair => pair.includes(profile.id))) sendFriends(pair.find(id => id !== profile.id));
      return send(res, 200, { profile: publicProfile(profile) });
    }
    if (pathname === '/api/friends' && req.method === 'GET') return send(res, 200, friendsFor(profile));
    if (pathname === '/api/multiplayer/rating' && req.method === 'GET') {
      const rating = publicRating(profile);
      persist();
      return send(res, 200, rating);
    }
    if (pathname === '/api/multiplayer/leaderboard' && req.method === 'GET') {
      const entries = store.profiles.filter(item => item && typeof item.id === 'string' &&
        typeof item.name === 'string').map(item => {
        const rating = publicRating(item);
        return { id: item.id, name: item.name, ...rating };
      }).filter(entry => entry.games > 0)
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins || b.games - a.games || a.id.localeCompare(b.id))
        .slice(0, 100);
      persist();
      return send(res, 200, { entries: entries.map(({ season, ...entry }) => entry) });
    }
    if (pathname === '/api/multiplayer/history' && req.method === 'GET') {
      const rawLimit = url.searchParams.get('limit');
      const rawOffset = url.searchParams.get('offset');
      const limit = rawLimit === null ? 30 : Number(rawLimit);
      const offset = rawOffset === null ? 0 : Number(rawOffset);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
          !Number.isSafeInteger(offset) || offset < 0) return fail(res, 400, 'Invalid history pagination.');
      const own = store.multiplayerHistory.filter(record => record.profileId === profile.id)
        .sort((a, b) => b.completedAt - a.completedAt || b.id.localeCompare(a.id));
      return send(res, 200, { entries: own.slice(offset, offset + limit).map(({ profileId, ...entry }) =>
        ({ ...entry, ranked: entry.ranked === true })),
        total: own.length });
    }
    if (pathname === '/api/records/history' && req.method === 'GET') {
      const records = store.history.filter(record => record.profileId === profile.id)
        .sort((a, b) => b.completedAt - a.completedAt || b.id.localeCompare(a.id)).slice(0, 30)
        .map(record => ({ id: record.id, mode: record.mode, scenarioId: record.scenarioId,
          scenarioName: record.scenarioName, difficulty: record.difficulty, faction: record.faction,
        ...(record.mode === 'campaign' ? { doctrineId: record.doctrineId,
            fieldOrderId: record.fieldOrderId, carryoverId: record.carryoverId,
            campaignVeteran: record.campaignVeteran ?? null,
            deployedVeteran: record.deployedVeteran ?? null,
            supplyId: record.supplyId ?? 'none', routePayoffId: record.routePayoffId ?? 'none' } :
            { skirmishOpening: record.skirmishOpening ?? 'established',
              victoryMode: record.victoryMode ?? 'dominion',
              ...(AI_COMMANDER_PROFILES.some(commander => commander.id === record.aiCommanderProfileId)
                ? { aiCommanderProfileId: record.aiCommanderProfileId } : {}) }), seconds: record.seconds, kills: record.kills,
          result: record.result, score: record.scoreId ? (() => {
            const score = store.scores.find(item => item.id === record.scoreId);
            return score ? scoreValue(score) : null;
          })() : null,
          completedAt: record.completedAt }));
      return send(res, 200, { entries: records });
    }
    if (pathname === '/api/campaign/progress' && req.method === 'GET') {
      const difficulties = Object.fromEntries(['easy', 'normal', 'hard'].map(difficulty =>
        [difficulty, campaignProgressForProfile(profile.id, difficulty)]));
      return send(res, 200, { profileId: profile.id, rulesVersion: SCORE_VERSION, difficulties });
    }
    if (pathname === '/api/campaign/carryover-unlocks' && req.method === 'GET') {
      const rawMissionIndex = url.searchParams.get('missionIndex');
      const missionIndex = rawMissionIndex === null ? NaN : Number(rawMissionIndex);
      const difficulty = url.searchParams.get('difficulty');
      if (!Number.isInteger(missionIndex) || missionIndex < 0 || missionIndex >= CAMPAIGN_MISSIONS.length)
        return fail(res, 400, 'Invalid campaign mission index.');
      if (!['easy', 'normal', 'hard'].includes(difficulty)) return fail(res, 400, 'Invalid difficulty.');
      const completedOrderIds = completedPreviousFieldOrders(profile.id, difficulty, missionIndex);
      const balance = requisitionBalance(profile.id, difficulty, missionIndex);
      return send(res, 200, { missionIndex, difficulty,
        carryoverIds: getCampaignCarryoverUnlocks(missionIndex, completedOrderIds),
        campaignVeteran: verifiedCampaignVeteran(profile.id, difficulty, missionIndex),
        requisitionBalance: balance,
        rankedAvailable: campaignMissionUnlockedForProfile(profile.id, difficulty, missionIndex),
        routePayoffId: [4, 5].includes(missionIndex)
          ? verifiedCampaignRoutePayoff(profile.id, difficulty) : 'none' });
    }
    if (pathname === '/api/friends/requests' && req.method === 'POST') {
      const body = await bodyOf(req);
      const target = store.profiles.find(p => p.code === String(body.code || '').toUpperCase().trim());
      if (!target || target.id === profile.id) return fail(res, 400, 'Friend code is invalid.');
      if (store.friendships.some(pair => pair.includes(profile.id) && pair.includes(target.id)))
        return fail(res, 409, 'Already friends.');
      const previous = store.requests.find(r => r.status === 'pending' && r.from === target.id && r.to === profile.id);
      if (previous) return fail(res, 409, 'This commander has already sent you a request. Accept it instead.');
      if (store.requests.some(r => r.status === 'pending' && r.from === profile.id && r.to === target.id))
        return fail(res, 409, 'Request already sent.');
      const request = { id: id(), from: profile.id, to: target.id, status: 'pending', createdAt: now() };
      store.requests.push(request); persist();
      sendFriends(target.id); sendFriends(profile.id);
      return send(res, 201, { request: { id: request.id, from: publicProfile(profile), to: publicProfile(target) } });
    }
    const accept = /^\/api\/friends\/requests\/([a-f0-9]+)\/accept$/.exec(pathname);
    if (accept && req.method === 'POST') {
      const request = store.requests.find(r => r.id === accept[1] && r.to === profile.id && r.status === 'pending');
      if (!request) return fail(res, 404, 'Friend request was not found.');
      request.status = 'accepted';
      store.friendships.push([request.from, request.to]); persist();
      sendFriends(request.from); sendFriends(request.to);
      return send(res, 200, { friend: publicProfile(store.profiles.find(p => p.id === request.from)) });
    }
    if (pathname === '/api/leaderboard' && req.method === 'GET') {
      const requestedDifficulty = url.searchParams.get('difficulty');
      const requestedFaction = url.searchParams.get('faction');
      const requestedMode = url.searchParams.get('mode');
      const requestedScenario = url.searchParams.get('scenarioId');
      const requestedDoctrine = url.searchParams.get('doctrineId');
      const requestedFieldOrder = url.searchParams.get('fieldOrderId');
      const requestedCarryover = url.searchParams.get('carryoverId');
      const requestedVeteran = url.searchParams.get('veteran');
      const requestedSupply = url.searchParams.get('supplyId');
      const requestedRoutePayoff = url.searchParams.get('routePayoffId');
      const requestedOpening = url.searchParams.get('skirmishOpening');
      const requestedVictoryMode = url.searchParams.get('victoryMode');
      const requestedCommanderProfile = url.searchParams.get('aiCommanderProfileId');
      if (requestedDifficulty && !['easy', 'normal', 'hard'].includes(requestedDifficulty))
        return fail(res, 400, 'Invalid difficulty.');
      if (requestedFaction && !['aegis', 'vesper'].includes(requestedFaction))
        return fail(res, 400, 'Invalid faction.');
      if (requestedMode && !['campaign', 'skirmish'].includes(requestedMode))
        return fail(res, 400, 'Invalid mode.');
      if (requestedOpening !== null && (!['established', 'command-rig'].includes(requestedOpening) ||
          requestedMode === 'campaign')) return fail(res, 400, 'Invalid skirmish opening filter.');
      if (requestedVictoryMode !== null && (!['dominion', 'elimination'].includes(requestedVictoryMode) ||
          requestedMode === 'campaign')) return fail(res, 400, 'Invalid skirmish victory mode filter.');
      if (requestedCommanderProfile !== null &&
          (!AI_COMMANDER_PROFILES.some(commander => commander.id === requestedCommanderProfile) ||
            requestedMode === 'campaign')) return fail(res, 400, 'Invalid AI commander profile filter.');
      if (requestedScenario) {
        const knownInMode = requestedMode === 'campaign' ? CAMPAIGN_MISSIONS
          : requestedMode === 'skirmish' ? SKIRMISH_MAPS : [...CAMPAIGN_MISSIONS, ...SKIRMISH_MAPS];
        if (!knownInMode.some(scenario => scenario.id === requestedScenario))
          return fail(res, 400, 'Invalid scenario.');
      }
      if (requestedDoctrine !== null) {
        if (!CAMPAIGN_DOCTRINES.some(doctrine => doctrine.id === requestedDoctrine) ||
            requestedMode === 'skirmish' ||
            (requestedScenario && !CAMPAIGN_MISSIONS.some(mission => mission.id === requestedScenario)))
          return fail(res, 400, 'Invalid campaign doctrine filter.');
      }
      if (requestedFieldOrder !== null &&
          (!knownFieldOrder(requestedFieldOrder) || requestedMode === 'skirmish' ||
            requestedScenario && (!CAMPAIGN_MISSIONS.some(mission => mission.id === requestedScenario) ||
              !validFieldOrder(requestedScenario, requestedFieldOrder))))
        return fail(res, 400, 'Invalid campaign field order filter.');
      if (requestedCarryover !== null &&
          (!CAMPAIGN_CARRYOVERS.some(carryover => carryover.id === requestedCarryover) ||
            requestedMode === 'skirmish' ||
            requestedScenario && (!CAMPAIGN_MISSIONS.some(mission => mission.id === requestedScenario) ||
              requestedScenario === CAMPAIGN_MISSIONS[0].id && requestedCarryover !== 'none')))
        return fail(res, 400, 'Invalid campaign carryover filter.');
      if (requestedVeteran !== null &&
          (!['none', 'veteran', 'elite'].includes(requestedVeteran) || requestedMode === 'skirmish' ||
            requestedScenario && (!CAMPAIGN_MISSIONS.some(mission => mission.id === requestedScenario) ||
              requestedScenario === CAMPAIGN_MISSIONS[0].id && requestedVeteran !== 'none')))
        return fail(res, 400, 'Invalid campaign survivor filter.');
      if (requestedSupply !== null &&
          (!knownSupply(requestedSupply) || requestedMode === 'skirmish' ||
            requestedScenario && (!CAMPAIGN_MISSIONS.some(mission => mission.id === requestedScenario) ||
              requestedMode === 'skirmish')))
        return fail(res, 400, 'Invalid campaign supply filter.');
      if (requestedRoutePayoff !== null &&
          (!CAMPAIGN_ROUTE_PAYOFFS.some(payoff => payoff.id === requestedRoutePayoff) ||
            requestedMode === 'skirmish' || requestedScenario &&
              !['red-ledger', 'ashes-in-transit'].includes(requestedScenario)))
        return fail(res, 400, 'Invalid campaign route payoff filter.');
      const difficulty = requestedDifficulty || null;
      const mode = requestedMode || null;
      const skirmishBoard = requestedMode === 'skirmish' || requestedOpening !== null ||
        requestedVictoryMode !== null || requestedCommanderProfile !== null ||
        SKIRMISH_MAPS.some(map => map.id === requestedScenario);
      const entries = store.scores.filter(score => comparableRankedScore(score) && score.verified === true &&
        (!difficulty || score.difficulty === difficulty) &&
        (!requestedFaction || score.faction === requestedFaction) && (!mode || score.mode === mode) &&
        (!requestedScenario || score.scenarioId === requestedScenario) &&
        (requestedOpening !== null || !skirmishBoard || score.mode !== 'skirmish' ||
          (score.skirmishOpening ?? 'established') === 'established') &&
        (requestedOpening === null || score.mode === 'skirmish' &&
          (score.skirmishOpening ?? 'established') === requestedOpening) &&
        (requestedVictoryMode !== null || !skirmishBoard || score.mode !== 'skirmish' ||
          (score.victoryMode ?? 'dominion') === 'dominion') &&
        (requestedVictoryMode === null || score.mode === 'skirmish' &&
          (score.victoryMode ?? 'dominion') === requestedVictoryMode) &&
        (requestedCommanderProfile === null || score.mode === 'skirmish' &&
          score.aiCommanderProfileId === requestedCommanderProfile) &&
        (requestedDoctrine === null || score.mode === 'campaign' &&
          (score.doctrineId ?? 'standard') === requestedDoctrine) &&
        (requestedFieldOrder === null || score.mode === 'campaign' &&
          (score.fieldOrderId ?? 'none') === requestedFieldOrder) &&
        (requestedCarryover === null || score.mode === 'campaign' &&
          (score.carryoverId ?? 'none') === requestedCarryover) &&
        (requestedVeteran === null || score.mode === 'campaign' &&
          (validateCampaignVeteran(score.deployedVeteran) && score.deployedVeteran
            ? score.deployedVeteran.veterancy === 2 ? 'elite' : 'veteran' : 'none') === requestedVeteran) &&
        (requestedSupply === null || score.mode === 'campaign' &&
          (score.supplyId ?? 'none') === requestedSupply) &&
        (requestedRoutePayoff === null || score.mode === 'campaign' &&
          ['red-ledger', 'ashes-in-transit'].includes(score.scenarioId) &&
          (score.routePayoffId ?? 'none') === requestedRoutePayoff))
        .sort((a, b) => scoreValue(b) - scoreValue(a) || a.seconds - b.seconds || a.completedAt - b.completedAt).slice(0, 100)
        .map(score => ({ id: score.id, player: publicProfile(store.profiles.find(p => p.id === score.profileId)),
          difficulty: score.difficulty, faction: score.faction, mode: score.mode, seconds: score.seconds,
          ...(score.scenarioId ? { scenarioId: score.scenarioId, scenarioName: score.scenarioName } : {}),
          ...(score.mode === 'campaign' ? { doctrineId: score.doctrineId ?? 'standard',
            fieldOrderId: score.fieldOrderId ?? 'none', fieldOrderStatus: score.fieldOrderStatus ?? 'none',
            carryoverId: score.carryoverId ?? 'none', supplyId: score.supplyId ?? 'none',
            deployedVeteran: score.deployedVeteran ?? null,
            routePayoffId: score.routePayoffId ?? 'none' } : {}),
          ...(score.mode === 'skirmish' ? { skirmishOpening: score.skirmishOpening ?? 'established',
            victoryMode: score.victoryMode ?? 'dominion',
            aiCommanderProfileId: score.aiCommanderProfileId } : {}),
          kills: score.kills, result: 'victory', score: scoreValue(score), completedAt: score.completedAt, verified: true }));
      return send(res, 200, { entries, note: 'Boards include verified scores under comparable rules. Route filters span Red Ledger and Ashes in Transit unless a mission is selected. Verified battles remain in My Battles.' });
    }
    if (pathname === '/api/scores/runs' && req.method === 'POST') {
      const body = await bodyOf(req);
      if (Object.hasOwn(body, 'campaignVeteran'))
        return fail(res, 400, 'Campaign veterans are derived from verified campaign results.');
      if (Object.hasOwn(body, 'aiCommanderProfileId'))
        return fail(res, 400, 'AI commander profiles are derived from the server-issued run seed.');
      if (!['skirmish', 'campaign'].includes(body.mode) || !['easy', 'normal', 'hard'].includes(body.difficulty) ||
        !['aegis', 'vesper'].includes(body.faction)) return fail(res, 400, 'Invalid run settings.');
      if (body.mode === 'skirmish' && body.skirmishOpening !== undefined &&
          !['established', 'command-rig'].includes(body.skirmishOpening))
        return fail(res, 400, 'Invalid skirmish opening.');
      if (body.mode === 'skirmish' && body.victoryMode !== undefined &&
          !['dominion', 'elimination'].includes(body.victoryMode))
        return fail(res, 400, 'Invalid skirmish victory mode.');
      if (body.mode === 'campaign' && Object.hasOwn(body, 'skirmishOpening'))
        return fail(res, 400, 'Campaign runs cannot have a skirmish opening.');
      if (body.mode === 'campaign' && Object.hasOwn(body, 'victoryMode'))
        return fail(res, 400, 'Campaign runs cannot have a skirmish victory mode.');
      if (body.mode === 'campaign' && Object.hasOwn(body, 'routePayoffId'))
        return fail(res, 400, 'Campaign route payoffs are derived from verified branch victories.');
      const scenarios = body.mode === 'campaign' ? CAMPAIGN_MISSIONS : SKIRMISH_MAPS;
      let scenario = null;
      if (body.scenarioId !== undefined && body.scenarioId !== 'random') {
        if (typeof body.scenarioId !== 'string') return fail(res, 400, 'Invalid scenario.');
        scenario = scenarios.find(item => item.id === body.scenarioId);
        if (!scenario) return fail(res, 400, 'Invalid scenario.');
      } else if (body.mode === 'campaign' && body.scenarioId === 'random') {
        return fail(res, 400, 'Invalid scenario.');
      }
      if (!scenario && body.mode === 'campaign') scenario = CAMPAIGN_MISSIONS.find(item => item.faction === body.faction);
      if (body.mode === 'campaign' && scenario.faction !== body.faction)
        return fail(res, 400, 'Campaign faction does not match its mission.');
      if (body.mode === 'campaign') {
        if (body.doctrineId !== undefined &&
            !CAMPAIGN_DOCTRINES.some(doctrine => doctrine.id === body.doctrineId))
          return fail(res, 400, 'Invalid campaign doctrine.');
        if (!validFieldOrder(scenario.id, body.fieldOrderId === undefined ? 'none' : body.fieldOrderId))
          return fail(res, 400, 'Invalid campaign field order for this mission.');
        const missionIndex = CAMPAIGN_MISSIONS.findIndex(mission => mission.id === scenario.id);
        if (!campaignMissionUnlockedForProfile(profile.id, body.difficulty, missionIndex))
          return fail(res, 403, 'Campaign mission is not unlocked for this profile and difficulty.');
        const carryoverId = body.carryoverId === undefined ? 'none' : body.carryoverId;
        if (!CAMPAIGN_CARRYOVERS.some(carryover => carryover.id === carryoverId) ||
            missionIndex === 0 && carryoverId !== 'none')
          return fail(res, 400, 'Invalid campaign carryover for this mission.');
        const completedOrderIds = completedPreviousFieldOrders(profile.id, body.difficulty, missionIndex);
        if (!getCampaignCarryoverUnlocks(missionIndex, completedOrderIds).includes(carryoverId))
          return fail(res, 403, 'Campaign carryover is not unlocked for this difficulty.');
        const supplyId = body.supplyId === undefined ? 'none' : body.supplyId;
        if (!knownSupply(supplyId) || missionIndex === 0 && supplyId !== 'none')
          return fail(res, 400, 'Invalid campaign supply package for this mission.');
        if (supplyId !== 'none' && requisitionBalance(profile.id, body.difficulty, missionIndex) < 1)
          return fail(res, 403, 'Campaign requisition is not available for this difficulty.');
      } else if (Object.hasOwn(body, 'doctrineId')) {
        return fail(res, 400, 'Skirmish runs cannot have a campaign doctrine.');
      } else if (Object.hasOwn(body, 'fieldOrderId')) {
        return fail(res, 400, 'Skirmish runs cannot have a campaign field order.');
      } else if (Object.hasOwn(body, 'carryoverId')) {
        return fail(res, 400, 'Skirmish runs cannot have campaign carryover.');
      } else if (Object.hasOwn(body, 'supplyId')) {
        return fail(res, 400, 'Skirmish runs cannot have campaign supply.');
      }
      const seed = randomInt(1, 0xffffffff);
      const aiCommanderProfileId = body.mode === 'skirmish' ? aiCommanderProfileForSeed(seed).id : null;
      if (!scenario && body.mode === 'skirmish') scenario = SKIRMISH_MAPS[seed % SKIRMISH_MAPS.length];
      const run = { id: id(), profileId: profile.id, rulesVersion: SCORE_VERSION,
        mode: body.mode, difficulty: body.difficulty,
        faction: body.faction, seed, ...(body.mode === 'skirmish' ? {
          skirmishOpening: body.skirmishOpening ?? 'established', victoryMode: body.victoryMode ?? 'dominion',
          aiCommanderProfileId } : {}),
        ...(body.mode === 'campaign' ? { doctrineId: body.doctrineId ?? 'standard',
          fieldOrderId: body.fieldOrderId ?? 'none', carryoverId: body.carryoverId ?? 'none',
          campaignVeteran: verifiedCampaignVeteran(profile.id, body.difficulty,
            CAMPAIGN_MISSIONS.findIndex(item => item.id === scenario.id)),
          supplyId: body.supplyId ?? 'none', routePayoffId: ['red-ledger', 'ashes-in-transit'].includes(scenario.id)
            ? verifiedCampaignRoutePayoff(profile.id, body.difficulty) : 'none' } : {}),
        ...(scenario ? { scenarioId: scenario.id,
          scenarioName: body.mode === 'campaign' ? scenario.title : scenario.name } : {}),
        startedAt: now(), finishedAt: null };
      validateSoloEnvelope(run);
      // Only the latest run can be finished. An old browser tab cannot submit
      // a victory after a newer run has started on the same profile.
      for (const previous of store.runs) if (previous.profileId === profile.id && !previous.finishedAt)
        previous.finishedAt = run.startedAt;
      store.runs.push(run);
      store.runs = store.runs.filter(r => r.finishedAt || now() - r.startedAt < 86400000).slice(-2000);
      persist();
      return send(res, 201, { runId: run.id, seed: run.seed, startedAt: run.startedAt,
        rulesVersion: run.rulesVersion,
        ...(run.mode === 'campaign' ? { doctrineId: run.doctrineId, fieldOrderId: run.fieldOrderId,
          carryoverId: run.carryoverId, campaignVeteran: run.campaignVeteran ?? null,
          supplyId: run.supplyId, routePayoffId: run.routePayoffId ?? 'none' } : {}),
        ...(run.mode === 'skirmish' ? { skirmishOpening: run.skirmishOpening ?? 'established',
          victoryMode: run.victoryMode ?? 'dominion', aiCommanderProfileId: run.aiCommanderProfileId } : {}),
        ...(scenario ? { scenarioId: run.scenarioId, scenarioName: run.scenarioName } : {}) });
    }
    const finish = /^\/api\/scores\/runs\/([a-f0-9]+)\/finish$/.exec(pathname);
    if (finish && req.method === 'POST') {
      const run = store.runs.find(r => r.id === finish[1] && r.profileId === profile.id);
      if (!run) return fail(res, 404, 'Run is missing or already finished.');
      // Keep a compact terminal result on the run so a client can recover when
      // the verification response was lost. Abandoned and superseded runs do
      // not have this marker and remain rejected.
      if (run.verifiedResult) {
        const entry = run.scoreId ? store.scores.find(score => score.id === run.scoreId) : null;
        return send(res, 200, { accepted: true, result: run.verifiedResult, entry: entry && {
          ...entry, player: publicProfile(profile), result: 'victory', score: scoreValue(entry) } });
      }
      if (run.finishedAt) return fail(res, 404, 'Run is missing or already finished.');
      if (run.rulesVersion !== SCORE_VERSION) {
        run.finishedAt = now();
        persist();
        return fail(res, 409, 'Run uses an outdated ruleset and cannot be verified.');
      }
      const body = await bodyOf(req, MAX_REPLAY_BODY_BYTES);
      if (body.abandon === true) {
        run.finishedAt = now();
        persist();
        return send(res, 200, { accepted: true, entry: null });
      }
      if (verifyingRuns.has(run.id)) return fail(res, 409, 'Run is already being verified.');
      if (activeVerifications >= MAX_VERIFICATIONS) return fail(res, 503, 'Replay verification is busy.');
      const envelope = { mode: run.mode, difficulty: run.difficulty, faction: run.faction,
        seed: run.seed, scenarioId: run.scenarioId,
        ...(run.mode === 'skirmish' ? { skirmishOpening: run.skirmishOpening ?? 'established',
          victoryMode: run.victoryMode ?? 'dominion',
          aiCommanderProfileId: run.aiCommanderProfileId ?? aiCommanderProfileForSeed(run.seed, run.rulesVersion).id } : {}),
        ...(run.mode === 'campaign' ? { doctrineId: run.doctrineId ?? 'standard',
          fieldOrderId: run.fieldOrderId ?? 'none', carryoverId: run.carryoverId ?? 'none',
          campaignVeteran: run.campaignVeteran ?? null,
          supplyId: run.supplyId ?? 'none', routePayoffId: run.routePayoffId ?? 'none' } : {}) };
      try { validateSoloReplay(envelope, body.commands, body.completedTicks); }
      catch (error) { return fail(res, 400, error.message); }
      if (body.completedTicks === 0 || body.completedTicks > MAX_SOLO_TICKS ||
          body.completedTicks * SOLO_STEP_SECONDS > (now() - run.startedAt) / 1000 + 15 ||
          now() - run.startedAt > 14_400_000)
        return fail(res, 400, 'Run time is outside accepted bounds.');
      verifyingRuns.add(run.id);
      let replay;
      try { replay = await verifyReplay(envelope, body.commands, body.completedTicks); }
      catch (error) {
        verifyingRuns.delete(run.id);
        if (error.message === 'Replay verification timed out.') return fail(res, 408, error.message);
        return fail(res, 400, `Invalid replay: ${error.message}`);
      }
      verifyingRuns.delete(run.id);
      if (run.finishedAt) return fail(res, 409, 'Run was superseded during verification.');
      if (!['victory', 'defeat'].includes(replay.status) ||
          replay.winner !== (replay.status === 'victory' ? 'player' : 'enemy'))
        return fail(res, 400, 'Replay has not reached a valid terminal result.');
      run.finishedAt = now();
      const record = { id: id(), profileId: profile.id, mode: run.mode, scenarioId: run.scenarioId,
        scenarioName: run.scenarioName, difficulty: run.difficulty, faction: run.faction,
        ...(run.mode === 'campaign' ? { doctrineId: run.doctrineId ?? 'standard',
          fieldOrderId: run.fieldOrderId ?? 'none', carryoverId: run.carryoverId ?? 'none',
          campaignVeteran: replay.status === 'victory' && validateCampaignVeteran(replay.campaignVeteran)
            ? replay.campaignVeteran : null,
          deployedVeteran: run.campaignVeteran ?? null,
          supplyId: run.supplyId ?? 'none', routePayoffId: run.routePayoffId ?? 'none' } :
          { skirmishOpening: run.skirmishOpening ?? 'established', victoryMode: run.victoryMode ?? 'dominion',
            aiCommanderProfileId: run.aiCommanderProfileId ?? aiCommanderProfileForSeed(run.seed, run.rulesVersion).id }),
        seconds: Math.max(1, Math.ceil(replay.seconds)), kills: replay.kills, result: replay.status,
        completedAt: run.finishedAt };
      store.history.push(record);
      if (store.history.length > MAX_HISTORY_RECORDS)
        store.history.splice(0, store.history.length - MAX_HISTORY_RECORDS);
      let entry = null;
      if (replay.status === 'victory') {
        entry = { id: id(), profileId: profile.id, mode: run.mode, difficulty: run.difficulty,
          faction: run.faction, scenarioId: run.scenarioId, scenarioName: run.scenarioName,
        ...(run.mode === 'skirmish' ? { skirmishOpening: run.skirmishOpening ?? 'established',
          victoryMode: run.victoryMode ?? 'dominion',
          aiCommanderProfileId: run.aiCommanderProfileId ?? aiCommanderProfileForSeed(run.seed, run.rulesVersion).id } : {}),
          ...(run.mode === 'campaign' ? { doctrineId: run.doctrineId ?? 'standard',
            fieldOrderId: run.fieldOrderId ?? 'none',
            fieldOrderStatus: replay.campaignResult?.fieldOrderStatus ?? 'none',
            campaignStars: Number.isInteger(replay.campaignResult?.stars) && replay.campaignResult.stars >= 1 &&
              replay.campaignResult.stars <= 3 ? replay.campaignResult.stars : 1,
            campaignVeteran: validateCampaignVeteran(replay.campaignVeteran) ? replay.campaignVeteran : null,
            deployedVeteran: run.campaignVeteran ?? null,
            carryoverId: run.carryoverId ?? 'none', supplyId: run.supplyId ?? 'none',
            routePayoffId: run.routePayoffId ?? 'none' } : {}),
          seconds: Math.max(1, Math.ceil(replay.seconds)), kills: replay.kills,
          completedAt: run.finishedAt, scoreVersion: SCORE_VERSION, verified: true };
        store.scores.push(entry);
      }
      run.verifiedResult = replay.status;
      if (entry) run.scoreId = entry.id;
      record.scoreId = entry?.id ?? null;
      run.historyId = record.id;
      persist();
      return send(res, 200, { accepted: true, result: replay.status, entry: entry && { ...entry,
        player: publicProfile(profile), result: 'victory', score: scoreValue(entry) } });
    }
    return fail(res, 404, 'Not found.');
  } catch (error) {
    if (error instanceof SyntaxError) return fail(res, 400, 'Invalid JSON.');
    if (/too large/.test(error.message)) return fail(res, 413, error.message);
    console.error(error);
    return fail(res, 500, 'Server error.');
  }
});
server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const profile = profileForToken(url.searchParams.get('token'));
    if (!profile) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    websocket.handleUpgrade(req, socket, head, ws => websocket.emit('connection', ws, req, profile));
  } catch { socket.destroy(); }
});
server.on('close', () => clearInterval(socketHeartbeat));

if (process.env.NODE_ENV !== 'test') server.listen(port, host, () => {
  console.log(`Frontier Command server listening on http://${host}:${port}`);
});
export { server, websocket, lobbies, store, projectedState };
