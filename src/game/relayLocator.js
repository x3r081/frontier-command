import { relayIntel } from './relayIntel.js';

/** Pick a public relay destination without inferring control through fog. */
export function chooseRelayLocator(relays, fogAt, enemyDominion, scoutIndex = 0) {
  const sites = Array.isArray(relays) ? relays : [];
  const visible = sites.filter(relay => fogAt(relay.x, relay.y) === 2);
  const target = enemyDominion
    ? visible.find(relay => relay.owner === 'enemy')
    : visible.find(relay => relay.owner == null);
  if (target) return { relay: target, scoutUnknown: false };
  if (!enemyDominion) return null;
  const unknown = sites.filter(relay => !relayIntel(relay, fogAt(relay.x, relay.y)).known)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!unknown.length) return null;
  const index = Math.abs(Math.trunc(scoutIndex)) % unknown.length;
  return { relay: unknown[index], scoutUnknown: true };
}
