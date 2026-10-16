const selectionKey = ids => [...new Set(ids)].sort().join('|');
const liveFriendly = unit => unit && unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn;
const typeKey = unit => JSON.stringify([unit.defId, unit.faction || '']);

// Transient interface state. Public orders still use the game's ordinary
// selection, so replay and multiplayer commands retain their normal ID context.
export class SelectionRoster {
  constructor() { this.reset(); }

  reset() {
    this.parentIds = [];
    this.previousIds = [];
    this.expectedKey = null;
    this.hadMultipleTypes = false;
    this.view = { visible: false, groups: [], allIds: [], selectedIds: [], isAll: true };
  }

  sync({ selection = [], units = [], buildings = [], unitDefs = {} } = {}) {
    const available = new Map(units.filter(liveFriendly).map(unit => [unit.id, unit]));
    const rawIds = [...new Set(selection)];
    const currentIds = rawIds.filter(id => available.has(id));
    const buildingIds = new Set(buildings.map(building => building.id));
    if (rawIds.some(id => buildingIds.has(id))) {
      this.reset();
      return this.view;
    }

    const currentKey = selectionKey(currentIds);
    const survivingPrevious = this.previousIds.filter(id => available.has(id));
    const ownChoice = this.expectedKey !== null && currentKey === this.expectedKey;
    // Death, boarding, or a network snapshot that prunes unavailable IDs is
    // allowed to shrink a cohort without discarding the rest of its parent.
    const changed = currentKey !== selectionKey(survivingPrevious);
    if (!ownChoice && changed) {
      this.parentIds = [...currentIds];
      this.hadMultipleTypes = false;
    }
    this.expectedKey = null;
    this.previousIds = [...currentIds];
    this.parentIds = this.parentIds.filter(id => available.has(id));

    const selected = new Set(currentIds);
    const groupsByKey = new Map();
    for (const id of this.parentIds) {
      const unit = available.get(id);
      const key = typeKey(unit);
      let group = groupsByKey.get(key);
      if (!group) {
        group = { key, name: unitDefs[unit.defId]?.name || unit.defId, defId: unit.defId,
          faction: unit.faction || '', ids: [], count: 0, selectedCount: 0, hp: 0, maxHp: 0 };
        groupsByKey.set(key, group);
      }
      group.ids.push(id);
      group.count++;
      group.selectedCount += selected.has(id) ? 1 : 0;
      group.hp += Math.max(0, unit.hp);
      group.maxHp += Math.max(1, unit.maxHp || unit.hp);
    }
    const groups = [...groupsByKey.values()].map(group => {
      const sameKind = [...groupsByKey.values()].filter(other => other.defId === group.defId);
      const name = sameKind.length > 1 && group.faction
        ? `${group.name} · ${group.faction.charAt(0).toUpperCase()}${group.faction.slice(1)}` : group.name;
      const { hp, maxHp, ...details } = group;
      return { ...details, name, healthPct: Math.min(100, Math.round(hp / maxHp * 100)) };
    });
    if (groups.length > 1) this.hadMultipleTypes = true;
    const allIds = [...this.parentIds];
    const isAll = selectionKey(allIds) === currentKey;
    this.view = { visible: groups.length > 1 || this.hadMultipleTypes && allIds.length > 0 && !isAll,
      groups, allIds, selectedIds: currentIds, isAll };
    return this.view;
  }

  choose(key) {
    const ids = key === 'all' ? this.view.allIds : this.view.groups.find(group => group.key === key)?.ids;
    if (!ids?.length) return null;
    this.expectedKey = selectionKey(ids);
    return [...ids];
  }
}
