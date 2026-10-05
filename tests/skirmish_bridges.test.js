import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

const deltaGame = () => new Game({ seed: 731, difficulty: 'normal', mapId: 'delta-crossing' });
const destroy = (game, bridge) => game._destroyEntity(bridge, null, null);

test('Delta Crossing AI targets a bridge only after seeing a nearby armed approach and keeps its second span open', () => {
  const game = deltaGame();
  const bridge = game.bridges[1];
  const defender = game._createUnit('enemy', 'lightTank', 44.5, 19.5);
  const approach = game._createUnit('player', 'lightTank', 45.5, 24.5);
  assert.equal(game.isVisible(bridge, 'enemy'), true);
  assert.equal(game.isVisible(approach, 'enemy'), true);

  game._aiBridgeTick([defender]);

  assert.equal(defender._aiBridgeTarget, bridge.id);
  assert.deepEqual(defender.order, {
    type: 'attack', targetId: bridge.id, aiBridge: true, aiIntel: true,
    lastX: bridge.x + bridge.w / 2, lastY: bridge.y + bridge.h / 2,
  });
  assert.equal(game.bridges[0].destroyed, false);
});

test('bridge demolition waits for vision and never collapses a span under a player unit', () => {
  const hidden = deltaGame();
  const bridge = hidden.bridges[0];
  const defender = hidden._createUnit('enemy', 'scout', 8.5, 8.5);
  for (const unit of hidden.units) if (unit.owner === 'enemy') { unit.x = 8.5; unit.y = 8.5; }
  hidden._createUnit('player', 'lightTank', 21.5, 25.5);
  for (const relay of hidden.relays) relay.owner = null;
  assert.equal(hidden.isVisible(bridge, 'enemy'), false);
  hidden._aiBridgeTick([defender]);
  assert.equal(defender._aiBridgeTarget, undefined);

  const occupied = deltaGame();
  const occupiedBridge = occupied.bridges[1];
  const nearbyDefender = occupied._createUnit('enemy', 'lightTank', 44.5, 19.5);
  occupied._createUnit('player', 'lightTank', 42.5, 23.5);
  occupied._aiBridgeTick([nearbyDefender]);
  assert.equal(nearbyDefender._aiBridgeTarget, undefined);
});

test('AI bridge denial preserves assigned relay squads and is limited to Delta Crossing skirmishes', () => {
  const game = deltaGame();
  const bridge = game.bridges[1];
  const defender = game._createUnit('enemy', 'lightTank', 44.5, 19.5);
  defender._relayAssignment = game.relays[0].id;
  defender.order = { type: 'guard', relayId: defender._relayAssignment };
  game._createUnit('player', 'lightTank', 45.5, 24.5);
  game._aiBridgeTick([defender]);
  assert.equal(defender.order.type, 'guard');
  assert.equal(defender._aiBridgeTarget, undefined);

  const campaign = new Game({ seed: 731, difficulty: 'normal', mode: 'campaign', mapId: 'delta-crossing' });
  const campaignUnit = campaign._createUnit('enemy', 'lightTank', 44.5, 19.5);
  campaign._createUnit('player', 'lightTank', 45.5, 24.5);
  campaign._aiBridgeTick([campaignUnit]);
  assert.equal(campaignUnit._aiBridgeTarget, undefined);
  assert.equal(campaignUnit.order.type, 'idle');
  assert.ok(campaign.bridges.length === 0, 'campaign setup does not add Delta Crossing bridges');
  assert.equal(game.bridges[1].destroyed, false);
  assert.ok(bridge);
});

test('AI engineers repair a visible destroyed crossing when both spans are down', () => {
  const game = deltaGame();
  for (const bridge of game.bridges) destroy(game, bridge);
  const engineer = game._createUnit('enemy', 'engineer', 18.5, 20.5);
  assert.equal(game.isVisible(game.bridges[0], 'enemy'), true);

  game._aiBridgeTick([]);

  assert.deepEqual(engineer.order, {
    type: 'engineer', targetId: game.bridges[0].id, aiBridgeRepair: true,
  });
});

test('AI does not repair a bridge it cannot see, and saves the bridge order deterministically', () => {
  const game = deltaGame();
  for (const bridge of game.bridges) destroy(game, bridge);
  const engineer = game._createUnit('enemy', 'engineer', 8.5, 8.5);
  for (const unit of game.units) if (unit.owner === 'enemy') { unit.x = 8.5; unit.y = 8.5; }
  for (const relay of game.relays) relay.owner = null;
  game._aiBridgeTick([]);
  assert.equal(engineer.order.type, 'idle');
  assert.equal(game.buildings.flatMap(building => building.queue)
    .some(item => item.defId === 'engineer'), false);

  const visible = deltaGame();
  for (const bridge of visible.bridges) destroy(visible, bridge);
  const nearbyEngineer = visible._createUnit('enemy', 'engineer', 18.5, 20.5);
  visible._aiBridgeTick([]);
  const replay = Game.deserialize(visible.serialize());
  replay._aiBridgeTick([]);
  assert.deepEqual(replay.getEntity(nearbyEngineer.id).order, nearbyEngineer.order);
});

test('AI engineer needs a passable approach to the visible destroyed bridge', () => {
  const game = deltaGame();
  for (const bridge of game.bridges) destroy(game, bridge);
  const engineer = game._createUnit('enemy', 'engineer', 19.5, 20.5);
  const bridge = game.bridges[0];
  for (let y = bridge.y - 1; y <= bridge.y + bridge.h; y++) {
    for (let x = bridge.x - 1; x <= bridge.x + bridge.w; x++) {
      if (x >= bridge.x && x < bridge.x + bridge.w && y >= bridge.y && y < bridge.y + bridge.h) continue;
      const tile = game._tile(x, y);
      if (tile) tile.walkable = false;
    }
  }
  assert.equal(game.isVisible(bridge, 'enemy'), true);

  game._aiBridgeTick([]);

  assert.equal(engineer.order.type, 'idle');
});

test('AI queues one engineer to reopen Delta Crossing when both visible bridges are destroyed', () => {
  const game = deltaGame();
  for (const bridge of game.bridges) destroy(game, bridge);
  game._createUnit('enemy', 'scout', 18.5, 20.5);

  game._aiBridgeTick([]);
  game._aiBridgeTick([]);

  const queued = game.buildings.flatMap(building => building.queue)
    .filter(item => item.defId === 'engineer');
  assert.equal(queued.length, 1);
});
