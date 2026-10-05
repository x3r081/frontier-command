import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { Game, SKIRMISH_MAPS, UNIT_DEFS, AI_COMMANDER_PROFILES, aiCommanderProfileForSeed } from '../src/game/engine.js';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS, createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { deriveCampaignVeteran } from '../src/game/campaignVeteran.js';
import { createSoloPlayback, createSoloRecorder, validateSoloEnvelope, SOLO_REPLAY_VERSION } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-server-test-'));
process.env.NODE_ENV = 'test';
process.env.FRONTIER_DATA_FILE = path.join(tempDir, 'data.json');
process.env.FRONTIER_MATCHMAKING_WAIT_MS = '700';
process.env.FRONTIER_MATCHMAKING_ACCEPT_MS = '700';
process.env.FRONTIER_RANKED_INITIAL_RANGE = '100';
process.env.FRONTIER_RANKED_RANGE_STEP = '100';
process.env.FRONTIER_RANKED_RANGE_STEP_MS = '100';
process.env.FRONTIER_RANKED_RANGE_FULL_MS = '600';
process.env.FRONTIER_MATCHMAKING_STATUS_MS = '50';
process.env.FRONTIER_SOCKET_HEARTBEAT_MS = '100';
process.env.FRONTIER_REMATCH_TTL_MS = '400';
const { server, websocket, store, lobbies, projectedState } = await import('./index.js');
const clients = new Set();
server.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function createProfile(name) {
  const response = await fetch(`${baseUrl}/api/profile`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 201);
  return response.json();
}
async function setProfileRating(profile, rating, seasonOffset = 0) {
  const response = await api('/api/multiplayer/rating', profile.token);
  assert.equal(response.status, 200);
  const { season } = await response.json();
  const stored = store.profiles.find(item => item.id === profile.profile.id);
  Object.assign(stored, { ratingSeason: season + seasonOffset, rating, wins: 0, losses: 0 });
  return season;
}
const auth = token => ({ Authorization: `Bearer ${token}` });
async function api(pathname, token, options = {}) {
  return fetch(`${baseUrl}${pathname}`, { ...options, headers: { ...(token ? auth(token) : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
}
const json = value => JSON.stringify(value);
function openSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?token=${token}`);
    clients.add(ws);
    ws.messages = [];
    ws.on('message', raw => { ws.messages.push(JSON.parse(raw.toString())); });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
function nextMessage(ws, predicate = () => true, timeoutMs = 2500) {
  const queuedIndex = ws.messages.findIndex(predicate);
  if (queuedIndex !== -1) return Promise.resolve(ws.messages.splice(queuedIndex, 1)[0]);
  return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { ws.off('message', onMessage); reject(new Error(`Timed out waiting for socket message; queued: ${JSON.stringify(ws.messages).slice(0, 2000)}`)); }, timeoutMs);
    const onMessage = () => {
      const index = ws.messages.findIndex(predicate);
      if (index === -1) return;
      clearTimeout(timeout); ws.off('message', onMessage); resolve(ws.messages.splice(index, 1)[0]);
    };
    ws.on('message', onMessage);
  });
}
function sendSocket(ws, message) { ws.send(json(message)); }

test('health reports the ranked replay rules version', async () => {
  const response = await api('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, rulesVersion: SOLO_REPLAY_VERSION });
});

test('campaign progress is authenticated, profile and difficulty scoped, and derived only from verified victories', async () => {
  const owner = await createProfile('Dossier Owner');
  const other = await createProfile('Dossier Other');
  const anonymous = await api('/api/campaign/progress');
  assert.equal(anonymous.status, 401);

  const common = { mode: 'campaign', verified: true, scoreVersion: 30, result: 'victory',
    completedAt: 100, fieldOrderStatus: 'none', fieldOrderId: 'none' };
  store.scores.push(
    { ...common, id: 'dossier-first-harvest', profileId: owner.profile.id,
      scenarioId: 'first-harvest', faction: 'aegis', difficulty: 'normal' },
    { ...common, id: 'dossier-silent-switch', profileId: owner.profile.id,
      scenarioId: 'silent-switch', faction: 'aegis', difficulty: 'normal',
      fieldOrderId: CAMPAIGN_FIELD_ORDERS[1][0].id, fieldOrderStatus: 'completed', campaignStars: 2 },
    { ...common, id: 'dossier-black-shard', profileId: owner.profile.id,
      scenarioId: 'black-shard', faction: 'aegis', difficulty: 'normal' },
    { ...common, id: 'dossier-ghost-channel', profileId: owner.profile.id,
      scenarioId: 'ghost-channel', faction: 'aegis', difficulty: 'normal', campaignStars: 3,
      fieldOrderId: CAMPAIGN_FIELD_ORDERS[13][1].id, fieldOrderStatus: 'completed' },
    { ...common, id: 'dossier-iron-current-later', profileId: owner.profile.id,
      scenarioId: 'iron-current', faction: 'aegis', difficulty: 'normal', completedAt: 200,
      fieldOrderId: CAMPAIGN_FIELD_ORDERS[14][0].id, fieldOrderStatus: 'completed' },
    { ...common, id: 'dossier-hard-first', profileId: owner.profile.id,
      scenarioId: 'first-harvest', faction: 'aegis', difficulty: 'hard', scoreVersion: 8 },
    { ...common, id: 'dossier-other-first', profileId: other.profile.id,
      scenarioId: 'first-harvest', faction: 'aegis', difficulty: 'normal', campaignStars: 3 },
    { ...common, id: 'dossier-defeat', profileId: owner.profile.id,
      scenarioId: 'silent-switch', faction: 'aegis', difficulty: 'hard', result: 'defeat', campaignStars: 3 },
    { ...common, id: 'dossier-unverified', profileId: owner.profile.id,
      scenarioId: 'silent-switch', faction: 'aegis', difficulty: 'hard', verified: false, campaignStars: 3 },
    { ...common, id: 'dossier-wrong-faction', profileId: owner.profile.id,
      scenarioId: 'silent-switch', faction: 'vesper', difficulty: 'hard', campaignStars: 3 },
    { ...common, id: 'dossier-unsupported-rules', profileId: owner.profile.id,
      scenarioId: 'silent-switch', faction: 'aegis', difficulty: 'hard', scoreVersion: SOLO_REPLAY_VERSION + 1,
      campaignStars: 3 },
  );

  const response = await api('/api/campaign/progress', owner.token);
  assert.equal(response.status, 200);
  const dossier = await response.json();
  assert.deepEqual(Object.keys(dossier), ['profileId', 'rulesVersion', 'difficulties']);
  assert.equal(dossier.profileId, owner.profile.id);
  assert.equal(dossier.rulesVersion, SOLO_REPLAY_VERSION);
  assert.deepEqual(dossier.difficulties.normal.completedMissionIds,
    ['first-harvest', 'silent-switch', 'black-shard', 'ghost-channel', 'iron-current']);
  assert.deepEqual(dossier.difficulties.normal.medalsByMission,
    { 'first-harvest': 1, 'silent-switch': 2, 'black-shard': 1, 'ghost-channel': 3, 'iron-current': 1 });
  assert.deepEqual(dossier.difficulties.normal.fieldOrdersByMission, {
    'silent-switch': [CAMPAIGN_FIELD_ORDERS[1][0].id],
    'ghost-channel': [CAMPAIGN_FIELD_ORDERS[13][1].id],
    'iron-current': [CAMPAIGN_FIELD_ORDERS[14][0].id],
  });
  assert.equal(dossier.difficulties.normal.chosenBranchId, 'ghost-channel',
    'first verified branch remains the route choice even if the alternate is replayed later');
  assert.ok(dossier.difficulties.normal.unlockedMissionIds.includes('red-ledger'));
  assert.ok(dossier.difficulties.normal.unlockedMissionIds.includes('iron-current'),
    'the alternate branch remains replayable after a route is chosen');
  assert.deepEqual(dossier.difficulties.easy.completedMissionIds, []);
  assert.deepEqual(dossier.difficulties.easy.unlockedMissionIds, ['first-harvest']);
  assert.deepEqual(dossier.difficulties.hard.completedMissionIds, ['first-harvest'],
    'defeats, unverified scores, wrong-faction rows, and unsupported rules are ignored');
  assert.deepEqual(dossier.difficulties.hard.unlockedMissionIds, ['first-harvest', 'silent-switch'],
    'legacy verified wins still follow the existing ranked progression gate');

  const isolated = await api('/api/campaign/progress', other.token);
  assert.deepEqual((await isolated.json()).difficulties.normal.completedMissionIds, ['first-harvest']);

  const legacy = await createProfile('Dossier Legacy');
  store.scores.push({ ...common, id: 'dossier-legacy-black-shard', profileId: legacy.profile.id,
    scenarioId: 'black-shard', faction: 'aegis', difficulty: 'normal', scoreVersion: 29 });
  const legacyResponse = await api('/api/campaign/progress', legacy.token);
  const legacyNormal = (await legacyResponse.json()).difficulties.normal;
  assert.ok(legacyNormal.unlockedMissionIds.includes('ghost-channel'));
  assert.ok(legacyNormal.unlockedMissionIds.includes('iron-current'));
  assert.ok(!legacyNormal.unlockedMissionIds.includes('red-ledger'),
    'a pre-fork Black Shard victory alone does not prove a selected branch');
  store.scores.push({ ...common, id: 'dossier-legacy-red-ledger', profileId: legacy.profile.id,
    scenarioId: 'red-ledger', faction: 'vesper', difficulty: 'normal', scoreVersion: 29 });
  const afterLegacyRoute = await api('/api/campaign/progress', legacy.token);
  assert.ok((await afterLegacyRoute.json()).difficulties.normal.unlockedMissionIds.includes('red-ledger'),
    'archived pre-fork progress beyond the branch retains the existing compatibility rule');
});

test('carryover unlocks require auth and use the same-profile verified previous mission at the requested difficulty', async () => {
  const owner = await createProfile('Owner');
  const other = await createProfile('Other');
  const prior = CAMPAIGN_MISSIONS[0].id;
  const [assaultOrder, signalOrder] = CAMPAIGN_FIELD_ORDERS[0];
  const common = { mode: 'campaign', scenarioId: prior, verified: true, scoreVersion: 4,
    fieldOrderStatus: 'completed' };
  store.scores.push(
    { ...common, profileId: owner.profile.id, difficulty: 'normal', fieldOrderId: assaultOrder.id },
    { ...common, profileId: owner.profile.id, difficulty: 'hard', fieldOrderId: signalOrder.id },
    { ...common, profileId: other.profile.id, difficulty: 'normal', fieldOrderId: signalOrder.id },
    { ...common, profileId: owner.profile.id, difficulty: 'normal', fieldOrderId: signalOrder.id,
      scenarioId: CAMPAIGN_MISSIONS[1].id },
    { ...common, profileId: owner.profile.id, difficulty: 'normal', fieldOrderId: signalOrder.id,
      verified: false },
    { ...common, profileId: owner.profile.id, difficulty: 'normal', fieldOrderId: signalOrder.id,
      scoreVersion: 5 },
  );

  const url = '/api/campaign/carryover-unlocks?missionIndex=1&difficulty=normal';
  const anonymous = await fetch(`${baseUrl}${url}`);
  assert.equal(anonymous.status, 401);

  const response = await fetch(`${baseUrl}${url}`, { headers: { Authorization: `Bearer ${owner.token}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { missionIndex: 1, difficulty: 'normal',
    carryoverIds: ['none', 'assault', 'signal'], campaignVeteran: null,
    requisitionBalance: 2, rankedAvailable: false, routePayoffId: 'none' });
});

test('carryover unlocks ignore scores without a supported verified ruleset', async () => {
  const profile = await createProfile('Legacy');
  store.scores.push({ profileId: profile.profile.id, mode: 'campaign',
    scenarioId: CAMPAIGN_MISSIONS[0].id, difficulty: 'normal', verified: true,
    fieldOrderStatus: 'completed', fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][1].id });
  const response = await fetch(`${baseUrl}/api/campaign/carryover-unlocks?missionIndex=1&difficulty=normal`, {
    headers: { Authorization: `Bearer ${profile.token}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).carryoverIds, ['none']);
});

test('version 8 verified Field Orders still unlock Carryover Intel under current rules', async () => {
  const profile = await createProfile('Previous Rules');
  store.scores.push({ profileId: profile.profile.id, mode: 'campaign',
    scenarioId: CAMPAIGN_MISSIONS[0].id, difficulty: 'normal', verified: true,
    scoreVersion: 8, fieldOrderStatus: 'completed', fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][1].id });
  const response = await api('/api/campaign/carryover-unlocks?missionIndex=1&difficulty=normal', profile.token);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).carryoverIds, ['none', 'signal']);
});

test('verified fork scores supply route-specific carryover Intel and legacy Red Ledger access', async () => {
  const profile = await createProfile('Route Intel');
  const common = { profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal',
    faction: 'aegis', verified: true, scoreVersion: 4, result: 'victory', fieldOrderStatus: 'completed' };
  const preview = async index => {
    const response = await api(`/api/campaign/carryover-unlocks?missionIndex=${index}&difficulty=normal`, profile.token);
    assert.equal(response.status, 200);
    return (await response.json()).carryoverIds;
  };
  store.scores.push({ ...common, scenarioId: 'black-shard', fieldOrderId: CAMPAIGN_FIELD_ORDERS[3][1].id });
  assert.deepEqual(await preview(13), ['none', 'signal']);
  assert.deepEqual(await preview(14), ['none', 'signal']);
  assert.deepEqual(await preview(4), ['none', 'signal']); // Existing linear profile.
  const noBranch = await api('/api/campaign/carryover-unlocks?missionIndex=4&difficulty=normal', profile.token);
  assert.equal((await noBranch.json()).routePayoffId, 'none');

  store.scores.push({ ...common, scenarioId: 'ghost-channel', fieldOrderStatus: 'failed',
    fieldOrderId: CAMPAIGN_FIELD_ORDERS[13][0].id });
  assert.deepEqual(await preview(4), ['none']); // The branch is now the direct source.
  store.scores.push({ ...common, scenarioId: 'ghost-channel', fieldOrderId: CAMPAIGN_FIELD_ORDERS[13][0].id });
  assert.deepEqual(await preview(4), ['none', 'assault']);
  const payoffPreview = await api('/api/campaign/carryover-unlocks?missionIndex=4&difficulty=normal', profile.token);
  assert.equal((await payoffPreview.json()).routePayoffId, 'ghost-channel');
  store.scores.push({ ...common, scenarioId: 'iron-current', fieldOrderId: CAMPAIGN_FIELD_ORDERS[14][1].id });
  assert.deepEqual(await preview(4), ['none', 'assault', 'signal']);
  const forged = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[4].faction,
    scenarioId: 'red-ledger', routePayoffId: 'iron-current',
  }) });
  assert.equal(forged.status, 400, 'clients cannot choose an unearned route payoff');
  const ticket = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[4].faction,
    scenarioId: 'red-ledger', carryoverId: 'signal',
  }) });
  assert.equal(ticket.status, 201);
  assert.equal((await ticket.json()).routePayoffId, 'ghost-channel');
  assert.equal(store.runs.find(run => run.scenarioId === 'red-ledger').routePayoffId, 'ghost-channel');
});

test('requisition awards and spends are distinct, verified, profile and difficulty scoped', async () => {
  const profile = await createProfile('Requisition Ledger');
  const other = await createProfile('Other Ledger');
  const empty = await createProfile('Empty Ledger');
  assert.notEqual(profile.profile.id, other.profile.id);
  assert.equal((await (await api('/api/profile', other.token)).json()).profile.id, other.profile.id);
  const orderA = CAMPAIGN_FIELD_ORDERS[0][0].id;
  const orderB = CAMPAIGN_FIELD_ORDERS[1][1].id;
  const common = { mode: 'campaign', faction: 'aegis', verified: true, scoreVersion: 8,
    fieldOrderStatus: 'completed' };
  store.scores.push(
    { ...common, profileId: profile.profile.id, difficulty: 'normal', scenarioId: 'first-harvest', fieldOrderId: orderA },
    { ...common, profileId: profile.profile.id, difficulty: 'normal', scenarioId: 'first-harvest', fieldOrderId: orderA },
    { ...common, profileId: profile.profile.id, difficulty: 'normal', scenarioId: 'silent-switch', fieldOrderId: orderB },
    { ...common, profileId: profile.profile.id, difficulty: 'normal', scenarioId: 'last-light',
      fieldOrderId: CAMPAIGN_FIELD_ORDERS[2][0].id, fieldOrderStatus: 'failed' },
    { ...common, profileId: profile.profile.id, difficulty: 'hard', scenarioId: 'first-harvest',
      fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][1].id },
    { ...common, profileId: other.profile.id, difficulty: 'normal', scenarioId: 'first-harvest',
      fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][1].id },
    { ...common, profileId: profile.profile.id, difficulty: 'normal', scenarioId: 'silent-switch',
      fieldOrderId: 'none', fieldOrderStatus: 'none', supplyId: 'recon' },
    { ...common, profileId: profile.profile.id, difficulty: 'normal', scenarioId: 'silent-switch',
      fieldOrderId: 'none', fieldOrderStatus: 'none', supplyId: 'recon' },
  );
  const preview = await api('/api/campaign/carryover-unlocks?missionIndex=2&difficulty=normal', profile.token);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).requisitionBalance, 1,
    'two distinct completed orders earn two tokens; the repeated supplied victory spends one');
  const otherPreview = await api('/api/campaign/carryover-unlocks?missionIndex=2&difficulty=normal', other.token);
  assert.equal((await otherPreview.json()).requisitionBalance, 1,
    'another profile earns only from its own completed order');
  const hardPreview = await api('/api/campaign/carryover-unlocks?missionIndex=2&difficulty=hard', profile.token);
  assert.equal((await hardPreview.json()).requisitionBalance, 1,
    'hard difficulty only sees its own completed order');

  const makeTicket = (owner, difficulty, scenarioId, supplyId) => api('/api/scores/runs', owner.token, {
    method: 'POST', body: json({ mode: 'campaign', difficulty,
      faction: CAMPAIGN_MISSIONS.find(mission => mission.id === scenarioId).faction,
      scenarioId, supplyId }),
  });
  const suppliedTicket = await makeTicket(profile, 'normal', 'last-light', 'vanguard');
  assert.equal(suppliedTicket.status, 201);
  const suppliedTicketBody = await suppliedTicket.json();
  assert.equal(suppliedTicketBody.supplyId, 'vanguard');
  assert.equal(store.runs.find(run => run.id === suppliedTicketBody.runId).supplyId, 'vanguard');
  const noBalance = await makeTicket(empty, 'normal', 'last-light', 'reserves');
  assert.equal(noBalance.status, 403);
  assert.equal((await makeTicket(profile, 'normal', 'last-light', 'unknown')).status, 400);
  assert.equal((await makeTicket(profile, 'normal', 'first-harvest', 'reserves')).status, 400);

  const skirmishSupply = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'skirmish', difficulty: 'normal', faction: 'aegis', scenarioId: SKIRMISH_MAPS[0].id,
    supplyId: 'none',
  }) });
  assert.equal(skirmishSupply.status, 400);
});

test('profile endpoints require bearer auth, resume valid tokens, and sanitize names', async () => {
  const created = await createProfile('Original');
  assert.equal((await api('/api/profile')).status, 401);
  assert.equal((await api('/api/profile', 'invalid-token')).status, 401);
  const resumed = await api('/api/profile', null, { method: 'POST', body: json({ token: created.token }) });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).profile.id, created.profile.id);
  const patched = await api('/api/profile', created.token, { method: 'PATCH', body: json({ name: ' <New>\u0000 Name ' }) });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).profile.name, 'New Name');
});

test('personal history requires auth, isolates profiles, and migrates missing history arrays', async () => {
  const a = await createProfile('History A');
  const b = await createProfile('History B');
  assert.equal((await api('/api/records/history')).status, 401);
  const legacyData = JSON.parse(fs.readFileSync(process.env.FRONTIER_DATA_FILE, 'utf8'));
  delete legacyData.history;
  fs.writeFileSync(process.env.FRONTIER_DATA_FILE, JSON.stringify(legacyData));
  // The already loaded store remains usable; persistence adds the new field without
  // discarding the legacy profiles, friendships, runs, or scores.
  const response = await api('/api/records/history', a.token);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entries, []);
  assert.equal((await api('/api/records/history', b.token)).status, 200);
});

test('legacy verified victory scores backfill history once and populated history is preserved', () => {
  const profileId = 'legacy-profile';
  const scores = [
    { id: 'legacy-score-1', profileId, scoreVersion: 3, verified: true, mode: 'skirmish',
      scenarioId: 'random', scenarioName: 'Random Map', difficulty: 'normal', faction: 'aegis',
      seconds: 41, kills: 8, completedAt: 100 },
    { id: 'legacy-score-2', profileId, scoreVersion: 3, verified: true, mode: 'campaign',
      scenarioId: 'first-light', scenarioName: 'First Light', difficulty: 'hard', faction: 'aegis',
      doctrineId: 'standard', fieldOrderId: 'none', carryoverId: 'none', seconds: 72, kills: 3,
      completedAt: 200 },
    { id: 'old-version-score', profileId, scoreVersion: 2, verified: true, mode: 'skirmish',
      seconds: 10, kills: 1, completedAt: 300 },
    { id: 'unverified-score', profileId, scoreVersion: 3, verified: false, mode: 'skirmish',
      seconds: 10, kills: 1, completedAt: 400 },
  ];
  const loadWith = history => {
    const file = path.join(tempDir, `migration-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify({ profiles: [], requests: [], friendships: [], runs: [], scores,
      ...(history === undefined ? {} : { history }) }));
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      "import('./server/index.js').then(({store}) => console.log(JSON.stringify(store.history)))"], {
      cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', FRONTIER_DATA_FILE: file },
    }).toString().trim();
    return JSON.parse(output);
  };

  const migrated = loadWith(undefined);
  assert.deepEqual(migrated.map(record => record.id), ['score-legacy-score-1', 'score-legacy-score-2',
    'score-old-version-score']);
  assert.deepEqual(migrated.map(record => record.result), ['victory', 'victory', 'victory']);
  assert.equal(migrated[0].scoreId, 'legacy-score-1');
  assert.equal(migrated[0].seconds, 41);
  assert.equal(migrated[0].kills, 8);
  assert.equal(migrated[1].doctrineId, 'standard');

  const existing = [{ id: 'already-recorded', profileId, mode: 'skirmish', difficulty: 'normal',
    faction: 'aegis', scenarioId: 'random', seconds: 20, kills: 1, result: 'victory', completedAt: 500,
    scoreId: 'legacy-score-1' }];
  const merged = loadWith(existing);
  assert.deepEqual(merged.map(record => record.id), ['score-legacy-score-2', 'score-old-version-score',
    'already-recorded']);
  assert.deepEqual(merged[2], existing[0], 'existing personal history is retained without duplication');
});

test('friend requests reject bad targets and become visible to both profiles after acceptance', async () => {
  const a = await createProfile('Alpha');
  const b = await createProfile('Bravo');
  assert.equal((await api('/api/friends/requests', a.token, { method: 'POST', body: json({ code: 'NOPE' }) })).status, 400);
  assert.equal((await api('/api/friends/requests', a.token, { method: 'POST', body: json({ code: a.profile.code }) })).status, 400);
  const requested = await api('/api/friends/requests', a.token, { method: 'POST', body: json({ code: b.profile.code }) });
  assert.equal(requested.status, 201);
  const request = (await requested.json()).request;
  assert.equal((await api('/api/friends/requests', a.token, { method: 'POST', body: json({ code: b.profile.code }) })).status, 409);
  assert.equal((await api(`/api/friends/requests/${request.id}/accept`, b.token, { method: 'POST' })).status, 200);
  assert.deepEqual((await (await api('/api/friends', a.token)).json()).friends.map(friend => friend.id), [b.profile.id]);
  assert.deepEqual((await (await api('/api/friends', b.token)).json()).friends.map(friend => friend.id), [a.profile.id]);
});

test('stale websocket connections are reaped so friend presence reflects reachability', async () => {
  const a = await createProfile('Presence Host');
  const b = await createProfile('Presence Friend');
  store.friendships.push([a.profile.id, b.profile.id]);
  const host = await openSocket(a.token);
  const friend = await openSocket(b.token);
  await Promise.all([host, friend].map(ws => nextMessage(ws, message => message.type === 'hello')));
  await nextMessage(host, message => message.type === 'friends' &&
    message.friends.some(item => item.id === b.profile.id && item.online));
  await nextMessage(friend, message => message.type === 'friends' &&
    message.friends.some(item => item.id === a.profile.id && item.online));

  const closed = new Promise(resolve => friend.once('close', resolve));
  // Models a half-open network connection: the TCP close event has not arrived,
  // but the client failed to answer the preceding heartbeat ping.
  const serverSocket = [...websocket.clients].find(socket => socket.profile.id === b.profile.id);
  assert.ok(serverSocket, 'the friend connection is registered on the server');
  serverSocket.isAlive = false;
  await closed;
  const offline = await nextMessage(host, message => message.type === 'friends' &&
    message.friends.some(item => item.id === b.profile.id && !item.online));
  assert.equal(offline.friends.find(item => item.id === b.profile.id).online, false);
  host.close();
});

test('leaderboard validates filters and ranks only compatible verified scores', async () => {
  const profile = await createProfile('Ranked');
  const makeScore = (id, fields = {}) => ({ id, profileId: profile.profile.id, mode: 'skirmish',
    scenarioId: 'random', difficulty: 'normal', faction: 'aegis', seconds: 30, kills: 2,
    completedAt: Number(id.slice(1)), scoreVersion: SOLO_REPLAY_VERSION,
    aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id, verified: true, ...fields });
  store.scores.push(makeScore('s1'), makeScore('s16', { faction: 'vesper' }),
    makeScore('s39', { scoreVersion: 39 }),
    makeScore('s38', { scoreVersion: 38 }),
    makeScore('s36', { scoreVersion: 36 }),
    makeScore('s35', { scoreVersion: 35 }),
    makeScore('s33', { scoreVersion: 33 }),
    makeScore('s32', { scoreVersion: 32 }),
    makeScore('s31', { scoreVersion: 31 }),
    makeScore('s28', { scoreVersion: 28 }),
    makeScore('s24', { scoreVersion: 24 }), makeScore('s25', { scoreVersion: 25 }),
    makeScore('s26', { scoreVersion: 26 }), makeScore('s27', { scoreVersion: 27 }),
    makeScore('s2', { scoreVersion: 6 }),
    makeScore('s3', { verified: false }), makeScore('s4', { scoreVersion: 8 }),
    makeScore('s5', { scoreVersion: 9 }), makeScore('s6', { scoreVersion: 10 }),
    makeScore('s7', { scoreVersion: 12 }), makeScore('s11', { scoreVersion: 13 }),
    makeScore('s14', { scoreVersion: 14 }), makeScore('s15', { scoreVersion: 15 }),
    makeScore('s17', { scoreVersion: 16 }),
    makeScore('s8', { scoreVersion: 12, difficulty: 'hard' }),
    makeScore('s9', { scoreVersion: 12, difficulty: 'easy' }),
    makeScore('s10', { scoreVersion: 13, difficulty: 'easy' }));
  store.history.push({ id: 'history-s2', profileId: profile.profile.id, mode: 'skirmish',
    scenarioId: 'random', scenarioName: 'Random Map', difficulty: 'normal', faction: 'aegis',
    skirmishOpening: 'established', seconds: 30, kills: 2, result: 'victory', completedAt: 2, scoreId: 's2' });
  store.history.push({ id: 'history-s35', profileId: profile.profile.id, mode: 'skirmish',
    scenarioId: 'random', scenarioName: 'Random Map', difficulty: 'normal', faction: 'aegis',
    skirmishOpening: 'established', seconds: 30, kills: 2, result: 'victory', completedAt: 35, scoreId: 's35' });
  assert.equal((await api('/api/leaderboard?difficulty=impossible', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?faction=impossible', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=campaign&scenarioId=unknown', profile.token)).status, 400);
  const entries = (await (await api('/api/leaderboard?mode=skirmish&difficulty=normal', profile.token)).json()).entries;
  assert.deepEqual(entries.map(entry => entry.id), ['s1', 's16'],
    'skirmish scores from older rulesets stay out of current rankings');
  assert.deepEqual((await (await api('/api/leaderboard?mode=skirmish&faction=aegis', profile.token)).json())
    .entries.map(entry => entry.id), ['s1']);
  assert.deepEqual((await (await api('/api/leaderboard?mode=skirmish&faction=vesper', profile.token)).json())
    .entries.map(entry => entry.id), ['s16']);
  assert.equal(entries[0].verified, true);
  assert.deepEqual((await (await api('/api/leaderboard?mode=skirmish&difficulty=hard', profile.token)).json())
    .entries.map(entry => entry.id), []);
  assert.deepEqual((await (await api('/api/leaderboard?mode=skirmish&difficulty=easy', profile.token)).json())
    .entries.map(entry => entry.id), []);
  const history = (await (await api('/api/records/history', profile.token)).json()).entries;
  assert.deepEqual(history.map(entry => entry.id), ['history-s35', 'history-s2'],
    'older score versions remain available in private battle history');
  assert.equal(history[1].score, 7410);
});

test('v57 skirmish boards compare combat pursuit and Shard Valley resources while preserving older results', async () => {
  const profile = await createProfile('Route Compatibility');
  const base = { profileId: profile.profile.id, mode: 'skirmish', difficulty: 'normal',
    faction: 'aegis', skirmishOpening: 'established', victoryMode: 'dominion',
    seconds: 42, kills: 2, completedAt: 500, verified: true };
  const rows = [
    { ...base, id: 'route-v44-shard', scenarioId: 'shard-valley', scoreVersion: 44 },
    { ...base, id: 'route-v44-canyon', scenarioId: 'canyon-ring', scoreVersion: 44 },
    { ...base, id: 'route-v45-canyon', scenarioId: 'canyon-ring', scoreVersion: 45 },
    { ...base, id: 'route-v45-shard', scenarioId: 'shard-valley', scoreVersion: 45 },
    { ...base, id: 'route-v46-canyon', scenarioId: 'canyon-ring', scoreVersion: 46 },
    { ...base, id: 'route-v46-shard', scenarioId: 'shard-valley', scoreVersion: 46 },
    { ...base, id: 'route-v47-canyon', scenarioId: 'canyon-ring', scoreVersion: 47,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v47-shard', scenarioId: 'shard-valley', scoreVersion: 47,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'route-v48-canyon', scenarioId: 'canyon-ring', scoreVersion: 48,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v48-shard', scenarioId: 'shard-valley', scoreVersion: 48,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'route-v49-canyon', scenarioId: 'canyon-ring', scoreVersion: 49,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v49-shard', scenarioId: 'shard-valley', scoreVersion: 49,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'route-v50-canyon', scenarioId: 'canyon-ring', scoreVersion: 50,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v50-shard', scenarioId: 'shard-valley', scoreVersion: 50,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'route-v55-canyon', scenarioId: 'canyon-ring', scoreVersion: 55,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v55-shard', scenarioId: 'shard-valley', scoreVersion: 55,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'route-v56-canyon', scenarioId: 'canyon-ring', scoreVersion: 56,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v56-shard', scenarioId: 'shard-valley', scoreVersion: 56,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'route-v57-canyon', scenarioId: 'canyon-ring', scoreVersion: 57,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id },
    { ...base, id: 'route-v57-shard', scenarioId: 'shard-valley', scoreVersion: 57,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id },
    { ...base, id: 'siege-v53', scenarioId: 'twin-passes', scoreVersion: 53,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-v54', scenarioId: 'twin-passes', scoreVersion: 54,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-v56', scenarioId: 'twin-passes', scoreVersion: 56,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-v57', scenarioId: 'twin-passes', scoreVersion: 57,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-easy-v52', difficulty: 'easy', scenarioId: 'twin-passes', scoreVersion: 52,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-easy-v53', difficulty: 'easy', scenarioId: 'twin-passes', scoreVersion: 53,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-easy-v56', difficulty: 'easy', scenarioId: 'twin-passes', scoreVersion: 56,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
    { ...base, id: 'siege-easy-v57', difficulty: 'easy', scenarioId: 'twin-passes', scoreVersion: 57,
      aiCommanderProfileId: AI_COMMANDER_PROFILES[2].id },
  ];
  store.scores.push(...rows);
  store.history.push({ id: 'history-route-v48', profileId: profile.profile.id, mode: 'skirmish',
    scenarioId: 'shard-valley', scenarioName: 'Shard Valley', difficulty: 'normal', faction: 'aegis',
    skirmishOpening: 'established', victoryMode: 'dominion', seconds: 42, kills: 2,
    result: 'victory', completedAt: 480, scoreId: 'route-v48-shard' });
  store.history.push({ id: 'history-route-v49', profileId: profile.profile.id, mode: 'skirmish',
    scenarioId: 'shard-valley', scenarioName: 'Shard Valley', difficulty: 'normal', faction: 'aegis',
    skirmishOpening: 'established', victoryMode: 'dominion', seconds: 42, kills: 2,
    result: 'victory', completedAt: 490, scoreId: 'route-v49-shard' });
  try {
    const shard = (await (await api('/api/leaderboard?mode=skirmish&scenarioId=shard-valley', profile.token)).json()).entries;
    const canyon = (await (await api('/api/leaderboard?mode=skirmish&scenarioId=canyon-ring', profile.token)).json()).entries;
    assert.deepEqual(shard.map(entry => entry.id), ['route-v57-shard']);
    assert.deepEqual(canyon.map(entry => entry.id), ['route-v57-canyon']);
    const siege = (await (await api('/api/leaderboard?mode=skirmish&scenarioId=twin-passes&aiCommanderProfileId=siege-director&difficulty=normal',
      profile.token)).json()).entries;
    assert.deepEqual(siege.map(entry => entry.id), ['siege-v57'],
      'v56 Siege Director scores predate the new combat pursuit');
    const easySiege = (await (await api('/api/leaderboard?mode=skirmish&scenarioId=twin-passes&aiCommanderProfileId=siege-director&difficulty=easy',
      profile.token)).json()).entries;
    assert.deepEqual(easySiege.map(entry => entry.id), ['siege-easy-v57'],
      'combat pursuit applies on Easy even though expansion does not');
    assert.equal(shard[0].aiCommanderProfileId, AI_COMMANDER_PROFILES[1].id);
    assert.deepEqual((await (await api(`/api/leaderboard?mode=skirmish&scenarioId=canyon-ring&aiCommanderProfileId=${AI_COMMANDER_PROFILES[0].id}`,
      profile.token)).json()).entries.map(entry => entry.id), ['route-v57-canyon']);
    assert.equal((await api('/api/leaderboard?mode=skirmish&aiCommanderProfileId=unknown', profile.token)).status, 400);
    assert.ok(store.scores.some(score => score.id === 'route-v44-canyon'),
      'retiring an old result from comparable rankings does not erase it');
    assert.ok(store.scores.some(score => score.id === 'route-v49-shard'),
      'v49 results stay stored after leaving the current skirmish board');
    assert.ok(rows.filter(row => row.scoreVersion < 48).every(row => store.scores.includes(row)),
      'older results remain in storage for private history');
    assert.ok((await (await api('/api/records/history', profile.token)).json()).entries
      .some(entry => entry.id === 'history-route-v48'), 'v48 results stay in personal history after leaving the board');
    assert.ok((await (await api('/api/records/history', profile.token)).json()).entries
      .some(entry => entry.id === 'history-route-v49'), 'v49 scores stay in personal history after leaving the board');
  } finally {
    for (const row of rows) {
      const index = store.scores.indexOf(row);
      if (index >= 0) store.scores.splice(index, 1);
    }
  }
});

test('leaderboard campaign filters expose field order and carryover only for campaign rows', async () => {
  const profile = await createProfile('Campaign Rank');
  const score = { id: 'campaign-ranked', profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal',
    faction: 'aegis', scenarioId: CAMPAIGN_MISSIONS[0].id, scenarioName: CAMPAIGN_MISSIONS[0].title,
    fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][0].id, fieldOrderStatus: 'completed', carryoverId: 'none',
    supplyId: 'recon', doctrineId: 'standard', seconds: 20, kills: 3, completedAt: 99,
    scoreVersion: SOLO_REPLAY_VERSION, verified: true };
  store.scores.push(score,
    { ...score, id: 'campaign-version53', scoreVersion: 53, seconds: 20.01, completedAt: 113 },
    { ...score, id: 'campaign-version39', scoreVersion: 39, seconds: 20.03, completedAt: 111 },
    { ...score, id: 'campaign-version48', scoreVersion: 48, seconds: 20.02, completedAt: 112 },
    { ...score, id: 'campaign-version38', scoreVersion: 38, seconds: 20.05, completedAt: 110 },
    { ...score, id: 'campaign-version37', scoreVersion: 37, seconds: 20.1, completedAt: 109 },
    { ...score, id: 'campaign-version36', scoreVersion: 36, seconds: 20.25, completedAt: 108 },
    { ...score, id: 'campaign-version35', scoreVersion: 35, seconds: 20.5, completedAt: 107 },
    { ...score, id: 'campaign-version31', scoreVersion: 31, seconds: 21, completedAt: 105 },
    { ...score, id: 'campaign-version32', scoreVersion: 32, seconds: 21, completedAt: 106 },
    { ...score, id: 'campaign-version28', scoreVersion: 28, seconds: 20.01, completedAt: 104 },
    { ...score, id: 'campaign-version27', scoreVersion: 27, seconds: 20.02, completedAt: 103 },
    { ...score, id: 'campaign-version26', scoreVersion: 26, seconds: 20.04, completedAt: 102 },
    { ...score, id: 'campaign-version25', scoreVersion: 25, seconds: 20.08, completedAt: 101 },
    { ...score, id: 'campaign-version24', scoreVersion: 24, seconds: 20.1, completedAt: 100 },
    { ...score, id: 'campaign-version23', scoreVersion: 23, seconds: 20.15, completedAt: 101 },
    { ...score, id: 'campaign-version17', scoreVersion: 17, seconds: 20.05, completedAt: 100 },
    { ...score, id: 'campaign-version16', scoreVersion: 16, seconds: 20.1, completedAt: 99 },
    { ...score, id: 'campaign-version15', scoreVersion: 15, seconds: 20.25, completedAt: 99 },
    { ...score, id: 'campaign-version14', scoreVersion: 14, seconds: 20.5, completedAt: 99 },
    { ...score, id: 'campaign-version13', scoreVersion: 13, seconds: 21, completedAt: 99 },
    { ...score, id: 'campaign-version12', scoreVersion: 12, seconds: 22, completedAt: 98 },
    { ...score, id: 'campaign-version11', scoreVersion: 11, seconds: 25, completedAt: 98 },
    { ...score, id: 'campaign-version10', scoreVersion: 10, seconds: 27, completedAt: 97 });
  store.history.push({ id: 'history-campaign-version17', profileId: profile.profile.id, mode: 'campaign',
    scenarioId: score.scenarioId, scenarioName: score.scenarioName, difficulty: score.difficulty,
    faction: score.faction, seconds: 20.05, kills: 3, result: 'victory', completedAt: 100,
    scoreId: 'campaign-version17' });
  store.history.push({ id: 'history-campaign-version48', profileId: profile.profile.id, mode: 'campaign',
    scenarioId: score.scenarioId, scenarioName: score.scenarioName, difficulty: score.difficulty,
    faction: score.faction, seconds: 20.02, kills: 3, result: 'victory', completedAt: 112,
    scoreId: 'campaign-version48' });
  const route = `/api/leaderboard?mode=campaign&scenarioId=${score.scenarioId}&fieldOrderId=${score.fieldOrderId}&carryoverId=none&supplyId=recon`;
  const response = await api(route, profile.token);
  assert.equal(response.status, 200);
  const campaignEntries = (await response.json()).entries;
  assert.deepEqual(campaignEntries.map(entry => entry.id), ['campaign-ranked'],
    'First Harvest entries require v57 after combat pursuit changes');
  store.scores.push(
    { ...score, id: 'black-shard-v57', scenarioId: 'black-shard', fieldOrderId: 'none', scoreVersion: 57 },
    { ...score, id: 'black-shard-v49', scenarioId: 'black-shard', fieldOrderId: 'none', scoreVersion: 49 },
    { ...score, id: 'black-shard-v37', scenarioId: 'black-shard', fieldOrderId: 'none', scoreVersion: 37 },
    { ...score, id: 'black-shard-v34', scenarioId: 'black-shard', fieldOrderId: 'none', scoreVersion: 34 },
    { ...score, id: 'black-shard-v35', scenarioId: 'black-shard', fieldOrderId: 'none', scoreVersion: 35 },
    { ...score, id: 'black-shard-v36', scenarioId: 'black-shard', fieldOrderId: 'none', scoreVersion: 36 });
  const blackShardEntries = (await (await api('/api/leaderboard?mode=campaign&scenarioId=black-shard',
    profile.token)).json()).entries;
  assert.deepEqual(blackShardEntries.map(entry => entry.id), ['black-shard-v57'],
    'combat pursuit resets economic campaign comparison');
  store.scores.push(
    { ...score, id: 'dawnfall-v57', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 57 },
    { ...score, id: 'dawnfall-v49', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 49 },
    { ...score, id: 'dawnfall-v37', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 37 },
    { ...score, id: 'dawnfall-v32', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 32 },
    { ...score, id: 'dawnfall-v33', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 33 },
    { ...score, id: 'dawnfall-v34', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 34 },
    { ...score, id: 'dawnfall-v35', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 35 },
    { ...score, id: 'dawnfall-v36', scenarioId: 'dawnfall', fieldOrderId: 'none', scoreVersion: 36 });
  const dawnfallEntries = (await (await api('/api/leaderboard?mode=campaign&scenarioId=dawnfall',
    profile.token)).json()).entries;
  assert.deepEqual(dawnfallEntries.map(entry => entry.id), ['dawnfall-v57'],
    'combat pursuit resets the Dawnfall comparison');
  store.scores.push(
    { ...score, id: 'quiet-knife-v57', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 57 },
    { ...score, id: 'quiet-knife-v49', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 49 },
    { ...score, id: 'quiet-knife-v37', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 37 },
    { ...score, id: 'quiet-knife-v33', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 33 },
    { ...score, id: 'quiet-knife-v34', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 34 },
    { ...score, id: 'quiet-knife-v35', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 35 },
    { ...score, id: 'quiet-knife-v36', scenarioId: 'quiet-knife', fieldOrderId: 'none', scoreVersion: 36 });
  const quietKnifeEntries = (await (await api('/api/leaderboard?mode=campaign&scenarioId=quiet-knife',
    profile.token)).json()).entries;
  assert.deepEqual(quietKnifeEntries.map(entry => entry.id), ['quiet-knife-v57'],
    'combat pursuit resets the Quiet Knife comparison');
  assert.equal(campaignEntries[0].fieldOrderStatus, 'completed');
  const history = (await (await api('/api/records/history', profile.token)).json()).entries;
  assert.deepEqual(history.map(entry => entry.id), ['history-campaign-version48', 'history-campaign-version17'],
    'older verified campaign results remain available in personal history');
  assert.equal((await (await api(`/api/leaderboard?mode=campaign&supplyId=recon`, profile.token)).json()).entries[0].supplyId, 'recon');
  assert.deepEqual((await (await api(`/api/leaderboard?mode=campaign&supplyId=none`, profile.token)).json()).entries, []);
  assert.equal((await api('/api/leaderboard?mode=skirmish&fieldOrderId=none', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=skirmish&supplyId=none', profile.token)).status, 400);
});

test('v57 combat pursuit resets economic and fixed-force campaign boards while retaining history', async () => {
  const profile = await createProfile('Last Light comparison');
  const base = { profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal',
    faction: 'aegis', fieldOrderId: 'none', fieldOrderStatus: 'skipped', carryoverId: 'none',
    doctrineId: 'standard', seconds: 160, kills: 4, score: 4520, completedAt: 500, verified: true };
  store.scores.push(
    { ...base, id: 'last-light-v57', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 57 },
    { ...base, id: 'last-light-v41', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 41 },
    { ...base, id: 'last-light-v42', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 42 },
    { ...base, id: 'last-light-v43', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 43 },
    { ...base, id: 'last-light-v48', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 48 },
    { ...base, id: 'last-light-v49', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 49 },
    { ...base, id: 'last-light-v50', scenarioId: 'last-light', scenarioName: 'Mission 3: Last Light', scoreVersion: 50 },
    { ...base, id: 'first-harvest-v41', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 41 },
    { ...base, id: 'first-harvest-v42', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 42 },
    { ...base, id: 'first-harvest-v43', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 43 },
    { ...base, id: 'first-harvest-v48', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 48 },
    { ...base, id: 'first-harvest-v49', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 49 },
    { ...base, id: 'first-harvest-v50', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 50 },
    { ...base, id: 'first-harvest-v53', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 53 },
    { ...base, id: 'first-harvest-v54', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 54 },
    { ...base, id: 'first-harvest-v57', scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', scoreVersion: 57 },
    { ...base, faction: 'vesper', id: 'ashes-v42', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 42 },
    { ...base, faction: 'vesper', id: 'ashes-v43', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 43 },
    { ...base, faction: 'vesper', id: 'ashes-v47', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 47 },
    { ...base, faction: 'vesper', id: 'ashes-v48', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 48 },
    { ...base, faction: 'vesper', id: 'ashes-v49', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 49 },
    { ...base, faction: 'vesper', id: 'ashes-v50', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 50 },
    { ...base, faction: 'vesper', id: 'ashes-v51', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 51, routePayoffId: 'iron-current' },
    { ...base, faction: 'vesper', id: 'ashes-v57', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', scoreVersion: 57, routePayoffId: 'iron-current' },
    { ...base, id: 'ghost-v35', scenarioId: 'ghost-channel', scenarioName: 'Ghost Channel', scoreVersion: 35 },
    { ...base, id: 'ghost-v36', scenarioId: 'ghost-channel', scenarioName: 'Ghost Channel', scoreVersion: 36 },
    { ...base, id: 'ghost-v48', scenarioId: 'ghost-channel', scenarioName: 'Ghost Channel', scoreVersion: 48 },
    { ...base, id: 'ghost-v49', scenarioId: 'ghost-channel', scenarioName: 'Ghost Channel', scoreVersion: 49 },
    { ...base, id: 'ghost-v50', scenarioId: 'ghost-channel', scenarioName: 'Ghost Channel', scoreVersion: 50 },
    { ...base, id: 'ghost-v57', scenarioId: 'ghost-channel', scenarioName: 'Ghost Channel', scoreVersion: 57 },
    { ...base, id: 'dawn-v35', scenarioId: 'after-the-dawn', scenarioName: 'After the Dawn', scoreVersion: 35 },
    { ...base, id: 'dawn-v36', scenarioId: 'after-the-dawn', scenarioName: 'After the Dawn', scoreVersion: 36 },
    { ...base, id: 'dawn-v48', scenarioId: 'after-the-dawn', scenarioName: 'After the Dawn', scoreVersion: 48 },
    { ...base, id: 'dawn-v49', scenarioId: 'after-the-dawn', scenarioName: 'After the Dawn', scoreVersion: 49 },
    { ...base, id: 'dawn-v50', scenarioId: 'after-the-dawn', scenarioName: 'After the Dawn', scoreVersion: 50 },
    { ...base, id: 'dawn-v57', scenarioId: 'after-the-dawn', scenarioName: 'After the Dawn', scoreVersion: 57 });
  store.history.push({ id: 'history-first-harvest-v48', profileId: profile.profile.id, mode: 'campaign',
    scenarioId: 'first-harvest', scenarioName: 'Mission 1: First Harvest', difficulty: 'normal', faction: 'aegis',
    seconds: 160, kills: 4, result: 'victory', completedAt: 480, scoreId: 'first-harvest-v48' });
  store.history.push({ id: 'history-ashes-v50', profileId: profile.profile.id, mode: 'campaign',
    scenarioId: 'ashes-in-transit', scenarioName: 'Mission 6: Ashes in Transit', difficulty: 'normal',
    faction: 'vesper', seconds: 160, kills: 4, result: 'victory', completedAt: 490, scoreId: 'ashes-v50' });
  const lastLight = await api('/api/leaderboard?mode=campaign&scenarioId=last-light', profile.token);
  assert.equal(lastLight.status, 200);
  assert.deepEqual((await lastLight.json()).entries.map(entry => entry.id)
    .filter(id => id.startsWith('last-light-v')).sort(), ['last-light-v57']);
  const firstHarvest = await api('/api/leaderboard?mode=campaign&scenarioId=first-harvest', profile.token);
  assert.equal(firstHarvest.status, 200);
  assert.deepEqual((await firstHarvest.json()).entries.map(entry => entry.id)
    .filter(id => id.startsWith('first-harvest-v')).sort(),
    ['first-harvest-v57']);
  const ashes = await api('/api/leaderboard?mode=campaign&scenarioId=ashes-in-transit', profile.token);
  assert.equal(ashes.status, 200);
  assert.deepEqual((await ashes.json()).entries.map(entry => entry.id)
    .filter(id => id.startsWith('ashes-v')).sort(), ['ashes-v57']);
  const ashRouteEntries = (await (await api('/api/leaderboard?mode=campaign&scenarioId=ashes-in-transit&routePayoffId=iron-current', profile.token)).json()).entries;
  assert.deepEqual(ashRouteEntries.map(entry => entry.id), ['ashes-v57']);
  assert.equal(ashRouteEntries[0].routePayoffId, 'iron-current');
  for (const [scenarioId, prefix] of [['ghost-channel', 'ghost'], ['after-the-dawn', 'dawn']]) {
    const fixedForce = await api(`/api/leaderboard?mode=campaign&scenarioId=${scenarioId}`, profile.token);
    assert.deepEqual((await fixedForce.json()).entries.map(entry => entry.id)
      .filter(id => id.startsWith(`${prefix}-v`)).sort(), [`${prefix}-v57`],
    `${scenarioId} now compares v57 combat pursuit rules`);
  }
  assert.ok((await (await api('/api/records/history', profile.token)).json()).entries
    .some(entry => entry.id === 'history-first-harvest-v48'), 'v48 economic scores remain in personal history');
  assert.ok((await (await api('/api/records/history', profile.token)).json()).entries
    .some(entry => entry.id === 'history-ashes-v50'), 'v50 Ashes scores remain in personal history');
});

test('Red Ledger route payoffs are filtered and exposed in public and personal records', async () => {
  const profile = await createProfile('Route Records');
  const base = { profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal', faction: 'vesper',
    scenarioId: 'red-ledger', scenarioName: 'Mission 5: Red Ledger', seconds: 90, kills: 4,
    scoreVersion: SOLO_REPLAY_VERSION, verified: true };
  store.scores.push(
    { ...base, id: 'route-neutral', routePayoffId: 'none', seconds: 93, scoreVersion: 49 },
    { ...base, id: 'route-ghost', routePayoffId: 'ghost-channel', seconds: 91 },
    { ...base, id: 'route-ghost-v45', routePayoffId: 'ghost-channel', seconds: 89, scoreVersion: 45 },
    { ...base, id: 'route-iron', routePayoffId: 'iron-current', seconds: 90 },
    { ...base, id: 'route-iron-v45', routePayoffId: 'iron-current', seconds: 88, scoreVersion: 45 },
    { ...base, id: 'ashes-route-ghost', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', routePayoffId: 'ghost-channel', seconds: 92 },
    { ...base, id: 'ashes-route-iron', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', routePayoffId: 'iron-current', seconds: 93 },
    { ...base, id: 'ashes-route-none', scenarioId: 'ashes-in-transit',
      scenarioName: 'Mission 6: Ashes in Transit', routePayoffId: 'none', seconds: 94 },
    { ...base, id: 'route-other-mission', scenarioId: 'ghost-channel', routePayoffId: 'none' },
  );
  store.history.push({ id: 'history-route-iron', profileId: profile.profile.id, mode: 'campaign',
    scenarioId: 'red-ledger', scenarioName: base.scenarioName, difficulty: 'normal', faction: 'vesper',
    routePayoffId: 'iron-current', seconds: 90, kills: 4, result: 'victory', completedAt: 100 });
  const rows = async route => (await (await api(`/api/leaderboard?mode=campaign&routePayoffId=${route}`, profile.token)).json()).entries;
  const ghostRows = await rows('ghost-channel');
  assert.deepEqual(new Set(ghostRows.map(entry => entry.scenarioId)), new Set(['red-ledger', 'ashes-in-transit']));
  assert.deepEqual(new Set(ghostRows.map(entry => entry.id)), new Set(['route-ghost', 'ashes-route-ghost']));
  const ironRows = await rows('iron-current');
  assert.deepEqual(new Set(ironRows.map(entry => entry.id)),
    new Set(['route-iron', 'ashes-route-iron', 'ashes-v57']));
  const neutralRows = await rows('none');
  assert.deepEqual(new Set(neutralRows.map(entry => entry.id)), new Set(['ashes-route-none']));
  assert.match((await (await api('/api/leaderboard?mode=campaign&routePayoffId=iron-current', profile.token)).json()).note,
    /span Red Ledger and Ashes in Transit/i);
  assert.deepEqual((await (await api('/api/leaderboard?mode=campaign&scenarioId=red-ledger&routePayoffId=iron-current', profile.token)).json()).entries.map(entry => entry.id), ['route-iron']);
  assert.ok(store.scores.some(score => score.id === 'route-ghost-v45'),
    'archived route wins stay stored even when their old objective is not comparable');
  assert.equal((await api('/api/leaderboard?mode=campaign&scenarioId=black-shard&routePayoffId=none', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=skirmish&routePayoffId=none', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=campaign&routePayoffId=unknown', profile.token)).status, 400);
  const history = (await (await api('/api/records/history', profile.token)).json()).entries;
  assert.equal(history[0].routePayoffId, 'iron-current');
});

test('Iron Current ranks only v57 results after the combat pursuit change', async () => {
  const profile = await createProfile('Freight Rank');
  const base = { profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal',
    faction: 'aegis', scenarioId: 'iron-current', scenarioName: 'Branch Operation: Iron Current',
    fieldOrderId: 'none', fieldOrderStatus: 'none', carryoverId: 'none', supplyId: 'none',
    doctrineId: 'standard', seconds: 140, kills: 5, completedAt: 99, verified: true };
  store.scores.push({ ...base, id: 'freight-v57', scoreVersion: SOLO_REPLAY_VERSION },
    { ...base, id: 'freight-v55', scoreVersion: 55 },
    { ...base, id: 'freight-v54', scoreVersion: 54 },
    { ...base, id: 'freight-v49', scoreVersion: 49 },
    { ...base, id: 'freight-v18', scoreVersion: 18 });
  const entries = (await (await api('/api/leaderboard?mode=campaign&scenarioId=iron-current', profile.token)).json()).entries;
  assert.deepEqual(entries.map(entry => entry.id), ['freight-v57']);
});

test('campaign run tickets lock field orders to their own mission and invalidate an older active run', async () => {
  const profile = await createProfile('Runs');
  const badOrder = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'campaign',
    difficulty: 'normal', faction: 'aegis', scenarioId: CAMPAIGN_MISSIONS[0].id,
    fieldOrderId: CAMPAIGN_FIELD_ORDERS[1][0].id }) });
  assert.equal(badOrder.status, 400);
  const start = () => api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'campaign',
    difficulty: 'normal', faction: 'aegis', scenarioId: CAMPAIGN_MISSIONS[0].id,
    fieldOrderId: CAMPAIGN_FIELD_ORDERS[0][0].id }) });
  const first = await start(); const firstId = (await first.json()).runId;
  const second = await start(); assert.equal(second.status, 201);
  assert.ok(store.runs.find(run => run.id === firstId).finishedAt);
});

test('ranked campaign tickets enforce verified progression and require a chosen fork branch', async () => {
  const profile = await createProfile('Campaign Progression');
  const start = (missionIndex, difficulty = 'normal') => api('/api/scores/runs', profile.token, {
    method: 'POST', body: json({ mode: 'campaign', difficulty,
      faction: CAMPAIGN_MISSIONS[missionIndex].faction, scenarioId: CAMPAIGN_MISSIONS[missionIndex].id }),
  });
  const runCount = store.runs.length;
  assert.equal((await start(11)).status, 403, 'a fresh profile cannot jump to the finale');
  assert.equal((await start(1)).status, 403, 'the first mission is the only fresh-profile entry');
  assert.equal(store.runs.length, runCount, 'denied mission requests must not persist run tickets');
  assert.equal((await start(0)).status, 201);

  const recordVictory = missionIndex => store.scores.push({ profileId: profile.profile.id,
    mode: 'campaign', scenarioId: CAMPAIGN_MISSIONS[missionIndex].id,
    faction: CAMPAIGN_MISSIONS[missionIndex].faction, difficulty: 'normal',
    // Archived verified wins still authorize progress without entering this
    // test process's current leaderboard fixtures below.
    scoreVersion: 30, verified: true, result: 'victory',
    completedAt: 1000 + missionIndex });
  for (const missionIndex of [0, 1, 2, 3]) recordVictory(missionIndex);
  assert.equal((await start(13)).status, 201, 'both branch operations follow Black Shard');
  assert.equal((await start(14)).status, 201, 'the second branch remains replayable');
  assert.equal((await start(4)).status, 403, 'Black Shard alone does not skip the selected branch');
  recordVictory(13);
  const redLedger = await start(4);
  assert.equal(redLedger.status, 201, 'a verified branch victory reconnects the campaign');
  assert.equal((await redLedger.json()).routePayoffId, 'ghost-channel',
    'the first verified branch remains the selected route payoff');
});

test('archived Black Shard victory unlocks branches while a later victory proves legacy Red Ledger access', async () => {
  const profile = await createProfile('Legacy Campaign Progress');
  const prior = { profileId: profile.profile.id, mode: 'campaign', scenarioId: 'black-shard',
    faction: 'aegis', difficulty: 'normal', verified: true, result: 'victory',
    scoreVersion: 29, completedAt: 100 };
  store.scores.push(prior);
  const start = missionIndex => api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[missionIndex].faction,
    scenarioId: CAMPAIGN_MISSIONS[missionIndex].id,
  }) });
  assert.equal((await start(4)).status, 403,
    'an archived Black Shard score alone does not prove pre-fork Red Ledger access');
  assert.equal((await start(13)).status, 201, 'Black Shard unlocks the fork');
  store.scores.push({ ...prior, scenarioId: 'red-ledger', faction: 'vesper', completedAt: 200 });
  assert.equal((await start(4)).status, 201,
    'an archived Red Ledger victory preserves access to that mission');
});

test('unfinished tickets from an older ruleset expire instead of being verified under current rules', async () => {
  const profile = await createProfile('Old Ticket');
  const started = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'skirmish', difficulty: 'normal', faction: 'aegis', scenarioId: SKIRMISH_MAPS[0].id,
  }) });
  assert.equal(started.status, 201);
  const run = await started.json();
  assert.equal(run.rulesVersion, SOLO_REPLAY_VERSION);
  const scoreCount = store.scores.length;
  const storedRun = store.runs.find(item => item.id === run.runId);
  assert.equal(storedRun.rulesVersion, SOLO_REPLAY_VERSION);
  delete storedRun.rulesVersion; // Legacy persisted tickets had no rules marker.
  const finish = await api(`/api/scores/runs/${run.runId}/finish`, profile.token, { method: 'POST',
    body: json({ commands: [], completedTicks: 0 }) });
  assert.equal(finish.status, 409);
  assert.match((await finish.json()).error, /outdated ruleset/i);
  assert.ok(storedRun.finishedAt);
  assert.equal(store.scores.length, scoreCount);
  assert.equal(store.history.filter(record => record.profileId === profile.profile.id).length, 0);
});

test('campaign run tickets only accept carryover earned on the immediately preceding mission and same difficulty', async () => {
  const profile = await createProfile('Carryover Ticket');
  const missionIndex = 1;
  const order = CAMPAIGN_FIELD_ORDERS[missionIndex - 1][1];
  const ticket = difficulty => api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'campaign',
    difficulty, faction: CAMPAIGN_MISSIONS[missionIndex].faction, scenarioId: CAMPAIGN_MISSIONS[missionIndex].id,
    carryoverId: 'signal' }) });
  assert.equal((await ticket('normal')).status, 403);
  store.scores.push({ profileId: profile.profile.id, mode: 'campaign', scenarioId: CAMPAIGN_MISSIONS[0].id,
    faction: CAMPAIGN_MISSIONS[0].faction, difficulty: 'normal', verified: true, scoreVersion: 4,
    fieldOrderStatus: 'completed', fieldOrderId: order.id });
  assert.equal((await ticket('hard')).status, 403);
  assert.equal((await ticket('normal')).status, 201);
});

test('campaign veteran tickets are server-derived from the latest same-difficulty verified predecessor victory', async () => {
  const profile = await createProfile('Veteran Ticket');
  const veteran = { defId: 'rifle', faction: 'aegis', veterancy: 1, promotion: null };
  const prior = { profileId: profile.profile.id, mode: 'campaign', scenarioId: 'first-harvest',
    faction: 'aegis', difficulty: 'normal', verified: true, scoreVersion: 30,
    campaignVeteran: veteran, completedAt: 100 };
  store.scores.push(prior,
    { ...prior, id: 'wrong-difficulty-veteran', difficulty: 'hard', completedAt: 300,
      campaignVeteran: { ...veteran, veterancy: 2 } },
    { ...prior, id: 'wrong-faction-veteran', faction: 'vesper', completedAt: 400,
      campaignVeteran: { ...veteran, faction: 'vesper' } },
    { ...prior, id: 'legacy-veteran', scoreVersion: 29, completedAt: 500,
      campaignVeteran: { ...veteran, veterancy: 2 } });

  const preview = await api('/api/campaign/carryover-unlocks?missionIndex=1&difficulty=normal', profile.token);
  assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).campaignVeteran, veteran);
  const forged = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: 'aegis', scenarioId: 'silent-switch',
    campaignVeteran: { ...veteran, veterancy: 2 },
  }) });
  assert.equal(forged.status, 400, 'clients cannot supply a veteran manifest');

  const ticketResponse = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: 'aegis', scenarioId: 'silent-switch',
  }) });
  assert.equal(ticketResponse.status, 201);
  const ticket = await ticketResponse.json();
  assert.deepEqual(ticket.campaignVeteran, veteran);
  assert.deepEqual(store.runs.find(run => run.id === ticket.runId).campaignVeteran, veteran);

  // A later verified victory without an eligible survivor clears the carryover;
  // do not revive the older veteran from the first victory.
  store.scores.push({ ...prior, id: 'newest-no-survivor', campaignVeteran: null, completedAt: 600 });
  const cleared = await api('/api/campaign/carryover-unlocks?missionIndex=1&difficulty=normal', profile.token);
  assert.equal((await cleared.json()).campaignVeteran, null);
  const noVeteranTicket = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: 'aegis', scenarioId: 'silent-switch',
  }) });
  assert.equal(noVeteranTicket.status, 201);
  assert.equal((await noVeteranTicket.json()).campaignVeteran, null);
});

test('campaign leaderboard separates no, Veteran, and Elite survivor openings', async () => {
  const profile = await createProfile('Veteran Board');
  const base = { profileId: profile.profile.id, mode: 'campaign', scenarioId: 'silent-switch',
    scenarioName: 'Mission 2: The Silent Switch', difficulty: 'normal', faction: 'aegis',
    seconds: 120, kills: 2, completedAt: 100, verified: true, scoreVersion: SOLO_REPLAY_VERSION };
  const veteran = { defId: 'rifle', faction: 'aegis', veterancy: 1, promotion: null };
  store.scores.push({ ...base, id: 'board-no-survivor', deployedVeteran: null },
    { ...base, id: 'board-veteran', deployedVeteran: veteran, completedAt: 101 },
    { ...base, id: 'board-elite', deployedVeteran: { ...veteran, veterancy: 2 }, completedAt: 102 });
  for (const [filter, expected] of [['none', 'board-no-survivor'], ['veteran', 'board-veteran'], ['elite', 'board-elite']]) {
    const response = await api(`/api/leaderboard?mode=campaign&scenarioId=silent-switch&veteran=${filter}`, profile.token);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).entries.map(entry => entry.id), [expected]);
  }
  assert.equal((await api('/api/leaderboard?mode=skirmish&veteran=elite', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=campaign&scenarioId=first-harvest&veteran=elite', profile.token)).status, 400);
});

test('Red Ledger survivor follows the chosen verified branch after later replays', async () => {
  const profile = await createProfile('Branch Survivor');
  const common = { profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal',
    verified: true, faction: 'aegis' };
  const rifle = { defId: 'rifle', faction: 'aegis', veterancy: 1, promotion: null };
  const tank = { defId: 'lightTank', faction: 'aegis', veterancy: 2, promotion: null };
  store.scores.push({ ...common, id: 'chosen-branch', scenarioId: 'ghost-channel',
    scoreVersion: 4, completedAt: 100 },
    { ...common, id: 'replayed-black-shard', scenarioId: 'black-shard',
      scoreVersion: 30, completedAt: 300, campaignVeteran: tank },
    { ...common, id: 'other-branch', scenarioId: 'iron-current',
      scoreVersion: 30, completedAt: 400, campaignVeteran: tank });
  const preview = () => api('/api/campaign/carryover-unlocks?missionIndex=4&difficulty=normal', profile.token);
  assert.equal((await (await preview()).json()).campaignVeteran, null,
    'old chosen route cannot borrow a newer survivor from another operation');
  store.scores.push({ ...common, id: 'chosen-branch-replay', scenarioId: 'ghost-channel',
    scoreVersion: 30, completedAt: 200, campaignVeteran: rifle });
  assert.deepEqual((await (await preview()).json()).campaignVeteran, rifle);
  const started = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: 'vesper', scenarioId: 'red-ledger',
  }) });
  assert.equal(started.status, 201);
  const ticket = await started.json();
  assert.equal(ticket.routePayoffId, 'ghost-channel');
  assert.deepEqual(ticket.campaignVeteran, rifle);
});

test('Ashes tickets lock route payoff to the profile first verified branch', async () => {
  const profile = await createProfile('Ashes Route Ticket');
  const common = { profileId: profile.profile.id, mode: 'campaign', difficulty: 'normal', verified: true };
  store.scores.push(
    { ...common, id: 'ashes-prior-red-ledger', scenarioId: 'red-ledger', faction: 'vesper',
      scoreVersion: 50, result: 'victory', completedAt: 10 },
    { ...common, id: 'ashes-first-branch', scenarioId: 'iron-current', faction: 'aegis',
      scoreVersion: 50, result: 'victory', completedAt: 20 },
    { ...common, id: 'ashes-later-branch', scenarioId: 'ghost-channel', faction: 'aegis',
      scoreVersion: 50, result: 'victory', completedAt: 30 });
  const preview = await api('/api/campaign/carryover-unlocks?missionIndex=5&difficulty=normal', profile.token);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).routePayoffId, 'iron-current',
    'Ashes unlock preview exposes the same server-derived route used by its ticket');
  const forged = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: 'vesper', scenarioId: 'ashes-in-transit',
    routePayoffId: 'ghost-channel',
  }) });
  assert.equal(forged.status, 400, 'client route fields are rejected');
  const started = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'normal', faction: 'vesper', scenarioId: 'ashes-in-transit',
  }) });
  assert.equal(started.status, 201);
  const ticket = await started.json();
  assert.equal(ticket.rulesVersion, SOLO_REPLAY_VERSION);
  assert.equal(ticket.routePayoffId, 'iron-current');
  assert.equal(store.runs.find(run => run.id === ticket.runId).routePayoffId, 'iron-current');
});

test('skirmish run tickets validate scenario identity and reject campaign fields', async () => {
  const profile = await createProfile('Skirmish');
  const invalidScenario = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'skirmish',
    difficulty: 'normal', faction: 'aegis', scenarioId: 'unknown' }) });
  assert.equal(invalidScenario.status, 400);
  const badField = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'skirmish',
    difficulty: 'normal', faction: 'aegis', fieldOrderId: 'none' }) });
  assert.equal(badField.status, 400);
});

test('skirmish opening is locked by tickets and leaderboard results stay comparable', async () => {
  const profile = await createProfile('Opening Rank');
  const makeTicket = fields => api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'skirmish', difficulty: 'normal', faction: 'aegis', scenarioId: 'random', ...fields,
  }) });
  assert.equal((await makeTicket({ skirmishOpening: 'invalid' })).status, 400);
  const establishedResponse = await makeTicket({});
  assert.equal(establishedResponse.status, 201);
  const established = await establishedResponse.json();
  assert.equal(established.skirmishOpening, 'established');
  assert.equal(established.aiCommanderProfileId, aiCommanderProfileForSeed(established.seed).id,
    'the ticket identifies the AI profile selected by the server-issued seed');
  assert.equal(store.runs.find(run => run.id === established.runId).aiCommanderProfileId,
    aiCommanderProfileForSeed(established.seed).id);
  assert.equal((await makeTicket({ aiCommanderProfileId: AI_COMMANDER_PROFILES[1].id })).status, 400,
    'clients cannot choose the commander profile');
  const rigResponse = await makeTicket({ skirmishOpening: 'command-rig' });
  assert.equal(rigResponse.status, 201);
  const rig = await rigResponse.json();
  assert.equal(rig.skirmishOpening, 'command-rig');
  assert.equal((await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'easy', faction: CAMPAIGN_MISSIONS[0].faction,
    scenarioId: CAMPAIGN_MISSIONS[0].id, skirmishOpening: 'established',
  }) })).status, 400);

  const common = { profileId: profile.profile.id, mode: 'skirmish', difficulty: 'normal',
    faction: 'aegis', scenarioId: 'random', seconds: 30, kills: 2, completedAt: 300,
    scoreVersion: SOLO_REPLAY_VERSION, aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id, verified: true };
  store.scores.push({ ...common, id: 'opening-legacy' },
    { ...common, id: 'opening-rig', skirmishOpening: 'command-rig', completedAt: 301 });
  const establishedEntries = (await (await api('/api/leaderboard?mode=skirmish', profile.token)).json()).entries;
  assert.ok(establishedEntries.some(entry => entry.id === 'opening-legacy' && entry.skirmishOpening === 'established'));
  assert.ok(!establishedEntries.some(entry => entry.id === 'opening-rig'));
  const rigEntries = (await (await api('/api/leaderboard?mode=skirmish&skirmishOpening=command-rig', profile.token)).json()).entries;
  assert.deepEqual(rigEntries.map(entry => entry.id), ['opening-rig']);
  assert.equal((await api('/api/leaderboard?mode=campaign&skirmishOpening=command-rig', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=skirmish&skirmishOpening=bogus', profile.token)).status, 400);
});

test('skirmish victory mode is locked by tickets and has separate leaderboard results', async () => {
  const profile = await createProfile('Elimination Rank');
  const ticket = fields => api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'skirmish', difficulty: 'normal', faction: 'vesper', scenarioId: 'random', ...fields,
  }) });
  assert.equal((await ticket({ victoryMode: 'invalid' })).status, 400);
  const standard = await ticket({});
  assert.equal(standard.status, 201);
  assert.equal((await standard.json()).victoryMode, 'dominion');
  const elimination = await ticket({ victoryMode: 'elimination' });
  assert.equal(elimination.status, 201);
  const locked = await elimination.json();
  assert.equal(locked.victoryMode, 'elimination');
  assert.equal(store.runs.find(run => run.id === locked.runId).victoryMode, 'elimination');
  assert.equal((await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'easy', faction: CAMPAIGN_MISSIONS[0].faction,
    scenarioId: CAMPAIGN_MISSIONS[0].id, victoryMode: 'dominion',
  }) })).status, 400);

  const common = { profileId: profile.profile.id, mode: 'skirmish', difficulty: 'normal',
    faction: 'vesper', scenarioId: 'random', seconds: 30, kills: 2, completedAt: 400,
    scoreVersion: SOLO_REPLAY_VERSION, aiCommanderProfileId: AI_COMMANDER_PROFILES[0].id, verified: true };
  store.scores.push({ ...common, id: 'victory-legacy' },
    { ...common, id: 'victory-elimination', victoryMode: 'elimination', completedAt: 401 },
    { ...common, id: 'victory-elimination-rig', skirmishOpening: 'command-rig',
      victoryMode: 'elimination', completedAt: 402 });
  const getEntries = async query => (await (await api(`/api/leaderboard?mode=skirmish${query}`, profile.token)).json()).entries;
  assert.ok((await getEntries('')).some(entry => entry.id === 'victory-legacy' && entry.victoryMode === 'dominion'));
  assert.ok(!(await getEntries('')).some(entry => entry.id === 'victory-elimination'));
  assert.deepEqual((await getEntries('&victoryMode=elimination')).map(entry => entry.id), ['victory-elimination']);
  const implicitMode = (await (await api('/api/leaderboard?victoryMode=elimination', profile.token)).json()).entries;
  assert.deepEqual(implicitMode.map(entry => entry.id), ['victory-elimination'],
    'a victory-only filter still keeps separate opening economies apart');
  assert.equal((await api('/api/leaderboard?mode=campaign&victoryMode=dominion', profile.token)).status, 400);
  assert.equal((await api('/api/leaderboard?mode=skirmish&victoryMode=bogus', profile.token)).status, 400);
});

test('replay envelope defaults old skirmish runs and rejects invalid or campaign openings', () => {
  const base = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 12,
    scenarioId: SKIRMISH_MAPS[0].id };
  assert.equal(validateSoloEnvelope(base), 0);
  assert.equal(validateSoloEnvelope({ ...base, skirmishOpening: 'command-rig' }), 0);
  assert.equal(validateSoloEnvelope({ ...base, victoryMode: 'elimination' }), 0);
  assert.throws(() => validateSoloEnvelope({ ...base, skirmishOpening: 'other' }), /skirmish opening/i);
  assert.throws(() => validateSoloEnvelope({ ...base, victoryMode: 'other' }), /victory mode/i);
  assert.throws(() => validateSoloEnvelope({ mode: 'campaign', difficulty: 'easy', faction: 'aegis',
    seed: 12, scenarioId: CAMPAIGN_MISSIONS[0].id, skirmishOpening: 'established' }), /cannot have a skirmish opening/i);
  assert.throws(() => validateSoloEnvelope({ mode: 'campaign', difficulty: 'easy', faction: 'aegis',
    seed: 12, scenarioId: CAMPAIGN_MISSIONS[0].id, victoryMode: 'elimination' }), /cannot have a skirmish victory mode/i);
});

test('ranked score finish rejects a nonterminal replay without recording client supplied statistics', async () => {
  const profile = await createProfile('Replay');
  const started = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'skirmish',
    difficulty: 'normal', faction: 'aegis', scenarioId: 'random' }) });
  assert.equal(started.status, 201);
  const run = await started.json();
  assert.equal(run.aiCommanderProfileId, aiCommanderProfileForSeed(run.seed).id);
  const before = store.scores.length;
  const response = await api(`/api/scores/runs/${run.runId}/finish`, profile.token, { method: 'POST',
    body: json({ commands: [], completedTicks: 1, seconds: 1, kills: 9999, result: 'victory' }) });
  assert.equal(response.status, 400);
  assert.equal(store.scores.length, before);
  assert.equal(store.runs.find(item => item.id === run.runId).finishedAt, null);
});

test('a recorded campaign victory is verified and ranked with server-derived statistics', async () => {
  const profile = await createProfile('Verified Victory');
  const started = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'easy', faction: 'aegis', scenarioId: CAMPAIGN_MISSIONS[0].id,
  }) });
  assert.equal(started.status, 201);
  const run = await started.json();
  assert.equal(run.supplyId, 'none');
  assert.equal(store.runs.find(item => item.id === run.runId).supplyId, 'none');
  const game = createCampaignGame(0, 'easy', run.seed);
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  assert.equal(game.startConstruction('refinery').ok, true);
  let placed = false, defenseStaged = false, attackTargetId = null;
  while (game.status === 'playing' && clock.completedTicks < 1800) {
    if (game.construction?.ready && !placed) {
      const site = Array.from({ length: 15 }, (_, y) => y + 27)
        .flatMap(y => Array.from({ length: 17 }, (_, x) => [x + 3, y]))
        .find(([x, y]) => game.canPlaceBuilding('refinery', x, y).ok);
      assert.ok(site, 'a valid second refinery site remains available');
      assert.equal(game.issueBuild('refinery', ...site).ok, true);
      placed = true;
    }
    const raid = game.campaignState;
    const defenders = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      unit.defId !== 'harvester').map(unit => unit.id);
    if (raid.firstHarvestRaidWarned && !defenseStaged) {
      game.select(defenders());
      assert.equal(game.issueMove(24.5, 36.5, true).ok, true);
      defenseStaged = true;
    }
    if (raid.firstHarvestRaidFired) {
      const target = (raid.firstHarvestRaidUnitIds || []).map(id => game.getEntity(id))
        .find(unit => unit?.hp > 0);
      if (target && target.id !== attackTargetId) {
        game.select(defenders());
        if (game.issueAttack(target.id).ok) attackTargetId = target.id;
      }
    }
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 0, SOLO_STEP_SECONDS);
    clock.completedTicks++;
  }
  recorder.dispose();
  assert.equal(game.status, 'victory');
  assert.equal(game.winner, 'player');
  assert.equal(placed, true);
  assert.equal(defenseStaged, true);
  assert.equal(game.campaignState.firstHarvestRaidRepelled, true);
  assert.ok(recorder.commands.some(command => command.method === 'issueMove'));
  assert.ok(recorder.commands.some(command => command.method === 'issueAttack'));

  // The API limits submitted simulation time to elapsed wall time plus 15 seconds.
  const earliestFinish = run.startedAt + clock.completedTicks * SOLO_STEP_SECONDS * 1000 - 15000 + 250;
  if (Date.now() < earliestFinish) await new Promise(resolve => setTimeout(resolve, earliestFinish - Date.now()));
  const finished = await api(`/api/scores/runs/${run.runId}/finish`, profile.token, { method: 'POST', body: json({
    commands: recorder.commands, completedTicks: clock.completedTicks,
    result: 'victory', seconds: 1, kills: 9999, supplyId: 'vanguard',
  }) });
  assert.equal(finished.status, 200, finished.status === 200 ? undefined : await finished.text());
  const result = await finished.json();
  assert.equal(result.accepted, true);
  assert.equal(result.result, 'victory');
  assert.equal(result.entry.verified, true);
  assert.equal(result.entry.profileId, profile.profile.id);
  assert.equal(result.entry.seconds, Math.ceil(clock.completedTicks * SOLO_STEP_SECONDS));
  assert.equal(result.entry.kills, game.kills.player);
  assert.notEqual(result.entry.kills, 9999);
  assert.equal(result.entry.supplyId, 'none', 'finish request cannot replace the ticket package');
  assert.equal(result.entry.campaignStars, game.campaignResult.stars,
    'the stored medal result comes from the server replay');
  assert.equal(result.entry.deployedVeteran, null);
  const expectedVeteran = deriveCampaignVeteran(game);
  assert.deepEqual(result.entry.campaignVeteran, expectedVeteran);
  assert.deepEqual(store.scores.find(score => score.id === result.entry.id).campaignVeteran, expectedVeteran);
  assert.equal(store.scores.find(score => score.id === result.entry.id).campaignStars, game.campaignResult.stars);
  const historyResponse = await api('/api/records/history', profile.token);
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()).entries;
  assert.equal(history.length, 1);
  assert.equal(history[0].result, 'victory');
  assert.equal(history[0].score, result.entry.score);
  assert.equal(history[0].seconds, result.entry.seconds);
  assert.equal(history[0].kills, game.kills.player);
  assert.equal(history[0].scenarioId, run.scenarioId);
  assert.equal(history[0].supplyId, 'none');
  assert.deepEqual(history[0].campaignVeteran, expectedVeteran);
  assert.equal(history[0].deployedVeteran, null);
  assert.equal('token' in history[0], false);
  const persistedRecord = store.history.find(record => record.id === history[0].id);
  const originalScoreId = persistedRecord.scoreId;
  persistedRecord.scoreId = 'score-pruned-from-leaderboard-retention';
  const prunedScoreHistory = await api('/api/records/history', profile.token);
  assert.equal((await prunedScoreHistory.json()).entries[0].score, null,
    'a victory whose linked score has been pruned does not get an invented score');
  persistedRecord.scoreId = originalScoreId;
  assert.deepEqual((await (await api('/api/records/history', (await createProfile('History outsider')).token)).json()).entries, []);
  const scoreCount = store.scores.length;
  const retry = await api(`/api/scores/runs/${run.runId}/finish`, profile.token, { method: 'POST', body: json({
    commands: recorder.commands, completedTicks: clock.completedTicks,
  }) });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), result);
  assert.equal(store.scores.length, scoreCount);
  assert.equal((await (await api('/api/records/history', profile.token)).json()).entries.length, 1);
  const other = await createProfile('Different Profile');
  assert.equal((await api(`/api/scores/runs/${run.runId}/finish`, other.token, { method: 'POST', body: json({}) })).status, 404);
  assert.equal((await api(`/api/scores/runs/${run.runId}/finish`, null, { method: 'POST', body: json({}) })).status, 401);
  const leaderboard = await api(`/api/leaderboard?mode=campaign&difficulty=easy&scenarioId=${run.scenarioId}&supplyId=none`, profile.token);
  assert.equal(leaderboard.status, 200);
  const entries = (await leaderboard.json()).entries;
  assert.deepEqual(entries.map(entry => entry.id), [result.entry.id]);
  assert.equal(entries[0].seconds, result.entry.seconds);
  assert.equal(entries[0].kills, result.entry.kills);
  const nextStarted = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({
    mode: 'campaign', difficulty: 'easy', faction: 'aegis', scenarioId: CAMPAIGN_MISSIONS[1].id,
  }) });
  assert.equal(nextStarted.status, 201);
  assert.deepEqual((await nextStarted.json()).campaignVeteran, expectedVeteran,
    'the next ticket uses the survivor produced by a real verified replay');
});

test('a verified defeat finish can be retried without creating a score', async () => {
  const profile = await createProfile('Verified Defeat');
  const started = await api('/api/scores/runs', profile.token, { method: 'POST', body: json({ mode: 'skirmish',
    difficulty: 'hard', faction: 'aegis', scenarioId: SKIRMISH_MAPS[0].id }) });
  assert.equal(started.status, 201);
  const run = await started.json();
  const playback = createSoloPlayback({ mode: 'skirmish', difficulty: 'hard', faction: 'aegis',
    seed: run.seed, scenarioId: run.scenarioId, skirmishOpening: run.skirmishOpening,
    victoryMode: run.victoryMode }, [], 12_000, SOLO_REPLAY_VERSION);
  while (playback.game.status === 'playing' && playback.tick < 12_000) playback.step(1);
  const completedTicks = playback.tick;
  assert.equal(playback.game.status, 'defeat');
  store.runs.find(item => item.id === run.runId).startedAt -= completedTicks * SOLO_STEP_SECONDS * 1000;
  const body = json({ commands: [], completedTicks });
  const scoreCount = store.scores.length;
  let droppedResponse;
  const responseDropped = new Promise(resolve => { droppedResponse = resolve; });
  let dropFirstFinish = true;
  const faultProxy = http.createServer((req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: server.address().port,
      path: req.url, method: req.method, headers: req.headers }, upstreamRes => {
      if (dropFirstFinish && req.url === `/api/scores/runs/${run.runId}/finish`) {
        dropFirstFinish = false;
        upstreamRes.resume();
        upstreamRes.once('end', () => {
          res.destroy(new Error('Injected lost finish response'));
          droppedResponse();
        });
        return;
      }
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
    req.pipe(upstream);
  });
  faultProxy.listen(0, '127.0.0.1');
  await new Promise(resolve => faultProxy.once('listening', resolve));
  const proxyUrl = `http://127.0.0.1:${faultProxy.address().port}`;
  const finishViaProxy = () => fetch(`${proxyUrl}/api/scores/runs/${run.runId}/finish`, {
    method: 'POST', headers: { ...auth(profile.token), 'Content-Type': 'application/json' }, body,
  });
  try {
    await assert.rejects(finishViaProxy(), /fetch failed/);
    await responseDropped;
    const afterDroppedResponse = JSON.parse(fs.readFileSync(process.env.FRONTIER_DATA_FILE, 'utf8'));
    const persistedDefeat = afterDroppedResponse.history.filter(item => item.profileId === profile.profile.id);
    assert.equal(persistedDefeat.length, 1, 'the origin persisted the result before the proxy dropped its response');
    assert.equal(persistedDefeat[0].result, 'defeat');
    const retry = await finishViaProxy();
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { accepted: true, result: 'defeat', entry: null });
    assert.equal(store.scores.length, scoreCount, 'a defeat and its retry must not create a score');
  } finally {
    await new Promise(resolve => faultProxy.close(resolve));
  }
  const historyResponse = await api('/api/records/history', profile.token);
  assert.equal(historyResponse.status, 200);
  const [record] = (await historyResponse.json()).entries;
  assert.equal(record.result, 'defeat');
  assert.equal(record.score, null);
  assert.equal(record.mode, 'skirmish');
  assert.equal(record.faction, 'aegis');
  assert.equal(record.skirmishOpening, 'established');
  assert.equal(record.aiCommanderProfileId, aiCommanderProfileForSeed(run.seed).id);
  assert.equal((await (await api('/api/records/history', profile.token)).json()).entries.length, 1);
  const persisted = JSON.parse(fs.readFileSync(process.env.FRONTIER_DATA_FILE, 'utf8'));
  assert.ok(persisted.history.some(item => item.profileId === profile.profile.id && item.result === 'defeat'));
  const reloadedCount = Number(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import('./server/index.js').then(({store}) => console.log(store.history.length))"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', FRONTIER_DATA_FILE: process.env.FRONTIER_DATA_FILE },
  }).toString().trim());
  assert.ok(reloadedCount >= persisted.history.length,
    'reload retains persisted history and may backfill newly uncovered verified legacy scores');
});

test('live multiplayer Bloom Expedition dispatch filters selections to the authenticated seat', async () => {
  const a = await createProfile('Bloom Order Host'); const b = await createProfile('Bloom Order Guest');
  const host = await openSocket(a.token); const guest = await openSocket(b.token);
  await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const room = await nextMessage(host, message => message.type === 'lobby');
  sendSocket(guest, { type: 'join_lobby', code: room.code });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(host, { type: 'set_ready', ready: true }); sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'match_start')));

  const lobby = lobbies.get(room.code), game = lobby.game;
  const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester' &&
    unit.order?.type === 'harvest' && unit._harvestPhase !== 'return' && unit.cargo < UNIT_DEFS.harvester.capacity);
  const escort = game.units.find(unit => unit.owner === 'player' && unit.defId !== 'harvester' &&
    !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon && UNIT_DEFS[unit.defId].weapon.target !== 'air');
  const refinery = game.buildings.find(building => building.owner === 'player' && building.defId === 'refinery' &&
    building.hp > 0 && building.progress >= 1);
  assert.ok(harvester && escort && refinery, 'the opening force includes the required units and refinery');
  const reachableCrystal = game.terrain.flatMap((row, y) => row.map((tile, x) => ({ tile, x, y })))
    .filter(({ tile }) => tile.type === 'crystal' && tile.resource >= 180 && tile.walkable)
    .filter(({ x, y }) => game._findPath(harvester.x, harvester.y, x + 0.5, y + 0.5).length &&
      game._findPath(x + 0.5, y + 0.5, refinery.x + refinery.w / 2, refinery.y + refinery.h / 2).length)
    .sort((left, right) => Math.hypot(left.x + 0.5 - harvester.x, left.y + 0.5 - harvester.y) -
      Math.hypot(right.x + 0.5 - harvester.x, right.y + 0.5 - harvester.y))[0];
  assert.ok(reachableCrystal, 'the map has a reachable crystal tile for the test expedition');
  game.storm.bloom = { x: reachableCrystal.x + 0.5, y: reachableCrystal.y + 0.5,
    radius: 1, until: game.time + 10_000 };

  sendSocket(guest, { type: 'command', requestId: 'cmd-bloom-foreign', command: 'issueBloomExpedition',
    ids: [harvester.id, escort.id] });
  const rejected = await nextMessage(guest, message => message.type === 'command_result' &&
    message.requestId === 'cmd-bloom-foreign');
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /Select a harvesting Harvester/,
    'the guest cannot smuggle the host Harvester through the command dispatch');
  assert.equal(harvester.order.bloomExpedition, undefined);

  sendSocket(host, { type: 'command', requestId: 'cmd-bloom-no-escort', command: 'issueBloomExpedition',
    ids: [harvester.id] });
  const missingEscort = await nextMessage(host, message => message.type === 'command_result' &&
    message.requestId === 'cmd-bloom-no-escort');
  assert.equal(missingEscort.ok, false);
  assert.match(missingEscort.reason, /at least one armed ground escort/);

  sendSocket(host, { type: 'command', requestId: 'cmd-bloom-valid', command: 'issueBloomExpedition',
    ids: [harvester.id, escort.id] });
  const accepted = await nextMessage(host, message => message.type === 'command_result' &&
    message.requestId === 'cmd-bloom-valid');
  assert.equal(accepted.ok, true, 'the allowlisted no-argument method accepts the selected expedition group');
  assert.deepEqual(accepted.harvesterIds, [harvester.id]);
  assert.deepEqual(accepted.escortIds, [escort.id]);
  assert.equal(harvester.order.bloomExpedition, true);
  assert.equal(escort.order.bloomExpeditionEscort, true);
  sendSocket(host, { type: 'leave_lobby' });
  await nextMessage(guest, message => message.type === 'match_end');
  host.close(); guest.close();
});

test('websocket multiplayer requires a bearer token and projects an oriented lobby snapshot', async () => {
  const bad = await new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?token=bad`);
    ws.once('unexpected-response', (_request, response) => { resolve(response.statusCode); response.resume(); });
    ws.on('error', () => {});
  });
  assert.equal(bad, 401);
  const a = await createProfile('Host'); const b = await createProfile('Guest');
  const host = await openSocket(a.token); const guest = await openSocket(b.token);
  await nextMessage(host, message => message.type === 'hello');
  await nextMessage(guest, message => message.type === 'hello');
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const lobby = await nextMessage(host, message => message.type === 'lobby');
  // The room snapshot exposes the query-string contract used by the copied
  // invite URL. Opening that URL must yield the same code accepted by join.
  assert.equal(lobby.inviteUrl, `/?join=${lobby.code}`);
  const inviteUrl = new URL(lobby.inviteUrl, baseUrl);
  assert.equal(inviteUrl.searchParams.get('join'), lobby.code);
  sendSocket(guest, { type: 'join_lobby', code: inviteUrl.searchParams.get('join') });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby');
  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  const startA = await nextMessage(host, message => message.type === 'match_start');
  const startB = await nextMessage(guest, message => message.type === 'match_start');
  assert.equal(startA.side, 'player'); assert.equal(startB.side, 'enemy');
  assert.equal('seed' in startA, false); assert.equal('seed' in startB, false);
  assert.equal(startA.state.commandOwner, 'player'); assert.equal(startB.state.commandOwner, 'player');
  assert.equal('seed' in startA.state, false); assert.equal('randomState' in startA.state, false);
  assert.equal('seed' in startB.state, false); assert.equal('randomState' in startB.state, false);
  const liveLobby = lobbies.get(lobby.code);
  const researchCenter = liveLobby.game._createBuilding('player', 'tech', 12, 12, 1);
  researchCenter.powered = true;
  liveLobby.game.credits.player = 5000;
  sendSocket(host, { type: 'command', requestId: 'cmd-invalid', command: 'chooseDoctrine', doctrineId: 'not-a-doctrine' });
  const invalidResearch = await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'chooseDoctrine');
  assert.equal(invalidResearch.ok, false);
  assert.equal(invalidResearch.requestId, 'cmd-invalid');
  assert.match(invalidResearch.reason, /Unknown doctrine/);
  sendSocket(host, { type: 'command', requestId: 'cmd-valid', command: 'chooseDoctrine', doctrineId: 'logistics' });
  const validResearch = await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'chooseDoctrine');
  assert.equal(validResearch.ok, true);
  assert.equal(validResearch.requestId, 'cmd-valid');
  const ownResearchState = await nextMessage(host, message => message.type === 'state' &&
    message.state.research?.player?.project?.id === 'logistics');
  const opponentResearchState = await nextMessage(guest, message => message.type === 'state' &&
    message.state.time >= ownResearchState.state.time);
  assert.equal(ownResearchState.state.research.player.project.id, 'logistics');
  assert.ok(ownResearchState.state.research.player.project.progress >= 0);
  assert.equal(opponentResearchState.state.research.player.project, null,
    'the guest must not receive the host project as its own research');
  assert.equal(opponentResearchState.state.research.enemy.project, null,
    'opponent snapshot hides the private in-progress research choice and progress');
  assert.doesNotThrow(() => Game.deserialize(opponentResearchState.state));
  liveLobby.game.research.player.doctrine = 'logistics';
  liveLobby.game.research.player.project = null;
  sendSocket(host, { type: 'command', requestId: 'cmd-replacement', command: 'chooseDoctrine', doctrineId: 'siege' });
  const replacement = await nextMessage(host, message => message.type === 'command_result' &&
    message.requestId === 'cmd-replacement');
  assert.equal(replacement.ok, true, 'a live commander can fund the one doctrine adaptation');
  const ownReplacementState = await nextMessage(host, message => message.type === 'state' &&
    message.state.research?.player?.project?.id === 'siege');
  const opponentReplacementState = await nextMessage(guest, message => message.type === 'state' &&
    message.state.time >= ownReplacementState.state.time);
  assert.equal(ownReplacementState.state.research.player.replacementUsed, true);
  assert.equal(opponentReplacementState.state.research.enemy.project, null);
  assert.equal(opponentReplacementState.state.research.enemy.replacementUsed, false,
    'the opponent must not see that a private doctrine adaptation started');
  sendSocket(host, { type: 'command', requestId: 'tactical-invalid', command: 'chooseTacticalPackage', packageId: 'unknown' });
  const invalidTactical = await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'chooseTacticalPackage');
  assert.equal(invalidTactical.ok, false);
  assert.match(invalidTactical.reason, /Unknown tactical package/);
  sendSocket(host, { type: 'command', requestId: 'tactical-valid', command: 'chooseTacticalPackage', packageId: 'breach' });
  const validTactical = await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'chooseTacticalPackage');
  assert.equal(validTactical.ok, true);
  assert.equal(validTactical.requestId, 'tactical-valid');
  const ownTacticalState = await nextMessage(host, message => message.type === 'state' &&
    message.state.research?.player?.tacticalProject?.id === 'breach');
  const opponentTacticalState = await nextMessage(guest, message => message.type === 'state' &&
    message.state.time >= ownTacticalState.state.time);
  assert.equal(opponentTacticalState.state.research.enemy.tacticalProject, null,
    'opponent snapshots hide tactical package research and progress');
  assert.equal(opponentTacticalState.state.research.enemy.tactical, null,
    'the unfinished tactical package is not exposed as a completed choice');
  const relay = liveLobby.game.relays.find(item => !liveLobby.game._relayIsContested(item));
  assert.ok(relay, 'the room has a secure relay for the protocol order');
  relay.owner = 'player'; relay.progress = 1; relay.contested = false;
  sendSocket(host, { type: 'command', command: 'setRelayProtocol', ids: [],
    relayId: relay.id, protocol: 'overdrive' });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'setRelayProtocol')).ok, true);
  assert.equal(relay.protocol, 'overdrive');
  const hostRelayState = await nextMessage(host, message => message.type === 'state' &&
    message.state.relays.some(item => item.id === relay.id && item.protocol === 'overdrive'));
  assert.equal(hostRelayState.state.relays.find(item => item.id === relay.id).owner, 'player');
  sendSocket(guest, { type: 'command', command: 'setRelayProtocol', ids: [],
    relayId: relay.id, protocol: 'shelter' });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'setRelayProtocol')).ok, false);
  assert.equal(relay.protocol, 'overdrive');

  const logisticsRelays = liveLobby.game.relays.filter(item => !liveLobby.game.units.some(unit =>
    unit.hp > 0 && unit.owner !== 'player' && !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying &&
    Math.hypot(unit.x - item.x, unit.y - item.y) <= 2.3));
  assert.equal(logisticsRelays.length, 3, 'all three relay sites are uncontested in this fixture');
  const priorRelayStates = logisticsRelays.map(item => ({ relay: item, owner: item.owner,
    progress: item.progress, contested: item.contested, protocol: item.protocol,
    protocolCooldown: item.protocolCooldown }));
  const priorCredits = liveLobby.game.credits.player;
  const refinery = liveLobby.game.buildings.find(building => building.owner === 'player' && building.defId === 'refinery');
  assert.ok(refinery, 'the live match has a player refinery for the unload fixture');
  const testHarvester = liveLobby.game._createUnit('player', 'harvester', refinery.x + 1.5,
    refinery.y + 1, { type: 'harvest' });
  const fixtureCreditEvents = [];
  try {
    for (const [index, item] of logisticsRelays.entries()) {
      item.owner = 'player'; item.progress = 1; item.contested = false;
      item.protocol = 'shelter'; item.protocolCooldown = 0;
      sendSocket(host, { type: 'command', requestId: `cmd-logistics-${index}`,
        command: 'setRelayProtocol', ids: [], relayId: item.id, protocol: 'logistics' });
      const result = await nextMessage(host, message => message.type === 'command_result' &&
        message.requestId === `cmd-logistics-${index}`);
      assert.equal(result.ok, true, 'the server accepts Logistics as a direct protocol choice');
    }
    const logisticsState = await nextMessage(host, message => message.type === 'state' &&
      logisticsRelays.every(item => message.state.relays.some(projected =>
        projected.id === item.id && projected.owner === 'player' && projected.protocol === 'logistics')));
    assert.ok(logisticsState, 'the host receives the projected Logistics protocol for all three secure relays');

    const unload = (credits, cargo) => {
      liveLobby.game.credits.player = credits;
      testHarvester.x = refinery.x + refinery.w / 2;
      testHarvester.y = refinery.y + refinery.h / 2;
      testHarvester.cargo = cargo;
      testHarvester.order = { type: 'harvest' };
      testHarvester._harvestPhase = 'return';
      testHarvester._unloadRefineryId = null;
      testHarvester._unloadApproach = null;
      testHarvester._unloadRemaining = 0;
      testHarvester._unloadProgress = 0;
      liveLobby.game._updateHarvester(testHarvester, 1);
      testHarvester.order = { type: 'idle' };
      const event = liveLobby.game.events.filter(event => event.type === 'credits').at(-1);
      fixtureCreditEvents.push(event);
      return event;
    };
    assert.equal(unload(1000, 100).amount, 130,
      'three Logistics relays add the maximum 30% bonus to 100 accepted cargo');
    const cappedCreditEvent = unload(5880, 100);
    assert.equal(cappedCreditEvent.amount, 120,
      'a full store clips the 30-credit bonus to the 20 credits of remaining capacity');
    assert.equal(liveLobby.game.credits.player, liveLobby.game.creditCapacity.player);
    const unloadState = await nextMessage(host, message => message.type === 'state' &&
      message.state.credits.player === liveLobby.game.creditCapacity.player &&
      message.state.units.some(unit => unit.id === testHarvester.id && unit.cargo === 0));
    assert.equal(unloadState.state.credits.player, 6000,
      'the multiplayer host snapshot carries the server-authoritative capped unload total');
  } finally {
    liveLobby.game.units = liveLobby.game.units.filter(unit => unit.id !== testHarvester.id);
    liveLobby.game.credits.player = priorCredits;
    liveLobby.game.events = liveLobby.game.events.filter(event => !fixtureCreditEvents.includes(event));
    for (const state of priorRelayStates) Object.assign(state.relay, {
      owner: state.owner, progress: state.progress, contested: state.contested,
      protocol: state.protocol, protocolCooldown: state.protocolCooldown,
    });
  }
  const hostUnit = startA.state.units.find(unit => unit.owner === 'player' && unit.defId !== 'harvester');
  const enemyUnit = startB.state.units.find(unit => unit.owner === 'player' && unit.defId !== 'harvester');
  assert.ok(hostUnit && enemyUnit);
  const priorOrder = enemyUnit.order;
  const deniedResult = nextMessage(host, message => message.type === 'command_result');
  sendSocket(host, { type: 'command', command: 'issueStop', ids: [enemyUnit.id] });
  const commandResult = await deniedResult;
  assert.equal(commandResult.ok, false);
  const afterDenied = await nextMessage(guest, message => message.type === 'state' &&
    message.state.units.some(unit => unit.id === enemyUnit.id));
  assert.deepEqual(afterDenied.state.units.find(unit => unit.id === enemyUnit.id).order, priorOrder);

  const hostDestination = { x: hostUnit.x + 1, y: hostUnit.y };
  sendSocket(host, { type: 'command', command: 'issueMove', ids: [hostUnit.id], ...hostDestination });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' && message.command === 'issueMove')).ok, true);
  const hostState = await nextMessage(host, message => message.type === 'state' &&
    message.state.units.some(unit => unit.id === hostUnit.id && unit.order?.type === 'move'));
  assert.deepEqual(hostState.state.selection, [hostUnit.id]);

  const routeFirst = nextMessage(host, message => message.type === 'command_result' &&
    message.requestId === 'route-first');
  const routeQueued = nextMessage(host, message => message.type === 'command_result' &&
    message.requestId === 'route-queued');
  const routedState = nextMessage(host, message => message.type === 'state' &&
    message.state.units.some(unit => unit.id === hostUnit.id && unit.order?.queue?.length === 1));
  sendSocket(host, { type: 'command', command: 'issueMove', ids: [hostUnit.id],
    x: hostUnit.x + 10, y: hostUnit.y, requestId: 'route-first' });
  sendSocket(host, { type: 'command', command: 'issueMove', ids: [hostUnit.id],
    x: hostUnit.x + 11, y: hostUnit.y + 1, queue: true, requestId: 'route-queued' });
  assert.equal((await routeFirst).ok, true);
  assert.equal((await routeQueued).ok, true);
  assert.equal((await routedState).state.units.find(unit => unit.id === hostUnit.id).order.queue.length, 1,
    'server-authoritative queued route reaches only the owning commander');
  sendSocket(guest, { type: 'command', command: 'issueMove', ids: [hostUnit.id],
    x: hostUnit.x + 12, y: hostUnit.y, queue: true });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'issueMove')).ok, false, 'guest cannot append orders to the host squad');
  sendSocket(host, { type: 'command', command: 'issueMove', ids: [hostUnit.id],
    x: hostUnit.x + 12, y: hostUnit.y, queue: 'true' });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'issueMove')).ok, false, 'queued-order flag must be a boolean');

  const salvageEngineer = liveLobby.game._createUnit('player', 'engineer', hostUnit.x, hostUnit.y);
  const wreckId = `wreck${liveLobby.game._nextWreckId++}`;
  liveLobby.game.wrecks.push({ id: wreckId, x: salvageEngineer.x, y: salvageEngineer.y,
    value: 60, faction: 'vesper', expiresAt: liveLobby.game.time + 120 });
  liveLobby.game._updateFog();
  sendSocket(guest, { type: 'command', command: 'issueRecoverWreck', ids: [salvageEngineer.id], wreckId });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'issueRecoverWreck')).ok, false, 'the guest cannot order the host Engineer');
  sendSocket(host, { type: 'command', command: 'issueRecoverWreck', ids: [salvageEngineer.id], wreckId });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'issueRecoverWreck')).ok, true);
  assert.deepEqual(salvageEngineer.order, { type: 'recoverWreck', wreckId });

  const serviceTank = liveLobby.game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  serviceTank.hp -= 40;
  const workshop = liveLobby.game._createBuilding('player', 'serviceBay', 20, 38, 1);
  liveLobby.game._refreshPower();
  liveLobby.game._updateFog();
  sendSocket(guest, { type: 'command', command: 'issueServiceAtWorkshop', ids: [serviceTank.id], workshopId: workshop.id });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'issueServiceAtWorkshop')).ok, false, 'the guest cannot order the host tank');
  sendSocket(host, { type: 'command', command: 'issueServiceAtWorkshop', ids: [serviceTank.id], workshopId: workshop.id });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'issueServiceAtWorkshop')).ok, true);
  assert.equal(serviceTank.order.type, 'service');

  const guardian = liveLobby.game._createUnit('player', 'guardian', hostUnit.x + 1, hostUnit.y);
  sendSocket(guest, { type: 'command', command: 'useUnitAbility', unitId: guardian.id, abilityId: 'brace' });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'useUnitAbility')).ok, false, 'the guest cannot activate the host Guardian ability');
  sendSocket(host, { type: 'command', command: 'useUnitAbility', unitId: guardian.id, abilityId: 'brace' });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'useUnitAbility')).ok, true);
  assert.ok(guardian.braceUntil > liveLobby.game.time);

  // Promotion commands address one unit directly, but still use the server's
  // commandOwner seat check and only accept the two engine-defined choices.
  serviceTank.veterancy = 2;
  sendSocket(guest, { type: 'command', command: 'issuePromoteUnit', unitId: serviceTank.id,
    promotionId: 'bulwark' });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'issuePromoteUnit')).ok, false, 'the guest cannot promote the host tank');
  sendSocket(host, { type: 'command', command: 'issuePromoteUnit', unitId: serviceTank.id,
    promotionId: 'invalid' });
  const invalidPromotion = await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'issuePromoteUnit');
  assert.equal(invalidPromotion.ok, false);
  assert.match(invalidPromotion.reason, /Bulwark or Rangefinder/);
  sendSocket(host, { type: 'command', command: 'issuePromoteUnit', unitId: serviceTank.id,
    promotionId: 'bulwark' });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'issuePromoteUnit')).ok, true);
  assert.equal(serviceTank.promotion, 'bulwark');

  sendSocket(guest, { type: 'command', command: 'issueStop', ids: [enemyUnit.id] });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' && message.command === 'issueStop')).ok, true);
  const guestState = await nextMessage(guest, message => message.type === 'state' &&
    message.state.selection.includes(enemyUnit.id));
  assert.equal(guestState.state.units.find(unit => unit.id === enemyUnit.id).owner, 'player');

  const c = await createProfile('Other Host');
  const other = await openSocket(c.token);
  await nextMessage(other, message => message.type === 'hello');
  sendSocket(other, { type: 'create_lobby', faction: 'vesper' });
  const otherLobby = await nextMessage(other, message => message.type === 'lobby');
  sendSocket(host, { type: 'join_lobby', code: otherLobby.code });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /Leave the current match/);
  sendSocket(host, { type: 'create_lobby', faction: 'vesper' });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /Leave the current match/);
  sendSocket(host, { type: 'join_lobby', code: lobby.code });
  assert.equal((await nextMessage(host, message => message.type === 'match_start')).code, lobby.code);
  sendSocket(host, { type: 'command', command: 'issueStop', ids: [hostUnit.id] });
  assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
    message.command === 'issueStop')).ok, true);
  assert.equal(host.messages.some(message => message.type === 'match_end'), false);
  assert.equal(guest.messages.some(message => message.type === 'match_end'), false);

  const endedHost = nextMessage(host, message => message.type === 'match_end');
  const endedGuest = nextMessage(guest, message => message.type === 'match_end');
  sendSocket(host, { type: 'leave_lobby' });
  await Promise.all([endedHost, endedGuest]);
  host.close(); guest.close(); other.close();
});

test('casual matchmaking pairs FIFO into a normal lobby and still requires explicit ready and host start', async () => {
  const one = await createProfile('Queue One'); const host = await openSocket(one.token);
  const duplicate = await openSocket(one.token);
  await nextMessage(host, message => message.type === 'hello');
  await nextMessage(duplicate, message => message.type === 'hello');
  sendSocket(duplicate, { type: 'queue_join' });
  assert.match((await nextMessage(duplicate, message => message.type === 'error')).error, /another tab/);
  const hostClosed = new Promise(resolve => duplicate.once('close', resolve)); duplicate.terminate(); await hostClosed;

  const two = await createProfile('Queue Two'); const guest = await openSocket(two.token);
  await nextMessage(guest, message => message.type === 'hello');
  sendSocket(host, { type: 'queue_join' });
  assert.equal((await nextMessage(host, message => message.type === 'matchmaking' && message.status === 'queued')).position, 1);
  sendSocket(guest, { type: 'queue_join' });
  await nextMessage(host, message => message.type === 'matchmaking' && message.status === 'match_found');
  await nextMessage(guest, message => message.type === 'matchmaking' && message.status === 'match_found');
  const [hostLobby, guestLobby] = await Promise.all([
    nextMessage(host, message => message.type === 'lobby' && message.matchmaking === true),
    nextMessage(guest, message => message.type === 'lobby' && message.matchmaking === true),
  ]);
  assert.equal(hostLobby.code, guestLobby.code);
  assert.equal(hostLobby.settings.victoryMode, 'dominion');
  assert.ok(SKIRMISH_MAPS.some(map => map.id === hostLobby.settings.mapId));
  assert.equal(hostLobby.players.length, 2);
  assert.ok(hostLobby.players.every(player => !player.ready));
  assert.equal('inviteUrl' in hostLobby, true);
  const third = await createProfile('Queue Intruder'); const thirdSocket = await openSocket(third.token);
  await nextMessage(thirdSocket, message => message.type === 'hello');
  sendSocket(thirdSocket, { type: 'join_lobby', code: hostLobby.code });
  assert.match((await nextMessage(thirdSocket, message => message.type === 'error')).error, /full or already playing/);
  sendSocket(host, { type: 'invite_friend', friendId: third.profile.id });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /cannot invite friends/);
  sendSocket(host, { type: 'set_settings', mapId: SKIRMISH_MAPS[1].id, victoryMode: 'elimination' });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /settings are fixed/);
  sendSocket(host, { type: 'start_match' });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /Both commanders must be ready/);
  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  await nextMessage(host, message => message.type === 'match_start');
  await nextMessage(guest, message => message.type === 'match_start');
  sendSocket(host, { type: 'leave_lobby' });
  await nextMessage(guest, message => message.type === 'match_end');

  const privateProfile = await createProfile('Private Queue'); const privateHost = await openSocket(privateProfile.token);
  await nextMessage(privateHost, message => message.type === 'hello');
  sendSocket(privateHost, { type: 'queue_join' });
  await nextMessage(privateHost, message => message.type === 'matchmaking' && message.status === 'queued');
  sendSocket(privateHost, { type: 'create_lobby', faction: 'aegis' });
  assert.equal((await nextMessage(privateHost, message => message.type === 'matchmaking' && message.status === 'cancelled')).reason,
    'private_room');
  const privateLobby = await nextMessage(privateHost, message => message.type === 'lobby');
  assert.equal(privateLobby.matchmaking, undefined, 'private room snapshots retain their old shape');
  sendSocket(privateHost, { type: 'queue_join' });
  assert.match((await nextMessage(privateHost, message => message.type === 'error')).error, /current room/);

  const roomOwnerProfile = await createProfile('Join Target'); const roomOwner = await openSocket(roomOwnerProfile.token);
  const queuedJoinProfile = await createProfile('Queued Joiner'); const queuedJoiner = await openSocket(queuedJoinProfile.token);
  await nextMessage(roomOwner, message => message.type === 'hello');
  await nextMessage(queuedJoiner, message => message.type === 'hello');
  sendSocket(roomOwner, { type: 'create_lobby', faction: 'aegis' });
  const target = await nextMessage(roomOwner, message => message.type === 'lobby');
  sendSocket(queuedJoiner, { type: 'queue_join' });
  await nextMessage(queuedJoiner, message => message.type === 'matchmaking' && message.status === 'queued');
  sendSocket(queuedJoiner, { type: 'join_lobby', code: target.code });
  assert.equal((await nextMessage(queuedJoiner,
    message => message.type === 'matchmaking' && message.status === 'cancelled')).reason, 'private_room');
  await nextMessage(roomOwner, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(queuedJoiner, { type: 'leave_lobby' });
});

test('ranked and casual queues stay separate and expose a ranked status flag', async () => {
  const rankedA = await createProfile('Ranked Queue A');
  const casual = await createProfile('Casual Queue');
  const rankedB = await createProfile('Ranked Queue B');
  const casualB = await createProfile('Casual Queue B');
  const [a, c, b, d] = await Promise.all([rankedA, casual, rankedB, casualB].map(item => openSocket(item.token)));
  await Promise.all([a, c, b, d].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(a, { type: 'queue_join', ranked: true });
  const rankedStatus = await nextMessage(a, message => message.status === 'queued');
  assert.equal(rankedStatus.ranked, true);
  assert.equal(rankedStatus.rating, 1200);
  assert.equal(rankedStatus.ratingRange, 100);
  sendSocket(c, { type: 'queue_join' });
  const casualStatus = await nextMessage(c, message => message.status === 'queued');
  assert.equal(casualStatus.ranked, false);
  assert.equal('ratingRange' in casualStatus, false, 'casual FIFO has no rating search band');
  sendSocket(b, { type: 'queue_join', ranked: true });
  const [aFound, bFound] = await Promise.all([
    nextMessage(a, message => message.status === 'match_found'),
    nextMessage(b, message => message.status === 'match_found'),
  ]);
  assert.equal(aFound.ranked, true); assert.equal(bFound.ranked, true);
  const [rankedLobbyA, rankedLobbyB] = await Promise.all([
    nextMessage(a, message => message.type === 'lobby' && message.matchmaking),
    nextMessage(b, message => message.type === 'lobby' && message.matchmaking),
  ]);
  assert.equal(rankedLobbyA.ranked, true); assert.equal(rankedLobbyB.ranked, true);
  assert.equal(rankedLobbyA.code, rankedLobbyB.code);
  sendSocket(a, { type: 'set_ready', ready: true }); sendSocket(b, { type: 'set_ready', ready: true });
  await nextMessage(a, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(a, { type: 'start_match' });
  await Promise.all([nextMessage(a, message => message.type === 'match_start'),
    nextMessage(b, message => message.type === 'match_start')]);
  const rankedEnded = Promise.all([nextMessage(a, message => message.type === 'match_end'),
    nextMessage(b, message => message.type === 'match_end')]);
  sendSocket(a, { type: 'leave_lobby' });
  await rankedEnded;

  sendSocket(d, { type: 'queue_join' });
  const casualPair = await Promise.all([
    nextMessage(c, message => message.status === 'match_found'),
    nextMessage(d, message => message.status === 'match_found'),
  ]);
  assert.ok(casualPair.every(message => message.ranked === false));
  const [casualLobbyA, casualLobbyB] = await Promise.all([
    nextMessage(c, message => message.type === 'lobby' && message.matchmaking),
    nextMessage(d, message => message.type === 'lobby' && message.matchmaking),
  ]);
  assert.equal(casualLobbyA.ranked, false); assert.equal(casualLobbyB.ranked, false);
  sendSocket(c, { type: 'set_ready', ready: true }); sendSocket(d, { type: 'set_ready', ready: true });
  await nextMessage(c, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(c, { type: 'start_match' });
  await Promise.all([nextMessage(c, message => message.type === 'match_start'),
    nextMessage(d, message => message.type === 'match_start')]);
  const casualEnded = Promise.all([nextMessage(c, message => message.type === 'match_end'),
    nextMessage(d, message => message.type === 'match_end')]);
  sendSocket(c, { type: 'leave_lobby' });
  await casualEnded;
});

test('ranked matchmaking prefers the closest eligible rating over an older wide match', async () => {
  const older = await createProfile('Ranked Close Older');
  const wide = await createProfile('Ranked Close Wide');
  const close = await createProfile('Ranked Close Candidate');
  await Promise.all([[older, 1200], [wide, 2000], [close, 1240]].map(([profile, rating]) =>
    setProfileRating(profile, rating)));
  const [a, b, c] = await Promise.all([older, wide, close].map(profile => openSocket(profile.token)));
  await Promise.all([a, b, c].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(a, { type: 'queue_join', ranked: true });
  sendSocket(b, { type: 'queue_join', ranked: true });
  await Promise.all([a, b].map(ws => nextMessage(ws, message => message.status === 'queued')));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(a.messages.some(message => message.status === 'match_found'), false,
    'the 800-point mismatch is outside both initial search ranges');
  sendSocket(c, { type: 'queue_join', ranked: true });
  const [aFound, cFound] = await Promise.all([a, c].map(ws =>
    nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'match_found')));
  assert.equal(aFound.ranked, true);
  assert.equal(cFound.ranked, true);
  await nextMessage(b, message => message.type === 'matchmaking' && message.status === 'queued');
  assert.equal(b.messages.some(message => message.type === 'matchmaking' && message.status === 'match_found'), false,
    'the lower-gap pair takes precedence over the older but much wider mismatch');
  sendSocket(a, { type: 'leave_lobby' });
  await Promise.all([a, c].map(ws => nextMessage(ws,
    message => message.type === 'matchmaking' && message.status === 'match_cancelled')));
  sendSocket(b, { type: 'queue_leave' });
  assert.equal((await nextMessage(b, message => message.status === 'cancelled')).reason, 'commander_cancelled');
});

test('ranked matchmaking widens by elapsed wait and reports the current band', async () => {
  const lower = await createProfile('Ranked Widen Lower');
  const higher = await createProfile('Ranked Widen Higher');
  await Promise.all([setProfileRating(lower, 1200), setProfileRating(higher, 1550)]);
  const [a, b] = await Promise.all([lower, higher].map(profile => openSocket(profile.token)));
  await Promise.all([a, b].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(a, { type: 'queue_join', ranked: true });
  sendSocket(b, { type: 'queue_join', ranked: true });
  const [statusA, statusB] = await Promise.all([a, b].map(ws =>
    nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'queued')));
  assert.equal(statusA.rating, 1200);
  assert.equal(statusA.ratingRange, 100);
  assert.equal(statusB.rating, 1550);
  assert.equal(statusB.ratingRange, 100);
  const [foundA, foundB] = await Promise.all([a, b].map(ws =>
    nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'match_found', 1500)));
  assert.equal(foundA.ranked, true);
  assert.equal(foundB.ranked, true);
  assert.ok(a.messages.some(message => message.type === 'matchmaking' && message.status === 'queued' &&
    message.ratingRange >= 350), 'queued updates expose the widened band before pairing');
  sendSocket(a, { type: 'leave_lobby' });
  await Promise.all([a, b].map(ws => nextMessage(ws,
    message => message.type === 'matchmaking' && message.status === 'match_cancelled')));
});

test('ranked matchmaking resets stale-season ratings before matching and cancellation removes eligibility', async () => {
  const stale = await createProfile('Ranked Stale Season');
  const current = await createProfile('Ranked Current Season');
  await setProfileRating(stale, 2600, -1);
  await setProfileRating(current, 1200);
  const [a, b] = await Promise.all([stale, current].map(profile => openSocket(profile.token)));
  await Promise.all([a, b].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(a, { type: 'queue_join', ranked: true });
  const staleStatus = await nextMessage(a, message => message.type === 'matchmaking' && message.status === 'queued');
  assert.equal(staleStatus.rating, 1200, 'a prior-season rating uses the new-season baseline');
  const storedStale = store.profiles.find(item => item.id === stale.profile.id);
  assert.equal(storedStale.rating, 1200);
  assert.equal(storedStale.ratingSeason, (await api('/api/multiplayer/rating', stale.token).then(r => r.json())).season);
  sendSocket(a, { type: 'queue_leave' });
  assert.equal((await nextMessage(a, message => message.type === 'matchmaking' && message.status === 'cancelled')).reason,
    'commander_cancelled');
  sendSocket(b, { type: 'queue_join', ranked: true });
  await nextMessage(b, message => message.type === 'matchmaking' && message.status === 'queued');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(b.messages.some(message => message.type === 'matchmaking' && message.status === 'match_found'), false,
    'cancelled queue entries cannot be paired by a later widening cycle');
  sendSocket(b, { type: 'queue_leave' });
  await nextMessage(b, message => message.type === 'matchmaking' && message.status === 'cancelled');
  sendSocket(a, { type: 'queue_join', ranked: true });
  sendSocket(b, { type: 'queue_join', ranked: true });
  const [foundA, foundB] = await Promise.all([a, b].map(ws =>
    nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'match_found')));
  assert.equal(foundA.ranked, true);
  assert.equal(foundB.ranked, true);
  sendSocket(a, { type: 'leave_lobby' });
  await Promise.all([a, b].map(ws => nextMessage(ws,
    message => message.type === 'matchmaking' && message.status === 'match_cancelled')));
});

test('ranked match terminal results update both ratings once; casual and private results do not', async () => {
  const a = await createProfile('Rating A'); const b = await createProfile('Rating B');
  const [host, guest] = await Promise.all([openSocket(a.token), openSocket(b.token)]);
  await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(host, { type: 'queue_join', ranked: true });
  await nextMessage(host, message => message.status === 'queued');
  sendSocket(guest, { type: 'queue_join', ranked: true });
  const rankedLobby = await nextMessage(host, message => message.type === 'lobby' && message.matchmaking);
  await nextMessage(guest, message => message.type === 'lobby' && message.matchmaking);
  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  await Promise.all([nextMessage(host, message => message.type === 'match_start'),
    nextMessage(guest, message => message.type === 'match_start')]);
  const hostEnd = nextMessage(host, message => message.type === 'match_end');
  const guestEnd = nextMessage(guest, message => message.type === 'match_end');
  const activeRankedLobby = lobbies.get(rankedLobby.code);
  store.multiplayerHistory.push({ id: `${activeRankedLobby.matchId}:${a.profile.id}`,
    matchId: activeRankedLobby.matchId, profileId: a.profile.id, result: 'defeat', winnerId: b.profile.id,
    opponent: { id: b.profile.id, name: b.profile.name }, mapId: activeRankedLobby.game.mapId,
    victoryMode: activeRankedLobby.game.victoryMode, durationSeconds: 0, reason: 'forfeit',
    completedAt: Date.now(), ranked: true });
  sendSocket(host, { type: 'leave_lobby' });
  const [hostResult, guestResult] = await Promise.all([hostEnd, guestEnd]);
  assert.equal(hostResult.reason, 'forfeit');
  assert.equal(typeof hostResult.ratingDelta, 'number');
  assert.equal(typeof guestResult.ratingDelta, 'number');
  assert.equal(hostResult.ratingDelta + guestResult.ratingDelta, 0);
  assert.equal(hostResult.ratingBefore, 1200);
  assert.equal(guestResult.ratingBefore, 1200);
  assert.equal(hostResult.ratingAfter + guestResult.ratingAfter, 2400);
  assert.equal(hostResult.ranked, true);

  const ratingAResponse = await api('/api/multiplayer/rating', a.token);
  const ratingBResponse = await api('/api/multiplayer/rating', b.token);
  const ratingA = await ratingAResponse.json(); const ratingB = await ratingBResponse.json();
  assert.equal(ratingA.season, 52, 'the ranked rating reset follows combat pursuit and map balance changes');
  assert.equal(ratingA.games, 1); assert.equal(ratingB.games, 1);
  assert.equal(ratingA.rating + ratingB.rating, 2400);
  assert.equal(ratingA.wins + ratingB.wins, 1);
  assert.equal(ratingA.losses + ratingB.losses, 1);
  assert.equal((await api('/api/multiplayer/rating')).status, 401);
  const leaderboardResponse = await api('/api/multiplayer/leaderboard', a.token);
  const leaderboard = await leaderboardResponse.json();
  assert.ok(leaderboard.entries.some(entry => entry.id === a.profile.id));
  assert.equal('token' in leaderboard.entries[0], false);

  const casualA = await createProfile('Unrated Casual A'); const casualB = await createProfile('Unrated Casual B');
  const [casualHost, casualGuest] = await Promise.all([openSocket(casualA.token), openSocket(casualB.token)]);
  await Promise.all([casualHost, casualGuest].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(casualHost, { type: 'queue_join' }); await nextMessage(casualHost, message => message.status === 'queued');
  sendSocket(casualGuest, { type: 'queue_join' });
  await nextMessage(casualHost, message => message.type === 'lobby' && message.matchmaking);
  await nextMessage(casualGuest, message => message.type === 'lobby' && message.matchmaking);
  sendSocket(casualHost, { type: 'set_ready', ready: true }); sendSocket(casualGuest, { type: 'set_ready', ready: true });
  await nextMessage(casualHost, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(casualHost, { type: 'start_match' });
  await Promise.all([nextMessage(casualHost, message => message.type === 'match_start'),
    nextMessage(casualGuest, message => message.type === 'match_start')]);
  const casualEnded = Promise.all([nextMessage(casualHost, message => message.type === 'match_end'),
    nextMessage(casualGuest, message => message.type === 'match_end')]);
  sendSocket(casualHost, { type: 'leave_lobby' });
  const casualResults = await casualEnded;
  assert.ok(casualResults.every(message => message.ratingDelta === undefined));
  assert.equal((await (await api('/api/multiplayer/rating', casualA.token)).json()).games, 0);
  const history = await (await api('/api/multiplayer/history', casualA.token)).json();
  assert.equal(history.entries[0].ranked, false);

  const privateA = await createProfile('Private Unrated A'); const privateB = await createProfile('Private Unrated B');
  const [privateHost, privateGuest] = await Promise.all([openSocket(privateA.token), openSocket(privateB.token)]);
  await Promise.all([privateHost, privateGuest].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(privateHost, { type: 'create_lobby' });
  const room = await nextMessage(privateHost, message => message.type === 'lobby');
  assert.equal(room.ranked, false);
  sendSocket(privateGuest, { type: 'join_lobby', code: room.code });
  await nextMessage(privateHost, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(privateGuest, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(privateHost, { type: 'set_ready', ready: true }); sendSocket(privateGuest, { type: 'set_ready', ready: true });
  await nextMessage(privateHost, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(privateHost, { type: 'start_match' });
  await Promise.all([nextMessage(privateHost, message => message.type === 'match_start'),
    nextMessage(privateGuest, message => message.type === 'match_start')]);
  const privateEnded = Promise.all([nextMessage(privateHost, message => message.type === 'match_end'),
    nextMessage(privateGuest, message => message.type === 'match_end')]);
  sendSocket(privateHost, { type: 'leave_lobby' });
  await privateEnded;
  assert.equal((await (await api('/api/multiplayer/rating', privateA.token)).json()).games, 0);
});

test('ranked checkpoint restoration and terminal persistence retain one season result per seat', async () => {
  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-ranked-restart-'));
  const dataPath = path.join(restartDir, 'data.json');
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const available = probe.address().port; probe.close(error => error ? reject(error) : resolve(available));
    });
  });
  const startChild = () => spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      FRONTIER_DATA_FILE: dataPath }, stdio: 'ignore' });
  const stopChild = child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve); child.kill('SIGTERM');
  });
  const waitReady = async child => {
    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${url}/api/health`)).ok) return url; } catch {}
      if (child.exitCode !== null) throw new Error(`Ranked restart server exited with ${child.exitCode}.`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Ranked restart server did not become ready.');
  };
  const openChildSocket = token => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`); clients.add(ws); ws.messages = [];
    ws.on('message', raw => ws.messages.push(JSON.parse(raw.toString())));
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
  let child = startChild(); let a; let b; let host; let guest;
  try {
    let url = await waitReady(child);
    const makeProfile = async name => {
      const response = await fetch(`${url}/api/profile`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: json({ name }) });
      assert.equal(response.status, 201); return response.json();
    };
    a = await makeProfile('Ranked Restart A'); b = await makeProfile('Ranked Restart B');
    host = await openChildSocket(a.token); guest = await openChildSocket(b.token);
    await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'hello')));
    sendSocket(host, { type: 'queue_join', ranked: true }); await nextMessage(host, message => message.status === 'queued');
    sendSocket(guest, { type: 'queue_join', ranked: true });
    const room = await nextMessage(host, message => message.type === 'lobby' && message.matchmaking);
    await nextMessage(guest, message => message.type === 'lobby' && message.matchmaking);
    sendSocket(host, { type: 'set_ready', ready: true }); sendSocket(guest, { type: 'set_ready', ready: true });
    await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
    sendSocket(host, { type: 'start_match' });
    await Promise.all([nextMessage(host, message => message.type === 'match_start'),
      nextMessage(guest, message => message.type === 'match_start')]);
    let savedLive;
    for (let attempt = 0; attempt < 80; attempt++) {
      savedLive = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (savedLive.activeMatches?.some(match => match.ranked === true)) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(savedLive.activeMatches[0]?.ranked, true, JSON.stringify(savedLive.activeMatches));
    assert.equal(savedLive.activeMatches[0].matchmaking, true);
    host.terminate(); guest.terminate(); host = guest = null;
    await stopChild(child); child = startChild(); url = await waitReady(child);

    host = await openChildSocket(a.token); guest = await openChildSocket(b.token);
    await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'hello')));
    const [restoredHost, restoredGuest] = await Promise.all([
      nextMessage(host, message => message.type === 'lobby' && message.status === 'playing'),
      nextMessage(guest, message => message.type === 'lobby' && message.status === 'playing'),
    ]);
    assert.equal(restoredHost.ranked, true); assert.equal(restoredGuest.ranked, true);
    assert.equal(restoredHost.code, room.code); assert.equal(restoredGuest.code, room.code);
    const hostEnd = nextMessage(host, message => message.type === 'match_end');
    const guestEnd = nextMessage(guest, message => message.type === 'match_end');
    sendSocket(host, { type: 'leave_lobby' });
    const [hostResult, guestResult] = await Promise.all([hostEnd, guestEnd]);
    assert.equal(hostResult.reason, 'forfeit');
    assert.equal(hostResult.rating + guestResult.rating, 2400);
    assert.equal(hostResult.ratingDelta + guestResult.ratingDelta, 0);
    const terminal = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(terminal.activeMatches.length, 0);
    assert.equal(terminal.multiplayerHistory.filter(record => record.ranked).length, 2);
    assert.equal(terminal.profiles.find(profile => profile.id === a.profile.id).wins +
      terminal.profiles.find(profile => profile.id === a.profile.id).losses, 1);
    host.terminate(); guest.terminate(); host = guest = null;
    await stopChild(child); child = startChild(); url = await waitReady(child);
    const ratingResponse = await fetch(`${url}/api/multiplayer/rating`, { headers: auth(a.token) });
    assert.equal(ratingResponse.status, 200);
    assert.equal((await ratingResponse.json()).games, 1);
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).multiplayerHistory.length, 2,
      'restart must not create duplicate terminal seat records');
    const recovered = await openChildSocket(b.token);
    await nextMessage(recovered, message => message.type === 'hello');
    sendSocket(recovered, { type: 'resume_match', code: room.code });
    const recoveredEnd = await nextMessage(recovered, message => message.type === 'match_end');
    assert.equal(typeof recoveredEnd.ratingDelta, 'number');
    assert.equal(typeof recoveredEnd.ratingAfter, 'number');
    recovered.close();
  } finally {
    host?.terminate(); guest?.terminate(); if (child) await stopChild(child);
    fs.rmSync(restartDir, { recursive: true, force: true });
  }
});

test('ranked relay dominion victory persists both ratings and histories across restart', async () => {
  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-ranked-dominion-'));
  const dataPath = path.join(restartDir, 'data.json');
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const available = probe.address().port; probe.close(error => error ? reject(error) : resolve(available));
    });
  });
  const startChild = () => spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      FRONTIER_DATA_FILE: dataPath }, stdio: 'ignore' });
  const stopChild = child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve); child.kill('SIGTERM');
  });
  const waitReady = async child => {
    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${url}/api/health`)).ok) return url; } catch {}
      if (child.exitCode !== null) throw new Error(`Ranked Dominion server exited with ${child.exitCode}.`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Ranked Dominion server did not become ready.');
  };
  const openChildSocket = profileToken => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${profileToken}`); clients.add(ws); ws.messages = [];
    ws.on('message', raw => ws.messages.push(JSON.parse(raw.toString())));
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
  let child = startChild(); let host; let guest;
  try {
    let url = await waitReady(child);
    const makeProfile = async name => {
      const response = await fetch(`${url}/api/profile`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: json({ name }) });
      assert.equal(response.status, 201); return response.json();
    };
    const a = await makeProfile('Relay Dominion A'); const b = await makeProfile('Relay Dominion B');
    host = await openChildSocket(a.token); guest = await openChildSocket(b.token);
    await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'hello')));
    sendSocket(host, { type: 'queue_join', ranked: true });
    await nextMessage(host, message => message.type === 'matchmaking' && message.status === 'queued');
    sendSocket(guest, { type: 'queue_join', ranked: true });
    const room = await nextMessage(host, message => message.type === 'lobby' && message.matchmaking);
    await nextMessage(guest, message => message.type === 'lobby' && message.matchmaking);
    sendSocket(host, { type: 'set_ready', ready: true }); sendSocket(guest, { type: 'set_ready', ready: true });
    await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
    sendSocket(host, { type: 'start_match' });
    const [hostStart, guestStart] = await Promise.all([
      nextMessage(host, message => message.type === 'match_start'),
      nextMessage(guest, message => message.type === 'match_start'),
    ]);
    assert.equal(hostStart.side, 'player'); assert.equal(guestStart.side, 'enemy');
    assert.equal(hostStart.state.victoryMode, 'dominion');
    const playerTank = hostStart.state.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
    const playerScout = hostStart.state.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
    assert.ok(playerTank && playerScout && hostStart.state.relays?.length === 3);
    const routeProbe = Game.deserialize(hostStart.state);
    // Matchmaking chooses among several maps and mirrored relay layouts. Pick
    // the two reachable public relay sites that minimize travel time for these
    // actual starting units, rather than assuming Shard Valley coordinates.
    const travelOptions = [];
    for (let firstRelay = 0; firstRelay < hostStart.state.relays.length; firstRelay++) {
      for (let secondRelay = firstRelay + 1; secondRelay < hostStart.state.relays.length; secondRelay++) {
        for (const [unitA, relayA, unitB, relayB] of [
          [playerTank, hostStart.state.relays[firstRelay], playerScout, hostStart.state.relays[secondRelay]],
          [playerScout, hostStart.state.relays[firstRelay], playerTank, hostStart.state.relays[secondRelay]],
        ]) {
          const travelSeconds = (unit, relay) => {
            const path = routeProbe._findPath(unit.x, unit.y, relay.x, relay.y);
            if (!path.length) return Infinity;
            let distance = 0, x = unit.x, y = unit.y;
            for (const point of path) {
              distance += Math.hypot(point.x - x, point.y - y);
              x = point.x; y = point.y;
            }
            return distance / ({ lightTank: 1.45, scout: 2.65 }[unit.defId]);
          };
          travelOptions.push({ unitA, relayA, unitB, relayB,
            cost: Math.max(travelSeconds(unitA, relayA), travelSeconds(unitB, relayB)) });
        }
      }
    }
    travelOptions.sort((a, b) => a.cost - b.cost);
    const relayPlan = travelOptions[0];
    for (const [unit, relay] of [[relayPlan.unitA, relayPlan.relayA], [relayPlan.unitB, relayPlan.relayB]]) {
      const { ids, x, y } = { ids: [unit.id], x: relay.x, y: relay.y };
      sendSocket(host, { type: 'command', command: 'issueMove', ids, x, y });
      assert.equal((await nextMessage(host, message => message.type === 'command_result' &&
        message.command === 'issueMove')).ok, true);
    }
    const [hostEnd, guestEnd] = await Promise.all([
      nextMessage(host, message => message.type === 'match_end', 180_000),
      nextMessage(guest, message => message.type === 'match_end', 180_000),
    ]);
    assert.equal(hostEnd.winner, 'player'); assert.equal(guestEnd.winner, 'enemy');
    assert.equal(hostEnd.reason, 'relayDominion'); assert.equal(guestEnd.reason, 'relayDominion');
    assert.equal(hostEnd.ranked, true); assert.equal(guestEnd.ranked, true);
    assert.equal(typeof hostEnd.ratingDelta, 'number');
    assert.equal(hostEnd.ratingDelta + guestEnd.ratingDelta, 0);
    assert.equal(hostEnd.ratingBefore, 1200); assert.equal(guestEnd.ratingBefore, 1200);
    assert.equal(hostEnd.ratingAfter + guestEnd.ratingAfter, 2400);

    const terminal = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(terminal.activeMatches.length, 0);
    assert.equal(terminal.multiplayerHistory.length, 2);
    assert.ok(terminal.multiplayerHistory.every(record => record.ranked && record.reason === 'relayDominion'));
    assert.equal(terminal.multiplayerHistory.filter(record => record.profileId === a.profile.id &&
      record.result === 'victory' && record.ratingDelta > 0).length, 1);
    assert.equal(terminal.multiplayerHistory.filter(record => record.profileId === b.profile.id &&
      record.result === 'defeat' && record.ratingDelta < 0).length, 1);
    host.terminate(); guest.terminate(); host = guest = null;
    await stopChild(child); child = startChild(); url = await waitReady(child);

    const ratingAResponse = await fetch(`${url}/api/multiplayer/rating`, { headers: auth(a.token) });
    const ratingBResponse = await fetch(`${url}/api/multiplayer/rating`, { headers: auth(b.token) });
    assert.equal(ratingAResponse.status, 200); assert.equal(ratingBResponse.status, 200);
    const [ratingA, ratingB] = await Promise.all([ratingAResponse.json(), ratingBResponse.json()]);
    assert.equal(ratingA.games, 1); assert.equal(ratingA.wins, 1); assert.equal(ratingA.losses, 0);
    assert.equal(ratingB.games, 1); assert.equal(ratingB.wins, 0); assert.equal(ratingB.losses, 1);
    assert.equal(ratingA.rating + ratingB.rating, 2400);
    const history = async profileToken => {
      const response = await fetch(`${url}/api/multiplayer/history`, { headers: auth(profileToken) });
      assert.equal(response.status, 200); return response.json();
    };
    const [historyA, historyB] = await Promise.all([history(a.token), history(b.token)]);
    assert.equal(historyA.total, 1); assert.equal(historyB.total, 1);
    assert.equal(historyA.entries[0].result, 'victory'); assert.equal(historyB.entries[0].result, 'defeat');
    assert.equal(historyA.entries[0].reason, 'relayDominion'); assert.equal(historyB.entries[0].reason, 'relayDominion');
    assert.equal(historyA.entries[0].matchId, historyB.entries[0].matchId);
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).multiplayerHistory.length, 2,
      'restart must not duplicate the two terminal seat rows');
  } finally {
    host?.terminate(); guest?.terminate();
    if (child) await stopChild(child);
    fs.rmSync(restartDir, { recursive: true, force: true });
  }
});

test('only the socket that owns a matchmaking queue entry can cancel it', async () => {
  const profile = await createProfile('Queue Owner');
  const owner = await openSocket(profile.token);
  await nextMessage(owner, message => message.type === 'hello');
  sendSocket(owner, { type: 'queue_join' });
  await nextMessage(owner, message => message.type === 'matchmaking' && message.status === 'queued');

  const otherTab = await openSocket(profile.token);
  await nextMessage(otherTab, message => message.type === 'hello');
  sendSocket(otherTab, { type: 'queue_leave' });
  assert.equal((await nextMessage(otherTab, message => message.type === 'matchmaking')).status, 'idle');
  sendSocket(otherTab, { type: 'leave_lobby' });

  const opponent = await createProfile('Queue Opponent');
  const opponentSocket = await openSocket(opponent.token);
  await nextMessage(opponentSocket, message => message.type === 'hello');
  sendSocket(opponentSocket, { type: 'queue_join' });
  const [ownerMatch, opponentMatch] = await Promise.all([
    nextMessage(owner, message => message.type === 'matchmaking' && message.status === 'match_found'),
    nextMessage(opponentSocket, message => message.type === 'matchmaking' && message.status === 'match_found'),
  ]);
  assert.equal(ownerMatch.status, 'match_found');
  assert.equal(opponentMatch.status, 'match_found');
  const code = (await nextMessage(owner, message => message.type === 'lobby' && message.matchmaking)).code;
  assert.equal((await nextMessage(opponentSocket, message => message.type === 'lobby' && message.matchmaking)).code, code);
  await nextMessage(owner, message => message.type === 'matchmaking' && message.status === 'match_cancelled', 1800);
  await nextMessage(opponentSocket, message => message.type === 'matchmaking' && message.status === 'match_cancelled', 1800);
});

test('matchmaking cancellation, disconnect, stale queue timers, queue timeout, and acceptance expiry clean up', async () => {
  const profile = await createProfile('Queue Lifecycle'); const ws = await openSocket(profile.token);
  await nextMessage(ws, message => message.type === 'hello');
  sendSocket(ws, { type: 'queue_join' });
  await nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'queued');
  sendSocket(ws, { type: 'queue_leave' });
  assert.equal((await nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'cancelled')).reason,
    'commander_cancelled');
  sendSocket(ws, { type: 'queue_join' });
  await nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'queued');
  await new Promise(resolve => setTimeout(resolve, 520));
  sendSocket(ws, { type: 'queue_leave' });
  assert.equal((await nextMessage(ws, message => message.type === 'matchmaking' && message.status === 'cancelled')).reason,
    'commander_cancelled', 'the first entry timer must not remove a later entry');

  const disconnected = await createProfile('Queue Disconnect'); const gone = await openSocket(disconnected.token);
  await nextMessage(gone, message => message.type === 'hello');
  sendSocket(gone, { type: 'queue_join' });
  await nextMessage(gone, message => message.type === 'matchmaking' && message.status === 'queued');
  gone.terminate();
  await new Promise(resolve => setTimeout(resolve, 30));
  const survivorProfile = await createProfile('Queue Survivor'); const survivor = await openSocket(survivorProfile.token);
  await nextMessage(survivor, message => message.type === 'hello');
  sendSocket(survivor, { type: 'queue_join' });
  assert.equal((await nextMessage(survivor, message => message.type === 'matchmaking' && message.status === 'queued')).position, 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(survivor.messages.some(message => message.type === 'matchmaking' && message.status === 'match_found'), false);
  sendSocket(survivor, { type: 'queue_leave' });
  await nextMessage(survivor, message => message.type === 'matchmaking' && message.status === 'cancelled');

  const timeoutProfile = await createProfile('Queue Timeout'); const timeoutWs = await openSocket(timeoutProfile.token);
  await nextMessage(timeoutWs, message => message.type === 'hello');
  sendSocket(timeoutWs, { type: 'queue_join' });
  await nextMessage(timeoutWs, message => message.type === 'matchmaking' && message.status === 'queued');
  assert.equal((await nextMessage(timeoutWs, message => message.type === 'matchmaking' && message.status === 'timeout', 1800)).status,
    'timeout');

  const a = await createProfile('Acceptance A'); const b = await createProfile('Acceptance B');
  const acceptA = await openSocket(a.token); const acceptB = await openSocket(b.token);
  await nextMessage(acceptA, message => message.type === 'hello'); await nextMessage(acceptB, message => message.type === 'hello');
  sendSocket(acceptA, { type: 'queue_join' });
  await nextMessage(acceptA, message => message.type === 'matchmaking' && message.status === 'queued');
  sendSocket(acceptB, { type: 'queue_join' });
  const code = (await nextMessage(acceptA, message => message.type === 'lobby' && message.matchmaking === true)).code;
  await nextMessage(acceptB, message => message.type === 'lobby' && message.matchmaking === true);
  assert.ok(lobbies.has(code));
  assert.equal((await nextMessage(acceptA, message => message.type === 'matchmaking' && message.status === 'match_cancelled', 1800)).reason,
    'acceptance_timeout');
  assert.equal((await nextMessage(acceptB, message => message.type === 'matchmaking' && message.status === 'match_cancelled')).reason,
    'acceptance_timeout');
  assert.equal(lobbies.has(code), false);
  sendSocket(acceptA, { type: 'queue_leave' });
  sendSocket(acceptB, { type: 'queue_leave' });
});

test('friend invitations only announce rooms with an available seat', async () => {
  const a = await createProfile('Invite Host');
  const b = await createProfile('Invite Guest');
  const c = await createProfile('Invite Friend');
  const d = await createProfile('Offline Friend');
  store.friendships.push([a.profile.id, c.profile.id]);
  store.friendships.push([a.profile.id, d.profile.id]);
  const host = await openSocket(a.token);
  const guest = await openSocket(b.token);
  const friend = await openSocket(c.token);
  await Promise.all([host, guest, friend].map(ws => nextMessage(ws, message => message.type === 'hello')));

  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const room = await nextMessage(host, message => message.type === 'lobby');
  sendSocket(host, { type: 'invite_friend', friendId: c.profile.id });
  assert.equal((await nextMessage(friend, message => message.type === 'invite')).code, room.code);
  assert.equal((await nextMessage(host, message => message.type === 'invite_sent')).friendId, c.profile.id);
  sendSocket(host, { type: 'invite_friend', friendId: c.profile.id });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /wait before inviting/);
  assert.equal(friend.messages.some(message => message.type === 'invite'), false,
    'repeating the same invite cannot spam the friend');
  sendSocket(host, { type: 'invite_friend', friendId: a.profile.id });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /not your friend/);
  sendSocket(host, { type: 'invite_friend', friendId: d.profile.id });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /offline/);

  sendSocket(guest, { type: 'join_lobby', code: room.code });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(host, { type: 'invite_friend', friendId: c.profile.id });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /full or already playing/);
  assert.equal(friend.messages.some(message => message.type === 'invite'), false);

  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'match_start')));
  sendSocket(host, { type: 'invite_friend', friendId: c.profile.id });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /full or already playing/);
  assert.equal(friend.messages.some(message => message.type === 'invite'), false);

  const ended = nextMessage(guest, message => message.type === 'match_end');
  sendSocket(host, { type: 'leave_lobby' });
  await ended;
  host.close(); guest.close(); friend.close();
});

test('host can configure validated lobby map and victory settings before start', async () => {
  const hostProfile = await createProfile('Settings Host');
  const guestProfile = await createProfile('Settings Guest');
  const host = await openSocket(hostProfile.token);
  const guest = await openSocket(guestProfile.token);
  await nextMessage(host, message => message.type === 'hello');
  await nextMessage(guest, message => message.type === 'hello');
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const created = await nextMessage(host, message => message.type === 'lobby');
  assert.deepEqual(created.settings, { mapId: 'shard-valley', victoryMode: 'dominion' });
  sendSocket(guest, { type: 'join_lobby', code: created.code });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);

  sendSocket(guest, { type: 'set_settings', mapId: SKIRMISH_MAPS[1].id });
  assert.match((await nextMessage(guest, message => message.type === 'error')).error, /Only the host/);
  sendSocket(host, { type: 'set_settings', mapId: 'unknown-map' });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /Invalid multiplayer map/);
  sendSocket(host, { type: 'set_settings', victoryMode: 'unknown-mode' });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /Invalid multiplayer victory mode/);

  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'set_settings', mapId: SKIRMISH_MAPS[1].id, victoryMode: 'elimination' });
  const changed = await nextMessage(host, message => message.type === 'lobby' &&
    message.settings?.mapId === SKIRMISH_MAPS[1].id && message.settings.victoryMode === 'elimination');
  const guestChanged = await nextMessage(guest, message => message.type === 'lobby' &&
    message.settings?.mapId === SKIRMISH_MAPS[1].id && message.settings.victoryMode === 'elimination');
  assert.ok(changed.players.every(player => !player.ready));
  assert.ok(guestChanged.players.every(player => !player.ready));

  sendSocket(host, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.settings?.mapId === SKIRMISH_MAPS[1].id &&
    message.players.some(player => player.id === hostProfile.profile.id && player.ready) &&
    message.players.some(player => player.id === guestProfile.profile.id && !player.ready));
  sendSocket(host, { type: 'set_settings', mapId: SKIRMISH_MAPS[1].id, victoryMode: 'elimination' });
  const unchanged = await nextMessage(host, message => message.type === 'lobby' &&
    message.settings?.mapId === SKIRMISH_MAPS[1].id && message.settings.victoryMode === 'elimination');
  assert.equal(unchanged.players.find(player => player.id === hostProfile.profile.id).ready, true,
    'same settings preserve ready state');
  assert.equal(unchanged.players.find(player => player.id === guestProfile.profile.id).ready, false);

  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));

  sendSocket(host, { type: 'start_match' });
  const [hostStart, guestStart] = await Promise.all([
    nextMessage(host, message => message.type === 'match_start'),
    nextMessage(guest, message => message.type === 'match_start'),
  ]);
  assert.equal(hostStart.state.mapId, SKIRMISH_MAPS[1].id);
  assert.equal(hostStart.state.victoryMode, 'elimination');
  assert.equal(guestStart.state.mapId, SKIRMISH_MAPS[1].id);
  assert.equal(guestStart.state.victoryMode, 'elimination');
  sendSocket(host, { type: 'set_settings', mapId: 'shard-valley' });
  assert.match((await nextMessage(host, message => message.type === 'error')).error, /after the match starts/);

  const ended = nextMessage(guest, message => message.type === 'match_end');
  sendSocket(host, { type: 'leave_lobby' });
  await ended;
  host.close(); guest.close();
});

test('a dropped commander resumes the same live seat and can still command', async () => {
  const a = await createProfile('Reconnect Host');
  const b = await createProfile('Reconnect Guest');
  const host = await openSocket(a.token);
  const guest = await openSocket(b.token);
  await nextMessage(host, message => message.type === 'hello');
  await nextMessage(guest, message => message.type === 'hello');
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const lobby = await nextMessage(host, message => message.type === 'lobby');
  sendSocket(guest, { type: 'join_lobby', code: lobby.code });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  const startA = await nextMessage(host, message => message.type === 'match_start');
  const startB = await nextMessage(guest, message => message.type === 'match_start');
  const guestUnit = startB.state.units.find(unit => unit.owner === 'player' && unit.defId !== 'harvester');
  assert.ok(guestUnit);

  // Exercise the WebSocket allowlist and dispatcher for the newly supported
  // loaded-harvester return command.
  const liveLobby = lobbies.get(lobby.code);
  const loadedHarvester = liveLobby.game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
  assert.ok(loadedHarvester);
  loadedHarvester.cargo = 5;
  sendSocket(guest, { type: 'command', command: 'issueReturnCargo', ids: [loadedHarvester.id] });
  assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
    message.command === 'issueReturnCargo')).ok, true);
  assert.equal(loadedHarvester._harvestPhase, 'return');

  const closed = new Promise(resolve => guest.once('close', resolve));
  guest.terminate();
  await closed;
  const outage = await nextMessage(host, message => message.type === 'lobby' &&
    message.status === 'playing' && message.players.some(player => player.id === b.profile.id && !player.connected));
  assert.equal(outage.code, lobby.code);

  const resumed = await openSocket(b.token);
  await nextMessage(resumed, message => message.type === 'hello');
  const restoredPresence = await nextMessage(host, message => message.type === 'lobby' &&
    message.status === 'playing' && message.players.some(player => player.id === b.profile.id && player.connected));
  assert.equal(restoredPresence.code, lobby.code);
  const snapshot = await nextMessage(resumed, message => message.type === 'match_start');
  assert.equal(snapshot.code, lobby.code);
  assert.equal(snapshot.side, 'enemy');
  assert.equal(snapshot.state.time >= startB.state.time, true);
  assert.equal(snapshot.state.units.some(unit => unit.id === guestUnit.id && unit.owner === 'player'), true);
  assert.equal(host.messages.some(message => message.type === 'match_end'), false);
  assert.equal(resumed.messages.some(message => message.type === 'match_end'), false);

  sendSocket(resumed, { type: 'command', command: 'issueStop', ids: [guestUnit.id] });
  assert.equal((await nextMessage(resumed, message => message.type === 'command_result' &&
    message.command === 'issueStop')).ok, true);
  const live = await nextMessage(resumed, message => message.type === 'state' &&
    message.state.selection.includes(guestUnit.id));
  assert.equal(live.state.units.find(unit => unit.id === guestUnit.id).owner, 'player');
  assert.equal(startA.code, snapshot.code);

  const endedHost = nextMessage(host, message => message.type === 'match_end');
  const endedGuest = nextMessage(resumed, message => message.type === 'match_end');
  sendSocket(host, { type: 'leave_lobby' });
  await Promise.all([endedHost, endedGuest]);
  host.close(); resumed.close();
});

test('resume probes report when a live match room is unavailable', async () => {
  const profile = await createProfile('Lost Match');
  const ws = await openSocket(profile.token);
  await nextMessage(ws, message => message.type === 'hello');
  sendSocket(ws, { type: 'resume_match', code: 'ABCD23' });
  const lost = await nextMessage(ws, message => message.type === 'match_session_lost');
  assert.deepEqual(lost, { type: 'match_session_lost', code: 'ABCD23', reason: 'room_unavailable' });
  ws.close();
});

test('a disconnected commander receives the finished match outcome on resume', async () => {
  const a = await createProfile('Outcome Host');
  const b = await createProfile('Outcome Guest');
  const host = await openSocket(a.token);
  const guest = await openSocket(b.token);
  await nextMessage(host, message => message.type === 'hello');
  await nextMessage(guest, message => message.type === 'hello');
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const room = await nextMessage(host, message => message.type === 'lobby');
  sendSocket(guest, { type: 'join_lobby', code: room.code });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  await nextMessage(host, message => message.type === 'match_start');
  await nextMessage(guest, message => message.type === 'match_start');

  const guestClosed = new Promise(resolve => guest.once('close', resolve));
  guest.terminate();
  await guestClosed;
  await nextMessage(host, message => message.type === 'lobby' &&
    message.players.some(player => player.id === b.profile.id && !player.connected));

  const hostEnd = nextMessage(host, message => message.type === 'match_end');
  sendSocket(host, { type: 'leave_lobby' });
  const hostOutcome = await hostEnd;
  assert.equal(hostOutcome.type, 'match_end');
  assert.equal(hostOutcome.winner, 'enemy');
  assert.equal(hostOutcome.reason, 'forfeit');
  assert.equal(hostOutcome.opponentFriendCode, b.profile.code);
  assert.equal(hostOutcome.opponentName, b.profile.name);
  assert.match(hostOutcome.matchId, /^[a-f0-9]{24}$/);
  assert.equal(hostOutcome.ranked, false);
  assert.equal(hostOutcome.rematchEligible, true);

  const resumedGuest = await openSocket(b.token);
  await nextMessage(resumedGuest, message => message.type === 'hello');
  sendSocket(resumedGuest, { type: 'resume_match', code: room.code });
  const resumedOutcome = await nextMessage(resumedGuest, message => message.type === 'match_end');
  assert.equal(resumedOutcome.type, 'match_end');
  assert.equal(resumedOutcome.winner, 'player');
  assert.equal(resumedOutcome.reason, 'forfeit');
  assert.equal(resumedOutcome.opponentFriendCode, a.profile.code);
  assert.equal(resumedOutcome.opponentName, a.profile.name);
  assert.equal(resumedOutcome.matchId, hostOutcome.matchId);
  assert.equal(resumedOutcome.ranked, false);
  assert.equal(resumedOutcome.rematchEligible, true);
  assert.equal(resumedGuest.messages.some(message => message.type === 'match_session_lost'), false);
  host.close(); resumedGuest.close();
});

test('match-end friend codes are seat-specific, resume-only, and support the existing friend request flow', async () => {
  const a = await createProfile('Social Host');
  const b = await createProfile('Social Guest');
  const outsiderProfile = await createProfile('Social Outsider');
  const [host, guest, outsider] = await Promise.all([a, b, outsiderProfile].map(profile => openSocket(profile.token)));
  await Promise.all([host, guest, outsider].map(ws => nextMessage(ws, message => message.type === 'hello')));
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const room = await nextMessage(host, message => message.type === 'lobby');
  sendSocket(guest, { type: 'join_lobby', code: room.code });
  await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
  await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);
  sendSocket(host, { type: 'set_ready', ready: true });
  sendSocket(guest, { type: 'set_ready', ready: true });
  await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
  sendSocket(host, { type: 'start_match' });
  await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'match_start')));

  const hostEnd = nextMessage(host, message => message.type === 'match_end');
  const guestEnd = nextMessage(guest, message => message.type === 'match_end');
  sendSocket(host, { type: 'leave_lobby' });
  const [hostOutcome, guestOutcome] = await Promise.all([hostEnd, guestEnd]);
  assert.equal(hostOutcome.opponentFriendCode, b.profile.code);
  assert.equal(hostOutcome.opponentName, b.profile.name);
  assert.equal(guestOutcome.opponentFriendCode, a.profile.code);
  assert.equal(guestOutcome.opponentName, a.profile.name);
  assert.notEqual(hostOutcome.opponentFriendCode, a.profile.code);
  assert.notEqual(guestOutcome.opponentFriendCode, b.profile.code);

  const hostHistory = await (await api('/api/multiplayer/history', a.token)).json();
  const guestHistory = await (await api('/api/multiplayer/history', b.token)).json();
  for (const history of [hostHistory, guestHistory]) {
    const serialized = JSON.stringify(history);
    assert.equal(serialized.includes(a.profile.code), false);
    assert.equal(serialized.includes(b.profile.code), false);
  }

  const request = await api('/api/friends/requests', a.token,
    { method: 'POST', body: json({ code: hostOutcome.opponentFriendCode }) });
  assert.equal(request.status, 201, 'the returned opponent code works with the existing friend request endpoint');
  assert.equal((await api('/api/friends/requests', a.token,
    { method: 'POST', body: json({ code: b.profile.code }) })).status, 409,
  'duplicate outgoing requests retain the existing conflict behavior');
  const requestBody = await request.json();
  assert.equal((await api(`/api/friends/requests/${requestBody.request.id}/accept`, b.token,
    { method: 'POST' })).status, 200);
  const alreadyFriends = await api('/api/friends/requests', a.token,
    { method: 'POST', body: json({ code: b.profile.code }) });
  assert.equal(alreadyFriends.status, 409);
  assert.match((await alreadyFriends.json()).error, /Already friends/);
  assert.equal((await api('/api/friends/requests', undefined,
    { method: 'POST', body: json({ code: b.profile.code }) })).status, 401,
  'friend creation remains authenticated');

  sendSocket(outsider, { type: 'resume_match', code: room.code });
  const denied = await nextMessage(outsider, message => message.type === 'match_session_lost');
  assert.equal('opponentFriendCode' in denied, false);
  assert.equal('opponentName' in denied, false);
  host.close(); guest.close(); outsider.close();
});

test('multiplayer history requires authentication and validates pagination', async () => {
  const profile = await createProfile('History validation');
  assert.equal((await api('/api/multiplayer/history')).status, 401);
  assert.equal((await api('/api/multiplayer/history', 'malformed')).status, 401);
  for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?offset=-1', '?offset=abc'])
    assert.equal((await api(`/api/multiplayer/history${query}`, profile.token)).status, 400);
  assert.deepEqual(await (await api('/api/multiplayer/history', profile.token)).json(),
    { entries: [], total: 0 });
});

test('active matches and recent outcomes survive a server restart', async () => {
  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontier-match-restart-'));
  const dataPath = path.join(restartDir, 'data.json');
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port: availablePort } = probe.address();
      probe.close(error => error ? reject(error) : resolve(availablePort));
    });
  });
  const startChild = () => {
    const child = spawn(process.execPath, ['server/index.js'], { cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
        FRONTIER_DATA_FILE: dataPath }, stdio: 'ignore' });
    return child;
  };
  const stopChild = child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve); child.kill('SIGTERM');
  });
  const waitReady = async childProcess => {
    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${url}/api/health`)).ok) return url; } catch {}
      if (childProcess.exitCode !== null) throw new Error(`Restart test server exited with ${childProcess.exitCode}.`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Restart test server did not become ready.');
  };
  const openChildSocket = token => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    clients.add(ws); ws.messages = [];
    ws.on('message', raw => ws.messages.push(JSON.parse(raw.toString())));
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
  let child = startChild();
  let host, guest;
  try {
    let childUrl = await waitReady(child);
    const makeProfile = async name => {
      const response = await fetch(`${childUrl}/api/profile`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: json({ name }) });
      assert.equal(response.status, 201); return response.json();
    };
    const a = await makeProfile('Restart Host'); const b = await makeProfile('Restart Guest');
    const outsider = await makeProfile('History outsider');
    host = await openChildSocket(a.token); guest = await openChildSocket(b.token);
    await nextMessage(host, message => message.type === 'hello');
    await nextMessage(guest, message => message.type === 'hello');
    sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
    const room = await nextMessage(host, message => message.type === 'lobby');
    sendSocket(guest, { type: 'join_lobby', code: room.code });
    await nextMessage(host, message => message.type === 'lobby' && message.players.length === 2);
    await nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2);
    sendSocket(host, { type: 'set_ready', ready: true }); sendSocket(guest, { type: 'set_ready', ready: true });
    await nextMessage(host, message => message.type === 'lobby' && message.players.every(player => player.ready));
    sendSocket(host, { type: 'start_match' });
    const startHost = await nextMessage(host, message => message.type === 'match_start');
    const startGuest = await nextMessage(guest, message => message.type === 'match_start');
    const guestUnit = startGuest.state.units.find(unit => unit.owner === 'player' && unit.defId !== 'harvester');
    assert.ok(guestUnit);
    // Let at least one periodic atomic match snapshot land before terminating
    // the process without a graceful shutdown.
    await new Promise(resolve => setTimeout(resolve, 1200));
    host.terminate(); guest.terminate(); host = guest = null;
    await stopChild(child); child = null;

    child = startChild(); childUrl = await waitReady(child);
    host = await openChildSocket(a.token); guest = await openChildSocket(b.token);
    await nextMessage(host, message => message.type === 'hello');
    await nextMessage(guest, message => message.type === 'hello');
    const restoredHost = await nextMessage(host, message => message.type === 'match_start')
      .catch(error => { throw new Error(`host restoration: ${error.message}`); });
    const restoredGuest = await nextMessage(guest, message => message.type === 'match_start')
      .catch(error => { throw new Error(`guest restoration: ${error.message}`); });
    assert.equal(restoredHost.code, room.code); assert.equal(restoredHost.side, 'player');
    assert.equal(restoredGuest.code, room.code); assert.equal(restoredGuest.side, 'enemy');
    assert.ok(restoredGuest.state.time >= startGuest.state.time);
    assert.ok(restoredGuest.state.units.some(unit => unit.id === guestUnit.id && unit.owner === 'player'));
    sendSocket(guest, { type: 'command', command: 'issueStop', ids: [guestUnit.id] });
    assert.equal((await nextMessage(guest, message => message.type === 'command_result' &&
      message.command === 'issueStop').catch(error => { throw new Error(`restored command: ${error.message}`); })).ok, true);

    const lostGuest = new Promise(resolve => guest.once('close', resolve));
    guest.terminate(); await lostGuest;
    const hostEnd = nextMessage(host, message => message.type === 'match_end');
    sendSocket(host, { type: 'leave_lobby' });
    const hostOutcome = await hostEnd;
    assert.equal(hostOutcome.type, 'match_end');
    assert.equal(hostOutcome.winner, 'enemy');
    assert.equal(hostOutcome.reason, 'forfeit');
    assert.equal(hostOutcome.opponentFriendCode, b.profile.code);
    assert.equal(hostOutcome.opponentName, b.profile.name);
    assert.match(hostOutcome.matchId, /^[a-f0-9]{24}$/);
    assert.equal(hostOutcome.ranked, false);
    assert.equal(hostOutcome.rematchEligible, true);
    const terminalStore = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    assert.equal(terminalStore.activeMatches.length, 0,
      `a terminal room must be removed from durable state (${terminalStore.activeMatches.map(match => match.code)})`);
    assert.equal(terminalStore.matchOutcomes.length, 2, 'both authenticated seats retain their terminal result');
    assert.equal(terminalStore.multiplayerHistory.length, 2);
    const historyFor = async (token, query = '') => {
      const response = await fetch(`${childUrl}/api/multiplayer/history${query}`, { headers: auth(token) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const hostHistory = await historyFor(a.token);
    const guestHistory = await historyFor(b.token);
    assert.deepEqual(await historyFor(outsider.token), { entries: [], total: 0 });
    assert.equal(hostHistory.total, 1);
    assert.equal(guestHistory.total, 1);
    assert.equal(hostHistory.entries[0].result, 'defeat');
    assert.equal(guestHistory.entries[0].result, 'victory');
    assert.equal(hostHistory.entries[0].winnerId, b.profile.id);
    assert.equal(guestHistory.entries[0].winnerId, b.profile.id);
    assert.deepEqual(hostHistory.entries[0].opponent, { id: b.profile.id, name: b.profile.name });
    assert.deepEqual(guestHistory.entries[0].opponent, { id: a.profile.id, name: a.profile.name });
    assert.equal(hostHistory.entries[0].matchId, guestHistory.entries[0].matchId);
    assert.equal(hostHistory.entries[0].mapId, 'shard-valley');
    assert.equal(hostHistory.entries[0].victoryMode, 'dominion');
    assert.equal(hostHistory.entries[0].reason, 'forfeit');
    assert.ok(hostHistory.entries[0].durationSeconds >= 0);
    assert.ok(hostHistory.entries[0].completedAt > 0);
    assert.equal('profileId' in hostHistory.entries[0], false);
    assert.equal((await historyFor(a.token, '?limit=1&offset=1')).entries.length, 0);
    assert.equal(JSON.stringify(hostHistory).includes(a.token), false);
    host.terminate(); host = null; await stopChild(child); child = null;

    child = startChild(); childUrl = await waitReady(child);
    assert.deepEqual(await historyFor(a.token), hostHistory);
    assert.deepEqual(await historyFor(b.token), guestHistory);
    assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).multiplayerHistory.length, 2);
    const resumedGuest = await openChildSocket(b.token);
    await nextMessage(resumedGuest, message => message.type === 'hello');
    sendSocket(resumedGuest, { type: 'resume_match', code: room.code });
    const resumedOutcome = await nextMessage(resumedGuest, message => message.type === 'match_end');
    assert.equal(resumedOutcome.type, 'match_end');
    assert.equal(resumedOutcome.winner, 'player');
    assert.equal(resumedOutcome.reason, 'forfeit');
    assert.equal(resumedOutcome.opponentFriendCode, a.profile.code);
    assert.equal(resumedOutcome.opponentName, a.profile.name);
    assert.equal(resumedOutcome.matchId, hostOutcome.matchId);
    assert.equal(resumedOutcome.ranked, false);
    assert.equal(resumedOutcome.rematchEligible, true);
    assert.deepEqual(await historyFor(a.token), hostHistory);
    assert.deepEqual(await historyFor(b.token), guestHistory);
    resumedGuest.close();
  } finally {
    host?.terminate(); guest?.terminate();
    if (child) await stopChild(child);
    fs.rmSync(restartDir, { recursive: true, force: true });
  }
});

test('multiplayer projection hides unseen enemy Stormcall targets and orients owned lures', () => {
  const game = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 109 });
  const x = game.width - 2, y = game.height - 2;
  game.storm.phase = 'warning';
  game.storm.lure = { owner: 'enemy', x, y, until: game.time + 35 };
  game.effects.push({ id: 'stormcall-preview-pulse', type: 'ion', source: 'stormcall',
    owner: 'enemy', x, y, ttl: 0.6, maxTtl: 0.6 });
  game.fog[y][x] = 0;
  const explored = Array.from({ length: game.height }, () => Array(game.width).fill(0));
  const host = { side: 'player', explored, selection: [] };
  assert.equal(projectedState({ game }, host).storm.lure, null);
  assert.equal(projectedState({ game }, host).effects.some(effect => effect.source === 'stormcall'), false);
  game.fog[y][x] = 2;
  assert.equal(projectedState({ game }, host).storm.lure.owner, 'enemy');
  assert.equal(projectedState({ game }, host).effects.find(effect => effect.source === 'stormcall')?.owner, 'enemy');
  const guest = { side: 'enemy', explored, selection: [] };
  assert.equal(projectedState({ game }, guest).storm.lure.owner, 'player');
});

test('multiplayer projection hides unseen Breach zones and orients visible casts', () => {
  const game = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 110 });
  const x = game.width - 2, y = game.height - 2;
  game.breachZones.push({ owner: 'enemy', x, y, radius: 5, until: game.time + 12 });
  const explored = Array.from({ length: game.height }, () => Array(game.width).fill(0));
  const host = { side: 'player', explored, selection: [] };
  game.fog[y][x] = 0;
  assert.equal(projectedState({ game }, host).breachZones.length, 0);
  game.fog[y][x] = 2;
  assert.equal(projectedState({ game }, host).breachZones[0].owner, 'enemy');
  const guest = { side: 'enemy', explored, selection: [] };
  assert.equal(projectedState({ game }, guest).breachZones[0].owner, 'player');
});

test('multiplayer projection redacts visible hostile unit orders and paths', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  const hostile = game.units.find(unit => unit.owner === 'enemy');
  const hostileBuilding = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'refinery');
  assert.ok(hostile);
  assert.ok(hostileBuilding);
  game.fog[Math.floor(hostile.y)][Math.floor(hostile.x)] = 2;
  game.fog[Math.floor(hostileBuilding.y + hostileBuilding.h / 2)]
    [Math.floor(hostileBuilding.x + hostileBuilding.w / 2)] = 2;
  hostile.order = { type: 'move', x: game.width - 1, y: game.height - 1 };
  hostile.path = [{ x: game.width - 2, y: game.height - 2 }];
  hostile._pathGoal = { x: game.width - 1, y: game.height - 1 };
  hostile._relayAssignment = 'relay-hidden';
  hostile._stanceChase = { targetId: 'u999', x: game.width - 1, y: game.height - 1 };
  hostile._harvestPhase = 'return';
  hostile._unloadRefineryId = hostileBuilding.id;
  hostileBuilding._unloadHarvesterId = hostile.id;
  const member = { side: 'player', selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) };

  const projection = projectedState({ game }, member);
  const projectedHostile = projection.units.find(unit => unit.id === hostile.id);
  const projectedHostileBuilding = projection.buildings.find(building => building.id === hostileBuilding.id);
  assert.ok(projectedHostile, 'visible hostile remains available for tactical display');
  assert.equal('order' in projectedHostile, false);
  assert.deepEqual(projectedHostile.path, []);
  for (const field of ['_pathGoal', '_relayAssignment', '_stanceChase', '_harvestPhase', '_unloadRefineryId'])
    assert.equal(field in projectedHostile, false, `${field} is private opponent state`);
  assert.equal('_unloadHarvesterId' in projectedHostileBuilding, false,
    'hostile buildings do not expose private unload pairing');
  assert.deepEqual(hostile.order, { type: 'move', x: game.width - 1, y: game.height - 1 },
    'projection does not mutate authoritative unit orders');

  const playerUnit = game.units.find(unit => unit.owner === 'player');
  const enemyObserver = game._createUnit('enemy', 'scout', playerUnit.x + 0.2, playerUnit.y + 0.2);
  game._createUnit('enemy', 'scout', hostileBuilding.x + 0.5, hostileBuilding.y + 0.5);
  playerUnit._relayAssignment = 'hidden-player-relay';
  playerUnit._stanceChase = { targetId: enemyObserver.id, x: game.width - 1, y: game.height - 1 };
  const guest = { side: 'enemy', selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) };
  const guestProjection = projectedState({ game }, guest);
  const guestHostile = guestProjection.units.find(unit => unit.id === playerUnit.id);
  assert.ok(guestHostile);
  assert.equal('_relayAssignment' in guestHostile, false, 'redaction applies symmetrically to the guest');
  assert.equal('_stanceChase' in guestHostile, false);
});

test('embarked passengers do not reveal targets or placement tiles for the guest', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  const carrier = game._createUnit('enemy', 'apc', 25.5, 25.5);
  const scout = game._createUnit('enemy', 'scout', 25.5, 25.5);
  const rocket = game._createUnit('enemy', 'rocket', 25.5, 25.5);
  const target = game._createUnit('player', 'rifle', 33.5, 25.5);
  const member = () => ({ side: 'enemy', selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });
  scout.embarkedIn = carrier.id;
  carrier.passengerIds = [scout.id];
  game.commandOwner = 'enemy';
  game.select([rocket.id]);

  assert.equal(game._tileVisibleToOwner('enemy', 33, 25), false);
  assert.equal(game.isVisible(target, 'enemy'), false);
  assert.equal(game.issueAttack(target.id).ok, false);
  const hidden = projectedState({ game }, member());
  assert.equal(hidden.fog[25][33], 0);
  assert.equal(hidden.units.some(unit => unit.id === target.id), false);

  scout.embarkedIn = null;
  carrier.passengerIds = [];
  assert.equal(game._tileVisibleToOwner('enemy', 33, 25), true);
  assert.equal(game.isVisible(target, 'enemy'), true);
  assert.equal(game.issueAttack(target.id).ok, true);
  const revealed = projectedState({ game }, member());
  assert.equal(revealed.fog[25][33], 2);
  assert.equal(revealed.units.some(unit => unit.id === target.id), true);
});

test('multiplayer projection shares public salvage drop and persists its public state without revealing units', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  for (const row of game.fog) row.fill(0);
  const hiddenEnemy = game._createUnit('enemy', 'scout', 30.5, 24.5);
  const hiddenPlayer = game._createUnit('player', 'scout', 1.5, 1.5);
  game.salvageDrop = { phase: 'active', x: 30.5, y: 24.5, warningAt: 10, landsAt: 12,
    expiresAt: 42, captureOwner: 'player', captureProgress: 3.25, claimedBy: null, contested: true,
    privateTargetId: hiddenEnemy.id };
  const member = side => ({ side, selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });
  const host = projectedState({ game }, member('player'));
  const guest = projectedState({ game }, member('enemy'));
  assert.deepEqual(host.salvageDrop, { phase: 'active', x: 30.5, y: 24.5, warningAt: 10,
    landsAt: 12, expiresAt: 42, captureOwner: 'player', captureProgress: 3.25, claimedBy: null,
    contested: true });
  assert.deepEqual(guest.salvageDrop, { ...host.salvageDrop, captureOwner: 'enemy' },
    'both seats receive the public site and phase, with capture owner oriented locally');
  assert.equal(host.units.some(unit => unit.id === hiddenEnemy.id), false);
  assert.equal(guest.units.some(unit => unit.id === hiddenPlayer.id), false);
  assert.equal('privateTargetId' in host.salvageDrop, false);
  assert.deepEqual(Game.deserialize(host).salvageDrop, host.salvageDrop,
    'projected salvage state remains deserializable for client reconnect');
  const persisted = Game.deserialize(game.serialize());
  assert.deepEqual(persisted.salvageDrop, { phase: 'active', x: 30.5, y: 24.5, warningAt: 10,
    landsAt: 12, expiresAt: 42, captureOwner: 'player', captureProgress: 3.25, claimedBy: null,
    contested: true },
    'serialized match checkpoints retain the active drop across server restart');
});

test('multiplayer projection shares the Bloom beacon but keeps opponent charged cargo private', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  const playerHarvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  assert.ok(playerHarvester);
  const enemyHarvester = game._createUnit('enemy', 'harvester', playerHarvester.x + 0.2,
    playerHarvester.y + 0.2, { type: 'harvest' });
  playerHarvester.cargo = 120; playerHarvester._stormglassCargo = 80;
  enemyHarvester.cargo = 200; enemyHarvester._stormglassCargo = 140;
  game.storm.bloom = { x: 30.5, y: 25.5, radius: 3.5, until: game.time + 90,
    privateTargetId: enemyHarvester.id };
  const member = side => ({ side, selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });
  const host = projectedState({ game }, member('player'));
  const guest = projectedState({ game }, member('enemy'));
  const publicBloom = { x: 30.5, y: 25.5, radius: 3.5, until: 90 };
  assert.deepEqual(host.storm.bloom, publicBloom);
  assert.deepEqual(guest.storm.bloom, publicBloom);
  assert.equal(host.units.find(unit => unit.id === playerHarvester.id)._stormglassCargo, 80);
  assert.equal('_stormglassCargo' in host.units.find(unit => unit.id === enemyHarvester.id), false);
  assert.equal(guest.units.find(unit => unit.id === enemyHarvester.id)._stormglassCargo, 140);
  assert.equal('_stormglassCargo' in guest.units.find(unit => unit.id === playerHarvester.id), false);
  assert.deepEqual(Game.deserialize(host).storm.bloom, publicBloom);
});

test('multiplayer projection shows wrecks only in live sight and keeps them deserializable', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  const playerVisible = { x: 6, y: 6 };
  const enemyVisible = { x: 49, y: 37 };
  const fogged = { x: 32, y: 24 };
  for (const row of game.fog) row.fill(0);
  game.fog[playerVisible.y][playerVisible.x] = 2;
  game._createUnit('enemy', 'scout', enemyVisible.x + 0.5, enemyVisible.y + 0.5);
  game.wrecks = [
    { id: 'wreck-player', ...playerVisible, value: 80, faction: 'aegis', expiresAt: 45 },
    { id: 'wreck-enemy', ...enemyVisible, value: 55, faction: 'vesper', expiresAt: 45 },
    { id: 'wreck-fogged', ...fogged, value: 120, faction: 'aegis', expiresAt: 45 },
  ];
  const member = side => ({ side, selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });

  const host = projectedState({ game }, member('player'));
  assert.deepEqual(host.wrecks.map(wreck => wreck.id), ['wreck-player']);
  assert.deepEqual(Game.deserialize(host).wrecks, host.wrecks);

  const guest = projectedState({ game }, member('enemy'));
  assert.deepEqual(guest.wrecks.map(wreck => wreck.id), ['wreck-enemy']);
  assert.deepEqual(Game.deserialize(guest).wrecks, guest.wrecks);
  assert.deepEqual(game.wrecks.map(wreck => wreck.id), ['wreck-player', 'wreck-enemy', 'wreck-fogged'],
    'projection must not mutate the authoritative wreck list');
});

test('multiplayer building ruins expose only recent losses inside each seat’s live sight', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  game.time = 200;
  const yard = owner => game.buildings.find(building => building.owner === owner && building.defId === 'command');
  const lost = (id, building, time = 195) => ({ type: 'buildingLost', id, time,
    owner: building.owner, defId: building.defId,
    x: building.x + building.w / 2, y: building.y + building.h / 2,
    secretAttackerOrder: 'private' });
  game.events.push(lost('host-yard', yard('player')), lost('guest-yard', yard('enemy')),
    { type: 'buildingLost', id: 'unseen-yard', time: 195, owner: 'enemy', defId: 'command',
      x: 32.5, y: 24.5, secretAttackerOrder: 'private' },
    lost('expired-yard', yard('player'), 40));
  const member = side => ({ side, selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });
  const host = projectedState({ game }, member('player'));
  const guest = projectedState({ game }, member('enemy'));
  assert.deepEqual(host.events.map(event => event.id), ['host-yard']);
  assert.deepEqual(guest.events.map(event => event.id), ['guest-yard']);
  assert.equal(guest.events[0].owner, 'player', 'guest view uses its local owner orientation');
  assert.equal('secretAttackerOrder' in host.events[0], false);
  assert.deepEqual(Game.deserialize(host).events, host.events);
});

test('multiplayer projection hides relay control in fog but keeps own control and public Dominion timer', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  for (const row of game.fog) row.fill(0);
  game.relays = [
    { id: 'own', x: 1.5, y: 1.5, owner: 'player', progress: 0.7, contested: true,
      protocol: 'overdrive', protocolCooldown: 7 },
    { id: 'enemy', x: game.width - 1.5, y: game.height - 1.5, owner: 'enemy', progress: 0.4, contested: true,
      protocol: 'overdrive', protocolCooldown: 5 },
    { id: 'neutral', x: game.width - 1.5, y: 1.5, owner: null, progress: 0.25, contested: true,
      protocol: 'overdrive', protocolCooldown: 2 },
  ];
  game.relayDominion = { owner: 'player', elapsed: 19, required: 45, majority: 2 };
  const member = side => ({ side, selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });

  const host = projectedState({ game }, member('player'));
  assert.deepEqual(host.relays.map(({ owner, progress, contested }) => ({ owner, progress, contested })), [
    { owner: 'player', progress: 0.7, contested: true },
    { owner: null, progress: 0, contested: false },
    { owner: null, progress: 0, contested: false },
  ]);
  assert.deepEqual(host.relays.map(({ protocol, protocolCooldown }) => ({ protocol, protocolCooldown })), [
    { protocol: 'overdrive', protocolCooldown: 7 },
    { protocol: 'shelter', protocolCooldown: 0 },
    { protocol: 'shelter', protocolCooldown: 0 },
  ]);
  assert.deepEqual(host.relayDominion, { owner: 'player', elapsed: 19, required: 45, majority: 2 });
  assert.doesNotThrow(() => Game.deserialize(host));

  const guest = projectedState({ game }, member('enemy'));
  assert.deepEqual(guest.relays.map(({ owner, progress, contested }) => ({ owner, progress, contested })), [
    { owner: null, progress: 0, contested: false },
    { owner: 'player', progress: 0.4, contested: true },
    { owner: null, progress: 0, contested: false },
  ]);
  assert.deepEqual(guest.relays.map(({ protocol, protocolCooldown }) => ({ protocol, protocolCooldown })), [
    { protocol: 'shelter', protocolCooldown: 0 },
    { protocol: 'overdrive', protocolCooldown: 5 },
    { protocol: 'shelter', protocolCooldown: 0 },
  ]);
  assert.deepEqual(guest.relayDominion, { owner: 'enemy', elapsed: 19, required: 45, majority: 2 });
  assert.doesNotThrow(() => Game.deserialize(guest));
});

test('multiplayer terrain projection remembers visible terrain and masks unknown terrain for both seats', () => {
  for (const side of ['player', 'enemy']) {
    const game = new Game({ mode: 'multiplayer', seed: 110, mapId: 'twin-passes' });
    assert.equal(game.mapVariant, 1, 'the authoritative game has a hidden alternate route');
    game.units = [];
    game.buildings = [];
    game.relays = [];
    game.scans = [];
    for (const row of game.fog) row.fill(0);
    const visible = { x: 8, y: 8 };
    const unknown = { x: game.width - 3, y: game.height - 3 };
    game.terrain[visible.y][visible.x] = { type: 'crystal', resource: 417, walkable: true,
      buildable: false, shade: 2, detail: 0.3 };
    game.terrain[unknown.y][unknown.x] = { type: 'rock', resource: 0, walkable: false,
      buildable: false, shade: 1, detail: 0.7 };
    const explored = Array.from({ length: game.height }, () => Array(game.width).fill(0));
    const member = { side, selection: [], explored };
    if (side === 'player') game.fog[visible.y][visible.x] = 2;
    else game._createUnit('enemy', 'scout', visible.x + 0.5, visible.y + 0.5);

    const first = projectedState({ game }, member);
    assert.equal('seed' in first, false, `${side} snapshot omits the map seed`);
    assert.equal('randomState' in first, false, `${side} snapshot omits the PRNG state`);
    assert.equal('mapVariant' in first, false, `${side} snapshot omits unseen route topology`);
    assert.deepEqual(first.terrain[visible.y][visible.x], game.terrain[visible.y][visible.x], `${side} sees current terrain`);
    assert.deepEqual(first.terrain[unknown.y][unknown.x], { type: 'sand', resource: 0,
      walkable: false, buildable: false, shade: 0, detail: 0 }, `${side} cannot inspect unknown terrain`);
    assert.doesNotThrow(() => Game.deserialize(first));

    game.terrain[visible.y][visible.x] = { type: 'sand', resource: 0, walkable: true,
      buildable: true, shade: 0, detail: 0.1 };
    if (side === 'player') game.fog[visible.y][visible.x] = 1;
    else game.units = [];
    const later = projectedState({ game }, member);
    assert.deepEqual(later.terrain[visible.y][visible.x], { type: 'crystal', resource: 417,
      walkable: true, buildable: false, shade: 2, detail: 0.3 }, `${side} retains last seen terrain while fogged`);
    assert.deepEqual(game.terrain[visible.y][visible.x], { type: 'sand', resource: 0,
      walkable: true, buildable: true, shade: 0, detail: 0.1 }, 'projection does not mutate authoritative terrain');
  }
});

test('multiplayer projection keeps each side’s own strategic state and redacts its opponent’s', () => {
  const game = new Game({ mode: 'multiplayer', seed: 109 });
  const playerBarracks = game.buildings.find(b => b.owner === 'player' && b.defId === 'barracks');
  const enemyBarracks = game.buildings.find(b => b.owner === 'enemy' && b.defId === 'barracks');
  for (const [building, defId] of [[playerBarracks, 'rifle'], [enemyBarracks, 'rocket']]) {
    building.queue = [{ defId, progress: 0.45 }];
    building.rally = { x: 30.5, y: 20.5 };
    building.repairing = true;
  }
  game.credits = { player: 1111, enemy: 2222 };
  game.creditCapacity = { player: 6111, enemy: 7222 };
  game.power = { player: { production: 123, consumption: 44, ratio: 1 },
    enemy: { production: 234, consumption: 55, ratio: 0.8 } };
  game.radar = { player: true, enemy: false };
  game.superweapon = { player: 0.13, enemy: 0.87 };
  game.commandEnergy = { player: 29, enemy: 73 };
  game.commandCooldowns.player.stormcall = 17;
  game.commandCooldowns.enemy.stormcall = 71;
  game.research.player.replacementUsed = true;
  game.research.enemy.replacementUsed = true;
  game.salvageEarned = { player: 16, enemy: 92 };
  game.construction = { defId: 'power', progress: 0.25, ready: false };
  game.enemyConstruction = { defId: 'tech', progress: 0.75, ready: false };
  for (const row of game.fog) row.fill(2);
  game._createUnit('enemy', 'scout', playerBarracks.x + 1, playerBarracks.y + 1);
  const member = side => ({ side, selection: [],
    explored: Array.from({ length: game.height }, () => Array(game.width).fill(0)) });
  for (const [side, ownCredits, ownCapacity, ownEnergy, ownConstruction, ownQueue, ownSalvage,
    ownPower, ownRadar, ownSuperweapon, ownStormcallCooldown] of [
    ['player', 1111, 6111, 29, 'power', 'rifle', 16, 123, true, 0.13, 17],
    ['enemy', 2222, 7222, 73, 'tech', 'rocket', 92, 234, false, 0.87, 71],
  ]) {
    const state = projectedState({ game }, member(side));
    assert.equal(state.credits.player, ownCredits);
    assert.equal(state.credits.enemy, 0);
    assert.equal(state.creditCapacity.player, ownCapacity);
    assert.equal(state.creditCapacity.enemy, 0);
    assert.equal(state.commandEnergy.player, ownEnergy);
    assert.equal(state.commandEnergy.enemy, 0);
    assert.equal(state.construction.defId, ownConstruction);
    assert.equal(state.enemyConstruction, null);
    assert.equal(state.salvageEarned.player, ownSalvage);
    assert.equal(state.salvageEarned.enemy, 0);
    assert.equal(state.power.player.production, ownPower);
    assert.deepEqual(state.power.enemy, { production: 0, consumption: 0, ratio: 1 });
    assert.equal(state.radar.player, ownRadar);
    assert.equal(state.radar.enemy, false);
    assert.equal(state.superweapon.player, ownSuperweapon);
    assert.equal(state.superweapon.enemy, 0);
    assert.equal(state.commandCooldowns.player.stormcall, ownStormcallCooldown);
    assert.equal(state.research.player.replacementUsed, true);
    assert.equal(state.research.enemy.replacementUsed, false);
    assert.ok(Object.values(state.commandCooldowns.enemy).every(value => value === 0));
    const ownBuilding = state.buildings.find(b => b.owner === 'player' && b.defId === 'barracks');
    const opponentBuilding = state.buildings.find(b => b.owner === 'enemy' && b.defId === 'barracks');
    assert.equal(ownBuilding.queue[0].defId, ownQueue);
    assert.ok(opponentBuilding, `${side} should see the opposing barracks`);
    assert.deepEqual(opponentBuilding.queue, []);
    assert.equal(opponentBuilding.rally, null);
    assert.equal(opponentBuilding.repairing, false);
    assert.doesNotThrow(() => Game.deserialize(state));
  }
  assert.equal(game.enemyConstruction.defId, 'tech', 'projection must not mutate authoritative state');
  assert.equal(enemyBarracks.queue[0].defId, 'rocket');
});

function seedRematchHistory(matchId, a, b, { ranked = false, completedAt = Date.now(),
  mapId = SKIRMISH_MAPS[1].id, victoryMode = 'elimination' } = {}) {
  store.multiplayerHistory.push(
    { id: `${matchId}:${a.profile.id}`, matchId, profileId: a.profile.id, result: 'victory',
      winnerId: a.profile.id, opponent: { id: b.profile.id, name: b.profile.name }, mapId,
      victoryMode, completedAt, ranked },
    { id: `${matchId}:${b.profile.id}`, matchId, profileId: b.profile.id, result: 'defeat',
      winnerId: a.profile.id, opponent: { id: a.profile.id, name: a.profile.name }, mapId,
      victoryMode, completedAt, ranked });
}

test('casual rematch is authenticated by both completed seats and creates an unready private lobby on consent', async () => {
  const a = await createProfile('Rematch A');
  const b = await createProfile('Rematch B');
  const stranger = await createProfile('Rematch Stranger');
  const socketsFor = await Promise.all([a, b, stranger].map(profile => openSocket(profile.token)));
  const [host, guest, outsider] = socketsFor;
  await Promise.all(socketsFor.map(ws => nextMessage(ws, message => message.type === 'hello')));
  const matchId = 'a'.repeat(24);
  seedRematchHistory(matchId, a, b);

  sendSocket(outsider, { type: 'rematch_request', matchId });
  assert.match((await nextMessage(outsider, message => message.type === 'rematch_error')).message,
    /no longer eligible/);
  sendSocket(host, { type: 'rematch_request', matchId: 'b'.repeat(24) });
  assert.match((await nextMessage(host, message => message.type === 'rematch_error')).message,
    /no longer eligible/);

  sendSocket(host, { type: 'rematch_request', matchId });
  const [pending, offer] = await Promise.all([
    nextMessage(host, message => message.type === 'rematch_pending'),
    nextMessage(guest, message => message.type === 'rematch_offer'),
  ]);
  assert.equal(pending.requestId, offer.requestId);
  assert.equal(pending.matchId, matchId);
  assert.equal(offer.matchId, matchId);
  assert.equal(offer.from.id, a.profile.id);
  assert.equal(offer.mapId, SKIRMISH_MAPS[1].id);
  assert.equal(offer.victoryMode, 'elimination');
  sendSocket(host, { type: 'rematch_request', matchId });
  assert.match((await nextMessage(host, message => message.type === 'rematch_error')).message,
    /already pending/);

  sendSocket(guest, { type: 'rematch_accept', requestId: offer.requestId });
  const [startedHost, startedGuest, lobbyHost, lobbyGuest] = await Promise.all([
    nextMessage(host, message => message.type === 'rematch_accepted'),
    nextMessage(guest, message => message.type === 'rematch_accepted'),
    nextMessage(host, message => message.type === 'lobby' && message.players.length === 2),
    nextMessage(guest, message => message.type === 'lobby' && message.players.length === 2),
  ]);
  assert.equal(startedHost.requestId, offer.requestId);
  assert.equal(startedGuest.requestId, offer.requestId);
  assert.equal(lobbyHost.code, lobbyGuest.code);
  assert.equal(lobbyHost.ranked, false);
  assert.deepEqual(lobbyHost.settings, { mapId: SKIRMISH_MAPS[1].id, victoryMode: 'elimination' });
  assert.ok(lobbyHost.players.every(player => !player.ready));
  assert.equal(lobbies.get(lobbyHost.code).game, null, 'consent creates a room but does not auto-start');
  host.close(); guest.close(); outsider.close();
});

test('rematch acceptance binds the new seat to the exact accepting socket', async () => {
  const a = await createProfile('Rematch Socket A');
  const b = await createProfile('Rematch Socket B');
  const host = await openSocket(a.token);
  const firstTab = await openSocket(b.token);
  const acceptingTab = await openSocket(b.token);
  await Promise.all([host, firstTab, acceptingTab].map(ws => nextMessage(ws, message => message.type === 'hello')));
  const matchId = '2'.repeat(24);
  seedRematchHistory(matchId, a, b);
  sendSocket(host, { type: 'rematch_request', matchId });
  const [firstOffer, secondOffer] = await Promise.all([
    nextMessage(firstTab, message => message.type === 'rematch_offer'),
    nextMessage(acceptingTab, message => message.type === 'rematch_offer'),
  ]);
  assert.equal(firstOffer.requestId, secondOffer.requestId);
  sendSocket(acceptingTab, { type: 'rematch_accept', requestId: secondOffer.requestId });
  const [hostLobby, acceptingLobby] = await Promise.all([
    nextMessage(host, message => message.type === 'lobby' && message.players.length === 2),
    nextMessage(acceptingTab, message => message.type === 'lobby' && message.players.length === 2),
  ]);
  assert.equal(hostLobby.code, acceptingLobby.code);
  assert.equal(firstTab.messages.some(message => message.type === 'lobby'), false,
    'the idle non-accepting tab must not be selected in place of the tab that accepted');
  sendSocket(host, { type: 'leave_lobby' });
  sendSocket(acceptingTab, { type: 'leave_lobby' });
  host.close(); firstTab.close(); acceptingTab.close();
});

test('ranked, stale, declined, expired, duplicate and newly seated rematches are rejected safely', async () => {
  const a = await createProfile('Rematch Edge A');
  const b = await createProfile('Rematch Edge B');
  const host = await openSocket(a.token);
  const guest = await openSocket(b.token);
  await Promise.all([host, guest].map(ws => nextMessage(ws, message => message.type === 'hello')));
  const rankedId = 'c'.repeat(24);
  seedRematchHistory(rankedId, a, b, { ranked: true });
  sendSocket(host, { type: 'rematch_request', matchId: rankedId });
  assert.match((await nextMessage(host, message => message.type === 'rematch_error')).message,
    /no longer eligible/);
  const staleId = 'd'.repeat(24);
  seedRematchHistory(staleId, a, b, { completedAt: Date.now() - 25 * 60 * 60_000 });
  sendSocket(host, { type: 'rematch_request', matchId: staleId });
  assert.match((await nextMessage(host, message => message.type === 'rematch_error')).message,
    /no longer eligible/);

  const declineId = 'e'.repeat(24);
  seedRematchHistory(declineId, a, b);
  sendSocket(host, { type: 'rematch_request', matchId: declineId });
  const declinedOffer = await nextMessage(guest, message => message.type === 'rematch_offer');
  sendSocket(guest, { type: 'rematch_decline', requestId: declinedOffer.requestId });
  assert.equal((await nextMessage(host, message => message.type === 'rematch_declined')).reason, 'declined');
  assert.equal((await nextMessage(guest, message => message.type === 'rematch_declined')).reason, 'declined');

  const expireId = 'f'.repeat(24);
  seedRematchHistory(expireId, a, b);
  sendSocket(host, { type: 'rematch_request', matchId: expireId });
  const expiredOffer = await nextMessage(guest, message => message.type === 'rematch_offer');
  const [expiredHost, expiredGuest] = await Promise.all([
    nextMessage(host, message => message.type === 'rematch_expired'),
    nextMessage(guest, message => message.type === 'rematch_expired'),
  ]);
  assert.equal(expiredHost.requestId, expiredOffer.requestId);
  assert.equal(expiredGuest.reason, 'expired');

  const seatedId = '1'.repeat(24);
  seedRematchHistory(seatedId, a, b);
  sendSocket(host, { type: 'rematch_request', matchId: seatedId });
  const seatedOffer = await nextMessage(guest, message => message.type === 'rematch_offer');
  sendSocket(host, { type: 'create_lobby', faction: 'aegis' });
  const unrelatedLobby = await nextMessage(host, message => message.type === 'lobby');
  sendSocket(guest, { type: 'rematch_accept', requestId: seatedOffer.requestId });
  assert.equal((await nextMessage(host, message => message.type === 'rematch_cancelled')).reason,
    'seat_unavailable');
  assert.equal((await nextMessage(guest, message => message.type === 'rematch_cancelled')).reason,
    'seat_unavailable');
  assert.match((await nextMessage(guest, message => message.type === 'rematch_error')).message,
    /already seated/);
  assert.equal(lobbies.get(unrelatedLobby.code)?.members[0]?.profile.id, a.profile.id,
    'failed rematch leaves the existing room intact');
  sendSocket(host, { type: 'leave_lobby' });
  host.close(); guest.close();
});

test.after(async () => {
  for (const client of clients) client.terminate();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});
