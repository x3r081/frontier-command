import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Game, ION_STORM_PHASE_SECONDS, STORMGLASS_BLOOM_DURATION,
  STORMGLASS_BLOOM_ENRICHMENT, STORMGLASS_BLOOM_PREMIUM_RATE,
} from '../src/game/engine.js';

function triggerBloom(game, time = 12) {
  game.time = time;
  game.storm.phase = 'warning';
  game.storm.phaseTime = ION_STORM_PHASE_SECONDS.warning - 0.05;
  game._updateStorm(0.05);
  return game.storm.bloom;
}

function prepareUnload({ mode = 'multiplayer', replayVersion = null, credits = 1000,
  cargo = 100, charged = 100, logistics = false } = {}) {
  const game = new Game({ seed: 1750, mode });
  game.replayVersion = replayVersion;
  game.credits.player = credits;
  if (logistics) {
    const relay = game.relays[0];
    relay.owner = 'player'; relay.progress = 1; relay.protocol = 'logistics'; relay.contested = false;
  }
  const refinery = game._createBuilding('player', 'refinery', 5, 5, 1);
  const harvester = game._createUnit('player', 'harvester', refinery.x + 1.5, refinery.y + 1,
    { type: 'harvest' });
  harvester.cargo = cargo;
  harvester._stormglassCargo = charged;
  harvester._harvestPhase = 'return';
  return { game, harvester };
}

test('a surge deterministically opens and enriches a public Bloom on a reachable crystal patch', () => {
  const first = new Game({ seed: 80217, mode: 'skirmish' });
  const second = new Game({ seed: 80217, mode: 'skirmish' });
  const priorStock = first.terrain.map(row => row.map(tile => tile.resource));
  const bloom = triggerBloom(first);
  const repeated = triggerBloom(second);

  assert.ok(bloom, 'the generated battlefield has an actionable existing patch near the storm');
  assert.deepEqual(repeated, bloom);
  assert.equal(bloom.until, 12 + STORMGLASS_BLOOM_DURATION);
  assert.equal(bloom.radius, 3.5);
  const event = first.events.find(item => item.type === 'stormglassBloom');
  assert.deepEqual({ x: event.x, y: event.y, radius: event.radius, until: event.until }, bloom);
  assert.match(event.message, /enriched crystal/i);
  assert.equal(event.premiumRate, STORMGLASS_BLOOM_PREMIUM_RATE);

  const cx = Math.floor(bloom.x), cy = Math.floor(bloom.y);
  const enriched = [];
  for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) {
    const before = first.terrain[y][x];
    const after = second.terrain[y][x];
    if (before.type === 'crystal' && Math.hypot(x + 0.5 - bloom.x, y + 0.5 - bloom.y) <= bloom.radius)
      enriched.push({ old: priorStock[y][x], now: before.resource, repeated: after.resource });
  }
  assert.ok(enriched.length > 0, 'Bloom is centered on an existing crystal patch');
  assert.ok(enriched.some(tile => tile.now > tile.old && tile.now === tile.repeated &&
    tile.now <= tile.old + STORMGLASS_BLOOM_ENRICHMENT),
    'Bloom adds a deterministic stock pulse to crystals in its radius');
  assert.equal(first.storm.bloom.x, cx + 0.5);
  assert.equal(first.storm.bloom.y, cy + 0.5);
});

test('charged crystal pays its premium only when accepted cargo unloads', () => {
  const { game, harvester } = prepareUnload();
  game._updateHarvester(harvester, 1);
  assert.equal(game.credits.player, 1135);
  assert.equal(game.events.filter(event => event.type === 'credits').at(-1).amount, 135);
  assert.equal(harvester.cargo, 0);
  assert.equal(harvester._stormglassCargo, 0);

  const stored = prepareUnload();
  stored.harvester.cargo = 0;
  stored.harvester._stormglassCargo = 0;
  stored.game._updateHarvester(stored.harvester, 1);
  assert.equal(stored.game.credits.player, 1000, 'carrying no cargo grants no credits');
});

test('charged premium and Logistics stack while total payout stays within storage', () => {
  const { game, harvester } = prepareUnload({ credits: 5880, logistics: true });
  game._updateHarvester(harvester, 1);
  assert.equal(game.credits.player, 6000);
  assert.equal(game.events.filter(event => event.type === 'credits').at(-1).amount, 120,
    '100 cargo + 10 Logistics + 10 premium fit the remaining 120 credits');
});

test('Bloom and charged cargo survive a current save/load round trip', () => {
  const { game, harvester } = prepareUnload();
  game.storm.bloom = { x: 30.5, y: 24.5, radius: 3.5, until: 88 };
  harvester._stormglassCargo = 73;
  const loaded = Game.deserialize(game.serialize());
  assert.deepEqual(loaded.storm.bloom, game.storm.bloom);
  assert.equal(loaded.units.find(unit => unit.id === harvester.id)._stormglassCargo, 73);
});

test('pre-v50 replay rules suppress both Bloom activation and charged premiums', () => {
  const { game, harvester } = prepareUnload({ replayVersion: 49 });
  assert.equal(triggerBloom(game), null);
  harvester.cargo = 100;
  harvester._stormglassCargo = 100;
  game.credits.player = 1000;
  game._updateHarvester(harvester, 1);
  assert.equal(game.credits.player, 1100);

  const markerless = JSON.parse(new Game({ seed: 22, mode: 'skirmish' }).serialize());
  delete markerless.stormglassBloomRulesVersion;
  const migrated = Game.deserialize(markerless);
  assert.equal(migrated.replayVersion, 49);
  assert.equal(migrated.storm.bloom, null);
});

test('campaign surges do not open Stormglass Blooms', () => {
  const campaign = new Game({ seed: 80217, mode: 'campaign' });
  assert.equal(triggerBloom(campaign), null);
  assert.equal(campaign.events.some(event => event.type === 'stormglassBloom'), false);
});

function prepareExpedition() {
  const game = new Game({ seed: 813, mode: 'skirmish' });
  game.replayVersion = 52;
  game.storm.bloom = { x: 9.5, y: 42.5, radius: 0.75, until: 90 };
  const patch = game._tile(9, 42);
  patch.type = 'crystal'; patch.resource = 900; patch.walkable = true;
  const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  const escort = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  escort.order = { type: 'guard', x: escort.x, y: escort.y };
  return { game, harvester, escort };
}

test('Bloom expedition selects a public viable patch and assigns selected armed ground escort', () => {
  const { game, harvester, escort } = prepareExpedition();
  game.select([harvester.id, escort.id]);
  const result = game.issueBloomExpedition();
  assert.deepEqual(result, { ok: true, harvesterIds: [harvester.id], escortIds: [escort.id],
    tiles: [{ x: 9, y: 42 }] });
  assert.deepEqual(harvester.order, { type: 'harvest', x: 9, y: 42, bloomExpedition: true });
  assert.equal(escort.order.type, 'follow');
  assert.equal(escort.order.targetId, harvester.id);
  assert.equal(escort.order.bloomExpeditionEscort, true);
  game.update(3);
  assert.ok(harvester._stormglassCargo > 0, 'mining inside the public Bloom charges delivered cargo');
});

test('Bloom expedition validation is atomic and rejects a missing escort or old replay version', () => {
  const { game, harvester } = prepareExpedition();
  game.select(harvester.id);
  const originalOrder = { ...harvester.order };
  assert.equal(game.issueBloomExpedition().ok, false);
  assert.deepEqual(harvester.order, originalOrder);
  game.select([harvester.id, game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank').id]);
  game.replayVersion = 51;
  assert.match(game.issueBloomExpedition().reason, /version 52/i);
  assert.deepEqual(harvester.order, originalOrder);
});

test('Bloom expiry sends loaded Harvester home and restores escort order', () => {
  const { game, harvester, escort } = prepareExpedition();
  const priorOrder = { ...escort.order };
  game.select([harvester.id, escort.id]);
  assert.equal(game.issueBloomExpedition().ok, true);
  harvester.cargo = 120;
  harvester._harvestPhase = 'return';
  game.storm.bloom.until = game.time + 0.05;
  game.update(0.1);
  assert.equal(harvester.order.type, 'harvest');
  assert.equal(harvester.order.bloomExpedition, undefined);
  assert.equal(harvester._harvestPhase, 'return');
  assert.deepEqual(escort.order, priorOrder);
});

test('a saved Bloom expedition resumes and releases its escort after the field closes', () => {
  const { game, harvester, escort } = prepareExpedition();
  const priorOrder = { ...escort.order };
  game.select([harvester.id, escort.id]);
  assert.equal(game.issueBloomExpedition().ok, true);
  const loaded = Game.deserialize(game.serialize());
  const loadedHarvester = loaded.getEntity(harvester.id);
  const loadedEscort = loaded.getEntity(escort.id);
  assert.equal(loadedHarvester.order.bloomExpedition, true);
  assert.equal(loadedEscort.order.bloomExpeditionEscort, true);
  loadedHarvester.cargo = 120;
  loaded.storm.bloom.until = loaded.time + 0.05;
  loaded.update(0.1);
  assert.equal(loadedHarvester._harvestPhase, 'return');
  assert.deepEqual(loadedEscort.order, priorOrder);
});

test('an escorted Bloom load completes delivery with the charged premium', () => {
  const { game, harvester, escort } = prepareExpedition();
  const startingCredits = game.credits.player;
  game.select([harvester.id, escort.id]);
  assert.equal(game.issueBloomExpedition().ok, true);
  for (let tick = 0; tick < 500 && game.credits.player === startingCredits; tick++) game.update(0.1);
  const delivery = game.events.find(event => event.type === 'credits' && event.owner === 'player' &&
    event.amount >= 945);
  assert.ok(delivery, '700 charged crystal is accepted for 945 credits');
  assert.equal(harvester.cargo, 0);
  assert.equal(escort.order.type, 'guard', 'the escort resumes its saved order after delivery');
});

test('a manual Harvester move cancels the expedition and releases its escort', () => {
  const { game, harvester, escort } = prepareExpedition();
  const priorOrder = { ...escort.order };
  game.select([harvester.id, escort.id]);
  assert.equal(game.issueBloomExpedition().ok, true);
  game.select(harvester.id);
  assert.equal(game.issueMove(8.5, 43.5).ok, true);
  game.update(0.1);
  assert.equal(harvester.order.type, 'move');
  assert.equal(harvester.order.bloomExpedition, undefined);
  assert.deepEqual(escort.order, priorOrder);
});
