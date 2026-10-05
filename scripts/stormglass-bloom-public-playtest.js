import assert from 'node:assert/strict';
import { Game, UNIT_DEFS } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

// A seeded player-order route, paired with an otherwise untouched opening.
// The engine chooses the Bloom; this script never moves it or grants cargo.
function play(sendExpedition) {
  const game = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis',
    seed: 80217, mapId: 'shard-valley' });
  const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  assert.ok(harvester);
  const deliveries = [];
  let bloom = null;
  let firstChargeAt = null;
  let peakCharged = 0;
  for (let tick = 0; tick < 3900 && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    if (!bloom && game.storm.bloom) {
      bloom = { ...game.storm.bloom, openedAt: game.time };
      if (sendExpedition) {
        game.select([harvester.id]);
        assert.equal(game.issueMove(bloom.x, bloom.y).ok, true);
        const escort = game.units.filter(unit => unit.owner === 'player' &&
          UNIT_DEFS[unit.defId]?.weapon && !UNIT_DEFS[unit.defId]?.flying);
        game.select(escort.map(unit => unit.id));
        assert.equal(game.issueMove(bloom.x, bloom.y, true).ok, true);
      }
    }
    const charged = harvester._stormglassCargo || 0;
    if (charged > 0 && firstChargeAt === null) firstChargeAt = game.time;
    peakCharged = Math.max(peakCharged, charged);
    for (const event of game.events)
      if (event.type === 'credits' && event.owner === 'player')
        deliveries.push({ at: game.time, amount: event.amount });
    game.events.length = 0;
  }
  return { status: game.status, bloom, firstChargeAt, peakCharged,
    harvesterAlive: harvester.hp > 0, deliveries };
}

const ordinary = play(false);
const expedition = play(true);
assert.equal(ordinary.status, 'playing');
assert.equal(expedition.status, 'playing');
assert.deepEqual(expedition.bloom, ordinary.bloom);
assert.deepEqual(ordinary.deliveries.slice(0, 2).map(delivery => delivery.amount), [700, 700]);
assert.ok(expedition.firstChargeAt > expedition.bloom.openedAt);
assert.ok(expedition.firstChargeAt < expedition.bloom.until);
assert.equal(expedition.peakCharged, 700);
assert.equal(expedition.harvesterAlive, true);
assert.equal(expedition.deliveries[1]?.amount, 945,
  'a full charged load pays 700 crystal plus the 35% Bloom premium');
console.log(JSON.stringify({ ordinary, expedition }, null, 2));
