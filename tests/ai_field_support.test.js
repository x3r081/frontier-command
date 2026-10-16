import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_FIELD_SUPPORT_RULES_VERSION, AI_FIELD_SUPPORT_RESERVE, Game } from '../src/game/engine.js';

function supportGame({ credits = 2000, difficulty = 'normal', replayVersion = AI_FIELD_SUPPORT_RULES_VERSION,
  mode = 'skirmish',
  time = 90, armorCount = 2 } = {}) {
  const game = new Game({ seed: 8801, mode, difficulty, replayVersion });
  game.units = [];
  game.buildings = [];
  game.wrecks = [];
  game.time = time;
  game.credits.enemy = credits;
  game._createBuilding('enemy', 'command', 48, 20, 1);
  game._createBuilding('enemy', 'power', 44, 20, 1);
  const barracks = game._createBuilding('enemy', 'barracks', 44, 25, 1);
  game._createBuilding('enemy', 'serviceBay', 50, 25, 1);
  game._createBuilding('enemy', 'factory', 55, 25, 1);
  for (const building of game.buildings) building.powered = true;
  const armor = [];
  for (let i = 0; i < armorCount; i++) {
    armor.push(game._createUnit('enemy', i % 2 ? 'buggy' : 'lightTank', 48 + i * 1.4, 31));
  }
  return { game, barracks, armor };
}

function updateRefill(game, engineer, seconds) {
  for (let elapsed = 0; elapsed + 0.000001 < seconds; elapsed += 0.1)
    game._updateRepairKitRefill(engineer, Math.min(0.1, seconds - elapsed));
}

test('rules 88 gates Veteran and Elite skirmish support and pins markerless v87 saves', () => {
  assert.equal(AI_FIELD_SUPPORT_RULES_VERSION, 88);
  assert.equal(AI_FIELD_SUPPORT_RESERVE, 1250);
  const normal = supportGame().game;
  assert.equal(normal._aiFieldSupportEnabled(), true);
  assert.equal(supportGame({ difficulty: 'hard' }).game._aiFieldSupportEnabled(), true);
  assert.equal(supportGame({ difficulty: 'easy' }).game._aiFieldSupportEnabled(), false);
  assert.equal(supportGame({ mode: 'campaign' }).game._aiFieldSupportEnabled(), false);
  assert.equal(supportGame({ replayVersion: 87 }).game._aiFieldSupportEnabled(), false);

  const markerless = JSON.parse(normal.serialize());
  markerless.replayVersion = null;
  markerless.engineerEscortRulesVersion = 87;
  delete markerless.aiFieldSupportRulesVersion;
  const restored = Game.deserialize(markerless);
  assert.equal(restored.replayVersion, 87);
  assert.equal(restored._aiFieldSupportEnabled(), false);
});

test('support Engineer is a normal paid Barracks job only after prerequisites and protected reserve', () => {
  const early = supportGame({ time: 74.9, credits: 4000 });
  assert.equal(early.game._aiFieldSupportTick(), false);
  assert.equal(early.barracks.queue.length, 0);

  const shortArmor = supportGame({ credits: 4000, armorCount: 1 });
  assert.equal(shortArmor.game._aiFieldSupportTick(), false);
  assert.equal(shortArmor.barracks.queue.length, 0);

  const tooPoor = supportGame({ credits: AI_FIELD_SUPPORT_RESERVE + 449 });
  assert.equal(tooPoor.game._aiFieldSupportTick(), false);
  assert.equal(tooPoor.barracks.queue.length, 0);

  const protectedRecovery = supportGame({ credits: 0 });
  protectedRecovery.game._createBuilding('enemy', 'refinery', 53, 20, 1);
  const existingReserve = protectedRecovery.game._aiEconomyReserve('enemy');
  assert.ok(existingReserve > 0);
  protectedRecovery.game.credits.enemy = AI_FIELD_SUPPORT_RESERVE + 450 + existingReserve - 1;
  assert.equal(protectedRecovery.game._aiFieldSupportTick(), false,
    'training preserves the existing replacement-Harvester reserve in addition to the support reserve');
  protectedRecovery.game.credits.enemy++;
  assert.equal(protectedRecovery.game._aiFieldSupportTick(), true);
  assert.equal(protectedRecovery.game.credits.enemy, AI_FIELD_SUPPORT_RESERVE + existingReserve);

  const ready = supportGame({ credits: AI_FIELD_SUPPORT_RESERVE + 450 });
  const initialCredits = ready.game.credits.enemy;
  assert.equal(ready.game._aiFieldSupportTick(), true);
  assert.equal(ready.game.credits.enemy, initialCredits - 450);
  assert.equal(ready.game.credits.enemy, AI_FIELD_SUPPORT_RESERVE);
  assert.equal(ready.barracks.queue.length, 1);
  assert.deepEqual({ defId: ready.barracks.queue[0].defId, reserved: ready.barracks.queue[0]._aiFieldSupport },
    { defId: 'engineer', reserved: true });
  assert.equal(ready.game._aiFieldSupportTick(), false);
  assert.equal(ready.barracks.queue.length, 1, 'a reserved training job prevents duplicate purchases');

  const saved = JSON.parse(ready.game.serialize());
  const restored = Game.deserialize(saved);
  const restoredBarracks = restored.buildings.find(building => building.defId === 'barracks');
  assert.equal(restoredBarracks.queue[0]._aiFieldSupport, true);
  const oldSave = structuredClone(saved);
  oldSave.replayVersion = null;
  delete oldSave.aiFieldSupportRulesVersion;
  const oldRestored = Game.deserialize(oldSave);
  assert.equal(oldRestored.replayVersion, 87);
  assert.equal(oldRestored.buildings.find(building => building.defId === 'barracks').queue[0]._aiFieldSupport,
    undefined);
  ready.barracks.queue[0].progress = 1;
  ready.game._updateBuildings(0.1);
  const trained = ready.game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'engineer' &&
    unit._aiFieldSupport === true);
  assert.ok(trained, 'normal Barracks completion transfers support reservation onto the paid Engineer');
  ready.armor[0].hp -= 80;
  assert.equal(ready.game._aiFieldSupportTick(), true);
  assert.equal(trained.order.type, 'follow');
  assert.equal(trained.order.targetId, ready.armor[0].id);

  const investment = supportGame({ credits: 5000, armorCount: 4 });
  const { game: economy } = investment;
  economy.buildings = economy.buildings.filter(building => building.defId !== 'serviceBay');
  economy._createBuilding('enemy', 'refinery', 53, 20, 1);
  for (const [x, y] of [[48, 36], [50, 36]]) {
    const harvester = economy._createUnit('enemy', 'harvester', x, y);
    harvester.order = { type: 'harvest' };
  }
  economy.power.enemy.ratio = 1;
  assert.equal(economy._aiFieldSupportInvestmentSafe(), true,
    'investment starts only with two working Harvesters, four mobile defenders, and core production online');
  economy.credits.enemy = 939;
  assert.equal(economy._aiFieldSupportInvestmentBudget(), 2850);
  assert.equal(economy._aiFieldSupportInvestmentTick(), false,
    'a low-credit economy cannot pause production while it speculatively saves for support');
  assert.equal(economy._aiFieldSupportInvestment, null);
  economy.credits.enemy = 5000;
  assert.equal(economy._aiFieldSupportInvestmentTick(), true);
  const investmentSave = Game.deserialize(JSON.parse(economy.serialize()));
  assert.equal(investmentSave._aiFieldSupportInvestment.startedAt, economy.time,
    'an active investment phase survives save/load');
  assert.equal(economy._aiBuildFieldSupportInvestment(), true,
    'the phase uses the ordinary paid construction path once the full Workshop + Engineer + $1250 budget is available');
  const paidWorkshop = economy.buildings.find(building => building.owner === 'enemy' && building.defId === 'serviceBay');
  assert.ok(paidWorkshop);
  assert.equal(economy.credits.enemy, 3850, 'the normal $1150 Workshop cost is charged');
  paidWorkshop.progress = 1;
  paidWorkshop.powered = true;
  assert.equal(economy._aiFieldSupportTick(), true);
  assert.equal(economy.credits.enemy, 3400, 'the normal $450 Engineer cost is charged after the Workshop completes');
  assert.equal(economy._aiFieldSupportInvestment, null, 'successful training ends the investment phase');

  const interrupted = supportGame({ credits: 5000, armorCount: 4 }).game;
  interrupted.buildings = interrupted.buildings.filter(building => building.defId !== 'serviceBay');
  interrupted._createBuilding('enemy', 'refinery', 53, 20, 1);
  for (const [x, y] of [[48, 36], [50, 36]]) {
    const harvester = interrupted._createUnit('enemy', 'harvester', x, y);
    harvester.order = { type: 'harvest' };
  }
  interrupted.power.enemy.ratio = 1;
  assert.equal(interrupted._aiFieldSupportInvestmentTick(), true);
  interrupted.power.enemy.ratio = 0.5;
  assert.equal(interrupted._aiFieldSupportInvestmentTick(), false,
    'a power emergency cancels the temporary production hold');
  assert.equal(interrupted._aiFieldSupportInvestment, null);
  assert.equal(interrupted._aiFieldSupportInvestmentCooldownUntil, interrupted.time + 90,
    'failed conditions start a bounded cooldown before another attempt');
  const abortedSave = Game.deserialize(JSON.parse(interrupted.serialize()));
  assert.equal(abortedSave._aiFieldSupportInvestment, null);
  assert.equal(abortedSave._aiFieldSupportInvestmentCooldownUntil,
    interrupted._aiFieldSupportInvestmentCooldownUntil, 'the abort cooldown survives save/load');
  interrupted.power.enemy.ratio = 1;
  assert.equal(interrupted._aiFieldSupportInvestmentTick(), false,
    'optional combat production is not held again during the cooldown');
});

test('support policy does not commandeer committed raid or wreck Engineers', () => {
  const { game, barracks } = supportGame({ credits: 2500 });
  const raid = game._createUnit('enemy', 'engineer', 45, 29);
  raid._aiEngineerRaid = { raidId: 'raid1' };
  raid.order = { type: 'engineer', targetId: 'player-building', aiEngineerRaid: 'raid1' };
  const recovery = game._createUnit('enemy', 'engineer', 46, 29);
  recovery._aiWreckRecommission = true;
  recovery.order = { type: 'recommissionWreck', wreckId: 'wreck1' };
  const oldOrders = [structuredClone(raid.order), structuredClone(recovery.order)];

  assert.equal(game._aiFieldSupportTick(), true);
  assert.deepEqual([raid.order, recovery.order], oldOrders);
  assert.equal(raid._aiFieldSupport, undefined);
  assert.equal(recovery._aiFieldSupport, undefined);
  assert.equal(barracks.queue.filter(item => item._aiFieldSupport).length, 1);

  const support = game._createUnit('enemy', 'engineer', 46, 29);
  support._aiFieldSupport = true;
  support.order = { type: 'idle' };
  game.isVisible = () => true;
  game.wrecks.push({ id: 'support-test-wreck', x: 46, y: 29, value: 50, expiresAt: 300 });
  game._aiRecoverWrecks();
  assert.deepEqual(support.order, { type: 'idle' }, 'wreck recovery leaves tagged support available');
  const wreckWorker = game._createUnit('enemy', 'engineer', 47, 29);
  game._aiRecoverWrecks();
  assert.deepEqual(wreckWorker.order, { type: 'recoverWreck', wreckId: 'support-test-wreck' },
    'wreck recovery still accepts an ordinary idle Engineer');

  const target = game._createBuilding('player', 'power', 40, 20, 1);
  target.hp = target.maxHp * 0.7;
  game.credits.enemy = 2500;
  assert.equal(game._aiEngineerRaidTargetValid(target), true);
  game._aiEngineerCaptureRaidTick({ protectedEconomy: false, combatUnits: [] });
  assert.equal(game._aiEngineerRaidState.active, null,
    'an idle tagged support Engineer cannot be assigned to a capture raid');
  assert.deepEqual(support.order, { type: 'idle' }, 'capture raids leave tagged support available');

  const bridgeGame = new Game({ seed: 8802, mapId: 'delta-crossing', difficulty: 'normal', replayVersion: 88 });
  bridgeGame.units = [];
  const bridgeSupport = bridgeGame._createUnit('enemy', 'engineer', 30.5, 18.5);
  bridgeSupport._aiFieldSupport = true;
  const bridgeWorker = bridgeGame._createUnit('enemy', 'engineer', 31.5, 18.5);
  for (const bridge of bridgeGame.bridges) {
    bridgeGame._applyDamage(bridge, bridge.maxHp, 'ion', 'player');
  }
  bridgeGame.isVisible = () => true;
  bridgeGame.credits.enemy = 0;
  bridgeGame._aiBridgeTick([]);
  assert.deepEqual(bridgeSupport.order, { type: 'idle' }, 'bridge repair leaves tagged support available');
  assert.equal(bridgeWorker.order.type, 'engineer', 'the same bridge repair still admits an ordinary Engineer');
});

test('trained support Engineer picks and retains an injured vehicle, applies real Follow kits, and keeps working if prerequisites later fall', () => {
  const { game, armor } = supportGame();
  const engineer = game._createUnit('enemy', 'engineer', 49, 31);
  engineer._aiFieldSupport = true;
  armor[0].hp -= 190;
  armor[1].hp -= 190;

  assert.equal(game._aiFieldSupportTick(), true);
  assert.deepEqual(engineer.order, { type: 'follow', targetId: armor[1].id },
    'support picks the nearby vehicle with the largest missing-health fraction');
  armor[0].hp -= 120;
  assert.equal(game._aiFieldSupportTick(), true);
  assert.equal(engineer.order.targetId, armor[1].id, 'a newly more damaged patient does not restart an active channel');
  for (let i = 0; i < 51; i++) game._updateUnit(engineer, 0.1);
  assert.equal(armor[1].hp, armor[1].maxHp - 70);
  assert.equal(engineer.fieldRepairKits, 1);

  game.buildings = game.buildings.filter(building => building.defId !== 'barracks');
  armor[1].hp -= 80;
  assert.equal(game._aiFieldSupportTick(), true, 'an existing support Engineer still tends vehicles if Barracks is lost');
  assert.deepEqual(engineer.order, { type: 'follow', targetId: armor[1].id });
});

test('refill uses normal $80 kit charges and pauses each debit below the protected reserve', () => {
  const { game, armor } = supportGame({ credits: AI_FIELD_SUPPORT_RESERVE + 160 });
  const engineer = game._createUnit('enemy', 'engineer', 51.5, 28.5);
  engineer._aiFieldSupport = true;
  engineer.fieldRepairKits = 0;
  armor[0].hp -= 50;

  assert.equal(game._aiFieldSupportTick(), true);
  assert.equal(engineer.order.type, 'refillRepairKits');
  assert.equal(engineer._fieldRepairWaiting, null);
  updateRefill(game, engineer, 8.1);
  assert.equal(engineer.fieldRepairKits, 1);
  assert.equal(game.credits.enemy, AI_FIELD_SUPPORT_RESERVE + 80);
  assert.equal(game._aiFieldSupportTick(), true, 'support keeps the ordinary refill order active for its second kit');
  assert.equal(engineer.order.type, 'refillRepairKits');

  game.credits.enemy = AI_FIELD_SUPPORT_RESERVE + 79;
  updateRefill(game, engineer, 8.1);
  assert.equal(engineer.fieldRepairKits, 1, 'the support Engineer cannot spend below its reserve');
  assert.equal(engineer._fieldRepairWaiting, 'credits');
  game.credits.enemy = AI_FIELD_SUPPORT_RESERVE + 80;
  updateRefill(game, engineer, 8.1);
  assert.equal(engineer.fieldRepairKits, 2);
  assert.equal(game.credits.enemy, AI_FIELD_SUPPORT_RESERVE);
  assert.deepEqual(engineer.order, { type: 'idle' });

  assert.equal(game._aiFieldSupportTick(), true);
  assert.deepEqual(engineer.order, { type: 'follow', targetId: armor[0].id });
});
