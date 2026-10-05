const MAX_CAPTURED_MOMENTS = 48;
const MAX_REPLAY_MOMENTS = 8;
const TICKS_PER_SECOND = 30;

const ABILITY_LABELS = Object.freeze({
  stormcall: 'Stormcall aimed',
  breach: 'Breach Window opened',
  interdict: 'Interdiction Pulse fired',
  rally: 'Rally Signal deployed',
});
const DOCTRINE_LABELS = Object.freeze({ logistics: 'Logistics Network', siege: 'Siege Protocol', signal: 'Signal Lattice' });
const PACKAGE_LABELS = Object.freeze({ breach: 'Breach Window', interdict: 'Interdiction Pulse', rally: 'Rally Signal' });
const BUILDING_LABELS = Object.freeze({ command: 'Command Yard', refinery: 'Crystal Refinery', factory: 'War Factory',
  research: 'Research Center', radar: 'Radar Array' });

export function battleMomentFromEvent(event) {
  if (!event || typeof event !== 'object' || !Number.isFinite(event.time) || event.time < 0) return null;
  const tick = Math.max(0, Math.round(event.time * TICKS_PER_SECOND));
  let title = '', kind = event.type, priority = 1;
  switch (event.type) {
    case 'relayCaptured':
      if (event.owner !== 'player') return null;
      title = 'Resonance Relay captured'; priority = 3; break;
    case 'relayDominionStarted':
      if (event.owner !== 'player') return null;
      title = 'Relay Dominion countdown started'; priority = 4; break;
    case 'salvageDropIncoming':
      title = 'Public salvage drop inbound'; priority = 2; break;
    case 'stormglassBloom':
      title = 'Stormglass Bloom opened'; priority = 2; break;
    case 'salvageDropClaimed':
      title = event.owner === 'player' ? 'Public salvage secured' : 'Enemy secured public salvage';
      priority = event.owner === 'player' ? 3 : 2; break;
    case 'doctrineReady':
      if (event.owner !== 'player' || !DOCTRINE_LABELS[event.id]) return null;
      title = `${DOCTRINE_LABELS[event.id]} researched`; priority = 2; break;
    case 'tacticalPackageReady':
      if (event.owner !== 'player' || !PACKAGE_LABELS[event.id]) return null;
      title = `${PACKAGE_LABELS[event.id]} ready`; priority = 2; break;
    case 'commandAbility':
      if (event.owner !== 'player' || !ABILITY_LABELS[event.abilityId]) return null;
      title = ABILITY_LABELS[event.abilityId]; priority = 2; break;
    case 'stormcallPulse':
      if (event.owner !== 'player') return null;
      title = 'Stormcall struck the field'; priority = 4; break;
    case 'superweapon':
      if (event.owner !== 'player') return null;
      title = event.kind === 'nuclear' ? 'Nuclear strike launched' : 'Ion strike launched'; priority = 4; break;
    case 'buildingLost':
      if (event.owner !== 'player' || !BUILDING_LABELS[event.defId]) return null;
      title = `${BUILDING_LABELS[event.defId]} lost`; priority = event.defId === 'command' ? 5 : 3; break;
    case 'campaignIntel':
      if (typeof event.message !== 'string' || !event.message.trim()) return null;
      title = event.message.trim().slice(0, 90); priority = 4; break;
    default: return null;
  }
  return { tick, title, kind, priority };
}

export function recordBattleMoment(moments, event) {
  const moment = battleMomentFromEvent(event);
  if (!moment) return moments;
  const prior = moments.findLast(item => item.kind === moment.kind && item.title === moment.title);
  if (prior && moment.tick - prior.tick < 20 * TICKS_PER_SECOND) return moments;
  if (moments.length >= MAX_CAPTURED_MOMENTS) {
    let weakest = 0;
    for (let index = 1; index < moments.length; index++)
      if (moments[index].priority < moments[weakest].priority) weakest = index;
    if (moments[weakest].priority > moment.priority) return moments;
    moments.splice(weakest, 1);
  }
  moments.push(moment);
  return moments;
}

export function selectReplayMoments(moments, completedTicks) {
  if (!Array.isArray(moments) || !Number.isInteger(completedTicks) || completedTicks < 0) return [];
  return moments.filter(item => item && Number.isInteger(item.tick) && item.tick >= 0 && item.tick <= completedTicks &&
      typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 90 &&
      typeof item.kind === 'string' && item.kind.length <= 40 && Number.isInteger(item.priority) && item.priority >= 1 && item.priority <= 5)
    .sort((a, b) => b.priority - a.priority || a.tick - b.tick)
    .slice(0, MAX_REPLAY_MOMENTS)
    .sort((a, b) => a.tick - b.tick)
    .map(({ tick, title, kind, priority }) => ({ tick, title, kind, priority }));
}
