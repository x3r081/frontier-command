import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINEER_ESCORT_RULES_VERSION, ENGINEER_FIELD_REPAIR_RULES_VERSION } from '../src/game/engine.js';
import { CAMPAIGN_MISSIONS, createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay, SOLO_REPLAY_VERSION } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 82001,
  scenarioId: CAMPAIGN_MISSIONS[15].id };

function advance(game, clock, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 15, SOLO_STEP_SECONDS, ENGINEER_FIELD_REPAIR_RULES_VERSION);
    clock.completedTicks++;
  }
}

function publicState(game) {
  return {
    units: game.units.map(unit => ({ id: unit.id, owner: unit.owner, defId: unit.defId, x: unit.x, y: unit.y,
      hp: unit.hp, maxHp: unit.maxHp, order: unit.order, fieldRepairKits: unit.fieldRepairKits })),
    buildings: game.buildings.map(building => ({ id: building.id, owner: building.owner, defId: building.defId,
      hp: building.hp, powered: building.powered, queue: building.queue })),
    credits: game.credits,
    effects: game.effects,
    time: game.time,
    status: game.status,
    campaignState: game.campaignState,
  };
}

test('Engineer field repair and Workshop kit refill replay deterministically under rules 85', () => {
  assert.equal(ENGINEER_FIELD_REPAIR_RULES_VERSION, 85);
  assert.ok(SOLO_REPLAY_VERSION >= ENGINEER_FIELD_REPAIR_RULES_VERSION,
    'current replay rules retain the version-85 repair command');
  const game = createCampaignGame(15, 'normal', envelope.seed, 'standard', 'none', 'none', 'none', 'none', null,
    ENGINEER_FIELD_REPAIR_RULES_VERSION);
  game.replayVersion = ENGINEER_FIELD_REPAIR_RULES_VERSION;
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const advanceUntil = (predicate, description, maxTicks) => {
    for (let tick = 0; tick < maxTicks && !predicate() && game.status === 'playing'; tick++) advance(game, clock);
    assert.ok(predicate(), `${description} completes during ordinary simulation`);
  };
  const engineer = game.getEntity(game.campaignState.engineerId);
  game.select([engineer.id]);
  assert.equal(game.issueRecommissionWreck(game.campaignState.wreckId).ok, true);
  advanceUntil(() => !!game.campaignState.recommissionedVehicleId, 'the marked Guardian is recommissioned', 1200);
  const guardian = game.getEntity(game.campaignState.recommissionedVehicleId);
  assert.ok(guardian, 'the recommissioned Guardian enters play');
  assert.ok(guardian.hp < guardian.maxHp, 'recommissioning returns the Guardian with repairable damage');
  const damagedHp = guardian.hp;
  game.select([engineer.id]);
  assert.equal(game.issueFieldRepair(guardian.id).ok, true);
  advanceUntil(() => engineer.fieldRepairKits === 1, 'the Engineer completes a field repair', 600);
  assert.equal(guardian.hp, Math.min(guardian.maxHp, damagedHp + 120));

  assert.equal(game.issueRefillRepairKits().ok, true);
  advanceUntil(() => engineer.fieldRepairKits === 2, 'the Workshop refills the used kit', 1200);
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => command.method), [
    'issueRecommissionWreck', 'issueFieldRepair', 'issueRefillRepairKits',
  ]);
  assert.deepEqual(recorder.commands.find(command => command.method === 'issueFieldRepair').args, [guardian.id]);
  assert.deepEqual(recorder.commands.find(command => command.method === 'issueRefillRepairKits').args, []);
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks,
    ENGINEER_FIELD_REPAIR_RULES_VERSION), true);

  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks,
    ENGINEER_FIELD_REPAIR_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(publicState(playback.game), publicState(game),
    'the repair amount, kit consumption/refill, Workshop cost and orders match playback');
});

test('Engineer Follow repair is deterministic in rules 87 and absent from archived rules 86', () => {
  const version = ENGINEER_ESCORT_RULES_VERSION;
  assert.equal(version, 87);
  assert.equal(SOLO_REPLAY_VERSION, version);
  const game = createCampaignGame(15, 'normal', envelope.seed, 'standard', 'none', 'none', 'none', 'none', null,
    version);
  game.replayVersion = version;
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const advance = () => {
    game.update(SOLO_STEP_SECONDS);
    updateCampaign(game, 15, SOLO_STEP_SECONDS, version);
    clock.completedTicks++;
  };
  const engineer = game.getEntity(game.campaignState.engineerId);
  game.select([engineer.id]);
  assert.equal(game.issueRecommissionWreck(game.campaignState.wreckId).ok, true);
  for (let tick = 0; tick < 1200 && !game.campaignState.recommissionedVehicleId && game.status === 'playing'; tick++)
    advance();
  const guardian = game.getEntity(game.campaignState.recommissionedVehicleId);
  assert.ok(guardian, 'the marked Guardian is recommissioned');
  const damagedHp = guardian.hp;
  game.select([guardian.id]);
  assert.equal(game.issueStop().ok, true, 'keep the patient stationary for the support channel');
  game.select([engineer.id]);
  assert.equal(game.issueFollow(guardian.id).ok, true);
  for (let tick = 0; tick < 600 && engineer.fieldRepairKits === 2 && game.status === 'playing'; tick++)
    advance();
  assert.equal(engineer.fieldRepairKits, 1, 'one kit is spent after an ordinary five-second channel');
  assert.equal(guardian.hp, Math.min(guardian.maxHp, damagedHp + 120));
  assert.deepEqual(engineer.order, { type: 'follow', targetId: guardian.id }, 'repair leaves Follow active');
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => command.method), [
    'issueRecommissionWreck', 'issueStop', 'issueFollow',
  ]);

  const current = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, version);
  current.step(clock.completedTicks);
  assert.equal(current.game.getEntity(engineer.id).fieldRepairKits, 1);
  assert.equal(current.game.getEntity(guardian.id).hp, guardian.hp);
  assert.deepEqual(current.game.getEntity(engineer.id).order, { type: 'follow', targetId: guardian.id });

  const archived = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, version - 1);
  archived.step(clock.completedTicks);
  assert.equal(archived.game.getEntity(engineer.id).fieldRepairKits, 2,
    'archived v86 Follow does not gain the v87 repair behavior');
  assert.equal(archived.game.getEntity(guardian.id).hp, damagedHp);
  assert.deepEqual(archived.game.getEntity(engineer.id).order, { type: 'follow', targetId: guardian.id });
});

test('field repair commands require rules 85 and strict target/argument shapes', () => {
  const v85 = ENGINEER_FIELD_REPAIR_RULES_VERSION;
  const validRepair = { tick: 0, sequence: 0, method: 'issueFieldRepair', args: ['u2'], selectedIds: ['u1'] };
  const validRefill = { tick: 0, sequence: 0, method: 'issueRefillRepairKits', args: [], selectedIds: ['u1'] };
  assert.throws(() => validateSoloReplay(envelope, [validRepair], 1, v85 - 1),
    /Engineer field repair requires replay version 85/i);
  assert.throws(() => createSoloPlayback(envelope, [validRefill], 1, v85 - 1),
    /Engineer field repair requires replay version 85/i);
  assert.throws(() => validateSoloReplay(envelope, [{ ...validRepair, args: [41] }], 1, v85),
    /Invalid solo command/i);
  assert.throws(() => validateSoloReplay(envelope, [{ ...validRefill, args: ['u2'] }], 1, v85),
    /Invalid solo command/i);
  assert.equal(validateSoloReplay(envelope, [validRepair], 1, v85), true);
  assert.equal(validateSoloReplay(envelope, [validRefill], 1, v85), true);
  assert.equal(validateSoloReplay(envelope, [], 1, v85 - 1), true,
    'rules 84 runs with no repair commands remain valid');
});

test('rules 84 Iron Reclaimed playback starts without Engineer repair kit state', () => {
  const legacyEnvelope = { ...envelope, scenarioId: 'iron-reclaimed' };
  const { game } = createSoloPlayback(legacyEnvelope, [], 0, ENGINEER_FIELD_REPAIR_RULES_VERSION - 1);
  const engineer = game.units.find(unit => unit.defId === 'engineer' && unit.owner === 'player');
  assert.ok(engineer, 'Iron Reclaimed starts with its signal Engineer');
  for (const key of ['fieldRepairKits', '_fieldRepairProgress', '_fieldRepairRefillProgress',
    '_fieldRepairWaiting', '_fieldRepairLastTargetX', '_fieldRepairLastTargetY'])
    assert.equal(Object.hasOwn(engineer, key), false, `legacy Engineer has no ${key}`);
});
