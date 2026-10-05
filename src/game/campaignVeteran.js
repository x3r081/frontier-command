import { UNIT_DEFS, VETERANCY_RANKS, UNIT_PROMOTION_DEFS } from './engine.js';

const MISSION_IDS = Object.freeze([
  'first-harvest', 'silent-switch', 'last-light', 'black-shard', 'red-ledger',
  'ashes-in-transit', 'dawnfall', 'eye-of-the-storm', 'three-points-of-light',
  'quiet-knife', 'last-ember', 'dawn-of-the-free', 'after-the-dawn',
  'ghost-channel', 'iron-current',
]);
const FACTIONS = new Set(['aegis', 'vesper']);
const EXCLUDED_ROLES = new Set(['mcv', 'harvester', 'transport', 'medic', 'engineer']);
const PROMOTIONS = new Set(Object.keys(UNIT_PROMOTION_DEFS));

function isEligibleVeteranUnit(unit) {
  const definition = unit && UNIT_DEFS[unit.defId];
  return !!definition?.weapon && !EXCLUDED_ROLES.has(definition.role) &&
    FACTIONS.has(unit.faction) && unit.owner === 'player' && unit.hp > 0;
}

/** Return the strict, serializable veteran payload expected by campaign continuation. */
export function validateCampaignVeteran(veteran) {
  if (veteran === null) return true;
  if (!veteran || typeof veteran !== 'object' || Array.isArray(veteran) ||
      Object.keys(veteran).length !== 4 ||
      !Object.hasOwn(veteran, 'defId') || !Object.hasOwn(veteran, 'faction') ||
      !Object.hasOwn(veteran, 'veterancy') || !Object.hasOwn(veteran, 'promotion') ||
      typeof veteran.defId !== 'string' || !FACTIONS.has(veteran.faction) ||
      ![1, 2].includes(veteran.veterancy) ||
      !(veteran.promotion === null || PROMOTIONS.has(veteran.promotion))) return false;
  const definition = UNIT_DEFS[veteran.defId];
  return !!definition?.weapon && !EXCLUDED_ROLES.has(definition.role) &&
    (!definition.faction || definition.faction === 'all' || definition.faction === veteran.faction) &&
    (!veteran.promotion || veteran.veterancy === 2);
}

/** Derive the one surviving armed unit that will represent the prior operation. */
export function deriveCampaignVeteran(game) {
  if (!game || game.mode !== 'campaign' || game.status !== 'victory' || !game.campaignComplete) return null;
  const candidates = (Array.isArray(game.units) ? game.units : []).filter(isEligibleVeteranUnit);
  candidates.sort((a, b) =>
    (Math.min(2, Math.max(1, Math.trunc(Number(b.veterancy) || 0))) -
      Math.min(2, Math.max(1, Math.trunc(Number(a.veterancy) || 0))) ) ||
    (Math.max(0, Number(b.kills) || 0) - Math.max(0, Number(a.kills) || 0)) ||
    (Math.max(0, Number(b.xp) || 0) - Math.max(0, Number(a.xp) || 0)) ||
    (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const unit = candidates[0];
  if (!unit) return null;
  const veterancy = Math.min(2, Math.max(1, Math.trunc(Number(unit.veterancy) || 0)));
  return {
    defId: unit.defId,
    faction: unit.faction,
    veterancy,
    promotion: veterancy === 2 && PROMOTIONS.has(unit.promotion) ? unit.promotion : null,
  };
}

/** Mission IDs whose verified victory may supply the next operation's survivor. */
export function campaignVeteranSourceIds(missionIndex) {
  if (!Number.isInteger(missionIndex) || missionIndex < 0 || missionIndex >= MISSION_IDS.length || missionIndex === 0)
    return [];
  if (missionIndex === 4) return ['ghost-channel', 'iron-current', 'black-shard'];
  if (missionIndex === 13 || missionIndex === 14) return ['black-shard'];
  return [MISSION_IDS[missionIndex - 1]];
}
