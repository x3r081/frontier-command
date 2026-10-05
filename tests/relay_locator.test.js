import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRelayLocator } from '../src/game/relayLocator.js';

const sites = [
  { id: 'relay1', x: 4, y: 2, owner: 'player' },
  { id: 'relay2', x: 8, y: 2, owner: 'enemy' },
  { id: 'relay3', x: 12, y: 2, owner: null },
];
const fog = levels => (x, y) => levels[x] ?? 0;

test('enemy countdown points to a currently visible enemy relay first', () => {
  assert.deepEqual(chooseRelayLocator(sites, fog({ 4: 2, 8: 2, 12: 0 }), true),
    { relay: sites[1], scoutUnknown: false });
  assert.equal(chooseRelayLocator(sites, fog({ 4: 2, 8: 0, 12: 2 }), false)?.relay.id,
    'relay3');
});

test('unseen countdown offers only public coordinates, independent of hidden ownership', () => {
  const sight = fog({ 4: 0, 8: 1, 12: 0 });
  const first = chooseRelayLocator(sites, sight, true, 0);
  const next = chooseRelayLocator(sites, sight, true, 1);
  assert.deepEqual([first.relay.id, next.relay.id], ['relay2', 'relay3']);
  assert.equal(first.scoutUnknown, true);
  const changedHiddenOwners = sites.map(site => ({ ...site,
    owner: site.id === 'relay2' ? null : site.id === 'relay3' ? 'enemy' : site.owner }));
  assert.deepEqual(chooseRelayLocator(changedHiddenOwners, sight, true, 0).relay.id, first.relay.id);
  assert.deepEqual(chooseRelayLocator(changedHiddenOwners, sight, true, 1).relay.id, next.relay.id);
  assert.equal(chooseRelayLocator(sites, sight, false), null);
});
