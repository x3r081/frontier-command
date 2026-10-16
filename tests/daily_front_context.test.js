import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyFrontForDate } from '../src/game/dailyFront.js';
import { canonicalDailyFront, dailyFrontTicketMatches, dailyFrontFromEnvelope, dailyFrontFromCheckpoint } from '../src/game/dailyFrontContext.js';
import { Game } from '../src/game/engine.js';
import { SOLO_REPLAY_VERSION } from '../src/game/replay.js';

test('Daily Front rejects a changed ticket and retains its original date through replay and recovery', () => {
  const challenge = dailyFrontForDate('2026-10-16', SOLO_REPLAY_VERSION);
  const metadata = { dailyChallengeId: challenge.id, dailyChallengeDate: challenge.date };
  const ticket = { ...challenge.setup, ...metadata, rulesVersion: SOLO_REPLAY_VERSION };
  assert.deepEqual(canonicalDailyFront(challenge, SOLO_REPLAY_VERSION), challenge);
  assert.equal(dailyFrontTicketMatches(challenge, ticket), true);
  assert.equal(dailyFrontTicketMatches(challenge, { ...ticket, seed: ticket.seed + 1 }), false);
  assert.equal(canonicalDailyFront({ ...challenge, setup: { ...challenge.setup, faction: 'invalid' } }, SOLO_REPLAY_VERSION), null);
  assert.deepEqual(dailyFrontFromEnvelope({ ...challenge.setup, ...metadata }, SOLO_REPLAY_VERSION), challenge);
  const game = new Game({ ...challenge.setup, mapId: challenge.setup.scenarioId });
  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(dailyFrontFromCheckpoint({ dailyFront: challenge }, restored, SOLO_REPLAY_VERSION), { challenge, practice: true });
  assert.equal(dailyFrontFromCheckpoint({ dailyFront: challenge }, new Game({ seed: 7 }), SOLO_REPLAY_VERSION), null);
});
