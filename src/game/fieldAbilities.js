const ABILITY_BY_UNIT_TYPE = Object.freeze({
  guardian: 'brace',
  stealthTank: 'ghostRun',
});

function unitActiveUntil(unit, abilityId) {
  return abilityId === 'brace' ? unit.braceUntil : unit.ghostRunUntil;
}

/**
 * Describe a strict selected Guardian or Specter cohort and its per-unit
 * ability readiness. A mixed, partial, or otherwise invalid selection is not
 * treated as a cohort.
 */
export function getFieldAbilityCohort(game) {
  const selection = game?.selection;
  if (!Array.isArray(selection) || selection.length === 0 ||
      selection.some(id => typeof id !== 'string') || new Set(selection).size !== selection.length)
    return null;

  const owner = game.commandOwner || 'player';
  const entities = new Map([
    ...(game.units || []).map(unit => [unit.id, { entity: unit, isUnit: true }]),
    ...(game.buildings || []).map(building => [building.id, { entity: building, isUnit: false }]),
  ]);
  const selected = selection.map(id => entities.get(id));
  if (selected.some(entry => !entry || !entry.isUnit)) return null;

  const units = selected.map(entry => entry.entity);
  const defId = units[0].defId;
  const abilityId = ABILITY_BY_UNIT_TYPE[defId];
  if (!abilityId || units.some(unit => unit.owner !== owner || !(unit.hp > 0) || unit.embarkedIn ||
      unit.defId !== defId)) return null;
  if (typeof game.canUseUnitAbility !== 'function') return null;

  const time = Number.isFinite(game.time) ? game.time : 0;
  const readyIds = [];
  const activeIds = [];
  const coolingIds = [];
  const needsMoveIds = [];
  const unavailableIds = [];
  const cooldowns = [];
  const activeRemainings = [];
  let unavailableReason = '';

  for (const unit of units) {
    const activeRemaining = Math.max(0, (unitActiveUntil(unit, abilityId) || 0) - time);
    const cooldown = Math.max(0, Number(unit.abilityCooldown) || 0);
    const canUse = game.canUseUnitAbility(unit.id, abilityId);
    if (activeRemaining > 0) {
      activeIds.push(unit.id);
      activeRemainings.push(activeRemaining);
    } else if (cooldown > 0) {
      coolingIds.push(unit.id);
      cooldowns.push(cooldown);
    } else if (canUse?.ok) {
      readyIds.push(unit.id);
    } else if (abilityId === 'ghostRun' && /Ghost Run requires a move order\./i.test(canUse?.reason || '')) {
      needsMoveIds.push(unit.id);
    } else {
      unavailableIds.push(unit.id);
      unavailableReason ||= canUse?.reason || 'Field action unavailable.';
    }
  }

  return {
    abilityId,
    ids: units.map(unit => unit.id),
    readyIds,
    activeIds,
    coolingIds,
    needsMoveIds,
    nextCooldown: cooldowns.length ? Math.min(...cooldowns) : 0,
    activeRemaining: activeRemainings.length ? Math.max(...activeRemainings) : 0,
    ...(unavailableIds.length ? { unavailableIds, unavailableReason } : {}),
  };
}

/**
 * Activate only ready members of the selected strict cohort. This deliberately
 * calls the existing per-unit Game command so solo replay recording continues
 * to capture the established useUnitAbility entries.
 */
export function activateSelectedUnitAbility(game, abilityId) {
  const cohort = getFieldAbilityCohort(game);
  if (!cohort) return { ok: false, activatedIds: [], skippedIds: [], reason: 'Select only living friendly Guardians or Specters of one type.' };
  if (cohort.abilityId !== abilityId)
    return { ok: false, activatedIds: [], skippedIds: [...cohort.ids], reason: 'That ability does not match the selected unit type.' };

  if (cohort.readyIds.length === 0) {
    let reason = cohort.unavailableReason;
    if (!reason && cohort.needsMoveIds.length) reason = 'Ghost Run requires a move order.';
    if (!reason && cohort.coolingIds.length) reason = 'Unit ability is cooling down.';
    if (!reason && cohort.activeIds.length) reason = abilityId === 'brace'
      ? 'Guardian is already braced.' : 'Specter is already on a Ghost Run.';
    return { ok: false, activatedIds: [], skippedIds: [...cohort.ids], reason: reason || 'No selected unit is ready.' };
  }

  const activatedIds = [];
  const skipped = new Set(cohort.ids.filter(id => !cohort.readyIds.includes(id)));
  let reason;
  for (const unitId of cohort.readyIds) {
    const result = game.useUnitAbility(unitId, abilityId);
    if (result?.ok) activatedIds.push(unitId);
    else {
      skipped.add(unitId);
      reason ||= result?.reason || 'Field action unavailable.';
    }
  }
  const skippedIds = cohort.ids.filter(id => skipped.has(id));
  return {
    ok: activatedIds.length > 0,
    activatedIds,
    skippedIds,
    ...(reason ? { reason } : {}),
    ...(activatedIds.length === 0 && !reason ? { reason: 'No selected unit could activate this ability.' } : {}),
  };
}
