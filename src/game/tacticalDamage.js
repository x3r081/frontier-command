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
  let lastTime = -Infinity;

  return {
    reset() {
      previous.clear();
      lastAlertById.clear();
      lastTime = -Infinity;
    },
    observe(game) {
      return this.observeAll(game)[0] ?? null;
    },
    observeAll(game) {
      const time = Number(game?.time);
      if (!Number.isFinite(time)) return [];
      if (time < lastTime) this.reset();
      lastTime = time;
      const next = new Map();
      const candidates = [];
      for (const [objects, structure] of [[game.units || [], false], [game.buildings || [], true]]) {
        for (const object of objects) {
          if (object.owner !== 'player' || object.embarkedIn) continue;
          const hp = Number(object.hp);
          const maxHp = Number(object.maxHp) || 1;
          const x = Number(object.x) + (Number(object.w) || 0) / 2;
          const y = Number(object.y) + (Number(object.h) || 0) / 2;
          if (!Number.isFinite(hp) || !Number.isFinite(maxHp) ||
              !Number.isFinite(x) || !Number.isFinite(y)) continue;
          const current = {
            hp, maxHp, defId: object.defId,
            x, y,
            priority: priorityFor(object, structure),
          };
          if (hp <= 0) {
            const old = previous.get(object.id);
            if (old) candidates.push({ id: object.id, ...old, kind: 'lost', damageFraction: 1 });
            continue;
          }
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
        if (next.has(id) || candidates.some((candidate) => candidate.id === id) ||
            !['command', 'harvester'].includes(old.defId)) continue;
        candidates.push({ id, ...old, kind: 'lost', damageFraction: 1 });
      }
      previous = next;
      candidates.sort((a, b) => b.priority - a.priority ||
        b.damageFraction - a.damageFraction || String(a.id).localeCompare(String(b.id)));
      for (const alert of candidates) lastAlertById.set(alert.id, time);
      for (const [id, at] of lastAlertById) if (time - at > 20) lastAlertById.delete(id);
      return candidates;
    },
  };
}
