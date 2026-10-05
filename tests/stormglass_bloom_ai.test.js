import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

function bloomFixture({ replayVersion = null, mode = 'skirmish' } = {}) {
  const game = new Game({ seed: 1750, mode });
  game.replayVersion = replayVersion;
  game.time = 20;
  game.credits.enemy = 1000;
  game.storm.bloom = { x: 50.5, y: 18.5, radius: 3.5, until: 110 };
  for (let y = 15; y <= 22; y++) for (let x = 47; x <= 54; x++) {
    const tile = game.terrain[y][x];
    if (Math.hypot(x + 0.5 - 50.5, y + 0.5 - 18.5) <= 3.5) {
      tile.type = 'crystal'; tile.resource = 800; tile.walkable = true;
    }
  }
  const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
  harvester.x = 50.5; harvester.y = 18.5;
  harvester.order = { type: 'harvest' }; harvester._harvestPhase = 'field';
  harvester._harvestTile = null; harvester.cargo = 0; harvester._stormglassCargo = 0;

  const escort = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'lightTank');
  for (const unit of game.units) if (unit.owner === 'enemy' && unit !== harvester && unit !== escort) unit.hp = 0;
  if (escort) {
    escort.order = { type: 'idle' }; escort._relayAssignment = null;
    escort._aiDefenseTarget = null; escort._aiRaidTarget = null;
    escort._aiRecovering = false; escort._aiRecoverWreck = false;
  }
  for (const relay of game.relays) relay.owner = 'enemy';
  return { game, harvester, escort };
}

test('v50 skirmish AI commits one idle Harvester and a free visible ground escort to the public Bloom', () => {
  const { game, harvester, escort } = bloomFixture();
  game._aiTick();
  assert.equal(harvester.order.aiBloom, true);
  assert.ok(Math.hypot(harvester.order.x + 0.5 - game.storm.bloom.x,
    harvester.order.y + 0.5 - game.storm.bloom.y) <= game.storm.bloom.radius);
  assert.equal(escort.order.type, 'follow');
  assert.equal(escort.order.targetId, harvester.id);
  assert.equal(escort.order.aiBloomEscort, true);

  const committedOrder = { ...harvester.order };
  game._aiTick();
  assert.deepEqual(harvester.order, committedOrder, 'the committed route is stable across policy ticks');
});

test('AI ordered Bloom cargo receives the public premium when delivered', () => {
  const { game, harvester } = bloomFixture();
  game._aiTick();
  const tile = { x: harvester.order.x, y: harvester.order.y };
  harvester.x = tile.x + 0.5; harvester.y = tile.y + 0.5;
  for (let i = 0; i < 10 && harvester._harvestPhase !== 'return'; i++) game._updateHarvester(harvester, 1);
  assert.equal(harvester.cargo, 700);
  assert.equal(harvester._stormglassCargo, 700);

  const refinery = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'refinery');
  harvester.x = refinery.x + refinery.w / 2; harvester.y = refinery.y + refinery.h / 2;
  const uncharged = Game.deserialize(game.serialize());
  const unchargedHarvester = uncharged.getEntity(harvester.id);
  unchargedHarvester._stormglassCargo = 0;
  unchargedHarvester.x = harvester.x; unchargedHarvester.y = harvester.y;
  const creditsBeforeUnload = game.credits.enemy;
  game._updateHarvester(harvester, 5);
  uncharged._updateHarvester(unchargedHarvester, 5);
  assert.equal(game.credits.enemy - uncharged.credits.enemy, 245);
  assert.ok(game.credits.enemy - creditsBeforeUnload >= 945);
  assert.equal(harvester.cargo, 0);
});

test('pre-v50 replays and campaign do not receive Bloom orders', () => {
  const legacy = bloomFixture({ replayVersion: 49 });
  legacy.game._aiTick();
  assert.notEqual(legacy.harvester.order.aiBloom, true);
  assert.notEqual(legacy.escort?.order.aiBloomEscort, true);

  const campaign = bloomFixture({ mode: 'campaign' });
  campaign.game._aiTick();
  assert.notEqual(campaign.harvester.order.aiBloom, true);
});

test('Bloom economy yields when no escort is free and during Dominion pressure', () => {
  const unescorted = bloomFixture();
  unescorted.escort.hp = 0;
  unescorted.game._aiTick();
  assert.notEqual(unescorted.harvester.order.aiBloom, true);

  const urgent = bloomFixture();
  urgent.game.relayDominion.owner = 'player';
  urgent.game.relayDominion.elapsed = 35;
  urgent.game._aiTick();
  assert.notEqual(urgent.harvester.order.aiBloom, true);
});
