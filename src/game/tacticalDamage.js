const priorityFor = (object, structure) => {
  if (object.defId === 'command') return 5;
  if (object.defId === 'harvester') return 4;
  if (structure && ['refinery', 'factory', 'power'].includes(object.defId)) return 3;
  return structure ? 2 : 1;
};

// The HUD derives alerts from the player's own health, so it works for both
// local simulation and fog-limited multiplayer snapshots without revealing an
// unseen attacker or changing the deterministic game/replay state.
export function createTacticalDamageMonitor() {
  let previous = new Map();
  let lastAlertById = new Map();
  let lastAlertAt = -Infinity;
  let lastTime = -Infinity;

  return {
    reset() {
      previous.clear();
      lastAlertById.clear();
      lastAlertAt = -Infinity;
      lastTime = -Infinity;
    },
    observe(game) {
      const time = Number(game?.time);
      if (!Number.isFinite(time)) return null;
      if (time < lastTime) this.reset();
      lastTime = time;
      const next = new Map();
      const candidates = [];
      for (const [objects, structure] of [[game.units || [], false], [game.buildings || [], true]]) {
        for (const object of objects) {
          if (object.owner !== 'player' || object.hp <= 0 || object.embarkedIn) continue;
          const current = {
            hp: object.hp, maxHp: object.maxHp || 1, defId: object.defId,
            x: object.x + (object.w || 0) / 2,
            y: object.y + (object.h || 0) / 2,
            priority: priorityFor(object, structure),
          };
          next.set(object.id, current);
          const old = previous.get(object.id);
          if (old && old.hp - current.hp > 0.5 &&
              time - (lastAlertById.get(object.id) ?? -Infinity) >= 9) {
            candidates.push({ id: object.id, ...current, kind: 'damaged',
              damageFraction: (old.hp - current.hp) / current.maxHp });
          }
        }
      }
      // A command yard or Harvester may vanish between network snapshots.
      // These two cannot enter transports, so their disappearance is a useful
      // strategic alert even when no low-health frame reached the client.
      for (const [id, old] of previous) {
        if (next.has(id) || !['command', 'harvester'].includes(old.defId) ||
            time - (lastAlertById.get(id) ?? -Infinity) < 9) continue;
        candidates.push({ id, ...old, kind: 'lost', damageFraction: 1 });
      }
      previous = next;
      if (!candidates.length || time - lastAlertAt < 2.5) return null;
      candidates.sort((a, b) => b.priority - a.priority ||
        b.damageFraction - a.damageFraction || String(a.id).localeCompare(String(b.id)));
      const alert = candidates[0];
      lastAlertAt = time;
      lastAlertById.set(alert.id, time);
      for (const [id, at] of lastAlertById) if (time - at > 20) lastAlertById.delete(id);
      return alert;
    },
  };
}
