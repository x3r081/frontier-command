import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyFrontForDate, currentDailyFront } from '../src/game/dailyFront.js';
import { SKIRMISH_MAPS, aiCommanderProfileForSeed } from '../src/game/engine.js';

test('a Daily Front has a strict, serializable Normal Dominion setup for its UTC day', () => {
  const front = dailyFrontForDate('2026-10-16', 91);
  assert.deepEqual(Object.keys(front), ['id', 'date', 'title', 'rulesVersion', 'opensAt', 'expiresAt', 'setup']);
  assert.equal(front.id, 'daily-2026-10-16-v91');
  assert.equal(front.opensAt, Date.parse('2026-10-16T00:00:00.000Z'));
  assert.equal(front.expiresAt, Date.parse('2026-10-17T00:00:00.000Z'));
  assert.deepEqual(front.setup, {
    mode: 'skirmish', difficulty: 'normal', faction: front.setup.faction,
    seed: front.setup.seed, scenarioId: front.setup.scenarioId,
    skirmishOpening: 'established', victoryMode: 'dominion',
    aiCommanderProfileId: aiCommanderProfileForSeed(front.setup.seed, 91).id,
  });
  assert.ok(SKIRMISH_MAPS.some(map => map.id === front.setup.scenarioId));
  assert.ok(['aegis', 'vesper'].includes(front.setup.faction));
  assert.doesNotThrow(() => JSON.stringify(front));
});

test('map and faction rotate by UTC date while the seed and commander stay deterministic per version', () => {
  const fronts = Array.from({ length: 10 }, (_, offset) => {
    const date = new Date(Date.parse('2026-10-16T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
    return dailyFrontForDate(date, 91);
  });
  assert.equal(new Set(fronts.slice(0, 5).map(front => front.setup.scenarioId)).size, 5);
  assert.equal(new Set(fronts.slice(0, 2).map(front => front.setup.faction)).size, 2);
  for (let i = 0; i < fronts.length; i++) {
    assert.deepEqual(fronts[i], dailyFrontForDate(fronts[i].date, 91));
    if (i < 5) assert.equal(fronts[i].setup.scenarioId, fronts[i + 5].setup.scenarioId);
    if (i < 8) assert.equal(fronts[i].setup.faction, fronts[i + 2].setup.faction);
  }
  assert.notEqual(fronts[0].setup.seed, dailyFrontForDate(fronts[0].date, 92).setup.seed);
});

test('date and clock inputs reject malformed calendar values; current front uses UTC boundaries', () => {
  for (const invalid of ['2026-2-03', '2026-02-29', 'not-a-date', null]) {
    assert.throws(() => dailyFrontForDate(invalid, 91), TypeError);
  }
  assert.throws(() => dailyFrontForDate('2026-10-16', -1), TypeError);
  assert.throws(() => currentDailyFront(Number.NaN, 91), TypeError);
  assert.deepEqual(currentDailyFront(Date.parse('2026-10-16T23:59:59.999Z'), 91),
    dailyFrontForDate('2026-10-16', 91));
  assert.deepEqual(currentDailyFront(Date.parse('2026-10-17T00:00:00.000Z'), 91),
    dailyFrontForDate('2026-10-17', 91));
});
