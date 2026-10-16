// One public-command v61 probe for the observed anti-armor screen. The
// _queueUnit wrapper only records stock and spend at production decisions.
import { Game, UNIT_DEFS } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const game = new Game({ seed: 481516, difficulty: 'normal', mapId: 'shard-valley',
  faction: 'aegis', replayVersion: 61 });
const queues = [], deaths = [], screenSamples = [], transitions = [];
const liveRockets = () => game.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
  !unit.embarkedIn && unit.defId === 'rocket').length;
const queuedRockets = () => game.buildings.filter(building => building.owner === 'enemy')
  .reduce((sum, building) => sum + building.queue.filter(item => item.defId === 'rocket').length, 0);
const originalQueue = game._queueUnit.bind(game);
game._queueUnit = (owner, defId) => {
  const stockBefore = liveRockets() + queuedRockets();
  const planActive = owner === 'enemy' && game.mode === 'skirmish' && game.replayVersion >= 59 &&
    game.aiCounterPlan?.id === 'anti-armor-screen' && game.time - game.aiCounterPlan.lastObservedAt <= 36;
  const forcedCounterPlan = planActive && stockBefore < 2;
  const creditsBefore = game.credits[owner];
  const result = originalQueue(owner, defId);
  if (owner === 'enemy' && defId === 'rocket' && result.ok) queues.push({
    time: +game.time.toFixed(1), forcedCounterPlan, planActive, stockBefore,
    stockAfter: liveRockets() + queuedRockets(), spend: creditsBefore - game.credits.enemy,
  });
  return result;
};
game.onEvent = event => {
  if (event.type === 'aiCounterPlanStarted') transitions.push({ type: 'started', time: +event.time.toFixed(1), target: event.target });
};

for (let count = 0; count < 5; count++) game.queueUnit('lightTank');
const tanks = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && unit.defId === 'lightTank');
let retreatSent = false, planStart = null, planClearedAt = null;
let lastObservedArmorAt = null, lastPlanObservedAt = null;
let lastDiagnosticSecond = -1;
const knownRockets = new Map();
const orderedTankIds = new Set();
const tankCommands = [];

while (game.time < 180 && game.status === 'playing' &&
    !(planClearedAt !== null && game.time >= planClearedAt + 8)) {
  if (!planStart && game.aiCounterPlan) planStart = game.aiCounterPlan.startedAt;
  if (game.aiCounterPlan) lastPlanObservedAt = game.aiCounterPlan.lastObservedAt;
  if (!retreatSent && planStart != null && game.time >= planStart + 4) {
    const returning = tanks();
    game.select(returning.map(unit => unit.id));
    game.issueMove(8.5, 43.5, false);
    retreatSent = true;
    tankCommands.push({ phase: 'retreat', time: +game.time.toFixed(1), ids: returning.map(unit => unit.id) });
  }
  const target = retreatSent ? { x: 8.5, y: 43.5 } : { x: 42.5, y: 16.5 };
  for (const unit of tanks()) if (!orderedTankIds.has(unit.id)) {
    game.select(unit.id);
    game.issueMove(target.x, target.y, !retreatSent);
    orderedTankIds.add(unit.id);
    tankCommands.push({ phase: retreatSent ? 'retreat' : 'approach', time: +game.time.toFixed(1), id: unit.id });
  }
  const oldPlanStart = game.aiCounterPlan?.startedAt ?? null;
  game.update(SOLO_STEP_SECONDS);
  const newPlanStart = game.aiCounterPlan?.startedAt ?? null;
  if (game.aiCounterPlan) lastPlanObservedAt = game.aiCounterPlan.lastObservedAt;
  if (oldPlanStart !== null && newPlanStart === null && planClearedAt === null) {
    planClearedAt = +game.time.toFixed(1);
    transitions.push({ type: 'expired', time: planClearedAt });
  }
  if (newPlanStart !== null && planStart === null) planStart = newPlanStart;

  for (const unit of game.units) if (unit.owner === 'enemy' && unit.defId === 'rocket') {
    const previous = knownRockets.get(unit.id) || {};
    knownRockets.set(unit.id, { ...previous, id: unit.id, lastSeen: +game.time.toFixed(1),
      hp: Math.round(unit.hp), assigned: unit.order?.aiCounterPlan === 'anti-armor-screen' });
  }
  const rememberedArmor = (game._aiIntel || []).filter(item => !item.building &&
    UNIT_DEFS[item.defId]?.weapon && ['light', 'heavy'].includes(UNIT_DEFS[item.defId]?.armor));
  if (rememberedArmor.length) lastObservedArmorAt = Math.max(lastObservedArmorAt ?? -1,
    ...rememberedArmor.map(item => item.seen));
  for (const [id, record] of knownRockets) if (!game.units.some(unit => unit.id === id) && !record.deadAt) {
    record.deadAt = +game.time.toFixed(1);
    deaths.push({ id, time: record.deadAt, lastSeen: record.lastSeen, assigned: record.assigned });
  }

  const diagnosticSecond = Math.floor(game.time + 0.000001);
  if (diagnosticSecond !== lastDiagnosticSecond) {
    lastDiagnosticSecond = diagnosticSecond;
    const screen = game.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit.order?.aiCounterPlan === 'anti-armor-screen');
    if (screen.length) screenSamples.push({ time: diagnosticSecond,
      units: screen.map(unit => ({ id: unit.id, orderTime: unit.order.aiCounterPlanOrderTime,
        reachable: Math.hypot(unit.x - unit.order.x, unit.y - unit.order.y) < 0.75 ||
          game._findPath(unit.x, unit.y, unit.order.x, unit.order.y).length > 0 })) });
  }
}

const screensById = new Map();
for (const sample of screenSamples) for (const unit of sample.units) {
  const record = screensById.get(unit.id) || { samples: 0, unreachable: 0, orderTimes: new Set() };
  record.samples++;
  record.unreachable += Number(!unit.reachable);
  record.orderTimes.add(unit.orderTime);
  screensById.set(unit.id, record);
}
console.log(JSON.stringify({ rulesVersion: game.replayVersion, map: game.mapId, seed: game.seed,
  difficulty: game.difficulty, result: game.status, endTime: +game.time.toFixed(1),
  planTransitions: transitions, rocketQueues: queues, rocketDeaths: deaths,
  maxAssigned: Math.max(0, ...screenSamples.map(sample => sample.units.length)),
  screenOrderSummary: [...screensById].map(([id, record]) => ({ id, samples: record.samples,
    unreachableSamples: record.unreachable, distinctOrderTimes: record.orderTimes.size })),
  retreatSent, commandedTanks: orderedTankIds.size, tankCommands, lastObservedArmorAt, lastPlanObservedAt,
}, null, 2));
