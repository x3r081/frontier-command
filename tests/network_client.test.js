import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkClient } from '../src/network/client.js';

test('a stalled leaderboard ticket stops waiting and reports an unranked local battle', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  let requestAborted = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = (_url, options) => new Promise((_, reject) => {
    assert.equal(options.method, 'POST');
    options.signal.addEventListener('abort', () => {
      requestAborted = true;
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
  try {
    const client = new NetworkClient();
    await assert.rejects(client.startRun({ mode: 'skirmish', scenarioId: 'shard-valley' }, 12),
      /Leaderboard did not answer in time; this battle will be saved locally/);
    assert.equal(requestAborted, true);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    globalThis.fetch = priorFetch;
  }
});

test('leaderboard requests carry the Red Ledger branch route filter', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  globalThis.fetch = async url => {
    assert.match(url, /\/api\/leaderboard\?/);
    const query = new URL(url, 'http://localhost').searchParams;
    assert.equal(query.get('mode'), 'campaign');
    assert.equal(query.get('scenarioId'), 'red-ledger');
    assert.equal(query.get('routePayoffId'), 'ghost-channel');
    return { ok: true, json: async () => ({ entries: [] }) };
  };
  try {
    const client = new NetworkClient();
    await client.leaderboard({ mode: 'campaign', scenarioId: 'red-ledger', routePayoffId: 'ghost-channel' });
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    globalThis.fetch = priorFetch;
  }
});

test('multiplayer command acknowledgments correlate overlapping orders by request ID', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const client = new NetworkClient();
    client.connected = true;
    client.send = (type, payload) => {
      assert.equal(type, 'command');
      client.sentCommands ||= [];
      client.sentCommands.push(payload);
      return true;
    };
    const first = client.command('issueMove', { ids: ['unit-a'], x: 5, y: 6 });
    const second = client.command('issueMove', { ids: ['unit-b'], x: 7, y: 8 });
    assert.match(first.requestId, /^cmd-[a-z0-9]+$/);
    assert.notEqual(first.requestId, second.requestId);
    assert.equal(client.sentCommands[0].requestId, first.requestId);
    assert.equal(client.sentCommands[1].requestId, second.requestId);

    client.settleCommand({ type: 'command_result', requestId: second.requestId, command: 'issueMove', ok: false, reason: 'Invalid target.' });
    client.settleCommand({ type: 'command_result', requestId: first.requestId, command: 'issueMove', ok: true });
    assert.equal((await first.acknowledgement).ok, true);
    assert.equal((await second.acknowledgement).reason, 'Invalid target.');
    assert.equal(client.pendingCommands.size, 0);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
});

test('multiplayer commands resolve pending confirmation as failed on disconnect', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const client = new NetworkClient();
    client.connected = true;
    client.send = () => true;
    const pending = client.command('issueStop', { ids: ['unit-a'] });
    client.failPendingCommands();
    assert.deepEqual(await pending.acknowledgement, {
      ok: false, transportFailure: true, reason: 'Connection lost before the order was confirmed.' });
    assert.equal(client.pendingCommands.size, 0);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
});

test('multiplayer command timeout resolves safely and ignores a late acknowledgment', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const client = new NetworkClient();
    client.connected = true;
    client.send = () => true;
    const pending = client.command('issueMove', { ids: ['unit-a'], x: 2, y: 3 }, 5);
    const timedOut = await pending.acknowledgement;
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.transportFailure, true);
    assert.match(timedOut.reason, /confirmation timed out/);
    client.settleCommand({ type: 'command_result', requestId: pending.requestId, command: 'issueMove', ok: true });
    assert.equal(client.pendingCommands.size, 0);
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
});
