import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_COMMANDER_PROFILES, AI_ECONOMY_RECON_RULES_VERSION, SIEGE_DIRECTOR_RULES_VERSION,
  SIEGE_EXPANSION_RULES_VERSION, BUILDING_DEFS, Game, aiCommanderProfileForSeed } from '../src/game/engine.js';
import { createSoloPlayback, SOLO_REPLAY_VERSION } from '../src/game/replay.js';

const unitChoiceArgs = {
  r: 0.8, infantry: false, recent: [], recentIntel: [], air: 0, armor: 0, rockets: 0,
  stealthTanks: 0, needAirRockets: false, needAntiArmor: false, needVesperArmor: false,
  needMedic: false, combatUnits: [], enemyBuildings: [], count: () => 0,
};

function relayAssignments(profileId, replayVersion = 47) {
  const game = new Game({ seed: 1, aiCommanderProfileId: profileId });
  game.replayVersion = replayVersion;
  game.units = game.units.filter(unit => unit.owner !== 'enemy');
  for (let i = 0; i < 8; i++) game.units.push({
    id: `profile-test-${i}`, owner: 'enemy', defId: 'rifle', hp: 110, maxHp: 110,
    x: 47 + i % 3, y: 16 + Math.floor(i / 3), order: { type: 'idle' }, path: [],
    _relayAssignment: null,
  });
  const combatUnits = game.units.filter(unit => unit.owner === 'enemy');
  game._aiStrategicRelays(combatUnits);
  return combatUnits.filter(unit => unit._relayAssignment).length;
}

test('commander selection is deterministic from normalized seed and serializes its public label', () => {
  assert.deepEqual(AI_COMMANDER_PROFILES.map(profile => profile.id), ['raider', 'relay-marshal', 'siege-director']);
  assert.equal(SIEGE_DIRECTOR_RULES_VERSION, 53);
  assert.equal(SIEGE_EXPANSION_RULES_VERSION, 54);
  assert.equal(SOLO_REPLAY_VERSION, 57);
  assert.equal(aiCommanderProfileForSeed(1).id, 'relay-marshal');
  assert.equal(aiCommanderProfileForSeed(2).id, 'siege-director');
  assert.equal(aiCommanderProfileForSeed(2, 52).id, 'raider');
  assert.equal(aiCommanderProfileForSeed(3, 52).id, 'relay-marshal');
  assert.equal(aiCommanderProfileForSeed(2, 53).id, 'siege-director');
  assert.equal(aiCommanderProfileForSeed(0).id, aiCommanderProfileForSeed(80217).id);

  const game = new Game({ seed: 2 });
  assert.equal(game.aiCommanderProfileId, 'siege-director');
  assert.equal(game.aiCommanderProfileName, 'Siege Director');
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.aiCommanderProfileId, 'siege-director');
  assert.equal(loaded.aiCommanderProfileName, 'Siege Director');
  assert.equal(loaded.aiCommanderProfileRulesVersion, 47);
});

test('v54 reserves the Siege Director expansion rig from relay assignments while v53 preserves them', () => {
  const prepare = version => {
    const game = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
    game.replayVersion = version;
    game.relays = [{ id: 'relay-test', x: 40, y: 20, owner: null }];
    const rig = game._createUnit('enemy', 'mcv', 40, 20);
    rig._aiExpansion = true;
    const guards = [game._createUnit('enemy', 'rifle', 50, 20),
      game._createUnit('enemy', 'rifle', 51, 20), game._createUnit('enemy', 'rifle', 52, 20)];
    game._aiStrategicRelays([rig, ...guards]);
    return { rig, guards };
  };
  const old = prepare(53);
  assert.equal(old.rig._relayAssignment, 'relay-test', 'v53 keeps its historical assignment policy');
  const current = prepare(54);
  assert.equal(current.rig._relayAssignment, undefined, 'v54 leaves the MCV free to finish its expansion route');
  assert.ok(current.guards.some(unit => unit._relayAssignment === 'relay-test'),
    'other combat units can still contest the relay');
});

test('Siege Director funds a forward expansion earlier while old commanders retain their timing', () => {
  const prepare = profileId => {
    const game = new Game({ seed: 2, difficulty: 'normal', aiCommanderProfileId: profileId });
    game.time = 90;
    game.buildings = [];
    for (const id of ['command', 'refinery', ...(profileId === 'siege-director' ? [] : ['refinery']), 'factory',
      ...(profileId === 'siege-director' ? [] : ['tech'])]) {
      game._createBuilding('enemy', id, 50 + game.buildings.length * 4, 10, 1);
    }
    game.credits.enemy = 10000;
    game.enemyConstruction = null;
    game._aiExpansionSite = () => ({ x: 22, y: 20 });
    const queued = [];
    game._queueUnit = (owner, defId) => { queued.push([owner, defId]); return { ok: true }; };
    return { game, queued };
  };
  const siege = prepare('siege-director');
  assert.equal(siege.game._aiManageExpansion(), true);
  assert.deepEqual(siege.queued, [['enemy', 'mcv']]);
  assert.equal(siege.game._aiExpansionTarget.stage, 'queued');
  assert.equal(siege.game._aiSiegeDirectorActive(), true);

  const raider = prepare('raider');
  assert.equal(raider.game._aiManageExpansion(), false);
  assert.deepEqual(raider.queued, []);
  raider.game.time = 110;
  assert.equal(raider.game._aiManageExpansion(), true);
  assert.deepEqual(raider.queued, [['enemy', 'mcv']]);
});

test('Siege Director recruits artillery for observed defenses and attacks visible defenses first', () => {
  const game = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
  game.time = 120;
  const defense = { id: 'b9001', defId: 'turret', owner: 'player', building: true,
    x: 31, y: 20, seen: game.time };
  game._aiIntel = [defense];
  const count = id => id === 'radar' ? 1 : 0;
  assert.equal(game._aiChooseTeamUnit({ ...unitChoiceArgs, recentIntel: [defense], count }), 'artillery');

  game.isVisible = () => true;
  const observedTurret = game._createBuilding('player', 'turret', 31, 20, 1);
  game._createBuilding('player', 'command', 33, 20, 1);
  const siegeForce = [
    game._createUnit('enemy', 'artillery', 45, 20),
    game._createUnit('enemy', 'lightTank', 45, 21),
    game._createUnit('enemy', 'rifle', 45, 22),
  ];
  const rig = game._createUnit('enemy', 'mcv', 46, 22);
  rig._aiExpansion = true;
  rig.order = { type: 'move', x: 26, y: 20 };
  assert.equal(game._launchAiWave(), true);
  assert.ok(siegeForce.some(unit => unit.order?.targetId === observedTurret.id),
    'the attack packet chooses the observed defense over the command yard');
  assert.ok(siegeForce.find(unit => unit.defId === 'artillery').order?.targetId === observedTurret.id,
    'artillery leads the defense-targeting packet');
  assert.deepEqual(rig.order, { type: 'move', x: 26, y: 20 },
    'the expansion MCV stays on its deployment route instead of joining the siege wave');
});

test('Siege Director only assigns artillery against defenses currently visible to its force', () => {
  const game = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
  const turret = game._createBuilding('player', 'turret', 35, 20, 1);
  const cannon = game._createUnit('enemy', 'artillery', 45, 20);
  const escort = game._createUnit('enemy', 'lightTank', 46, 21);
  const force = [cannon, escort];
  game.isVisible = (_target, owner) => owner === 'enemy' && game.defensesVisible === true;
  game.defensesVisible = false;
  assert.equal(game._aiSiegeVisibleDefenses(force), false);
  assert.equal(cannon._aiSiegeTarget, undefined, 'unseen defenses do not influence targeting');
  game.defensesVisible = true;
  assert.equal(game._aiSiegeVisibleDefenses(force), true);
  assert.equal(cannon.order.targetId, turret.id);
  assert.equal(cannon.order.aiSiegeDirector, true);
  assert.equal(escort.order.type, 'follow');
  assert.equal(escort.order.targetId, cannon.id);
  game.defensesVisible = false;
  game._aiSiegeVisibleDefenses(force);
  assert.equal(cannon.order.type, 'idle', 'artillery abandons its target when it leaves current sight');
  assert.equal(cannon._aiSiegeTarget, null);
});

test('Siege Director escorts its expansion MCV and retasks escorts if the rig is lost', () => {
  const game = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
  const rig = game._createUnit('enemy', 'mcv', 45, 18);
  const guards = [game._createUnit('enemy', 'lightTank', 43, 18),
    game._createUnit('enemy', 'rifle', 42, 18), game._createUnit('enemy', 'rocket', 41, 18)];
  guards[0].order = { type: 'attack', targetId: 'u9999' };
  game._aiEscortExpansionRig(rig);
  const firstPair = guards.filter(unit => unit._aiExpansionEscort === rig.id);
  assert.equal(firstPair.length, 2);
  assert.ok(firstPair.every(unit => unit.order.type === 'follow' &&
    unit.order.targetId === rig.id && unit.order.aiExpansionEscort));

  const replacementRig = game._createUnit('enemy', 'mcv', 40, 18);
  game._aiEscortExpansionRig(replacementRig);
  const replacementPair = guards.filter(unit => unit._aiExpansionEscort === replacementRig.id);
  assert.equal(replacementPair.length, 2);
  assert.ok(firstPair.every(unit => !replacementPair.includes(unit) ||
    unit._aiExpansionEscort === replacementRig.id));
});

test('Siege Director reroutes expansion away from currently visible powered defenses', () => {
  const game = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
  const turret = game._createBuilding('player', 'turret', 32, 20, 1);
  game.isVisible = (target, owner) => owner === 'enemy' && target.id === turret.id;
  assert.equal(game._aiExpansionThreatened(37, 20, 8), true);
  assert.equal(game._aiExpansionThreatened(45, 20, 8), false);
  const raider = new Game({ seed: 2, aiCommanderProfileId: 'raider' });
  const raiderTurret = raider._createBuilding('player', 'turret', 32, 20, 1);
  raider.isVisible = (target, owner) => owner === 'enemy' && target.id === raiderTurret.id;
  assert.equal(raider._aiExpansionThreatened(37, 20, 8), false,
    'the v53 site-safety rule stays specific to Siege Director');
});

test('version 52 saves and replays retain the two-profile mapping; v53 and v54 saves resume their expansion rules', () => {
  const historical = new Game({ seed: 2, aiCommanderProfileId: 'raider' });
  historical.replayVersion = 52;
  const oldSave = JSON.parse(historical.serialize());
  delete oldSave.siegeDirectorRulesVersion;
  delete oldSave.aiCommanderProfileId;
  delete oldSave.aiCommanderProfileName;
  oldSave.replayVersion = null;
  const loadedOld = Game.deserialize(oldSave);
  assert.equal(loadedOld.replayVersion, 52);
  assert.equal(loadedOld.aiCommanderProfileId, 'raider');
  assert.equal(loadedOld._aiSiegeDirectorActive(), false);
  assert.equal(createSoloPlayback({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 2, scenarioId: 'shard-valley' }, [], 0, 52).game.aiCommanderProfileId, 'raider');
  assert.equal(createSoloPlayback({ mode: 'skirmish', difficulty: 'normal', faction: 'aegis',
    seed: 2, scenarioId: 'shard-valley' }, [], 0, 53).game.aiCommanderProfileId, 'siege-director');

  const legacySiege = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
  legacySiege.replayVersion = 53;
  const legacySiegeSave = JSON.parse(legacySiege.serialize());
  delete legacySiegeSave.siegeExpansionRulesVersion;
  legacySiegeSave.replayVersion = null;
  assert.equal(Game.deserialize(legacySiegeSave).replayVersion, 53,
    'markerless Siege Director saves remain on v53 relay/expansion behavior');

  const current = new Game({ seed: 2, aiCommanderProfileId: 'siege-director' });
  current.replayVersion = 54;
  current.time = 90;
  current._aiIntel = [{ id: 'b9001', building: true, defId: 'turret', x: 30, y: 20, seen: 80 }];
  for (let i = 0; i < 30; i++) current.update(0.1);
  const resumed = Game.deserialize(current.serialize());
  assert.equal(resumed.aiCommanderProfileId, 'siege-director');
  assert.equal(resumed.replayVersion, 54);
  for (let i = 0; i < 80; i++) { current.update(0.1); resumed.update(0.1); }
  const state = game => JSON.stringify({ time: game.time, randomState: game.randomState,
    expansion: game._aiExpansionTarget,
    units: game.units.filter(unit => unit.owner === 'enemy').map(unit =>
      ({ id: unit.id, defId: unit.defId, x: unit.x, y: unit.y, order: unit.order })) });
  assert.equal(state(resumed), state(current));
});

test('Raider biases early composition toward buggies while Relay Marshal claims more relays', () => {
  const raider = new Game({ seed: 2, aiCommanderProfileId: 'raider' });
  const marshal = new Game({ seed: 1, aiCommanderProfileId: 'relay-marshal' });
  raider.time = marshal.time = 60;
  assert.equal(raider._aiChooseTeamUnit(unitChoiceArgs), 'buggy');
  assert.equal(marshal._aiChooseTeamUnit(unitChoiceArgs), 'lightTank');
  assert.equal(relayAssignments('relay-marshal'), 5);
  assert.equal(relayAssignments('raider'), 4);
});

test('Raider commits two buggies to a genuinely visible harvester, while old rules commit one', () => {
  const raidCount = (profileId, difficulty = 'normal', replayVersion = 47) => {
    const game = new Game({ seed: 49, difficulty, aiCommanderProfileId: profileId });
    game.replayVersion = replayVersion;
    const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
    const buggies = [2, 3, 4].map(offset =>
      game._createUnit('enemy', 'buggy', harvester.x + offset, harvester.y));
    assert.equal(game.isVisible(harvester, 'enemy'), true);
    game._aiRaidHarvesters(buggies);
    return buggies.filter(unit => unit._aiRaidTarget === harvester.id).length;
  };
  assert.equal(raidCount('raider'), 2);
  assert.equal(raidCount('relay-marshal'), 1);
  assert.equal(raidCount('raider', 'normal', 46), 1);
  assert.equal(raidCount('raider', 'easy'), 2);
  assert.equal(raidCount('relay-marshal', 'easy'), 0);
});

test('v46 and markerless skirmish saves retain legacy AI rules', () => {
  const raider = new Game({ seed: 2, aiCommanderProfileId: 'raider' });
  raider.replayVersion = 46;
  raider.time = 60;
  assert.equal(raider._aiChooseTeamUnit(unitChoiceArgs), 'lightTank');
  assert.equal(relayAssignments('relay-marshal', 46), relayAssignments('raider', 46));

  const oldSave = JSON.parse(new Game({ seed: 2 }).serialize());
  delete oldSave.aiCommanderProfileRulesVersion;
  delete oldSave.aiCommanderProfileId;
  delete oldSave.aiCommanderProfileName;
  const migrated = Game.deserialize(oldSave);
  assert.equal(migrated.replayVersion, 46);
  assert.equal(migrated.aiCommanderProfileId, 'raider');
  assert.equal(migrated.aiCommanderProfileName, 'Raider');
  assert.equal(migrated._aiCommanderProfileActive('raider'), false);
  const preRecon = JSON.parse(new Game({ seed: 2, aiCommanderProfileId: 'raider' }).serialize());
  preRecon.replayVersion = null;
  preRecon.aiCommanderProfileRulesVersion = 47;
  delete preRecon.aiEconomyReconRulesVersion;
  const loadedV47 = Game.deserialize(preRecon);
  assert.equal(loadedV47.replayVersion, 47);
  assert.equal(loadedV47._aiCommanderProfileActive('raider'), true);
  loadedV47._aiIntel = [];
  const v47Scout = loadedV47.units.find(unit => unit.owner === 'enemy' && unit.defId === 'scout');
  loadedV47._aiScout(loadedV47.units.filter(unit => unit.owner === 'enemy'));
  assert.deepEqual([v47Scout.order.x, v47Scout.order.y, v47Scout.order.aiScoutEscort], [32, 25, undefined]);
});

test('v48 Raider recon discovers and pressures the live Harvester that v47 misses', () => {
  const run = replayVersion => {
    const game = new Game({ seed: 80218, difficulty: 'normal', aiCommanderProfileId: 'raider' });
    game.replayVersion = replayVersion;
    const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
    let firstObserved = null;
    let firstDamage = null;
    for (let step = 0; step < 1000; step++) {
      game.update(0.1);
      if (firstObserved == null && game._aiIntel.some(item => item.id === harvester.id)) firstObserved = game.time;
      if (firstDamage == null && harvester.hp < harvester.maxHp) firstDamage = game.time;
    }
    return { firstObserved, firstDamage, hp: harvester.hp };
  };
  const oldRules = run(47);
  const currentRules = run(AI_ECONOMY_RECON_RULES_VERSION);
  assert.equal(oldRules.firstDamage, null);
  assert.ok(currentRules.firstObserved < 70, `Harvester first observed at ${currentRules.firstObserved}`);
  assert.ok(currentRules.firstDamage < 80, `Harvester first hit at ${currentRules.firstDamage}`);
  assert.ok(currentRules.hp < 610);
});

test('Raider reconnaissance never assigns an unseen Harvester and yields a strike unit to emergency defense', () => {
  const game = new Game({ seed: 2, aiCommanderProfileId: 'raider' });
  game.replayVersion = AI_ECONOMY_RECON_RULES_VERSION;
  const harvester = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  const scout = game._createUnit('enemy', 'scout', harvester.x + 9, harvester.y);
  assert.equal(game.isVisible(harvester, 'enemy'), false);
  game._aiRaidHarvesters([scout]);
  assert.equal(scout._aiRaidTarget, undefined);

  scout._aiRaidTarget = harvester.id;
  scout._aiDefenseTarget = 'visible-threat';
  scout.order = { type: 'attack', targetId: 'visible-threat', aiDefense: true };
  game._aiRaidHarvesters([scout]);
  assert.equal(scout._aiRaidTarget, null);
  assert.equal(scout.order.targetId, 'visible-threat');
});

test('Raider recon releases its screen after Harvester intel and replenishes a lost escort', () => {
  const game = new Game({ seed: 80218, aiCommanderProfileId: 'raider' });
  game.replayVersion = AI_ECONOMY_RECON_RULES_VERSION;
  game._aiIntel = [];
  const scout = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'scout');
  const units = game.units.filter(unit => unit.owner === 'enemy' && unit.defId !== 'harvester');
  game._aiScout(units);
  const escort = units.find(unit => unit.order?.aiScoutEscort === scout.id);
  assert.ok(scout.order.aiScout);
  assert.ok(escort);

  game._aiIntel = [{ id: 'player-harvester', defId: 'harvester', building: false,
    x: 12, y: 34, seen: game.time }];
  game._aiScout(units);
  assert.equal(scout.order.type, 'idle');
  assert.equal(escort.order.type, 'idle');

  game.time += 36;
  game._aiIntel = [];
  const replacement = game._createUnit('enemy', 'buggy', 40, 20);
  game._aiScout([...units.filter(unit => unit !== escort), replacement]);
  assert.equal(replacement.order.aiScoutEscort, scout.id);
});

test('Raider sweep goals snap to passable terrain on both route variants', () => {
  for (const [mapId, mapVariant] of [['twin-passes', 0], ['twin-passes', 1],
    ['canyon-ring', 0], ['canyon-ring', 1], ['storm-basin', 0]]) {
    const game = new Game({ seed: 80218, mapId, mapVariant, aiCommanderProfileId: 'raider' });
    game.replayVersion = AI_ECONOMY_RECON_RULES_VERSION;
    game._aiIntel = [];
    const scout = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'scout');
    game._aiScout(game.units.filter(unit => unit.owner === 'enemy' && unit.defId !== 'harvester'));
    assert.ok(scout.order.aiScout, `${mapId} variant ${mapVariant} should start recon`);
    assert.equal(game._isPassable(Math.floor(scout.order.x), Math.floor(scout.order.y)), true,
      `${mapId} variant ${mapVariant} goal should be passable`);
  }
});

test('Cadet Raider reconnaissance waits through the 45-second opening window', () => {
  const game = new Game({ seed: 80218, difficulty: 'easy', aiCommanderProfileId: 'raider' });
  game.replayVersion = AI_ECONOMY_RECON_RULES_VERSION;
  game._aiIntel = [];
  const scout = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'scout');
  const units = game.units.filter(unit => unit.owner === 'enemy' && unit.defId !== 'harvester');
  game.time = 44.9;
  game._aiScout(units);
  assert.notEqual(scout.order?.aiScout, true);
  game.time = 45;
  game._aiScout(units);
  assert.equal(scout.order.aiScout, true);
});

test('v48 Raider scouting and strike state remain deterministic across save and load', () => {
  const game = new Game({ seed: 80218, difficulty: 'normal', aiCommanderProfileId: 'raider' });
  game.replayVersion = AI_ECONOMY_RECON_RULES_VERSION;
  for (let step = 0; step < 520; step++) game.update(0.1);
  assert.equal(game.aiEconomyReconRulesVersion, AI_ECONOMY_RECON_RULES_VERSION);
  const resumed = Game.deserialize(game.serialize());
  assert.equal(resumed.replayVersion, AI_ECONOMY_RECON_RULES_VERSION);
  for (let step = 0; step < 300; step++) {
    game.update(0.1);
    resumed.update(0.1);
  }
  const aiState = state => JSON.stringify({
    time: state.time,
    randomState: state.randomState,
    scoutStep: state._aiScoutStep,
    intel: state._aiIntel,
    units: state.units.filter(unit => unit.owner === 'enemy').map(unit => ({
      id: unit.id, defId: unit.defId, x: unit.x, y: unit.y, hp: unit.hp,
      order: unit.order, raidTarget: unit._aiRaidTarget, relayAssignment: unit._relayAssignment,
      defenseTarget: unit._aiDefenseTarget,
    })),
  });
  assert.equal(aiState(resumed), aiState(game));
});
