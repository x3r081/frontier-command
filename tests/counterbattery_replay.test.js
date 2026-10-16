import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTERBATTERY_RULES_VERSION, createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, createSoloRecorder, SOLO_REPLAY_VERSION,
  validateSoloEnvelope, validateSoloReplay } from '../src/game/replay.js';
import { campaignVeteranSourceIds } from '../src/game/campaignVeteran.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 84016,
  scenarioId: 'counterbattery', doctrineId: 'standard', fieldOrderId: 'none', carryoverId: 'none',
  supplyId: 'none', routePayoffId: 'none', campaignVeteran: null };
const snapshot = game => structuredClone({ units: game.units, buildings: game.buildings,
  credits: game.credits, terrain: game.terrain, effects: game.effects,
  campaignState: game.campaignState, time: game.time, status: game.status });

test('Counterbattery requires rules 84 and its public command log replays exactly', () => {
  assert.equal(COUNTERBATTERY_RULES_VERSION, 84);
  assert.ok(SOLO_REPLAY_VERSION >= COUNTERBATTERY_RULES_VERSION);
  assert.deepEqual(campaignVeteranSourceIds(16), ['iron-reclaimed']);
  assert.deepEqual(campaignVeteranSourceIds(17), []);
  assert.throws(() => validateSoloEnvelope(envelope, 83), /Counterbattery requires replay version 84/i);

  const game = createCampaignGame(16, 'normal', envelope.seed, 'standard', 'none', 'none', 'none',
    'none', null, COUNTERBATTERY_RULES_VERSION);
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const rifle = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle' && unit.hp > 0);
  assert.ok(rifle, 'the authored operation provides a player Rifle');
  game.select(rifle.id);
  assert.equal(game.issueStop().ok, true, 'record a normal public command in the new mission');
  game.update(SOLO_STEP_SECONDS);
  updateCampaign(game, 16, SOLO_STEP_SECONDS, COUNTERBATTERY_RULES_VERSION);
  clock.completedTicks++;
  recorder.dispose();

  assert.equal(recorder.commands.length, 1);
  assert.equal(recorder.commands[0].method, 'issueStop');
  validateSoloReplay(envelope, recorder.commands, clock.completedTicks, COUNTERBATTERY_RULES_VERSION);
  assert.throws(() => validateSoloReplay(envelope, recorder.commands, clock.completedTicks,
    COUNTERBATTERY_RULES_VERSION - 1),
    /Counterbattery requires replay version 84/i);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks,
    COUNTERBATTERY_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(snapshot(playback.game), snapshot(game));

  const archivedIron = { ...envelope, scenarioId: 'iron-reclaimed' };
  assert.equal(validateSoloEnvelope(archivedIron, 73), 15,
    'archived Iron Reclaimed version-73 records remain valid');
});
