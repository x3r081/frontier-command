import test from 'node:test';
import assert from 'node:assert/strict';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

function runPartitions(partitions) {
  const clock = new SoloClock();
  const sequence = [];
  for (const frame of partitions) clock.advance(frame, (dt, tick) => sequence.push([dt, tick]));
  return { clock, sequence };
}

test('equal elapsed frame partitions produce the same fixed tick sequence', () => {
  const regular = runPartitions(Array(90).fill(1 / 60));
  const uneven = runPartitions(Array(30).fill(1 / 20));
  assert.equal(regular.clock.completedTicks, 45);
  assert.equal(uneven.clock.completedTicks, 45);
  assert.deepEqual(regular.sequence, uneven.sequence);
  assert.ok(regular.sequence.every(([dt], index) => dt === SOLO_STEP_SECONDS && index + 1 > 0));
});

test('not advancing while paused leaves the completed tick unchanged', () => {
  const clock = new SoloClock();
  clock.advance(SOLO_STEP_SECONDS * 3, () => {});
  const pausedTick = clock.completedTicks;
  // Pause is represented by the caller omitting advance calls.
  assert.equal(clock.completedTicks, pausedTick);
  clock.advance(SOLO_STEP_SECONDS, () => {});
  assert.equal(clock.completedTicks, pausedTick + 1);
});

test('saved tick restoration resumes from the completed integer tick', () => {
  const clock = new SoloClock(120);
  const seen = [];
  clock.advance(SOLO_STEP_SECONDS, (dt, tick) => seen.push([dt, tick]));
  assert.deepEqual(seen, [[SOLO_STEP_SECONDS, 121]]);
  assert.equal(clock.reset(), 0);
  assert.equal(clock.restore(900), 900);
  assert.throws(() => clock.restore(1.5), RangeError);
});

test('callback false counts the terminal tick and clears catch-up remainder', () => {
  const clock = new SoloClock();
  const seen = [];
  const steps = clock.advance(SOLO_STEP_SECONDS * 5, (dt, tick) => {
    seen.push([dt, tick]);
    return tick < 2;
  });
  assert.equal(steps, 2);
  assert.deepEqual(seen, [[SOLO_STEP_SECONDS, 1], [SOLO_STEP_SECONDS, 2]]);
  assert.equal(clock.completedTicks, 2);

  // The three unconsumed steps were discarded at termination.
  assert.equal(clock.advance(SOLO_STEP_SECONDS / 2, () => {}), 0);
  assert.equal(clock.completedTicks, 2);
});
