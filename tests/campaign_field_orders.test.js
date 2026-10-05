import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS, createCampaignGame,
  getCampaignFieldOrderView, getCampaignResult, updateCampaign } from '../src/game/campaign.js';

function clearFirstHarvestRaid(game) {
  game.campaignState.elapsed = 19;
  assert.equal(updateCampaign(game, 0, 0), false, 'the economy alone cannot finish v54');
  assert.notEqual(game.campaignState.firstHarvestRaidTargetId, game.campaignState.fieldOrderTargetId,
    'the southern raid lead remains separate from the eastern Field Order target');
  for (const id of game.campaignState.firstHarvestRaidUnitIds) game.getEntity(id).hp = 0;
}

test('all 30 authored orders are frozen, distinct, and inactive at mission start', () => {
  assert.equal(CAMPAIGN_FIELD_ORDERS.length, CAMPAIGN_MISSIONS.length);
  assert.ok(Object.isFrozen(CAMPAIGN_FIELD_ORDERS));
  const ids = new Set();
  for (let index = 0; index < CAMPAIGN_MISSIONS.length; index++) {
    assert.equal(CAMPAIGN_FIELD_ORDERS[index].length, 2);
    assert.ok(Object.isFrozen(CAMPAIGN_FIELD_ORDERS[index]));
    for (const order of CAMPAIGN_FIELD_ORDERS[index]) {
      assert.ok(Object.isFrozen(order));
      assert.deepEqual(Object.keys(order), ['id', 'title', 'objective', 'rewardText']);
      assert.ok(!ids.has(order.id));
      ids.add(order.id);
      const game = createCampaignGame(index, 'normal', 1000 + index, 'standard', order.id);
      assert.equal(game.campaignFieldOrderId, order.id);
      assert.equal(game.campaignState.fieldOrderStatus, 'active');
      assert.equal(getCampaignFieldOrderView(game).status, 'active');
      if (index === 8 && order.id.endsWith('-signal')) {
        assert.equal(getCampaignFieldOrderView(game).target, null);
      } else {
        assert.ok(Number.isFinite(getCampaignFieldOrderView(game).target?.x));
        assert.ok(Number.isFinite(getCampaignFieldOrderView(game).target?.y));
      }
      updateCampaign(game, index, 0);
      assert.equal(game.campaignState.fieldOrderStatus, 'active');
    }
  }
  assert.equal(ids.size, 30);
});

test('orders are validated against their own mission and none is supported', () => {
  assert.equal(getCampaignFieldOrderView(createCampaignGame(0)), null);
  assert.throws(() => createCampaignGame(0, 'normal', 1, 'standard', CAMPAIGN_FIELD_ORDERS[1][0].id), RangeError);
  assert.throws(() => createCampaignGame(0, 'normal', 1, 'standard', 'made-up'), RangeError);
  assert.equal(getCampaignFieldOrderView(new Game({ seed: 1 })), null);
});

test('intercept rewards once, survives save and load, and is included in result', () => {
  const index = 0;
  const order = CAMPAIGN_FIELD_ORDERS[index][0];
  let game = createCampaignGame(index, 'normal', 41, 'standard', order.id);
  game = Game.deserialize(game.serialize());
  assert.equal(getCampaignFieldOrderView(game).id, order.id);
  const credits = game.credits.player;
  const target = game.getEntity(game.campaignState.fieldOrderTargetId);
  assert.equal(target.owner, 'enemy');
  target.x = 21.5; target.y = 37.5;
  game._updateFog();
  const attacker = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  game.select([attacker.id]);
  assert.equal(game.issueAttack(target.id).ok, true);
  assert.equal(game.campaignState.fieldOrderEngaged, true);
  game = Game.deserialize(game.serialize());
  assert.equal(game.campaignState.fieldOrderEngaged, true);
  game.getEntity(target.id).hp = 0;
  updateCampaign(game, index, 0.1);
  assert.equal(game.credits.player, credits + 650);
  assert.equal(getCampaignFieldOrderView(game).status, 'completed');
  assert.equal(game.events.filter(event => event.type === 'campaignIntel' && event.fieldOrderId === order.id).length, 1);
  game = Game.deserialize(game.serialize());
  updateCampaign(game, index, 0.1);
  assert.equal(game.credits.player, credits + 650);
  game._createBuilding('player', 'refinery', 20, 29, 1);
  game.credits.player = 2200;
  clearFirstHarvestRaid(game);
  assert.equal(updateCampaign(game, index, 0.1), true);
  assert.deepEqual([getCampaignResult(game).fieldOrderId, getCampaignResult(game).fieldOrderStatus],
    [order.id, 'completed']);
});

test('relay order requires the named relay and grants its one-shot supply cache', () => {
  const index = 2;
  const order = CAMPAIGN_FIELD_ORDERS[index][1];
  const game = createCampaignGame(index, 'normal', 42, 'standard', order.id);
  const credits = game.credits.player;
  game.relays[1].owner = 'player';
  updateCampaign(game, index, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'active');
  game.relays[0].owner = 'player';
  updateCampaign(game, index, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.equal(game.credits.player, credits + 650);
  updateCampaign(game, index, 0);
  assert.equal(game.credits.player, credits + 650);
});

test('fixed-force detour refits surviving units and only fires once', () => {
  const index = 12;
  const order = CAMPAIGN_FIELD_ORDERS[index][1];
  const game = createCampaignGame(index, 'normal', 43, 'standard', order.id);
  const dropship = game.units.find(unit => unit.owner === 'player' && unit.defId === 'dropship');
  const engineer = game.getEntity(game.campaignState.engineerId);
  const initialMax = engineer.maxHp;
  engineer.hp = initialMax / 2;
  const waypoint = getCampaignFieldOrderView(game).target;
  const relay = game.relays[2];
  dropship.x = relay.x; dropship.y = relay.y;
  updateCampaign(game, index, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'active');
  dropship.x = waypoint.x; dropship.y = waypoint.y;
  updateCampaign(game, index, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.equal(engineer.maxHp, Math.round(initialMax * 1.25));
  assert.ok(engineer.hp > initialMax / 2);
  const hp = engineer.hp;
  updateCampaign(game, index, 0);
  assert.equal(engineer.hp, hp);
});

test('Mission 10 intercept targets an off-path tank and requires a successful direct attack', () => {
  const index = 9;
  const order = CAMPAIGN_FIELD_ORDERS[index][0];
  const game = createCampaignGame(index, 'normal', 51, 'standard', order.id);
  const target = game.getEntity(game.campaignState.fieldOrderTargetId);
  assert.equal(target.defId, 'lightTank');
  assert.notEqual(target.id, game.campaignState.targetId);
  target.x = 24.5; target.y = 33.5;
  game._updateFog();
  const attacker = game.units.find(unit => unit.owner === 'player' && unit.defId === 'stealthTank');
  game.select([attacker.id]);
  assert.equal(game.issueAttack(target.id).ok, true);
  target.hp = 0;
  updateCampaign(game, index, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.equal(game.status, 'playing');
});

test('Mission 2 intercept marks the enemy harvester beyond the radar objective', () => {
  const game = createCampaignGame(1, 'normal', 54, 'standard', CAMPAIGN_FIELD_ORDERS[1][0].id);
  const target = game.getEntity(game.campaignState.fieldOrderTargetId);
  assert.equal(target.defId, 'harvester');
  assert.ok(target.x > game.getEntity(game.campaignState.targetId).x);
});

test('Mission 9 sweep requires all three relays held for ten seconds', () => {
  const index = 8;
  const order = CAMPAIGN_FIELD_ORDERS[index][1];
  const game = createCampaignGame(index, 'easy', 52, 'standard', order.id);
  // Mission 9's primary objective ends play after holding two relays for 25s.
  // Start the third relay held so this field-order timer can be exercised
  // while public move orders secure the two relays in the authored opening.
  game.relays[2].owner = 'player';
  const units = [
    game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle'),
    game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank'),
  ];
  for (let i = 0; i < units.length; i++) {
    game.select([units[i].id]);
    assert.equal(game.issueMove(game.relays[i].x, game.relays[i].y).ok, true);
  }
  for (let i = 0; i < 75 && game.campaignState.fieldOrderStatus === 'active'; i++) {
    game.update(1);
    updateCampaign(game, index, 1);
  }
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.ok(game.relays.every(relay => relay.owner === 'player'));
  assert.ok(game.campaignState.fieldOrderHoldElapsed >= 10);
});

test('Mission 13 southeast waypoint is separate from the landing relay and reachable by move order', () => {
  const index = 12;
  const game = createCampaignGame(index, 'normal', 53, 'standard', CAMPAIGN_FIELD_ORDERS[index][1].id);
  const waypoint = getCampaignFieldOrderView(game).target;
  assert.ok(Math.hypot(waypoint.x - game.relays[2].x, waypoint.y - game.relays[2].y) > 4);
  const dropship = game.units.find(unit => unit.owner === 'player' && unit.defId === 'dropship');
  game.select([dropship.id]);
  assert.equal(game.issueMove(waypoint.x, waypoint.y).ok, true);
  for (let i = 0; i < 100 && game.campaignState.fieldOrderStatus === 'active'; i++) {
    game.update(0.5);
    updateCampaign(game, index, 0.5);
  }
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.equal(game.campaignState.phase, 'secure-landing');
});

test('branch intercepts mark present escorts and their signal detours use different relays', () => {
  for (const [index, expectedDef] of [[13, 'buggy'], [14, 'lightTank']]) {
    const intercept = CAMPAIGN_FIELD_ORDERS[index][0];
    const game = createCampaignGame(index, 'normal', 200 + index, 'standard', intercept.id);
    const target = game.getEntity(game.campaignState.fieldOrderTargetId);
    assert.equal(target.defId, expectedDef);
    assert.equal(target.owner, 'enemy');
    assert.deepEqual(getCampaignFieldOrderView(game).target, { x: target.x, y: target.y });
    const signal = createCampaignGame(index, 'normal', 200 + index, 'standard', CAMPAIGN_FIELD_ORDERS[index][1].id);
    assert.deepEqual(getCampaignFieldOrderView(signal).target,
      { x: signal.relays[1].x, y: signal.relays[1].y });
  }
});

test('Ghost Channel signal detour refits its fixed force instead of granting unusable credits', () => {
  const game = createCampaignGame(13, 'normal', 313, 'standard', CAMPAIGN_FIELD_ORDERS[13][1].id);
  const engineer = game.getEntity(game.campaignState.engineerId);
  const oldMax = engineer.maxHp;
  const credits = game.credits.player;
  game.relays[1].owner = 'player';
  updateCampaign(game, 13, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'completed');
  assert.equal(engineer.maxHp, Math.round(oldMax * 1.25));
  assert.equal(game.credits.player, credits);
  updateCampaign(game, 13, 0);
  assert.equal(engineer.maxHp, Math.round(oldMax * 1.25));
});

test('idle simulation cannot earn intercept rewards from automatic combat', () => {
  for (const index of [0, 2, 5, 7, 8]) {
    const game = createCampaignGame(index, 'normal', 80217 + index * 9721,
      'standard', CAMPAIGN_FIELD_ORDERS[index][0].id);
    const credits = game.credits.player;
    for (let i = 0; i < 100 && game.status === 'playing'; i++) {
      game.update(1);
      updateCampaign(game, index, 1);
    }
    assert.notEqual(game.campaignState.fieldOrderStatus, 'completed', `mission ${index + 1}`);
    assert.equal(game.campaignState.fieldOrderEngaged, false, `mission ${index + 1}`);
    assert.equal(game.events.some(event => event.type === 'campaignIntel' && event.fieldOrderId), false);
    assert.ok(game.credits.player >= 0 && Number.isFinite(credits));
  }
});

test('a destroyed target cannot be marked by a retroactive attack order', () => {
  const game = createCampaignGame(0, 'normal', 55, 'standard', CAMPAIGN_FIELD_ORDERS[0][0].id);
  const target = game.getEntity(game.campaignState.fieldOrderTargetId);
  target.x = 21.5; target.y = 37.5;
  target.hp = 0;
  game._updateFog();
  const attacker = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  game.select([attacker.id]);
  assert.equal(game.issueAttack(target.id).ok, false);
  updateCampaign(game, 0, 0);
  assert.equal(game.campaignState.fieldOrderStatus, 'active');
  assert.equal(game.campaignState.fieldOrderEngaged, false);
});

test('legacy saves with no field-order fields remain valid', () => {
  const data = JSON.parse(createCampaignGame(0, 'normal', 44).serialize());
  delete data.campaignFieldOrderId;
  delete data.campaignState.fieldOrderStatus;
  const game = Game.deserialize(data);
  assert.equal(getCampaignFieldOrderView(game), null);
  updateCampaign(game, 0, 0.1);
  assert.equal(getCampaignFieldOrderView(game), null);
});

test('unfulfilled order is failed at victory and a lost mission fails its active order', () => {
  const order = CAMPAIGN_FIELD_ORDERS[0][0];
  const game = createCampaignGame(0, 'normal', 45, 'standard', order.id);
  game._createBuilding('player', 'refinery', 20, 29, 1);
  game.credits.player = 2200;
  clearFirstHarvestRaid(game);
  assert.equal(updateCampaign(game, 0, 0), true);
  assert.equal(game.campaignState.fieldOrderStatus, 'failed');
  assert.equal(getCampaignResult(game).fieldOrderStatus, 'failed');

  const lost = createCampaignGame(2, 'normal', 46, 'standard', CAMPAIGN_FIELD_ORDERS[2][1].id);
  lost.buildings.find(building => building.owner === 'player' && building.defId === 'command').hp = 0;
  updateCampaign(lost, 2, 0);
  assert.equal(lost.status, 'defeat');
  assert.equal(lost.campaignState.fieldOrderStatus, 'failed');
});
