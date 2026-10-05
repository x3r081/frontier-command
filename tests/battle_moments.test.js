import test from 'node:test';
import assert from 'node:assert/strict';
import { battleMomentFromEvent, recordBattleMoment, selectReplayMoments } from '../src/game/battleMoments.js';

test('key moments record only owned or authored information', () => {
  assert.equal(battleMomentFromEvent({ type: 'relayCaptured', owner: 'enemy', time: 25 }), null);
  assert.equal(battleMomentFromEvent({ type: 'buildingLost', owner: 'enemy', defId: 'command', time: 25 }), null);
  assert.equal(battleMomentFromEvent({ type: 'commandAbility', owner: 'enemy', abilityId: 'breach', time: 25 }), null);
  assert.equal(battleMomentFromEvent({ type: 'campaignIntel', time: NaN, message: 'Secret' }), null);
  const captured = battleMomentFromEvent({ type: 'relayCaptured', owner: 'player', time: 25 });
  assert.deepEqual(captured, { tick: 750, title: 'Resonance Relay captured', kind: 'relayCaptured', priority: 3 });
  const warning = battleMomentFromEvent({ type: 'campaignIntel', time: 26, message: 'The signal chief is fleeing.' });
  assert.equal(warning.title, 'The signal chief is fleeing.');
  assert.deepEqual(battleMomentFromEvent({ type: 'salvageDropClaimed', owner: 'player', time: 30 }),
    { tick: 900, title: 'Public salvage secured', kind: 'salvageDropClaimed', priority: 3 });
});

test('replay moments stay bounded, deduplicate bursts, and favor decisive events', () => {
  const moments = [];
  recordBattleMoment(moments, { type: 'relayCaptured', owner: 'player', time: 10 });
  recordBattleMoment(moments, { type: 'relayCaptured', owner: 'player', time: 11 });
  assert.equal(moments.length, 1);
  for (let time = 40; time < 1600; time += 21)
    recordBattleMoment(moments, { type: 'relayCaptured', owner: 'player', time });
  assert.ok(moments.length <= 48);
  recordBattleMoment(moments, { type: 'buildingLost', owner: 'player', defId: 'command', time: 1600 });
  const selected = selectReplayMoments(moments, 1601 * 30);
  assert.ok(selected.length <= 8);
  assert.equal(selected.at(-1).title, 'Command Yard lost');
  assert.ok(selected.every((moment, index) => index === 0 || selected[index - 1].tick <= moment.tick));
});

test('archived moment metadata is validated against the replay duration', () => {
  const selected = selectReplayMoments([
    { tick: 30, title: 'Relay captured', kind: 'relayCaptured', priority: 3 },
    { tick: 400, title: 'Beyond replay', kind: 'relayCaptured', priority: 3 },
    { tick: -1, title: 'Invalid', kind: 'relayCaptured', priority: 3 },
    { tick: 50, title: '<img src=x onerror=alert(1)>', kind: 'campaignIntel', priority: 4 },
  ], 100);
  assert.deepEqual(selected.map(item => item.tick), [30, 50]);
});
