import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_ECONOMY_RESERVE_RULES_VERSION, Game, UNIT_DEFS } from '../src/game/engine.js';

function recoveryState({ replayVersion, mode = 'skirmish', difficulty = 'normal', credits = 1260,
  aiCommanderProfileId } = {}) {
  const game = new Game({ seed: 24, mode, difficulty, mapId: 'shard-valley', faction: 'aegis', replayVersion,
    aiCommanderProfileId });
  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId !== 'harvester');
  game.credits.enemy = credits;
  const position = game._findAiPlacement('serviceBay');
  const bay = game._createBuilding('enemy', 'serviceBay', position.x, position.y, 1);
  const tank = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
  tank.x = bay.x + bay.w + 1.4;
  tank.y = bay.y + 0.5;
  tank.hp = tank.maxHp * 0.5;
  game._refreshPower();
  return { game, bay, tank };
}

test('replacement reserve is limited to current skirmish AI with a working refinery and factory', () => {
  assert.equal(AI_ECONOMY_RESERVE_RULES_VERSION, 69);
  const current = recoveryState();
  assert.equal(current.game._aiEconomyReserve(), UNIT_DEFS.harvester.cost);

  const legacy = recoveryState({ replayVersion: 68 });
  assert.equal(legacy.game._aiEconomyReserve(), 0);
  const campaign = recoveryState({ mode: 'campaign' });
  assert.equal(campaign.game._aiEconomyReserve(), 0);
  const multiplayer = recoveryState({ mode: 'multiplayer' });
  assert.equal(multiplayer.game._aiEconomyReserve(), 0);
  const missingFactory = recoveryState();
  missingFactory.game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory').hp = 0;
  assert.equal(missingFactory.game._aiEconomyReserve(), 0);
});

test('workshop repairs spend only credits above a replacement Harvester reserve', () => {
  const { game, tank } = recoveryState();
  assert.equal(game.hasBuilding('enemy', 'refinery'), true);
  assert.equal(game.hasBuilding('enemy', 'factory'), true);
  game._updateBuildings(2);

  assert.equal(tank.hp, 240);
  assert.equal(game.credits.enemy, UNIT_DEFS.harvester.cost);

  const queuedHarvester = recoveryState({ credits: 1800 });
  queuedHarvester.game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory')
    .queue.push({ defId: 'harvester', progress: 0 });
  queuedHarvester.game.credits.enemy = 5;
  const queuedTank = queuedHarvester.game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
  queuedTank.hp = queuedTank.maxHp - 100;
  queuedHarvester.game._updateBuildings(1);
  assert.equal(queuedHarvester.game._aiEconomyReserve(), 0);
  assert.equal(queuedHarvester.game.credits.enemy, 0);
  assert.equal(queuedTank.hp, queuedTank.maxHp - 90);
});

test('automatic structure repair preserves the same replacement reserve and player repairs remain unchanged', () => {
  const { game } = recoveryState();
  const tank = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
  tank.x = 10.5;
  tank.y = 10.5;
  const turret = game._createBuilding('enemy', 'turret', 2, 2, 1);
  turret.hp -= 100;
  turret.repairing = true;
  game._updateBuildings(1);
  assert.equal(turret.hp, turret.maxHp - 67);
  assert.ok(Math.abs(game.credits.enemy - (1260 - 33 / 3.7)) < 1e-9);

  const playerRepair = game._createBuilding('player', 'turret', 20, 20, 1);
  playerRepair.hp -= 100;
  playerRepair.repairing = true;
  const playerCredits = game.credits.player;
  game._updateBuildings(1);
  assert.equal(playerRepair.hp, playerRepair.maxHp - 67);
  assert.ok(Math.abs(game.credits.player - (playerCredits - 33 / 3.7)) < 1e-9);
});

test('enemy optional purchases respect the reserve while Harvester production uses and releases it', () => {
  const { game } = recoveryState({ credits: 1800 });
  const factory = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
  const previousCredits = game.credits.enemy;

  assert.equal(game._queueUnit('enemy', 'apc').ok, false);
  assert.equal(game.credits.enemy, previousCredits);
  const tech = game._createBuilding('enemy', 'tech', 1, 1, 1);
  tech.powered = true;
  game.commandOwner = 'enemy';
  assert.equal(game.chooseDoctrine('logistics').ok, false);
  assert.equal(game.credits.enemy, previousCredits);
  assert.equal(game._aiBuild('radar'), false);
  assert.equal(game.credits.enemy, previousCredits);

  const queued = game._queueUnit('enemy', 'harvester');
  assert.equal(queued.ok, true);
  assert.equal(game.credits.enemy, previousCredits - UNIT_DEFS.harvester.cost);
  assert.equal(factory.queue.some(item => item.defId === 'harvester'), true);
  assert.equal(game._aiEconomyReserve(), 0);
});

test('full factory queue is preserved until a Harvester slot opens, then AI queues the replacement', () => {
  const { game } = recoveryState({ credits: UNIT_DEFS.harvester.cost });
  const factory = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
  factory.queue = Array.from({ length: 5 }, () => ({ defId: 'rifle', progress: 0 }));
  const originalQueue = structuredClone(factory.queue);

  game._aiTick();
  assert.deepEqual(factory.queue, originalQueue);
  assert.equal(game.credits.enemy, UNIT_DEFS.harvester.cost);
  assert.equal(game._aiEconomyReserve(), UNIT_DEFS.harvester.cost);

  factory.queue.pop();
  game._aiTick();
  assert.equal(factory.queue.length, 5);
  assert.equal(factory.queue.at(-1).defId, 'harvester');
  assert.equal(game.credits.enemy, 0);
  assert.equal(game._aiEconomyReserve(), 0);
});

test('late Siege Director expansion funding cannot block the emergency Harvester replacement', () => {
  function simulate(replayVersion) {
    const { game } = recoveryState({ replayVersion, credits: 1260, aiCommanderProfileId: 'siege-director' });
    game.time = 120;
    game._aiTick();
    const factory = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
    return { game, factory };
  }

  const legacy = simulate(68);
  const current = simulate(69);
  assert.equal(legacy.game._aiExpansionTarget.stage, 'funding');
  assert.equal(legacy.factory.queue.some(item => item.defId === 'harvester'), false);
  assert.equal(current.game._aiExpansionTarget.stage, 'funding');
  assert.equal(current.factory.queue.at(-1).defId, 'harvester');
  assert.equal(current.game.credits.enemy, 10);
  assert.equal(current.game._aiEconomyReserve(), 0);
});

test('full 30 Hz AI rebuilds the lost Harvester under v69 but preserves v68 spending rules', () => {
  function simulate(replayVersion) {
    const { game, tank } = recoveryState({ replayVersion });
    game.units = game.units.filter(unit => unit.owner === 'enemy');
    game.credits.enemy = 1260;
    game._refreshPower();
    const events = [];
    game.onEvent = event => {
      if (event.owner === 'enemy' && ['unitQueued', 'unitReady', 'credits'].includes(event.type))
        events.push({ time: +game.time.toFixed(1), type: event.type, defId: event.defId,
          amount: event.amount, total: event.total });
    };
    for (let frame = 0; frame < 1800 && game.status === 'playing'; frame++) game.update(1 / 30);
    return { game, tank, events };
  }

  const before = simulate(68);
  const after = simulate(69);
  assert.equal(before.events.some(event => event.type === 'unitReady' && event.defId === 'harvester'), false);
  assert.equal(before.game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'harvester').length, 0);
  assert.equal(before.events.some(event => event.type === 'unitQueued' && event.defId === 'apc'), true);

  const replacementQueued = after.events.find(event => event.type === 'unitQueued' && event.defId === 'harvester');
  const replacementReady = after.events.find(event => event.type === 'unitReady' && event.defId === 'harvester');
  const firstDelivery = after.events.find(event => event.type === 'credits');
  assert.equal(replacementQueued?.time, 2);
  assert.equal(replacementReady?.time, 27.9);
  assert.equal(firstDelivery?.time, 51.7);
  assert.equal(firstDelivery?.amount, 699);
  assert.equal(after.game.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'harvester').length, 1);
  assert.ok(after.tank.hp > before.tank.hp, 'the workshop still repairs armor from post-reserve funds');
});

test('unversioned skirmish saves pin to v68, while explicit and non-skirmish saves keep scope', () => {
  const current = new Game({ seed: 2 });
  const serialized = JSON.parse(current.serialize());
  assert.equal(serialized.aiEconomyReserveRulesVersion, AI_ECONOMY_RESERVE_RULES_VERSION);
  assert.equal(Game.deserialize(serialized).replayVersion == null, true);

  delete serialized.aiEconomyReserveRulesVersion;
  assert.equal(Game.deserialize(serialized).replayVersion, 68);

  const explicitLegacy = new Game({ seed: 2, replayVersion: 68 });
  assert.equal(Game.deserialize(explicitLegacy.serialize()).replayVersion, 68);

  for (const mode of ['campaign', 'multiplayer']) {
    const game = new Game({ seed: 2, mode });
    const data = JSON.parse(game.serialize());
    delete data.aiEconomyReserveRulesVersion;
    assert.equal(Game.deserialize(data).replayVersion == null, true);
  }
});
