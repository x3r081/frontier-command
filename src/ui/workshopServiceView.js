import { WORKSHOP_SERVICE_REPAIR_RATE_HP_PER_SECOND,
  WORKSHOP_SERVICE_REPAIR_CREDIT_COST_PER_HP } from '../game/engine.js';

const distanceToBuilding = (unit, building) => Math.hypot(
  Math.max(building.x - unit.x, 0, unit.x - building.x - building.w),
  Math.max(building.y - unit.y, 0, unit.y - building.y - building.h),
);

export function serviceReturnLabel(order) {
  if (!order || typeof order !== 'object') return 'Idle';
  if (order.type === 'move') return order.attackMove ? 'Attack move' : order.reverse ? 'Reverse move' : 'Move';
  return ({ idle:'Idle', guard:'Guard', patrol:'Patrol', attack:'Attack', follow:'Follow',
    harvest:'Harvest', service:'Previous assignment' })[order.type] || 'Previous assignment';
}

export function vehicleServiceView(game, unit, owner = 'player') {
  if (!game || unit?.owner !== owner || unit.hp <= 0 || unit.embarkedIn || unit.order?.type !== 'service') return null;
  const workshop = game.buildings?.find(building => building.id === unit.order.workshopId &&
    building.owner === owner && building.defId === 'serviceBay' && building.hp > 0 && building.progress >= 1);
  const missingHp = Math.max(0, (Number(unit.maxHp) || 0) - (Number(unit.hp) || 0));
  const inRange = !!workshop && distanceToBuilding(unit, workshop) <= 2.5;
  const status = !workshop ? 'unavailable' : !inRange ? 'approaching'
    : !workshop.powered ? 'power' : !(game.credits?.[owner] > 0) ? 'credits' : missingHp > 0 ? 'repairing' : 'complete';
  return {
    id: unit.id, defId: unit.defId, faction: unit.faction || game.faction,
    name: game.unitDefs?.[unit.defId]?.name || 'Vehicle', workshopId: workshop?.id || null,
    hpPercent: Math.max(0, Math.min(100, Math.round(unit.hp / Math.max(1, unit.maxHp) * 100))),
    missingHp, repairCost: Math.ceil(missingHp * WORKSHOP_SERVICE_REPAIR_CREDIT_COST_PER_HP),
    rate: WORKSHOP_SERVICE_REPAIR_RATE_HP_PER_SECOND, status,
    statusLabel: ({ unavailable:'Workshop unavailable', approaching:'Approaching Workshop', power:'Paused · no power',
      credits:'Paused · no credits', repairing:'Repairs active', complete:'Ready to return' })[status],
    returnLabel: serviceReturnLabel(unit.order.resumeOrder),
    sector: `${Math.floor(unit.x)} // ${Math.floor(unit.y)}`,
  };
}

export function workshopServiceView(game, workshopId, owner = 'player') {
  const workshop = game?.buildings?.find(building => building.id === workshopId && building.defId === 'serviceBay' &&
    building.owner === owner && building.hp > 0 && building.progress >= 1);
  if (!workshop) return null;
  const patients = (game.units || []).map(unit => vehicleServiceView(game, unit, owner))
    .filter(patient => patient?.workshopId === workshop.id)
    .sort((a,b) => String(a.id).localeCompare(String(b.id)));
  return { id: workshop.id, powered: !!workshop.powered, patients,
    rate: WORKSHOP_SERVICE_REPAIR_RATE_HP_PER_SECOND, costPerHp: WORKSHOP_SERVICE_REPAIR_CREDIT_COST_PER_HP,
    approaching: patients.filter(patient => patient.status === 'approaching').length,
    repairing: patients.filter(patient => patient.status === 'repairing').length,
    repairCost: patients.reduce((sum, patient) => sum + patient.repairCost, 0),
    credits: Math.floor(Math.max(0, game.credits?.[owner] || 0)),
  };
}
