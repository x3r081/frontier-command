import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { CAMPAIGN_MISSIONS, COUNTERBATTERY_RULES_VERSION, createCampaignGame,
  getCounterbatteryView, updateCampaign } from '../src/game/campaign.js';

function mission(seed = 84016) {
  return createCampaignGame(16, 'normal', seed);
}

function advanceCampaign(game, seconds, step = 0.5) {
  const count = Math.ceil(seconds / step);
  for (let i = 0; i < count; i++) updateCampaign(game, 16, Math.min(step, seconds - i * step));
}

test('Counterbattery appends at index 16 and requires rules 84 without changing prior missions', () => {
  assert.equal(CAMPAIGN_MISSIONS[15].id, 'iron-reclaimed');
  assert.equal(CAMPAIGN_MISSIONS[16].id, 'counterbattery');
  assert.equal(COUNTERBATTERY_RULES_VERSION, 84);
  assert.throws(() => createCampaignGame(16, 'normal', 84016, 'standard', 'none', 'none', 'none', 'none', null, 83),
    /Counterbattery requires replay rules version 84/i);

  const game = mission();
  assert.equal(game.campaignState.counterbatteryRulesVersion, 84);
  assert.equal(game.campaignState.deadline, 210);
  assert.equal(game.campaignState.crawlerIds.length, 2);
  const crawlers = game.campaignState.crawlerIds.map(id => game.getEntity(id));
  assert.deepEqual(crawlers.map(unit => unit.defId), ['artillery', 'artillery']);
  assert.deepEqual(crawlers.map(unit => [unit.x, unit.y]), [[46.5, 18.5], [47, 35.5]]);
  assert.deepEqual(game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'turret')
    .map(building => [building.x, building.y]), [[37, 23], [37, 29]]);
  assert.deepEqual(game.campaignState.crawlerSites, [{ x: 46.5, y: 18.5 }, { x: 47, y: 35.5 }]);
  assert.deepEqual(crawlers.map(unit => unit.order.targetId), [
    game.campaignState.forwardRadarId, game.campaignState.forwardRefineryId,
  ]);

  for (const crawler of crawlers) {
    const target = game.getEntity(crawler.order.targetId);
    const weapon = game.unitDefs[crawler.defId].weapon;
    const center = game._entityCenter(target);
    assert.ok(game._distanceToEntity(crawler.x, crawler.y, target) <= weapon.range,
      'the authored target starts within actual artillery range');
    assert.equal(game._hasLineOfSight(crawler.x, crawler.y, center.x, center.y), true,
      'the authored target starts through an open pass');
    crawler.cooldown = 0;
    game._updateUnit(crawler, 0.1);
    assert.ok(game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === crawler.id &&
      effect.targetId === target.id), 'each crawler can fire its assigned opening shot');
  }
  const hiddenSouth = crawlers[1];
  hiddenSouth.x = 51; hiddenSouth.y = 40;
  const objective = getCounterbatteryView(game);
  assert.equal(objective.total, 2);
  assert.equal(objective.remainingSeconds, 210);
  assert.equal(objective.targets[1].visible, false);
  assert.equal(objective.targets[1].hpPercent, null);
  assert.deepEqual([objective.targets[1].x, objective.targets[1].y], [47, 35.5],
    'the objective view keeps the public starting marker while the crawler is hidden');

  const legacyState = mission(84017);
  delete legacyState.campaignState.counterbatteryRulesVersion;
  updateCampaign(legacyState, 16, 1, null);
  assert.equal(legacyState.campaignState.elapsed, 0, 'markerless new-mission state cannot activate current rules');
});

test('both named Siege Crawlers must be destroyed and the Command Yard must remain', () => {
  const game = mission();
  const [firstId, secondId] = game.campaignState.crawlerIds;
  game.getEntity(firstId).hp = 0;
  assert.equal(updateCampaign(game, 16, 0.1), false);
  assert.equal(game.status, 'playing');

  game.getEntity(secondId).hp = 0;
  assert.equal(updateCampaign(game, 16, 0.1), true);
  assert.equal(game.status, 'victory');
  assert.equal(game.campaignComplete, true);

  const yardLoss = mission(84018);
  yardLoss.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  assert.equal(updateCampaign(yardLoss, 16, 0.1), false);
  assert.equal(yardLoss.status, 'defeat');
  assert.match(yardLoss.events.findLast(event => event.type === 'defeat').reason, /Command Yard was destroyed/i);
});

test('Cut the Siege Supply requires a direct attack order before destroying the marked Harvester', () => {
  const ordered = createCampaignGame(16, 'normal', 84022, 'standard', 'counterbattery-intercept');
  const target = ordered.getEntity(ordered.campaignState.fieldOrderTargetId);
  assert.equal(target.defId, 'harvester');
  const attacker = ordered.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  target.x = attacker.x + 1;
  target.y = attacker.y;
  ordered._updateFog();
  const credits = ordered.credits.player;
  ordered.select([attacker.id]);
  assert.equal(ordered.issueAttack(target.id).ok, true);
  assert.equal(ordered.campaignState.fieldOrderEngaged, true);
  target.hp = 0;
  updateCampaign(ordered, 16, 0.1);
  assert.equal(ordered.campaignState.fieldOrderStatus, 'completed');
  assert.equal(ordered.credits.player, credits + 650);

  const noOrder = createCampaignGame(16, 'normal', 84023, 'standard', 'counterbattery-intercept');
  noOrder.getEntity(noOrder.campaignState.fieldOrderTargetId).hp = 0;
  const noOrderCredits = noOrder.credits.player;
  updateCampaign(noOrder, 16, 0.1);
  assert.equal(noOrder.campaignState.fieldOrderEngaged, false);
  assert.equal(noOrder.campaignState.fieldOrderStatus, 'active');
  assert.equal(noOrder.credits.player, noOrderCredits, 'an uncommanded kill earns no Field Order reward');
});

test('the 210-second deadline defeats the operation while a crawler remains', () => {
  const game = mission(84019);
  game.campaignState.elapsed = 209.95;
  assert.equal(updateCampaign(game, 16, 0.1), false);
  assert.equal(game.status, 'defeat');
  assert.match(game.events.findLast(event => event.type === 'defeat').reason, /barrage/i);
});

test('a zero-order operation loses at the 210-second deadline', () => {
  const game = mission(84024);
  for (let elapsed = 0; elapsed < 210 && game.status === 'playing'; elapsed += 0.25) {
    game.update(0.25);
    updateCampaign(game, 16, 0.25);
  }
  assert.equal(game.status, 'defeat');
  assert.equal(game.campaignState.elapsed, 210);
  assert.match(game.events.findLast(event => event.type === 'defeat').reason, /barrage/i);
});

test('both warned reinforcement waves survive save/load and fire only once', () => {
  let game = mission(84020);
  game.campaignState.elapsed = 34.9;
  updateCampaign(game, 16, 0.1);
  assert.equal(game.campaignState.waves[0].warned, true);
  assert.equal(game.campaignState.waves[0].fired, false);
  assert.equal(game.events.filter(event => event.type === 'campaignThreatWarning').length, 1);

  game = Game.deserialize(game.serialize());
  advanceCampaign(game, 5);
  assert.equal(game.campaignState.waves[0].fired, true);
  assert.equal(game.campaignState.waveUnitIds.length, 2);
  assert.equal(game.events.filter(event => event.type === 'campaignReinforcement').length, 1);
  advanceCampaign(game, 3);
  assert.equal(game.campaignState.waveUnitIds.length, 2, 'first wave does not duplicate');

  game.campaignState.elapsed = 84.9;
  updateCampaign(game, 16, 0.1);
  assert.equal(game.campaignState.waves[1].warned, true);
  game = Game.deserialize(game.serialize());
  advanceCampaign(game, 5);
  assert.equal(game.campaignState.waves[1].fired, true);
  assert.equal(game.campaignState.waveUnitIds.length, 4);
  assert.equal(game.events.filter(event => event.type === 'campaignThreatWarning').length, 2);
  assert.equal(game.events.filter(event => event.type === 'campaignReinforcement').length, 2);
  advanceCampaign(game, 3);
  assert.equal(game.campaignState.waveUnitIds.length, 4, 'second wave does not duplicate after reload');
});
