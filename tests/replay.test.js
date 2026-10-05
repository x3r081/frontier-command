import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';
import { CAMPAIGN_MISSIONS, CAMPAIGN_FIELD_ORDERS, createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, replaySoloRun, validateSoloEnvelope, validateSoloReplay,
  SOLO_REPLAY_VERSION } from '../src/game/replay.js';

const skirmish = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 12345,
  scenarioId: SKIRMISH_MAPS[0].id };

test('solo playback rebuilds the locked skirmish victory mode after reset', () => {
  const playback = createSoloPlayback({ ...skirmish, victoryMode: 'elimination' }, [], 1);
  assert.equal(playback.game.victoryMode, 'elimination');
  playback.step(1);
  assert.equal(playback.game.status, 'playing');
  assert.equal(playback.reset().victoryMode, 'elimination');
  assert.equal(createSoloPlayback(skirmish, [], 0).game.victoryMode, 'dominion');
});

test('workshop service orders are version 21 commands while version 20 replay behavior stays locked', () => {
  const commands = [{ tick: 0, sequence: 0, method: 'issueServiceAtWorkshop', args: ['b2'],
    selectedIds: ['u1'] }];
  assert.equal(validateSoloReplay(skirmish, commands, 1), true);
  assert.throws(() => createSoloPlayback(skirmish, commands, 1, 20), /version 21/i);
  assert.equal(createSoloPlayback(skirmish, [], 1, 20).game.replayVersion, 20);
});

test('faction field orders require version 36 and reject invalid ability arguments', () => {
  const command = { tick: 0, sequence: 0, method: 'useUnitAbility',
    args: ['u1', 'brace'], selectedIds: ['u1'] };
  assert.equal(validateSoloReplay(skirmish, [command], 1), true);
  assert.throws(() => createSoloPlayback(skirmish, [command], 1, 35), /require replay version 36/i);
  assert.throws(() => validateSoloReplay(skirmish, [{ ...command, args: ['u1', 'invalid'] }], 1),
    /invalid solo command/i);
});

test('Guardian Brace records and replays its campaign activation at the same simulation tick', () => {
  const index = CAMPAIGN_MISSIONS.findIndex(mission => mission.id === 'black-shard');
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: 'aegis',
    seed: 22991, scenarioId: 'black-shard' };
  const source = createCampaignGame(index, envelope.difficulty, envelope.seed);
  const guardian = source.units.find(unit => unit.owner === 'player' && unit.defId === 'guardian');
  assert.ok(guardian);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(source, clock);
  source.select(guardian.id);
  assert.equal(source.useUnitAbility(guardian.id, 'brace').ok, true);
  step(source, clock, 5, index);
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => [command.method, command.args]),
    [['useUnitAbility', [guardian.id, 'brace']]]);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks);
  playback.step(clock.completedTicks);
  const replayed = playback.game.getEntity(guardian.id);
  assert.equal(replayed.braceUntil, guardian.braceUntil);
  assert.equal(replayed.abilityCooldown, guardian.abilityCooldown);
  assert.equal(playback.game.time, source.time);
});

test('solo recorder replays a deterministic workshop service order', () => {
  const game = new Game({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: skirmish.seed, mapId: skirmish.scenarioId });
  const bay = game._createBuilding('player', 'serviceBay', 20, 20, 1);
  game._refreshPower();
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  tank.x = 21; tank.y = 21; tank.hp -= 50; tank.order = { type: 'guard', x: 12.5, y: 12.5 };
  const baseline = game.serialize();
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  game.select(tank.id);
  assert.equal(game.issueServiceAtWorkshop(bay.id).ok, true);
  step(game, clock, 20);
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => [command.method, command.args]),
    [['issueServiceAtWorkshop', [bay.id]]]);

  const playback = Game.deserialize(baseline);
  playback.replayVersion = SOLO_REPLAY_VERSION;
  let cursor = 0;
  for (let tick = 0; tick < clock.completedTicks; tick++) {
    while (cursor < recorder.commands.length && recorder.commands[cursor].tick === tick) {
      const command = recorder.commands[cursor++];
      playback.select(command.selectedIds);
      assert.equal(playback[command.method](...command.args).ok, true);
    }
    playback.update(SOLO_STEP_SECONDS);
  }
  assert.deepEqual(JSON.parse(playback.serialize()).units, JSON.parse(game.serialize()).units);
  assert.deepEqual(playback.credits, game.credits);
});

test('wreck recovery is a version 10 solo command and older playback rejects it', () => {
  const commands = [{ tick: 0, sequence: 0, method: 'issueRecoverWreck', args: ['wreck1'],
    selectedIds: ['u1'] }];
  assert.equal(validateSoloReplay(skirmish, commands, 1), true);
  assert.throws(() => createSoloPlayback(skirmish, commands, 1, 9), /version 10/i);
  assert.throws(() => validateSoloReplay(skirmish, [{ ...commands[0], args: ['u1'] }], 1), /command/i);
});

function step(game, clock, count, campaignIndex = null) {
  for (let i = 0; i < count; i++) clock.advance(SOLO_STEP_SECONDS, dt => {
    game.update(dt);
    if (campaignIndex !== null) updateCampaign(game, campaignIndex, dt);
  });
}

function signature(game) {
  return {
    time: game.time, status: game.status, winner: game.winner, randomState: game.randomState,
    credits: game.credits, construction: game.construction, kills: game.kills,
    units: game.units.map(({ id, x, y, hp, order }) => ({ id, x, y, hp, order })),
    buildings: game.buildings.map(({ id, x, y, hp, queue }) => ({ id, x, y, hp, queue })),
    campaignState: game.campaignState, campaignFieldOrderId: game.campaignFieldOrderId,
  };
}

test('records successful player commands and replays skirmish at completed tick boundaries', () => {
  const game = new Game({ mode: skirmish.mode, difficulty: skirmish.difficulty,
    faction: skirmish.faction, seed: skirmish.seed, mapId: skirmish.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const unit = game.units.find(item => item.owner === 'player' && item.defId !== 'harvester');
  game.select([unit.id]);
  assert.equal(game.issueStop().ok, true);
  assert.equal(game.issueAttack('missing').ok, false);
  assert.equal(game.issueMove(20.5, 20.5).ok, true);
  step(game, clock, 3);
  assert.equal(game.issueGuard().ok, true);
  step(game, clock, 3);
  recorder.dispose();

  assert.deepEqual(recorder.commands.map(({ tick, sequence, method, selectedIds }) =>
    ({ tick, sequence, method, selectedIds })), [
    { tick: 0, sequence: 0, method: 'issueStop', selectedIds: [unit.id] },
    { tick: 0, sequence: 1, method: 'issueMove', selectedIds: [unit.id] },
    { tick: 3, sequence: 2, method: 'issueGuard', selectedIds: [unit.id] },
  ]);
  const replay = replaySoloRun(skirmish, recorder.commands, clock.completedTicks);
  assert.deepEqual(signature(replay.game), signature(game));
  assert.equal(replay.seconds, clock.completedTicks * SOLO_STEP_SECONDS);
});

test('Relay Protocol orders replay after a public capture and are unavailable to version 6 playback', () => {
  const envelope = { ...skirmish, difficulty: 'easy' };
  const source = new Game({ mode: envelope.mode, difficulty: envelope.difficulty,
    faction: envelope.faction, seed: envelope.seed, mapId: envelope.scenarioId });
  const relay = source.relays[0];
  const force = source.units.filter(unit => unit.owner === 'player' &&
    source.unitDefs[unit.defId]?.weapon && !source.unitDefs[unit.defId]?.flying);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(source, clock);
  source.select(force.map(unit => unit.id));
  assert.equal(source.issueMove(relay.x, relay.y, true).ok, true);
  for (let i = 0; i < 1200 && relay.owner !== 'player' && source.status === 'playing'; i++)
    step(source, clock, 1);
  assert.equal(relay.owner, 'player', 'the force secures the relay using public orders');
  assert.equal(source.setRelayProtocol(relay.id, 'overdrive').ok, true);
  step(source, clock, 90);
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => command.method), ['issueMove', 'setRelayProtocol']);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks);
  playback.step(clock.completedTicks);
  assert.equal(playback.game.relays[0].protocol, 'overdrive');
  assert.deepEqual(playback.game.relays, source.relays);
  assert.equal(playback.game.commandEnergy.player, source.commandEnergy.player);
  playback.reset();
  playback.step(clock.completedTicks);
  assert.deepEqual(playback.game.relays, source.relays);
  assert.throws(() => createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 6),
    /require replay version 7/i);
});

test('Logistics relay orders require version 49 without changing older protocol orders', () => {
  const logistics = [{ tick: 0, sequence: 0, method: 'setRelayProtocol',
    args: ['relay1', 'logistics'], selectedIds: [] }];
  assert.equal(validateSoloReplay(skirmish, logistics, 1), true);
  assert.throws(() => createSoloPlayback(skirmish, logistics, 1, 48), /requires replay version 49/i);
  assert.equal(createSoloPlayback(skirmish, logistics, 1, 49).game.replayVersion, 49);
  const shelter = [{ ...logistics[0], args: ['relay1', 'shelter'] }];
  assert.equal(createSoloPlayback(skirmish, shelter, 1, 48).game.replayVersion, 48);
  assert.throws(() => validateSoloReplay(skirmish, [{ ...logistics[0], args: ['relay1', 'cargo'] }], 1),
    /invalid solo command/i);
});

test('campaign replay applies mission updates at the same fixed step', () => {
  const index = 0;
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[index].faction,
    seed: 54321, scenarioId: CAMPAIGN_MISSIONS[index].id };
  const game = createCampaignGame(index, envelope.difficulty, envelope.seed);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const unit = game.units.find(item => item.owner === 'player');
  game.select([unit.id]);
  assert.equal(game.issueStop().ok, true);
  step(game, clock, 5, index);
  recorder.dispose();
  const replay = replaySoloRun(envelope, recorder.commands, clock.completedTicks);
  assert.deepEqual(signature(replay.game), signature(game));
});

test('version 3 First Harvest archive replays its historical unfinished-refinery victory', () => {
  const index = 0;
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[index].faction,
    seed: 1, scenarioId: CAMPAIGN_MISSIONS[index].id };
  const source = createCampaignGame(index, envelope.difficulty, envelope.seed,
    'standard', 'none', 'none', 'none', 'none', null, 3);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(source, clock);
  let site = null;
  for (let y = 0; y < source.height && !site; y++) for (let x = 0; x < source.width; x++) {
    if (source.canPlaceBuilding('refinery', x, y).ok) { site = { x, y }; break; }
  }
  assert.ok(site);
  assert.equal(source.issueBuild('refinery', site.x, site.y).ok, true);
  for (let tick = 0; tick < 1000 && source.status === 'playing'; tick++) {
    clock.advance(SOLO_STEP_SECONDS, dt => {
      source.update(dt);
      updateCampaign(source, index, dt, 3);
    });
  }
  recorder.dispose();
  assert.equal(source.status, 'victory');
  const oldRefinery = source.buildings.find(building => building.owner === 'player' &&
    building.defId === 'refinery' && building.progress < 1);
  assert.ok(oldRefinery, 'the archived victory happened before the new refinery completed');

  const legacyPlayback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 3);
  const legacyResult = legacyPlayback.step(clock.completedTicks);
  assert.equal(legacyResult.status, 'victory');
  assert.deepEqual(signature(legacyResult), signature(source));

  const currentPlayback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, SOLO_REPLAY_VERSION);
  assert.equal(currentPlayback.step(clock.completedTicks).status, 'playing',
    'the current objective does not grant the old premature victory');
});

test('Cadet relay rush timing is preserved in v12 playback and delayed in v13', () => {
  const envelope = { ...skirmish, difficulty: 'easy' };
  const assignedEnemyRelays = playback => playback.game.units.filter(unit => unit.owner === 'enemy' &&
    unit._relayAssignment).length;
  const legacy = createSoloPlayback(envelope, [], 0, 12);
  legacy.game.relays[0].owner = 'player';
  legacy.game._aiTick();
  assert.ok(assignedEnemyRelays(legacy) > 0, 'v12 responds immediately after the first capture');

  const current = createSoloPlayback(envelope, [], 0, 13);
  current.game.relays[0].owner = 'player';
  current.game._aiTick();
  assert.equal(assignedEnemyRelays(current), 0, 'v13 keeps the onboarding pause');
  current.game.time = 45;
  current.game._aiTick();
  assert.ok(assignedEnemyRelays(current) > 0, 'v13 resumes the ordinary relay response after 45 seconds');
});

test('campaign doctrine is validated and reconstructed by playback', () => {
  assert.equal(SOLO_REPLAY_VERSION, 57);
  const index = 0;
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[index].faction,
    seed: 54321, scenarioId: CAMPAIGN_MISSIONS[index].id, doctrineId: 'reinforced' };
  const source = createCampaignGame(index, envelope.difficulty, envelope.seed, envelope.doctrineId);
  const clock = new SoloClock();
  step(source, clock, 5, index);
  const playback = createSoloPlayback(envelope, [], clock.completedTicks);
  assert.equal(playback.game.campaignDoctrineId, 'reinforced');
  assert.equal(playback.game.replayVersion, SOLO_REPLAY_VERSION);
  assert.deepEqual(signature(playback.step(clock.completedTicks)), signature(source));
  assert.equal(playback.reset().campaignDoctrineId, 'reinforced');
  assert.equal(playback.game.replayVersion, SOLO_REPLAY_VERSION);
  assert.equal(createSoloPlayback(skirmish, [], 0, 5).game.replayVersion, 5);
  assert.equal(createSoloPlayback({ ...envelope, doctrineId: undefined }, [], 0).game.campaignDoctrineId, 'standard');
  for (const doctrineId of ['REINFORCED', ' reinforced', 'unknown', null, 1])
    assert.throws(() => validateSoloEnvelope({ ...envelope, doctrineId }), /doctrine/i);
  assert.throws(() => validateSoloEnvelope({ ...skirmish, doctrineId: 'standard' }), /doctrine/i);
});

test('Dawnfall playback begins on the mission objective recorded by its replay version', () => {
  const mission = CAMPAIGN_MISSIONS[6];
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: mission.faction,
    seed: 70633, scenarioId: mission.id };
  const old = createSoloPlayback(envelope, [], 1, 32);
  const current = createSoloPlayback(envelope, [], 1, 33);
  const oldYard = old.game.getEntity(old.game.campaignState.targetId);
  const currentYard = current.game.getEntity(current.game.campaignState.targetId);
  assert.equal(oldYard.campaignShielded, false);
  assert.equal(currentYard.campaignShielded, true);
  assert.match(old.game.mission.objective, /Destroy the Vesper Construction Yard/i);
  assert.match(current.game.mission.objective, /Capture and hold the central/i);
  assert.equal(old.reset().getEntity(old.game.campaignState.targetId).campaignShielded, false);
});

test('Last Light playback describes only the completion route available in its rules', () => {
  const mission = CAMPAIGN_MISSIONS[2];
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: mission.faction,
    seed: 70634, scenarioId: mission.id };
  const legacy = createSoloPlayback(envelope, [], 0, 41);
  const current = createSoloPlayback(envelope, [], 0, 42);
  assert.doesNotMatch(legacy.game.mission.objective, /eastern flank/i);
  assert.match(current.game.mission.objective, /eastern flank/i);
  assert.doesNotMatch(legacy.reset().mission.objective, /eastern flank/i);
});

test('Ashes in Transit playback keeps the archived analyst and direct extraction rule', () => {
  const mission = CAMPAIGN_MISSIONS[5];
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: mission.faction,
    seed: 70635, scenarioId: mission.id };
  const legacy = createSoloPlayback(envelope, [], 0, 42);
  const staged = createSoloPlayback(envelope, [], 0, 43);
  const stagedV47 = createSoloPlayback(envelope, [], 0, 47);
  const current = createSoloPlayback(envelope, [], 0, SOLO_REPLAY_VERSION);
  const analyst = playback => playback.game.getEntity(playback.game.campaignState.escortId);
  assert.equal(analyst(legacy).maxHp, 105);
  assert.equal(analyst(staged).maxHp, 160);
  assert.equal(staged.game.campaignState.transmissionUplinks.find(item => item.id === 'south').y, 34.5);
  assert.equal(stagedV47.game.campaignState.transmissionUplinks.find(item => item.id === 'south').y, 34.5);
  assert.equal(current.game.campaignState.transmissionUplinks.find(item => item.id === 'south').y, 32);
  assert.doesNotMatch(legacy.game.mission.objective, /uplink|transmit/i);
  assert.match(staged.game.mission.objective, /eight uninterrupted seconds/i);
  assert.doesNotMatch(staged.game.mission.objective, /five|intercept/i);
  assert.match(current.game.mission.objective, /5 seconds/i);
  assert.match(staged.game.events.find(event => event.type === 'mission').objective, /eight uninterrupted seconds/i);
  assert.match(staged.reset().mission.objective, /eight uninterrupted seconds/i);
  assert.equal(staged.game.campaignState.transmissionUplinks.find(item => item.id === 'south').y, 34.5);
  assert.equal(legacy.reset().getEntity(legacy.game.campaignState.escortId).maxHp, 105);
});

test('Ashes route payoffs require v51 while no-route legacy practice remains valid', () => {
  const mission = CAMPAIGN_MISSIONS[5];
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: mission.faction,
    seed: 70635, scenarioId: mission.id };
  const routed = { ...envelope, routePayoffId: 'ghost-channel' };
  const legacyPractice = createSoloPlayback(envelope, [], 0, 50);
  assert.equal(legacyPractice.game.campaignState.ashesRouteRulesVersion, undefined,
    'route-neutral v50 practice reconstructs the archived Ashes rules');
  assert.equal(validateSoloEnvelope(envelope, 50), 5);
  assert.equal(validateSoloReplay(envelope, [], 0, 50), true);
  assert.throws(() => validateSoloEnvelope(routed, 50), /route payoff/i);
  assert.throws(() => validateSoloReplay(routed, [], 0, 50), /route payoff/i);
  assert.equal(validateSoloEnvelope(routed, 51), 5);
  assert.throws(() => validateSoloEnvelope({ ...envelope, routePayoffId: 'unknown' }, 51), /route payoff/i);
});

test('Black Shard playback restores the vulnerable v34 array before the first tick and after seek', () => {
  const mission = CAMPAIGN_MISSIONS[3];
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: mission.faction,
    seed: 481516, scenarioId: mission.id };
  const legacy = createSoloPlayback(envelope, [], 30, 34);
  const current = createSoloPlayback(envelope, [], 30, 35);
  const targetId = legacy.game.campaignState.targetId;
  assert.equal(legacy.game.getEntity(targetId).campaignShielded, false);
  assert.equal(current.game.getEntity(targetId).campaignShielded, true);
  assert.match(legacy.game.mission.objective, /Destroy the Vesper forward relay/i);
  assert.match(current.game.mission.objective, /Hold the central Resonance Relay/i);
  legacy.step(30);
  assert.equal(legacy.seek(0).getEntity(targetId).campaignShielded, false);
  assert.equal(current.reset().getEntity(targetId).campaignShielded, true);
});

test('Quiet Knife playback keeps the chief stationary in v33 and reproduces the v34 flight after seek', () => {
  const index = 9;
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[index].faction,
    seed: 481516, scenarioId: CAMPAIGN_MISSIONS[index].id };
  const opening = createCampaignGame(index, envelope.difficulty, envelope.seed);
  const armedIds = opening.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    unit.defId !== 'harvester').map(unit => unit.id);
  const orders = [{ tick: 0, sequence: 0, method: 'issueMove', args: [52.5, 22.5, true], selectedIds: armedIds }];
  const current = createSoloPlayback(envelope, orders, 600, 34);
  const legacy = createSoloPlayback(envelope, orders, 600, 33);
  assert.match(current.game.mission.objective, /flight to the southeast extraction zone/i);
  assert.doesNotMatch(legacy.game.mission.objective, /extraction zone/i);
  const chiefId = current.game.campaignState.targetId;
  const original = legacy.game.getEntity(chiefId);
  const originalPosition = [original.x, original.y];
  while (current.tick < 570 && current.game.campaignState.chiefEscapePhase !== 'escaping') current.step(1);
  assert.equal(current.game.campaignState.chiefEscapePhase, 'escaping');
  const flightTick = current.tick;
  legacy.step(flightTick);
  assert.equal(legacy.game.campaignState.chiefEscapePhase, undefined);
  assert.deepEqual([legacy.game.getEntity(chiefId).x, legacy.game.getEntity(chiefId).y], originalPosition);
  current.seek(0);
  assert.equal(current.game.campaignState.chiefEscapePhase, undefined);
  current.seek(flightTick);
  assert.equal(current.game.campaignState.chiefEscapePhase, 'escaping');
});

test('Elite promotion is a recorded v29 command and older replay versions reject it', () => {
  const commands = [{ tick: 0, sequence: 0, method: 'issuePromoteUnit',
    args: ['u1', 'bulwark'], selectedIds: ['u1'] }];
  assert.equal(validateSoloReplay(skirmish, commands, 1), true);
  assert.throws(() => createSoloPlayback(skirmish, commands, 1, 28), /promotions require replay version 29/i);
  assert.equal(createSoloPlayback(skirmish, [], 0, 29).game.replayVersion, 29);
});

test('version 22 team decisions replay identically across reset, seek, and save/load', () => {
  const source = new Game({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 481516, mapId: skirmish.scenarioId, replayVersion: 22 });
  const envelope = { ...skirmish, seed: 481516 };
  const playback = createSoloPlayback(envelope, [], 2700, 22);
  for (let i = 0; i < 1350; i++) source.update(SOLO_STEP_SECONDS);
  const resumed = Game.deserialize(source.serialize());
  for (let i = 0; i < 1350; i++) {
    source.update(SOLO_STEP_SECONDS);
    resumed.update(SOLO_STEP_SECONDS);
  }
  playback.step(1350);
  playback.seek(0);
  playback.step(2700);
  assert.deepEqual(signature(resumed), signature(source),
    'the AI planner keeps the same deterministic state after saving midway');
  assert.deepEqual(signature(playback.game), signature(source),
    'replay seek and forward playback reproduce team decisions exactly');
  assert.equal(playback.game.replayVersion, 22);
});

test('version 18 playback enables Aegis shelter recovery while version 17 keeps prior rules', () => {
  const prepare = replayVersion => {
    const game = createSoloPlayback(skirmish, [], 0, replayVersion).game;
    const relay = game.relays[0];
    relay.owner = 'player';
    relay.progress = 1;
    relay.protocol = 'shelter';
    game.units = [];
    const infantry = game._createUnit('player', 'rifle', relay.x, relay.y);
    infantry.hp -= 10;
    game._updateRelays(1);
    return infantry.hp;
  };
  assert.equal(prepare(17), 100);
  assert.equal(prepare(18), 101);
});

test('version 4 After the Dawn replay skips the version 5 Hard patrol warning', () => {
  const advanceLanding = version => {
    const game = createCampaignGame(12, 'hard', 481516);
    const engineer = game.getEntity(game.campaignState.engineerId);
    const relay = game.relays.find(item => item.id === game.campaignState.relayId);
    engineer.x = relay.x;
    engineer.y = relay.y;
    relay.owner = 'player';
    relay.contested = false;
    game.campaignState.holdElapsed = game.campaignState.holdDuration - 0.1;
    const before = game.units.length;
    updateCampaign(game, 12, 0.2, version);
    assert.equal(game.campaignState.phase, 'extract-engineer');
    return { game, added: game.units.slice(before) };
  };
  const legacy = advanceLanding(4);
  assert.equal(legacy.added.length, 0);
  assert.equal(legacy.game.campaignState.extractionPatrolWarned, false);
  assert.equal(legacy.game.campaignState.extractionPatrolFired, false);
  assert.equal(legacy.game.events.some(event => event.type === 'campaignThreatWarning'), false);
  const current = advanceLanding(SOLO_REPLAY_VERSION);
  assert.deepEqual(current.added, []);
  assert.equal(current.game.campaignState.extractionPatrolWarned, true);
  assert.equal(current.game.campaignState.extractionPatrolWarningElapsed, 0);
  assert.equal(current.game.campaignState.extractionPatrolFired, false);
  assert.equal(current.game.events.filter(event => event.type === 'campaignThreatWarning').length, 1);
  const unitsBeforePatrol = current.game.units.length;
  for (let i = 0; i < 24; i++) updateCampaign(current.game, 12, 0.2, SOLO_REPLAY_VERSION);
  assert.equal(current.game.units.length, unitsBeforePatrol, 'patrol waits through the full warning interval');
  updateCampaign(current.game, 12, 0.2, SOLO_REPLAY_VERSION);
  assert.deepEqual(current.game.units.slice(unitsBeforePatrol).map(unit => unit.defId), ['buggy', 'rifle']);
  assert.equal(current.game.campaignState.extractionPatrolFired, true);
  for (let i = 0; i < 25; i++) updateCampaign(current.game, 12, 0.2, SOLO_REPLAY_VERSION);
  assert.equal(current.game.units.length, unitsBeforePatrol + 2, 'later updates do not deploy a duplicate patrol');
});

test('field research choice survives recorded playback with the same progress and credits', () => {
  const index = 6; // Dawnfall starts with a powered Research Center.
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[index].faction,
    seed: 54321, scenarioId: CAMPAIGN_MISSIONS[index].id };
  const source = createCampaignGame(index, envelope.difficulty, envelope.seed);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(source, clock);
  assert.equal(source.chooseDoctrine('signal').ok, true);
  step(source, clock, 10, index);
  recorder.dispose();
  assert.equal(recorder.commands[0].method, 'chooseDoctrine');
  assert.deepEqual(recorder.commands[0].args, ['signal']);
  const playback = replaySoloRun(envelope, recorder.commands, clock.completedTicks);
  assert.deepEqual(playback.game.research, source.research);
  assert.deepEqual(playback.game.credits, source.credits);
});

test('tactical package commands require replay version 31 while legacy replays remain valid', () => {
  const commands = [{ tick: 0, sequence: 0, method: 'chooseTacticalPackage', args: ['breach'], selectedIds: [] }];
  assert.equal(SOLO_REPLAY_VERSION, 57);
  assert.throws(() => createSoloPlayback(skirmish, commands, 1, 30), /tactical packages require replay version 31/i);
  assert.equal(createSoloPlayback(skirmish, commands, 1, 31).game.replayVersion, 31);
  const abilityCommand = [{ tick: 0, sequence: 0, method: 'useCommandAbility', args: ['interdict', 2, 2], selectedIds: [] }];
  assert.throws(() => createSoloPlayback(skirmish, abilityCommand, 1, 30), /tactical packages require replay version 31/i);
});

test('field order playback reconstructs the selected mission variant and rejects cross-mission orders', () => {
  const index = 0;
  const fieldOrderId = CAMPAIGN_FIELD_ORDERS[index][0].id;
  const envelope = { mode: 'campaign', difficulty: 'normal', faction: CAMPAIGN_MISSIONS[index].faction,
    seed: 54321, scenarioId: CAMPAIGN_MISSIONS[index].id, doctrineId: 'rapid', fieldOrderId };
  const source = createCampaignGame(index, envelope.difficulty, envelope.seed, envelope.doctrineId, fieldOrderId);
  const clock = new SoloClock();
  step(source, clock, 5, index);
  const playback = createSoloPlayback(envelope, [], clock.completedTicks);
  assert.equal(playback.game.campaignFieldOrderId, fieldOrderId);
  assert.deepEqual(signature(playback.step(clock.completedTicks)), signature(source));
  assert.equal(playback.reset().campaignFieldOrderId, fieldOrderId);
  assert.equal(createSoloPlayback({ ...envelope, fieldOrderId: undefined }, [], 0).game.campaignFieldOrderId, 'none');
  for (const invalid of [CAMPAIGN_FIELD_ORDERS[1][0].id, 'UNKNOWN', '', null, 7])
    assert.throws(() => validateSoloEnvelope({ ...envelope, fieldOrderId: invalid }), /field order/i);
  assert.throws(() => validateSoloEnvelope({ ...skirmish, fieldOrderId: 'none' }), /field order/i);
});

test('viewer playback advances, pauses, seeks, and reproduces the verified simulation', () => {
  const source = new Game({ mode: skirmish.mode, difficulty: skirmish.difficulty,
    faction: skirmish.faction, seed: skirmish.seed, mapId: skirmish.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(source, clock);
  const unit = source.units.find(item => item.owner === 'player' && item.defId === 'rifle');
  source.select(unit.id);
  assert.equal(source.issueMove(19.5, 20.5).ok, true);
  step(source, clock, 15);
  assert.equal(source.issueGuard().ok, true);
  step(source, clock, 20);
  recorder.dispose();

  const playback = createSoloPlayback(skirmish, recorder.commands, clock.completedTicks);
  assert.equal(playback.tick, 0);
  playback.step(15);
  assert.equal(playback.tick, 15);
  const fifteen = signature(playback.game);
  playback.step(0);
  assert.deepEqual(signature(playback.game), fifteen);
  playback.step(20);
  assert.equal(playback.finished, true);
  assert.deepEqual(signature(playback.game), signature(source));
  playback.seek(15);
  assert.deepEqual(signature(playback.game), fifteen);
  playback.seek(clock.completedTicks);
  assert.deepEqual(signature(playback.game), signature(source));
  assert.throws(() => playback.seek(-1), RangeError);
  assert.throws(() => playback.step(-1), RangeError);
});

test('board and unload orders replay from their recorded fixed ticks', () => {
  const game = new Game({ mode: skirmish.mode, difficulty: skirmish.difficulty,
    faction: skirmish.faction, seed: skirmish.seed, mapId: skirmish.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);

  // Build an APC through the normal player command path so replay starts from
  // the same deterministic scenario state and owns all setup actions.
  assert.equal(game.queueUnit('apc').ok, true);
  step(game, clock, 480);
  const carrier = game.units.find(item => item.owner === 'player' && item.defId === 'apc');
  assert.ok(carrier, 'the queued APC should be produced');
  const infantry = game.units.find(item => item.owner === 'player' && item.defId === 'rifle');
  game.select([infantry.id]);
  assert.equal(game.issueBoard(carrier.id).ok, true);
  for (let i = 0; i < 180 && !infantry.embarkedIn; i++) step(game, clock, 1);
  assert.equal(infantry.embarkedIn, carrier.id, 'infantry should board before unloading');

  game.select([carrier.id]);
  assert.equal(game.issueUnload(18, 38).ok, true);
  step(game, clock, 120);
  recorder.dispose();

  assert.deepEqual(recorder.commands.map(({ tick, method }) => ({ tick, method })), [
    { tick: 0, method: 'queueUnit' },
    { tick: 480, method: 'issueBoard' },
    { tick: clock.completedTicks - 120, method: 'issueUnload' },
  ]);
  const replay = replaySoloRun(skirmish, recorder.commands, clock.completedTicks);
  assert.deepEqual(signature(replay.game), signature(game));
  assert.equal(replay.game.units.find(item => item.id === carrier.id).passengerIds.length, 0);
  assert.equal(replay.game.units.find(item => item.id === infantry.id).embarkedIn, null);
});

test('rejects malformed commands, selection forgery, and commands that fail in simulation', () => {
  const valid = { tick: 0, sequence: 0, method: 'issueStop', args: [], selectedIds: [] };
  const bad = [
    { ...valid, method: '_createUnit' },
    { ...valid, tick: -1 },
    { ...valid, tick: 2 },
    { ...valid, sequence: 1 },
    { ...valid, args: [3] },
    { ...valid, selectedIds: ['enemy'] },
    { ...valid, selectedIds: ['u1', 'u1'] },
    { ...valid, method: 'issueMove', args: [Infinity, 4] },
    { ...valid, method: 'useCommandAbility', args: ['unknown', 3, 4] },
    { ...valid, method: 'chooseDoctrine', args: ['unknown'] },
  ];
  for (const command of bad) assert.throws(() => validateSoloReplay(skirmish, [command], 1));
  assert.throws(() => validateSoloReplay(skirmish, [valid], 0));
  assert.throws(() => validateSoloReplay(skirmish, [], 324001));
  assert.throws(() => validateSoloReplay({ ...skirmish, scenarioId: 'unknown' }, [], 1));
  assert.throws(() => replaySoloRun(skirmish, [valid], 1), /Replay command failed/);
  assert.throws(() => replaySoloRun(skirmish, [{ ...valid, selectedIds: ['u999'] }], 1), /Invalid replay selection/);
});

test('Bloom expedition is a deterministic v52 player command and older versions reject it', () => {
  const game = new Game({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: skirmish.seed, mapId: skirmish.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  step(game, clock, 1260);
  assert.ok(game.storm.bloom, 'the normal storm cycle has opened a public Bloom');
  const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  const escort = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  game.select([harvester.id, escort.id]);
  assert.equal(game.issueBloomExpedition().ok, true);
  step(game, clock, 20);
  recorder.dispose();

  assert.deepEqual(recorder.commands.map(({ tick, method, args }) => ({ tick, method, args })), [
    { tick: 1260, method: 'issueBloomExpedition', args: [] },
  ]);
  assert.throws(() => createSoloPlayback(skirmish, recorder.commands, clock.completedTicks, 51), /version 52/i);
  const playback = createSoloPlayback(skirmish, recorder.commands, clock.completedTicks);
  playback.step(clock.completedTicks);
  assert.deepEqual(JSON.parse(playback.game.serialize()).units, JSON.parse(game.serialize()).units);
  assert.deepEqual(playback.game.credits, game.credits);
});
