// Paired 30 Hz full-AI economic recovery probe. The setup removes the rival's
// only Harvester, leaves its completed Refinery and Factory, and gives it a
// damaged tank beside a powered Field Workshop with only $10 above replacement
// Harvester cost. Both versions retain every normal AI decision after setup.
import { Game } from '../src/game/engine.js';

function simulate(replayVersion, startTime = 0, frames = 1800) {
  const game = new Game({ seed: 24, difficulty: 'normal', mapId: 'shard-valley', faction: 'aegis', replayVersion,
    aiCommanderProfileId: 'siege-director' });
  game.time = startTime;
  game.units = game.units.filter(unit => unit.owner === 'enemy' && unit.defId !== 'harvester');
  const position = game._findAiPlacement('serviceBay');
  const workshop = game._createBuilding('enemy', 'serviceBay', position.x, position.y, 1);
  const tank = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
  tank.x = workshop.x + workshop.w + 1.4;
  tank.y = workshop.y + 0.5;
  tank.hp = tank.maxHp * 0.5;
  tank.order = { type: 'idle' };
  game.credits.enemy = 1260;
  game._refreshPower();

  const events = [];
  game.onEvent = event => {
    if (event.owner === 'enemy' && ['unitQueued', 'unitReady', 'credits'].includes(event.type)) {
      events.push({ time: +game.time.toFixed(1), type: event.type, defId: event.defId,
        amount: event.amount ?? null, total: event.total ?? null, balance: +game.credits.enemy.toFixed(1) });
    }
  };
  for (let frame = 0; frame < frames && game.status === 'playing'; frame++) game.update(1 / 30);

  return {
    rules: replayVersion,
    seconds: +game.time.toFixed(1),
    endingCredits: +game.credits.enemy.toFixed(1),
    expansionStage: game._aiExpansionTarget?.stage ?? null,
    workshopPowered: workshop.powered,
    tankHealth: +tank.hp.toFixed(1),
    harvestersAlive: game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'harvester').length,
    queuedHarvesters: game.buildings.filter(building => building.owner === 'enemy')
      .flatMap(building => building.queue.filter(item => item.defId === 'harvester')).length,
    events: events.filter(event => event.defId === 'harvester' || event.type === 'credits' ||
      event.type === 'unitQueued' && ['apc', 'buggy'].includes(event.defId)),
  };
}

function pairedRun(startTime, frames) {
  return { before: simulate(68, startTime, frames), after: simulate(69, startTime, frames) };
}

console.log(JSON.stringify({
  setup: {
    difficulty: 'normal', map: 'shard-valley', seed: 24, stepSeconds: 1 / 30,
    commanderProfile: 'Siege Director',
    startCredits: 1260, replacementHarvesterCost: 1250,
    enemyHarvesterAtStart: 0, completedEnemyRefinery: true, completedEnemyFactory: true,
    damagedEnemyTank: '50% health, placed within powered Field Workshop repair radius',
    playerCombatUnits: 0, playerBuildingsRetained: true,
    aiDecisions: 'full; no AI handlers or purchase paths suppressed',
  },
  earlyRecoveryAt0s: pairedRun(0, 1800),
  lateExpansionConflictAt120s: pairedRun(120, 180),
}, null, 2));
