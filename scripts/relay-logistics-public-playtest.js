import assert from 'node:assert/strict';
import { Game, UNIT_DEFS } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

// Paired public-order opener: both games capture the same relay and let their
// ordinary Harvester unload twice. Only the chosen relay protocol differs.
function play(protocol) {
  const game = new Game({ mode: 'skirmish', difficulty: 'easy', faction: 'aegis',
    seed: 80217, mapId: 'shard-valley' });
  const relay = game.relays[0];
  const army = game.units.filter(unit => unit.owner === 'player' &&
    UNIT_DEFS[unit.defId]?.weapon && !UNIT_DEFS[unit.defId]?.flying);
  game.select(army.map(unit => unit.id));
  assert.equal(game.issueMove(relay.x, relay.y, true).ok, true);
  let captureTick = null;
  for (let tick = 0; tick < 3600 && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    if (captureTick === null && relay.owner === 'player') {
      captureTick = tick + 1;
      if (protocol === 'logistics')
        assert.equal(game.setRelayProtocol(relay.id, 'logistics').ok, true);
    }
    const deliveries = game.events.filter(event => event.type === 'credits' && event.owner === 'player');
    if (captureTick !== null && deliveries.length >= 2)
      return { captureTick, deliveryAmounts: deliveries.slice(0, 2).map(event => event.amount),
        credits: game.credits.player, status: game.status, time: game.time };
  }
  throw new Error(`${protocol}: the public-order route did not capture and unload twice.`);
}

const shelter = play('shelter');
const logistics = play('logistics');
assert.equal(shelter.captureTick, logistics.captureTick);
assert.equal(shelter.status, 'playing');
assert.equal(logistics.status, 'playing');
assert.deepEqual(shelter.deliveryAmounts, [700, 700]);
assert.deepEqual(logistics.deliveryAmounts, [770, 770]);
assert.equal(logistics.credits - shelter.credits, 140);
console.log(JSON.stringify({ shelter, logistics, addedCredits: logistics.credits - shelter.credits }, null, 2));
