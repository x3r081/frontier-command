import { SKIRMISH_MAPS, aiCommanderProfileForSeed } from './engine.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FACTIONS = Object.freeze(['aegis', 'vesper']);

function utcDayIndex(dateId) {
  if (typeof dateId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
    throw new TypeError('Daily Front date must use YYYY-MM-DD.');
  }
  const opensAt = Date.parse(`${dateId}T00:00:00.000Z`);
  if (!Number.isFinite(opensAt) || new Date(opensAt).toISOString().slice(0, 10) !== dateId) {
    throw new TypeError('Daily Front date must be a valid calendar date.');
  }
  return { opensAt, day: Math.floor(opensAt / DAY_MS) };
}

function checkedRulesVersion(rulesVersion) {
  if (!Number.isSafeInteger(rulesVersion) || rulesVersion < 0) {
    throw new TypeError('Daily Front rulesVersion must be a non-negative safe integer.');
  }
  return rulesVersion;
}

function dailySeed(dateId, rulesVersion) {
  const input = `daily-front:${dateId}:v${rulesVersion}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash || 1;
}

/** Build the immutable challenge setup for one strict UTC calendar date. */
export function dailyFrontForDate(dateId, rulesVersion) {
  const version = checkedRulesVersion(rulesVersion);
  const { opensAt, day } = utcDayIndex(dateId);
  const seed = dailySeed(dateId, version);
  return {
    id: `daily-${dateId}-v${version}`,
    date: dateId,
    title: 'Daily Front',
    rulesVersion: version,
    opensAt,
    expiresAt: opensAt + DAY_MS,
    setup: {
      mode: 'skirmish',
      difficulty: 'normal',
      faction: FACTIONS[((day % FACTIONS.length) + FACTIONS.length) % FACTIONS.length],
      seed,
      scenarioId: SKIRMISH_MAPS[((day % SKIRMISH_MAPS.length) + SKIRMISH_MAPS.length) % SKIRMISH_MAPS.length].id,
      skirmishOpening: 'established',
      victoryMode: 'dominion',
      aiCommanderProfileId: aiCommanderProfileForSeed(seed, version).id,
    },
  };
}

/** Resolve the current challenge from an injected clock value (UTC milliseconds). */
export function currentDailyFront(nowMs, rulesVersion) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError('Daily Front nowMs must be a finite UTC timestamp in milliseconds.');
  }
  const dateId = new Date(nowMs).toISOString().slice(0, 10);
  return dailyFrontForDate(dateId, rulesVersion);
}
