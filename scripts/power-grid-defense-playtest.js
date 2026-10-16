// Deterministic, authored two-commander fixture for power routing and powered
// defense. Building purchases and queues use the game's public commands;
// combat uses the normal attack order, weapons, projectiles, and damage rules.
// Run with: node scripts/power-grid-defense-playtest.js
import { Game } from '../src/game/engine.js';

const SEED = 24;
const HZ = 30;
const COMBAT_SECONDS = 30;
const STEP = 1 / HZ;

function requireOk(result, label) {
  if (!result?.ok) throw new Error(`${label}: ${result?.reason || 'command failed'}`);
  return result;
}

function advance(game, seconds) {
  const frames = Math.round(seconds * HZ);
  for (let i = 0; i < frames && game.status === 'playing'; i++) game.update(STEP);
}

function findConnectedSite(game, defId, target) {
  const sites = [];
  for (let y = 1; y < game.height - 3; y++) for (let x = 1; x < game.width - 3; x++) {
    if (game.canPlaceBuilding(defId, x, y).ok)
      sites.push({ x, y, distance: Math.hypot(x + 0.5 - target.x, y + 0.5 - target.y) });
  }
  sites.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  return sites[0] || null;
}

function buildPaidCompleted(game, defId, target) {
  const site = findConnectedSite(game, defId, target);
  if (!site) throw new Error(`No legal connected site for ${defId}.`);
  requireOk(game.startConstruction(defId), `start ${defId}`);
  const maxFrames = Math.ceil(game.buildingDefs[defId].buildTime * 20 * HZ);
  let frames = 0;
  while (!game.construction?.ready && frames++ < maxFrames) game.update(STEP);
  if (!game.construction?.ready) throw new Error(`${defId} did not complete within the bounded setup window.`);
  const placed = requireOk(game.issueBuild(defId, site.x, site.y), `place ${defId}`);
  const building = game.getEntity(placed.id);
  if (!building || building.progress !== 1) throw new Error(`${defId} did not finish placement.`);
  return { defId, x: building.x, y: building.y, cost: game.buildingDefs[defId].cost };
}

function placeLocalEnemySquads(game) {
  // Authored local fixture placement, used only to make a short, repeatable
  // defense encounter. These units still fire and take damage normally.
  const points = [[16.8, 37.4], [17.5, 37.4], [17.15, 38.0]];
  return points.map(([x, y]) => game._createUnit('enemy', 'rifle', x, y).id);
}

function issueEnemyAttack(game, unitIds, targetId) {
  game.commandOwner = 'enemy';
  game.select(unitIds);
  const order = game.issueAttack(targetId);
  game.commandOwner = 'player';
  requireOk(order, 'enemy attack order');
}

function runCase(snapshot, label, standbyIds) {
  const game = Game.deserialize(snapshot);
  const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
  const tower = game.buildings.find(b => b.owner === 'player' && b.defId === 'guardTower');
  const enemies = game.units.filter(u => u.owner === 'enemy' && u._playtestLocalSquad);
  const queue = factory.queue[0];
  if (!queue) throw new Error(`${label}: paid Striker queue item is missing.`);
  const queueProgressStart = queue.progress;
  const factoryHpStart = factory.hp;
  const enemyIdsStart = new Set(enemies.map(u => u.id));
  const enemyDeathsStart = game.kills.player;
  for (const id of standbyIds) requireOk(game.setBuildingPower(id, true), `${label} standby ${id}`);

  const powerAtStart = { ...game.power.player };
  const towerPoweredAtStart = tower.powered;
  const shotIds = new Set();
  let elapsed = 0;
  const frameCount = Math.round(COMBAT_SECONDS * HZ);
  for (let frame = 0; frame < frameCount && game.status === 'playing'; frame++) {
    game.update(STEP);
    elapsed += STEP;
    for (const effect of game.effects) if (effect.type === 'projectile' &&
        effect.owner === 'player' && effect.sourceId === tower.id) shotIds.add(effect.id);
  }

  const remainingEnemies = game.units.filter(u => enemyIdsStart.has(u.id) && u.hp > 0);
  const result = {
    label,
    seconds: +elapsed.toFixed(2),
    power: powerAtStart,
    guardTowerPoweredAtStart: towerPoweredAtStart,
    guardTowerShots: shotIds.size,
    factoryHp: { start: +factoryHpStart.toFixed(1), end: +factory.hp.toFixed(1),
      lost: +(factoryHpStart - factory.hp).toFixed(1) },
    enemySquads: { start: enemyIdsStart.size, remaining: remainingEnemies.length,
      killsCredited: game.kills.player - enemyDeathsStart },
    strikerQueue: { retained: factory.queue.some(item => item.defId === 'lightTank'),
      progressStart: +queueProgressStart.toFixed(4),
      progressEnd: +factory.queue[0]?.progress.toFixed(4) || 0,
      standby: factory.powerStandby },
  };
  return { game, result };
}

const game = new Game({ seed: SEED, faction: 'aegis', mode: 'multiplayer',
  mapId: 'shard-valley', victoryMode: 'elimination' });
const originalPower = { ...game.power.player };
const startingCombat = game.units.filter(u => u.owner === 'player' && game.unitDefs[u.defId]?.weapon);
game.select(startingCombat.map(u => u.id));
requireOk(game.issueSetStance('holdFire'), 'hold player combat units');

// The scenario supplies a defined build budget, then pays each normal building
// cost through startConstruction. Placement favors a compact corridor beside
// the existing War Factory; no terrain is altered.
game.credits.player = 12000;
const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
const target = { x: factory.x + factory.w / 2, y: factory.y + factory.h / 2 };
const paidBuildings = [];
for (const defId of ['radar', 'tech', 'helipad', 'serviceBay', 'guardTower'])
  paidBuildings.push(buildPaidCompleted(game, defId, target));

const playerFactory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
const tower = game.buildings.find(b => b.owner === 'player' && b.defId === 'guardTower');
const enemyIds = placeLocalEnemySquads(game);
for (const id of enemyIds) game.getEntity(id)._playtestLocalSquad = true;
const paidStrikerQueue = requireOk(game.queueUnit('lightTank', playerFactory.id), 'queue paid Striker');
issueEnemyAttack(game, enemyIds, playerFactory.id);

const fixture = JSON.parse(game.serialize());
const allOn = runCase(JSON.stringify(fixture), 'brownout-all-online', []);
const standbyBuildings = ['factory', 'radar', 'tech'].map(defId =>
  game.buildings.find(b => b.owner === 'player' && b.defId === defId));
if (standbyBuildings.some(b => !b)) throw new Error('A required standby building is missing.');
const standbyIds = standbyBuildings.map(b => b.id);
const standby = runCase(JSON.stringify(fixture), 'factory-radar-tech-standby', standbyIds);

// Restore the factory while Radar and Tech stay on standby. This restores a
// powered production site, keeps the tower online, and lets the paid queue move.
const resumeGame = standby.game;
const resumeFactory = resumeGame.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
const progressBeforeResume = resumeFactory.queue[0]?.progress;
requireOk(resumeGame.setBuildingPower(resumeFactory.id, false), 'restore factory power');
const restoredPower = { ...resumeGame.power.player };
advance(resumeGame, 6);
const progressAfterResume = resumeFactory.queue[0]?.progress;

const report = {
  scope: 'Authored local two-commander combat fixture; not a full match or win-rate result.',
  setup: {
    seed: SEED, faction: 'aegis', mode: game.mode, map: game.mapId, aiCommander: game.aiCommanderProfileId,
    originalBasePower: originalPower,
    originalBaseDrawFromDefinitions: ['refinery', 'barracks', 'factory'].reduce((sum, id) =>
      sum - Math.min(0, game.buildingDefs[id].power), 0),
    playerCombatStance: 'holdFire',
    completedPaidBuildings: paidBuildings,
    fixtureBudget: 12000,
    enemyFixture: { unit: 'Rifle Squad', count: enemyIds.length,
      placement: 'authored close to the player Factory; normal weapons, damage, and attack orders' },
    guardTowerId: tower.id,
    paidQueue: { unit: 'Striker Tank', defId: 'lightTank', producerId: playerFactory.id,
      queued: paidStrikerQueue.ok },
    paidBuildingCostTotal: paidBuildings.reduce((sum, item) => sum + item.cost, 0),
    actualAllOnlinePower: { ...game.power.player },
    noTerrainFlattening: true,
  },
  cases: [allOn.result, standby.result],
  restore: {
    factoryStandbyRemoved: !resumeFactory.powerStandby,
    radarAndTechRemainStandby: ['radar', 'tech'].every(defId =>
      resumeGame.buildings.find(b => b.owner === 'player' && b.defId === defId)?.powerStandby),
    power: restoredPower,
    queueProgress: { before: +progressBeforeResume.toFixed(4), afterSixSeconds: +progressAfterResume.toFixed(4),
      advanced: progressAfterResume > progressBeforeResume },
    guardTowerPowered: resumeGame.getEntity(tower.id).powered,
  },
  checks: {
    originalPowerProduction120: originalPower.production === 120,
    originalDefinitionDrawIs105: reportDrawIs105(game),
    brownoutRatioBelowThreshold: allOn.result.power.ratio < 0.55,
    towerOfflineDuringBrownout: allOn.result.guardTowerPoweredAtStart === false,
    towerOnlineWithStandby: standby.result.guardTowerPoweredAtStart === true,
    queueRemainsInFactory: allOn.result.strikerQueue.retained && standby.result.strikerQueue.retained,
    queuePausedInStandby: standby.result.strikerQueue.progressEnd === standby.result.strikerQueue.progressStart,
    queueResumesAfterFactoryRestore: progressAfterResume > progressBeforeResume,
    enemySquadsHaveActualAttackOrders: enemyIds.every(id => fixture.units.find(unit => unit.id === id)?.order?.type === 'attack'),
    noInitialPlayerCombatFire: startingCombat.every(unit => unit.stance === 'holdFire'),
  },
};

function reportDrawIs105(instance) {
  return ['refinery', 'barracks', 'factory'].reduce((sum, id) =>
    sum - Math.min(0, instance.buildingDefs[id].power), 0) === 105;
}

console.log(JSON.stringify(report));
