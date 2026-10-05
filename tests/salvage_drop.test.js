import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SALVAGE_DROP_CAPTURE_SECONDS, SALVAGE_DROP_CREDIT_REWARD,
  SALVAGE_DROP_ENERGY_REWARD, SALVAGE_DROP_RULES_VERSION } from '../src/game/engine.js';

const MAPS = ['shard-valley', 'twin-passes', 'delta-crossing', 'canyon-ring', 'storm-basin'];

function warn(game) {
  game.time = 75;
  game._updateSalvageDrop(0.1);
  return game.salvageDrop;
}

function activeDrop(game) {
  const drop = warn(game);
  drop.phase = 'active';
  return drop;
}

function capture(game, owner, seconds = SALVAGE_DROP_CAPTURE_SECONDS) {
  const drop = game.salvageDrop;
  const unit = game._createUnit(owner, 'rifle', drop.x, drop.y);
  for (let elapsed = 0; elapsed < seconds - 1e-7; elapsed += 0.1) {
    game.time += 0.1;
    game._updateSalvageDrop(0.1);
  }
  return unit;
}

test('one deterministic public drop lands at passable sites reachable on every skirmish map', () => {
  for (const mapId of MAPS) {
    const first = new Game({ mapId, seed: 4312 });
    const second = new Game({ mapId, seed: 4312 });
    const drop = warn(first);
    warn(second);
    assert.deepEqual(drop, second.salvageDrop, `${mapId} uses deterministic coordinates`);
    assert.equal(drop.phase, 'incoming');
    assert.equal(drop.landsAt, 87);
    assert.equal(drop.expiresAt, 177);
    assert.equal(first._isPassable(Math.floor(drop.x), Math.floor(drop.y)), true, `${mapId} site is passable`);
    assert.equal(first.units.some(unit => unit.hp > 0 && !unit.embarkedIn &&
      Math.hypot(unit.x - drop.x, unit.y - drop.y) < 1.35), false, `${mapId} site is unoccupied`);
    for (const owner of ['player', 'enemy']) {
      const unit = first.units.find(candidate => candidate.owner === owner && first.unitDefs[candidate.defId].weapon);
      assert.ok(first._findPath(unit.x, unit.y, drop.x, drop.y).length > 0, `${mapId} reachable from ${owner} start`);
    }
    first.time = 87;
    first._updateSalvageDrop(0.1);
    assert.equal(first.salvageDrop.phase, 'active');
    assert.equal(first.events.filter(event => event.type === 'salvageDropIncoming').length, 1);
  }
});

test('maps without armed ground starts still choose a deterministic passable unoccupied fallback', () => {
  for (const mapId of MAPS) {
    const game = new Game({ mapId, seed: 90210 });
    game.units = game.units.filter(unit => !game.unitDefs[unit.defId]?.weapon);
    const first = game._chooseSalvageDropSite();
    const second = game._chooseSalvageDropSite();
    assert.deepEqual(first, second, `${mapId} fallback is deterministic`);
    assert.ok(first, `${mapId} has a fallback candidate`);
    assert.equal(game._isPassable(Math.floor(first.x), Math.floor(first.y)), true, `${mapId} fallback is passable`);
    assert.equal(game.units.some(unit => unit.hp > 0 && !unit.embarkedIn &&
      Math.hypot(unit.x - first.x, unit.y - first.y) < 1.35), false, `${mapId} fallback is unoccupied`);
  }
});

test('contested presence pauses capture and a completed claim pays bounded credits and energy', () => {
  const game = new Game({ seed: 33 });
  const drop = activeDrop(game);
  game.units = [];
  game.credits.player = game.creditCapacity.player - 100;
  game.commandEnergy.player = 90;
  const player = game._createUnit('player', 'rifle', drop.x, drop.y);
  for (let i = 0; i < 20; i++) { game.time += 0.1; game._updateSalvageDrop(0.1); }
  assert.ok(Math.abs(drop.captureProgress - 2) < 1e-9);
  const enemy = game._createUnit('enemy', 'buggy', drop.x + 0.3, drop.y);
  for (let i = 0; i < 10; i++) { game.time += 0.1; game._updateSalvageDrop(0.1); }
  assert.ok(Math.abs(drop.captureProgress - 2) < 1e-9, 'opposing armed presence pauses the channel');
  assert.equal(drop.contested, true);
  game.units = [player];
  game.time += 0.1; game._updateSalvageDrop(0.1);
  assert.equal(drop.contested, false, 'contest clears when one side leaves the capture radius');
  for (let i = 0; i < 29; i++) { game.time += 0.1; game._updateSalvageDrop(0.1); }
  assert.equal(drop.phase, 'claimed');
  assert.equal(drop.claimedBy, 'player');
  assert.equal(drop.contested, false, 'terminal state is never contested');
  assert.equal(game.credits.player, game.creditCapacity.player);
  assert.equal(game.events.at(-1).credits, 100);
  assert.equal(game.commandEnergy.player, 100);
  assert.equal(game.events.at(-1).commandEnergy, 10);
  assert.match(game.events.at(-1).message, /Your forces/);
  assert.equal(SALVAGE_DROP_CREDIT_REWARD, 450);
  assert.equal(SALVAGE_DROP_ENERGY_REWARD, 20);
  assert.equal(enemy.hp > 0, true);
});

test('save/load preserves the drop channel; pre-v38 saves, old replays, and campaigns stay gated', () => {
  const current = new Game({ seed: 91 });
  const drop = activeDrop(current);
  current.units = [];
  const capturingPlayer = current._createUnit('player', 'rifle', drop.x, drop.y);
  for (let i = 0; i < 14; i++) { current.time += 0.1; current._updateSalvageDrop(0.1); }
  current._createUnit('enemy', 'buggy', drop.x + 0.2, drop.y);
  current.time += 0.1; current._updateSalvageDrop(0.1);
  assert.equal(drop.contested, true);
  const restored = Game.deserialize(current.serialize());
  assert.deepEqual(restored.salvageDrop, current.salvageDrop);
  assert.equal(restored.salvageDropRulesVersion, SALVAGE_DROP_RULES_VERSION);
  restored.units = [restored.getEntity(capturingPlayer.id)];
  for (let i = 0; i < 36; i++) { restored.time += 0.1; restored._updateSalvageDrop(0.1); }
  assert.equal(restored.salvageDrop.phase, 'claimed');

  const legacyData = JSON.parse(current.serialize());
  delete legacyData.salvageDropRulesVersion;
  delete legacyData.salvageDrop;
  const legacy = Game.deserialize(legacyData);
  assert.equal(legacy.replayVersion, 37);
  legacy.time = 75; legacy._updateSalvageDrop(0.1);
  assert.equal(legacy.salvageDrop, null);
  const oldReplay = new Game({ seed: 91 });
  oldReplay.replayVersion = 37;
  oldReplay.time = 75; oldReplay._updateSalvageDrop(0.1);
  assert.equal(oldReplay.salvageDrop, null);
  const campaign = new Game({ mode: 'campaign', seed: 91 });
  campaign.time = 75; campaign._updateSalvageDrop(0.1);
  assert.equal(campaign.salvageDrop, null);
});

test('solo AI commits at most one reachable available unit and restores its order when cache ends', () => {
  const game = new Game({ seed: 12 });
  const drop = activeDrop(game);
  const first = game._createUnit('enemy', 'rifle', drop.x - 2, drop.y);
  first.order = { type: 'move', x: drop.x - 4, y: drop.y };
  const second = game._createUnit('enemy', 'lightTank', drop.x - 3, drop.y);
  game._aiSalvageDrop();
  assert.equal(first.order.aiSalvageDrop, true);
  assert.equal(first._aiSalvageDropOrder.type, 'move');
  assert.equal(second._aiSalvageDropOrder, undefined, 'a second unit is not dispatched');
  second._aiDefenseTarget = 'enemy-command';
  game._aiSalvageDrop();
  assert.deepEqual(first.order, { type: 'move', x: drop.x - 4, y: drop.y },
    'urgent defense restores the prior order of an already assigned unit');
  assert.equal(first._aiSalvageDropOrder, null);
  assert.equal(second._aiSalvageDropOrder, undefined);
  second._aiDefenseTarget = null;
  game._aiSalvageDrop();
  assert.equal(first.order.aiSalvageDrop, true);
  game.relayDominion.owner = 'player';
  game._aiSalvageDrop();
  assert.deepEqual(first.order, { type: 'move', x: drop.x - 4, y: drop.y },
    'a player Dominion response also restores the previous order');
  game.relayDominion.owner = null;
  game._aiSalvageDrop();
  drop.phase = 'expired';
  game._aiSalvageDrop();
  assert.deepEqual(first.order, { type: 'move', x: drop.x - 4, y: drop.y });
  assert.equal(first._aiSalvageDropOrder, null);

  const defending = game._createUnit('enemy', 'rifle', drop.x - 1, drop.y);
  defending._aiDefenseTarget = 'command';
  drop.phase = 'active';
  game._aiSalvageDrop();
  assert.equal(defending._aiSalvageDropOrder, undefined, 'urgent defense prevents a cache assignment');
});
