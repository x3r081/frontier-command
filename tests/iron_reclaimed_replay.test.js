import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoloPlayback, validateSoloEnvelope } from '../src/game/replay.js';
import { runIronReclaimedPlaytest } from '../scripts/iron-reclaimed-public-playtest.js';

const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'aegis',
  seed: 41073, scenarioId: 'iron-reclaimed' };

function outcome(game) {
  return {
    status: game.status, winner: game.winner, time: game.time,
    credits: game.credits, kills: game.kills,
    campaignState: game.campaignState, campaignResult: game.campaignResult,
    units: game.units.map(unit => ({ id: unit.id, defId: unit.defId, owner: unit.owner,
      x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp, order: unit.order,
      veterancy: unit.veterancy, xp: unit.xp, recommissioned: unit._recommissioned === true })),
    wrecks: game.wrecks,
  };
}

test('the new recovery operation cannot be started or verified using archived v72 rules', () => {
  assert.throws(() => validateSoloEnvelope(envelope, 72), /Iron Reclaimed requires replay version 73/);
  assert.throws(() => createSoloPlayback(envelope, [], 0, 72), /Iron Reclaimed requires replay version 73/);
  assert.equal(validateSoloEnvelope(envelope, 73), 15);
});

test('a full 30 Hz public-command recovery victory replays with the same pair, combat and campaign outcome', () => {
  const played = runIronReclaimedPlaytest({ route: 'south', seed: 41073 });
  assert.equal(played.game.status, 'victory');
  assert.equal(played.game.campaignComplete, true);
  assert.equal(played.game.campaignState.routeChoice, 'south');
  assert.ok(played.commands.some(command => command.method === 'issueRecommissionWreck'));
  const recovery = played.game.events.find(event => event.type === 'wreckRecommissioned');
  assert.equal(recovery.cost, 520);
  assert.equal(recovery.unitId, played.game.campaignState.engineerId);
  assert.equal(recovery.vehicleId, played.game.campaignState.recommissionedVehicleId);
  const replay = createSoloPlayback(played.envelope, played.commands, played.completedTicks, 73);
  replay.step(played.completedTicks);
  assert.deepEqual(outcome(replay.game), outcome(played.game));
});
