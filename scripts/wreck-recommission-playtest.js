// Bounded two-commander field test for Engineer salvage versus vehicle
// recommissioning. It retains the seed 24 shard-valley bases and starting
// armies, pays for a power plant and Field Workshop through normal construction,
// and uses real public attack/recovery/recommission orders. The damaged Guardian
// and the local rifle patrol are declared test fixtures; neither changes terrain.
// Run with: node scripts/wreck-recommission-playtest.js
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

const SEED = 24;
const MAP = 'shard-valley';
const HZ = 30;
const STEP = 1 / HZ;
const CASE_SECONDS = 30;
const PREP_BUDGET = 6000;
const GUARDIAN_HP_FRACTION = 0.28;
const CHECKPOINTS = [0, 2, 3, 4, 8, 12, 20, 30];

function requireOk(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${result?.reason || 'command failed'}`);
  return result;
}

function setStance(game, owner, unitIds, stance) {
  const priorOwner = game.commandOwner;
  game.commandOwner = owner;
  game.select(unitIds);
  const result = game.issueSetStance(stance);
  game.commandOwner = priorOwner;
  requireOk(result, `${owner} ${stance} stance`);
}

function issueFor(game, owner, unitIds, method, ...args) {
  const priorOwner = game.commandOwner;
  game.commandOwner = owner;
  game.select(unitIds);
  const result = game[method](...args);
  game.commandOwner = priorOwner;
  return result;
}

function findConnectedSite(game, defId, target, maxDistance = 9) {
  const def = game.buildingDefs[defId];
  const candidates = [];
  for (let y = 1; y < game.height - def.h - 1; y++) for (let x = 1; x < game.width - def.w - 1; x++) {
    const center = { x: x + def.w / 2, y: y + def.h / 2 };
    const distance = Math.hypot(center.x - target.x, center.y - target.y);
    if (distance <= maxDistance && game.canPlaceBuilding(defId, x, y).ok)
      candidates.push({ x, y, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return candidates[0] || null;
}

function buildPaidBuilding(game, defId, target) {
  const site = findConnectedSite(game, defId, target);
  if (!site) throw new Error(`No legal connected ${defId} site within ${maxDistanceLabel(target)}.`);
  requireOk(game.startConstruction(defId), `start ${defId}`);
  const limit = Math.ceil(game.buildingDefs[defId].buildTime * 2.5 * HZ);
  let frames = 0;
  while (!game.construction?.ready && frames++ < limit && game.status === 'playing') game.update(STEP);
  if (!game.construction?.ready) throw new Error(`${defId} did not complete within the bounded setup window.`);
  const result = requireOk(game.issueBuild(defId, site.x, site.y), `place ${defId}`);
  const building = game.getEntity(result.id);
  if (!building || building.progress < 1) throw new Error(`${defId} did not finish placement.`);
  return building;
}

function maxDistanceLabel(target) {
  return `the ${target.label || 'target'} area`;
}

function freeGroundSites(game, { target, minDistance = 0, maxDistance = Infinity,
  minUnitsDistance = 0.85, direction = null, minDirectionDot = -1 } = {}) {
  const sites = [];
  for (let y = 1; y < game.height - 1; y++) for (let x = 1; x < game.width - 1; x++) {
    const point = { x: x + 0.5, y: y + 0.5 };
    const tile = game.terrain[y]?.[x];
    if (!tile?.walkable) continue;
    const distance = target ? Math.hypot(point.x - target.x, point.y - target.y) : 0;
    if (distance < minDistance || distance > maxDistance) continue;
    if (direction && target) {
      const length = Math.hypot(direction.x, direction.y) || 1;
      const dot = ((point.x - target.x) * direction.x + (point.y - target.y) * direction.y) /
        (Math.max(0.001, distance) * length);
      if (dot < minDirectionDot) continue;
    }
    if (game.buildings.some(building => building.hp > 0 && point.x >= building.x &&
        point.x < building.x + building.w && point.y >= building.y && point.y < building.y + building.h)) continue;
    if (game.units.some(unit => unit.hp > 0 && !unit.embarkedIn &&
        Math.hypot(point.x - unit.x, point.y - unit.y) < minUnitsDistance)) continue;
    sites.push({ ...point, distance });
  }
  sites.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return sites;
}

function findGuardianSite(game, workshop, engineer) {
  const workshopCenter = { x: workshop.x + workshop.w / 2, y: workshop.y + workshop.h / 2 };
  const candidates = freeGroundSites(game, { target: workshopCenter, maxDistance: 4.7, minUnitsDistance: 1.2 });
  const reachable = candidates.filter(point => game._distanceToEntity(point.x, point.y, workshop) > 2.75 &&
    (game._findPath(engineer.x, engineer.y, point.x, point.y).length > 0 ||
    Math.hypot(engineer.x - point.x, engineer.y - point.y) < 1.2));
  if (!reachable.length) throw new Error('No clear, reachable Guardian fixture site beside the powered Workshop.');
  return reachable[0];
}

function createGuardianAttackers(game, guardian) {
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  const away = { x: guardian.x - engineer.x, y: guardian.y - engineer.y };
  const candidateSites = freeGroundSites(game, { target: guardian, minDistance: 2.0, maxDistance: 3.15,
    minUnitsDistance: 0.9, direction: away, minDirectionDot: 0.12 });
  if (candidateSites.length < 2) throw new Error('Could not place two legal hostile rifle fixtures in range of the Guardian.');
  const ids = candidateSites.slice(0, 2).map(point => game._createUnit('enemy', 'rifle', point.x, point.y).id);
  return { ids, positions: ids.map(id => {
    const unit = game.getEntity(id); return { x: +unit.x.toFixed(2), y: +unit.y.toFixed(2) };
  }) };
}

function stageEngineerBesideGuardian(game, engineer, guardian) {
  const sites = freeGroundSites(game, { target: guardian, minDistance: 1.15, maxDistance: 1.9,
    minUnitsDistance: 0.85 });
  const goal = sites.find(point => game._findPath(engineer.x, engineer.y, point.x, point.y).length > 0);
  if (!goal) throw new Error('No clear reachable Engineer staging site beside the Guardian fixture.');
  requireOk(issueFor(game, 'player', [engineer.id], 'issueMove', goal.x, goal.y), 'stage Engineer beside Guardian fixture');
  let frames = 0;
  while (Math.hypot(engineer.x - goal.x, engineer.y - goal.y) > 0.55 && frames++ < 20 * HZ)
    game.update(STEP);
  if (frames >= 20 * HZ) throw new Error('Engineer could not reach the legal Guardian staging site.');
  requireOk(issueFor(game, 'player', [engineer.id], 'issueStop'), 'hold staged Engineer');
}

function setupArena() {
  const game = new Game({ seed: SEED, mode: 'multiplayer', mapId: MAP,
    faction: 'aegis', difficulty: 'normal', victoryMode: 'elimination' });
  const originalUnits = game.units.map(unit => ({ id: unit.id, owner: unit.owner, defId: unit.defId }));
  const originalBuildings = game.buildings.map(building => ({ id: building.id, owner: building.owner, defId: building.defId }));
  const originalArmedIds = game.units.filter(unit => game.unitDefs[unit.defId]?.weapon).map(unit => unit.id);
  for (const owner of ['player', 'enemy']) {
    const ids = game.units.filter(unit => unit.owner === owner && game.unitDefs[unit.defId]?.weapon).map(unit => unit.id);
    setStance(game, owner, ids, 'holdFire');
  }

  // The fixture receives an explicit test budget; all structure/unit spending
  // below still goes through the game's ordinary construction and queue APIs.
  game.credits.player = PREP_BUDGET;
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  if (!factory || !barracks) throw new Error('Seed 24 multiplayer bases are missing their starting factory or Barracks.');
  const factoryCenter = { x: factory.x + factory.w / 2, y: factory.y + factory.h / 2, label: 'original factory' };

  requireOk(game.queueUnit('engineer', barracks.id), 'queue paid Engineer');
  const powerPlant = buildPaidBuilding(game, 'power', factoryCenter);
  const workshop = buildPaidBuilding(game, 'serviceBay', factoryCenter);
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer' && unit.hp > 0);
  if (!engineer) throw new Error('Paid Engineer training did not complete during setup.');
  if (!workshop.powered) throw new Error('The paid Field Workshop completed without power.');

  const guardianPoint = findGuardianSite(game, workshop, engineer);
  const guardian = game._createUnit('player', 'guardian', guardianPoint.x, guardianPoint.y);
  const authoredGuardianHp = +(guardian.maxHp * GUARDIAN_HP_FRACTION).toFixed(2);
  guardian.hp = authoredGuardianHp;
  setStance(game, 'player', [guardian.id], 'holdFire');
  stageEngineerBesideGuardian(game, engineer, guardian);

  const patrol = createGuardianAttackers(game, guardian);
  const hostileIds = patrol.ids;
  const shots = { byHostiles: 0, guardianHits: 0, guardianHpRemoved: 0 };
  const originalFire = game._fire.bind(game);
  game._fire = (source, target, weaponDef) => {
    if (hostileIds.includes(source.id)) shots.byHostiles++;
    return originalFire(source, target, weaponDef);
  };
  const originalApplyDamage = game._applyDamage.bind(game);
  game._applyDamage = (target, damage, damageType, attackerOwner, sourceId, ...rest) => {
    const before = target.hp;
    if (target.id === guardian.id && attackerOwner === 'enemy' && hostileIds.includes(sourceId)) shots.guardianHits++;
    const result = originalApplyDamage(target, damage, damageType, attackerOwner, sourceId, ...rest);
    if (target.id === guardian.id && attackerOwner === 'enemy' && hostileIds.includes(sourceId)) shots.guardianHpRemoved += Math.max(0, before - target.hp);
    return result;
  };

  const attack = requireOk(issueFor(game, 'enemy', hostileIds, 'issueAttack', guardian.id), 'hostile rifle attack on Guardian');
  let frames = 0;
  const killLimit = 35 * HZ;
  while (guardian.hp > 0 && frames++ < killLimit && game.status === 'playing') game.update(STEP);
  if (guardian.hp > 0) throw new Error(`Hostile rifle attack did not destroy the authored Guardian within 35 seconds (hp=${guardian.hp.toFixed(1)}, hits=${shots.guardianHits}, patrol=${hostileIds.map(id => { const unit = game.getEntity(id); return unit ? `${unit.hp.toFixed(1)}hp/${unit.order?.type}` : 'missing'; }).join(',')}).`);
  const wreck = game.wrecks.find(item => item.restoreDefId === 'guardian' && item.expiresAt > game.time);
  if (!wreck) throw new Error('Actual Guardian destruction did not leave an eligible recommission wreck.');
  if (shots.guardianHits < 1) throw new Error('Guardian wreck was not created by observed hostile combat damage.');

  requireOk(issueFor(game, 'enemy', hostileIds, 'issueStop'), 'hold hostile patrol after Guardian destruction');
  const distanceToWorkshop = game._distanceToEntity(wreck.x, wreck.y, workshop);
  if (distanceToWorkshop > 6) throw new Error(`Workshop is ${distanceToWorkshop.toFixed(2)} tiles from the wreck.`);
  const visibleToPlayer = game.isVisible({ x: wreck.x, y: wreck.y, owner: 'enemy' }, 'player');
  if (!visibleToPlayer) throw new Error('The authored wreck is not visible to the player Engineer.');
  const baseSnapshot = game.serialize();

  return {
    game, baseSnapshot, engineerId: engineer.id, wreckId: wreck.id, hostileIds,
    originalArmedIds, originalUnits, originalBuildings, factoryId: factory.id,
    powerPlantId: powerPlant.id, workshopId: workshop.id,
    authoredGuardianHp, guardianMaxHp: guardian.maxHp,
    guardianPoint: { x: +guardian.x.toFixed(2), y: +guardian.y.toFixed(2) },
    hostilePositions: patrol.positions, wreckPoint: { x: +wreck.x.toFixed(2), y: +wreck.y.toFixed(2) },
    wreckValue: wreck.value, setupSeconds: +game.time.toFixed(2), setupEnemyShots: shots.byHostiles,
    setupGuardianHits: shots.guardianHits, setupAttackAccepted: attack.ok,
    setupCredits: game.credits.player, workshopPowered: workshop.powered,
    workshopDistance: +distanceToWorkshop.toFixed(2),
  };
}

function observe(game, engineer, wreck, elapsed, previousGuardianIds, hostileIds) {
  const addedGuardians = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'guardian' &&
    !previousGuardianIds.has(unit.id));
  const restored = addedGuardians.at(-1) || null;
  const output = {
    seconds: elapsed,
    engineerHp: +Math.max(0, engineer.hp).toFixed(1),
    engineerAlive: engineer.hp > 0,
    order: engineer.order?.type || 'missing',
    recommissionProgress: +Math.max(0, engineer._wreckRecommissionProgress || 0).toFixed(2),
    salvageProgress: +Math.max(0, engineer._wreckRecoveryProgress || 0).toFixed(2),
    waiting: engineer._wreckRecommissionWaiting || (engineer._wreckCapacityWaiting ? 'storage' : null),
    credits: Math.floor(game.credits.player),
    wreckPresent: game.wrecks.some(item => item.id === wreck.id),
    guardianAlive: !!restored && restored.hp > 0,
    guardianHp: restored ? +Math.max(0, restored.hp).toFixed(1) : null,
    hostileAlive: hostileIds.filter(id => game.getEntity(id)?.hp > 0).length,
  };
  return output;
}

function runCase(snapshot, { label, command, exposed = true, escorted = false, context }) {
  const game = Game.deserialize(snapshot);
  const engineer = game.getEntity(context.engineerId);
  const wreck = game.wrecks.find(item => item.id === context.wreckId);
  if (!engineer || !wreck) throw new Error(`${label}: shared scenario snapshot is incomplete.`);
  const startCredits = game.credits.player;
  const startEngineerHp = engineer.hp;
  const previousGuardianIds = new Set(game.units.filter(unit => unit.owner === 'player' && unit.defId === 'guardian').map(unit => unit.id));
  const hostileShots = { fired: 0, engineerHits: 0 };
  let recoveredEvent = null;
  let recommissionedEvent = null;
  const originalFire = game._fire.bind(game);
  game._fire = (source, target, weaponDef) => {
    if (context.hostileIds.includes(source.id)) hostileShots.fired++;
    return originalFire(source, target, weaponDef);
  };
  const originalApplyDamage = game._applyDamage.bind(game);
  game._applyDamage = (target, damage, damageType, attackerOwner, sourceId, ...rest) => {
    if (target.id === engineer.id && attackerOwner === 'enemy' && context.hostileIds.includes(sourceId)) hostileShots.engineerHits++;
    return originalApplyDamage(target, damage, damageType, attackerOwner, sourceId, ...rest);
  };
  game.onEvent = event => {
    if (event.type === 'wreckRecovered' && event.id === wreck.id) recoveredEvent = { ...event };
    if (event.type === 'wreckRecommissioned' && event.id === wreck.id) {
      const unit = game.getEntity(event.vehicleId);
      recommissionedEvent = { ...event, hpAtCompletion: unit?.hp ?? null, maxHpAtCompletion: unit?.maxHp ?? null };
    }
  };

  if (command === 'recommission')
    requireOk(issueFor(game, 'player', [engineer.id], 'issueRecommissionWreck', wreck.id), `${label} recommission order`);
  else if (command === 'salvage')
    requireOk(issueFor(game, 'player', [engineer.id], 'issueRecoverWreck', wreck.id), `${label} salvage order`);
  else throw new Error(`Unknown playtest command: ${command}`);

  const checkpoints = [];
  let elapsed = 0;
  let nextCheckpoint = 0;
  let hostileOrderIssued = false;
  if (escorted) {
    const liveEscorts = context.originalArmedIds.filter(id => game.getEntity(id)?.hp > 0);
    const firstGroup = liveEscorts.filter((_, index) => index % 2 === 0);
    const secondGroup = liveEscorts.filter((_, index) => index % 2 === 1);
    requireOk(issueFor(game, 'player', firstGroup, 'issueAttack', context.hostileIds[0]), `${label} first escort interception`);
    requireOk(issueFor(game, 'player', secondGroup.length ? secondGroup : firstGroup, 'issueAttack', context.hostileIds[1]), `${label} second escort interception`);
  }
  const frames = Math.round(CASE_SECONDS * HZ);
  for (let frame = 0; frame <= frames && game.status === 'playing'; frame++) {
    if (frame % HZ === 0) {
      elapsed = frame / HZ;
      while (nextCheckpoint < CHECKPOINTS.length && elapsed >= CHECKPOINTS[nextCheckpoint]) {
        checkpoints.push(observe(game, engineer, wreck, CHECKPOINTS[nextCheckpoint], previousGuardianIds, context.hostileIds));
        nextCheckpoint++;
      }
      if (exposed && !hostileOrderIssued && elapsed >= 3 && game.isVisible(engineer, 'enemy')) {
        const patrolOrder = issueFor(game, 'enemy', [context.hostileIds[0]], 'issueAttack', engineer.id);
        hostileOrderIssued = patrolOrder?.ok === true;
      }
    }
    if (frame === frames) break;
    game.update(STEP);
  }

  const final = observe(game, engineer, wreck, CASE_SECONDS, previousGuardianIds, context.hostileIds);
  const restored = game.units.find(unit => unit.owner === 'player' && unit.defId === 'guardian' &&
    !previousGuardianIds.has(unit.id)) || null;
  const restoredEvent = recommissionedEvent;
  const creditDelta = Math.floor(game.credits.player - startCredits);
  const result = {
    label, command, exposed, escorted,
    seconds: +Math.min(CASE_SECONDS, game.time - (JSON.parse(snapshot).time || 0)).toFixed(2),
    creditDelta, creditAtStart: Math.floor(startCredits), creditAtEnd: Math.floor(game.credits.player),
    expectedSalvage: recoveredEvent?.value ?? null,
    expectedRecommissionCost: restoredEvent?.cost ?? null,
    engineer: { startHp: +startEngineerHp.toFixed(1), endHp: +Math.max(0, engineer.hp).toFixed(1), alive: engineer.hp > 0,
      order: engineer.order?.type || 'missing', waiting: engineer._wreckRecommissionWaiting || null },
    hostileFire: { shots: hostileShots.fired, hitsOnEngineer: hostileShots.engineerHits,
      survivors: final.hostileAlive },
    channelProgress: checkpoints,
    wreckConsumed: !game.wrecks.some(item => item.id === wreck.id),
    recoveredEvent: recoveredEvent ? { value: recoveredEvent.value, time: +recoveredEvent.time.toFixed(2) } : null,
    recommissionedEvent: restoredEvent ? { cost: restoredEvent.cost, time: +restoredEvent.time.toFixed(2),
      hpAtCompletion: +Number(restoredEvent.hpAtCompletion).toFixed(1),
      maxHpAtCompletion: +Number(restoredEvent.maxHpAtCompletion).toFixed(1) } : null,
    restoredVehicle: { alive: !!restored && restored.hp > 0,
      hp: restored ? +Math.max(0, restored.hp).toFixed(1) : null,
      restoredHpAtCompletion: restoredEvent?.hpAtCompletion == null ? null : +Number(restoredEvent.hpAtCompletion).toFixed(1),
      maxHp: restored?.maxHp ?? null,
      healthPercent: restored ? +Math.max(0, restored.hp / restored.maxHp * 100).toFixed(1) : null,
      healthGainVsWoundedFixture: restoredEvent?.hpAtCompletion == null ? null :
        +Math.max(0, Number(restoredEvent.hpAtCompletion) - context.authoredGuardianHp).toFixed(1),
      hpGainOverDamagedAuthoredGuardian: restored ? +Math.max(0, restored.hp - context.authoredGuardianHp).toFixed(1) : null },
  };
  return result;
}

const arena = setupArena();
const shared = {
  engineerId: arena.engineerId, wreckId: arena.wreckId, hostileIds: arena.hostileIds,
  originalArmedIds: arena.originalArmedIds,
  authoredGuardianHp: arena.authoredGuardianHp,
};
const results = [
  runCase(arena.baseSnapshot, { label: 'SALVAGE · exposed patrol', command: 'salvage', context: shared }),
  runCase(arena.baseSnapshot, { label: 'RECOMMISSION · exposed patrol', command: 'recommission', context: shared }),
  runCase(arena.baseSnapshot, { label: 'RECOMMISSION · escorted', command: 'recommission', escorted: true, context: shared }),
];

assert(results[0].recoveredEvent, 'SALVAGE branch should recover the shared wreck through issueRecoverWreck.');
assert.equal(results[0].expectedSalvage, arena.wreckValue, 'SALVAGE branch should receive the wreck value.');
assert(results[2].recommissionedEvent, 'Escorted RECOMMISSION branch should complete the shared wreck through issueRecommissionWreck.');
assert.equal(results[2].expectedRecommissionCost, Math.ceil(1300 * 0.4), 'Recommission should charge 40% of Guardian cost.');
assert(Math.abs(results[2].recommissionedEvent.hpAtCompletion - arena.guardianMaxHp * 0.4) < 0.1,
  'Recommission should create the Guardian at 40% health.');
assert(results.slice(0, 2).every(result => result.hostileFire.shots > 0), 'Unescorted branches should retain the hostile patrol fixture.');
assert(results[0].hostileFire.hitsOnEngineer > 0 && results[1].hostileFire.hitsOnEngineer > 0,
  'Unescorted branches should show actual enemy fire landing on the Engineer.');
assert(!results[1].recommissionedEvent && !results[1].engineer.alive && !results[1].wreckConsumed,
  'Exposed RECOMMISSION should fail when the Engineer is intercepted before completion.');
assert(results[2].hostileFire.hitsOnEngineer > 0 && results[2].hostileFire.survivors === 0,
  'Escorted RECOMMISSION should withstand actual patrol fire and clear both hostile rifles.');

console.log(JSON.stringify({
  scope: 'Three bounded branches from one shared snapshot in an authored local two-commander arena; not a full match or win-rate result.',
  setup: {
    seed: SEED, mode: 'multiplayer', map: MAP, stepHz: HZ,
    retainedStartingUnits: arena.originalUnits.length,
    retainedStartingBuildings: arena.originalBuildings.length,
    originalArmedUnitsHeldFire: arena.originalArmedIds.length,
    paidBudget: PREP_BUDGET,
    paidConstruction: [
      { defId: 'power', id: arena.powerPlantId, cost: 300 },
      { defId: 'serviceBay', id: arena.workshopId, cost: 1150 },
      { defId: 'engineer', cost: 450 },
    ],
    workshopPowered: arena.workshopPowered,
    workshopDistanceToWreck: arena.workshopDistance,
    authoredGuardian: { x: arena.guardianPoint.x, y: arena.guardianPoint.y,
      hpBeforeCombat: arena.authoredGuardianHp, maxHp: arena.guardianMaxHp },
    authoredHostileRifles: arena.hostilePositions,
    wreck: { id: arena.wreckId, x: arena.wreckPoint.x, y: arena.wreckPoint.y,
      value: arena.wreckValue, setupSeconds: arena.setupSeconds,
      hostileShots: arena.setupEnemyShots, hostileHitsOnGuardian: arena.setupGuardianHits,
      publicAttackOrderAccepted: arena.setupAttackAccepted },
    sharedSnapshotCredit: arena.setupCredits,
  },
  results,
}));
