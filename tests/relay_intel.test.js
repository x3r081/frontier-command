import test from 'node:test';
import assert from 'node:assert/strict';
import { relayIntel } from '../src/game/relayIntel.js';

test('relay intel hides rival control and protocol outside live sight', () => {
  const enemy = { owner: 'enemy', protocol: 'overdrive' };
  assert.deepEqual(relayIntel(enemy, 0), { known: false, owner: null, protocol: null });
  assert.deepEqual(relayIntel(enemy, 1), { known: false, owner: null, protocol: null });
  assert.deepEqual(relayIntel(enemy, 2), { known: true, owner: 'enemy', protocol: 'overdrive' });
});

test('a commander always knows their own relay while neutral control needs sight', () => {
  assert.deepEqual(relayIntel({ owner: 'player', protocol: 'shelter' }, 0),
    { known: true, owner: 'player', protocol: 'shelter' });
  assert.deepEqual(relayIntel({ owner: null, protocol: 'overdrive' }, 1),
    { known: false, owner: null, protocol: null });
  assert.deepEqual(relayIntel({ owner: null }, 2),
    { known: true, owner: null, protocol: 'shelter' });
});
