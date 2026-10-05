/** Fixed simulation interval for solo play: 30 simulation updates per second. */
export const SOLO_STEP_SECONDS = 1 / 30;

/**
 * Advances solo simulation in fixed steps, independent of render-frame timing.
 * Each call accepts at most MAX_FRAME_SECONDS of wall time and runs at most
 * MAX_CATCH_UP_STEPS updates. Any accumulated backlog remains for later calls,
 * unless callback returns false: that terminal tick is counted and the
 * remainder is cleared so a finished run cannot consume more simulation time.
 * A paused game simply does not call advance, so its simulation tick is stable.
 */
export class SoloClock {
  static STEP_SECONDS = SOLO_STEP_SECONDS;
  static MAX_FRAME_SECONDS = 0.25;
  static MAX_CATCH_UP_STEPS = 8;

  constructor(completedTicks = 0) {
    this.completedTicks = 0;
    this._accumulator = 0;
    this.restore(completedTicks);
  }

  /** Add elapsed frame time and call callback(dt, completedTick) per update. */
  advance(frameSeconds, callback) {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) return 0;

    this._accumulator += Math.min(frameSeconds, SoloClock.MAX_FRAME_SECONDS);
    let steps = 0;
    // Small tolerance prevents equivalent frame partitions from differing due
    // only to binary floating-point rounding at an exact step boundary.
    const epsilon = SOLO_STEP_SECONDS * 1e-10;
    while (steps < SoloClock.MAX_CATCH_UP_STEPS && this._accumulator + epsilon >= SOLO_STEP_SECONDS) {
      this._accumulator -= SOLO_STEP_SECONDS;
      if (this._accumulator < 0 && this._accumulator > -epsilon) this._accumulator = 0;
      this.completedTicks += 1;
      steps += 1;
      if (callback(SOLO_STEP_SECONDS, this.completedTicks) === false) {
        this._accumulator = 0;
        break;
      }
    }
    return steps;
  }

  /** Start a fresh run, optionally at a known completed tick. */
  reset(completedTicks = 0) {
    return this.restore(completedTicks);
  }

  /** Restore saved progress; fractional or negative tick values are rejected. */
  restore(completedTicks) {
    if (!Number.isSafeInteger(completedTicks) || completedTicks < 0) {
      throw new RangeError('completedTicks must be a non-negative safe integer');
    }
    this.completedTicks = completedTicks;
    this._accumulator = 0;
    return this.completedTicks;
  }
}
