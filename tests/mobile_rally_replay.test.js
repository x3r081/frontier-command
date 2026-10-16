import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILE_RALLY_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';
import { runMobileRallyPublicPlaytest } from '../scripts/mobile-rally-public-playtest.js';

const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };

test('ordinary paid mobile-rally route rendezvouses, follows a moving leader, and releases safely in exact replay', () => {
  const result = runMobileRallyPublicPlaytest();

  assert.equal(result.seconds, 70);
  assert.equal(result.startingCredits - result.creditsAfterPaidQueues, 450 * 2 + 600,
    'the three ordinary production insertions should pay their full normal cost');
  assert.ok(result.finalCredits > result.creditsAfterPaidQueues,
    'the untouched live economy should continue earning credits during the route');
  assert.equal(result.leaderEmbarkedIn, result.apcId,
    'the original Rifle should board the paid APC through a public order');
  assert.equal(result.firstBuggyMetadataCleared, true,
    'the first Buggy should no longer have private rally metadata after its manual move');
  assert.equal(result.secondBuggyMetadataCleared, true,
    'the second Buggy should release its follow marker when the original leader boards');
  assert.equal(result.secondRelease?.targetNoLongerVisible, true,
    'fallback should use the saved normal rally instead of passenger coordinates');
  assert.ok(result.milestones.some(event => event.type === 'leaderMovedWhileFollowed'));
  assert.ok(result.milestones.some(event => event.type === 'leaderMovedAgain'));
  assert.ok(result.milestones.some(event => event.type === 'leaderBoarded'));
  assert.equal(result.replayMatches, true,
    `rules-${MOBILE_RALLY_RULES_VERSION} public command playback must reproduce the paid route exactly`);
});

test('mobile rally replay commands require rules 81 and reject malformed arguments', () => {
  const command = { tick: 0, sequence: 0, method: 'setRallyTarget', args: ['b5', 'u12'], selectedIds: [] };
  assert.throws(() => createSoloPlayback(envelope, [command], 1, MOBILE_RALLY_RULES_VERSION - 1),
    /mobile rally targets require replay version 81/i);

  for (const args of [[], ['b5', false], ['building', 'u12'], ['b5', 'unit'],
    ['b5', 'u12', null], ['b5', null, null]]) {
    assert.throws(() => validateSoloReplay(envelope, [{ ...command, args }], 1, MOBILE_RALLY_RULES_VERSION),
      /invalid solo command/i);
  }
  assert.equal(validateSoloReplay(envelope, [{ ...command, args: ['b5'] }], 1, MOBILE_RALLY_RULES_VERSION), true,
    'one argument clears the mobile rally and remains a valid public command');
  assert.equal(validateSoloReplay(envelope, [{ ...command, args: ['b5', null] }], 1, MOBILE_RALLY_RULES_VERSION), true);
});
