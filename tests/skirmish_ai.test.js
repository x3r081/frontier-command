import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

const enemyCombat = game => game.units.filter(u => u.owner === 'enemy' &&
  !['harvester', 'engineer', 'medic'].includes(u.defId));

test('unseen player structures are probed instead of targeted through fog', () => {
  const game = new Game({ seed: 41 });
  assert.equal(game._launchAiWave(), true);
  const wave = enemyCombat(game).filter(u => u.order.type === 'move' && u.order.attackMove);
  assert.ok(wave.length >= 3);
  assert.ok(wave.every(u => u.order.x === 12 && u.order.y === 37 && !u.order.targetId));
  assert.equal(game._aiIntel.length, 0);
});

test('assaults use observed positions and stop tracking a target after losing sight', () => {
  const game = new Game({ seed: 42 });
  game.replayVersion = 5;
  const scout = game.units.find(u => u.owner === 'enemy' && u.defId === 'scout');
  const command = game.buildings.find(b => b.owner === 'player' && b.defId === 'command');
  scout.x = command.x + 3.5; scout.y = command.y + 1.5;
  assert.equal(game._launchAiWave(), true);
  const attacker = enemyCombat(game).find(u => u.order.type === 'attack');
  assert.equal(attacker.order.targetId, command.id);
  const lastX = attacker.order.lastX, lastY = attacker.order.lastY;
  scout.x = 45.5; scout.y = 14.5;
  assert.equal(game.isVisible(command, 'enemy'), false);
  game._updateUnit(attacker, 0.1);
  assert.equal(attacker.order.type, 'move');
  assert.equal(attacker.order.x, lastX);
  assert.equal(attacker.order.y, lastY);
});

test('new skirmish assault target choice favors a nearby objective while version 5 keeps legacy priority', () => {
  const selectedTarget = replayVersion => {
    const game = new Game({ seed: 42 });
    game.replayVersion = replayVersion;
    const refinery = game.buildings.find(b => b.owner === 'player' && b.defId === 'refinery');
    const army = enemyCombat(game);
    army.forEach((unit, index) => {
      unit.x = refinery.x + (index % 2);
      unit.y = refinery.y + 0.5;
    });
    assert.equal(game._launchAiWave(), true);
    return army.find(unit => unit.order.type === 'attack')?.order.targetId;
  };

  const game = new Game({ seed: 42 });
  const commandId = game.buildings.find(b => b.owner === 'player' && b.defId === 'command').id;
  const refineryId = game.buildings.find(b => b.owner === 'player' && b.defId === 'refinery').id;
  assert.equal(selectedTarget(5), commandId, 'version 5 retains its fixed command priority');
  assert.equal(selectedTarget(6), refineryId, 'new rules attack the nearby refinery');
});

test('version 22 builds a siege specialist into the first objective team while version 21 preserves its roster order', () => {
  const launch = replayVersion => {
    const game = new Game({ seed: 420, difficulty: 'normal' });
    game.replayVersion = replayVersion;
    for (const unit of game.units.filter(unit => unit.owner === 'enemy')) unit.hp = 0;
    const target = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
    const observer = game._createUnit('enemy', 'scout', target.x + 2, target.y + 1);
    observer.order = { type: 'move', x: observer.x, y: observer.y, aiScout: true };
    const force = ['lightTank', 'artillery', 'rocket'].map((defId, i) =>
      game._createUnit('enemy', defId, target.x + 3 + i, target.y + 2));
    game._aiIntel = [{ id: target.id, defId: 'command', x: target.x, y: target.y,
      building: true, seen: game.time }];
    assert.equal(game.isVisible(target, 'enemy'), true);
    assert.equal(game._launchAiWave(), true);
    return { force, targetId: target.id };
  };
  const legacy = launch(21);
  const current = launch(22);
  assert.equal(legacy.force[0].order.targetId, legacy.targetId,
    'legacy selection keeps the original first eligible unit');
  assert.equal(current.force[1].order.aiTeamRole, 'siege');
  assert.ok(current.force.every(unit => unit.order.aiTeam === 0), 'one wave shares a stable team identifier');
  assert.ok(current.force.every(unit => unit.order.targetId === current.force[1].order.targetId));
});

test('version 22 production fills counter and frontline roles before random variety', () => {
  const game = new Game({ seed: 421, difficulty: 'normal', faction: 'aegis' });
  game.replayVersion = 22;
  const enemyBuildings = game.buildings.filter(building => building.owner === 'enemy');
  const count = defId => enemyBuildings.filter(building => building.defId === defId).length;
  const result = game._aiChooseTeamUnit({ r: 0.99, infantry: false,
    recent: [{ defId: 'orca' }], recentIntel: [{ defId: 'command', building: true }],
    air: 1, armor: 0, rockets: 0, stealthTanks: 0, needAirRockets: true,
    needAntiArmor: false, needVesperArmor: false, combatUnits: [], enemyBuildings, count });
  assert.equal(result, 'rocket', 'air sightings add an anti-air counter to the planned force');
  const withCounters = game._aiChooseTeamUnit({ r: 0.99, infantry: false,
    recent: [], recentIntel: [{ defId: 'factory', building: true }], air: 0, armor: 0,
    rockets: 0, stealthTanks: 0, needAirRockets: false, needAntiArmor: false,
    needVesperArmor: false, combatUnits: [], enemyBuildings, count: defId => defId === 'radar' ? 1 : count(defId) });
  assert.equal(withCounters, 'artillery', 'radar plus observed production enables deliberate siege investment');
});

function enableEnemyRadar(game) {
  const radar = game._createBuilding('enemy', 'radar', 57, 18, 1);
  game._refreshPower();
  game.credits.enemy = 4000;
  return radar;
}

test('Aegis AI queues one medic only when radar is active and infantry need healing', () => {
  const game = new Game({ seed: 423, faction: 'vesper', difficulty: 'normal' });
  enableEnemyRadar(game);
  const barracks = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'barracks');
  game._aiTick();
  assert.equal(barracks.queue.some(item => item.defId === 'medic'), false,
    'healthy infantry do not justify medic production');

  const rifle = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'rifle');
  rifle.hp -= 45;
  game._aiTick();
  assert.equal(barracks.queue.filter(item => item.defId === 'medic').length, 1,
    'a wounded squad justifies one field medic');
  game._aiTick();
  assert.equal(barracks.queue.filter(item => item.defId === 'medic').length, 1,
    'the AI keeps its medic roster bounded to one');

  const unresearched = new Game({ seed: 426, faction: 'vesper', difficulty: 'normal' });
  const unresearchedRifle = unresearched.units.find(unit => unit.owner === 'enemy' && unit.defId === 'rifle');
  unresearchedRifle.hp -= 45;
  unresearched._aiTick();
  assert.equal(unresearched.buildings.filter(building => building.owner === 'enemy')
    .some(building => building.queue.some(item => item.defId === 'medic')), false,
  'wounded infantry do not bypass the Radar prerequisite');
});

test('AI medics follow a healthy infantry escort near wounded troops and stay out of assault waves', () => {
  const game = new Game({ seed: 424, faction: 'vesper', difficulty: 'normal' });
  for (const unit of game.units.filter(unit => unit.owner === 'enemy')) unit.hp = 0;
  const patient = game._createUnit('enemy', 'rifle', 25.5, 20.5);
  patient.hp = 50;
  const escort = game._createUnit('enemy', 'rifle', 25.5, 21.5);
  const flank = game._createUnit('enemy', 'rifle', 26.5, 21.5);
  const medic = game._createUnit('enemy', 'medic', 24.5, 21.5);

  game._aiSupportMedics();
  assert.deepEqual(medic.order, { type: 'follow', targetId: escort.id, aiMedicEscort: true },
    'a healthy nearby infantry unit escorts the medic while remaining within healing range');
  const healthBefore = patient.hp;
  game._updateUnit(medic, 1.5);
  assert.equal(patient.hp, Math.min(patient.maxHp, healthBefore + 22), 'the medic heals the nearby wounded rifle');

  assert.equal(game._launchAiWave(), true);
  assert.equal(medic.order.type, 'follow', 'the medic keeps its support order instead of joining the assault');
  assert.equal(medic.order.aiTeam, undefined);
  assert.ok([escort, flank, patient].every(unit => unit.order.type === 'move' || unit.order.type === 'attack'));
});

test('AI medic does not idle when every surviving infantry escort is wounded', () => {
  const game = new Game({ seed: 427, faction: 'vesper', difficulty: 'normal' });
  for (const unit of game.units.filter(unit => unit.owner === 'enemy')) unit.hp = 0;
  const critical = game._createUnit('enemy', 'rifle', 25.5, 20.5);
  critical.hp = 24;
  const sturdier = game._createUnit('enemy', 'rifle', 26.5, 20.5);
  sturdier.hp = 55;
  const medic = game._createUnit('enemy', 'medic', 54.5, 19.5);
  game._aiSupportMedics();
  assert.deepEqual(medic.order, { type: 'follow', targetId: sturdier.id, aiMedicEscort: true });
});

test('v22 skirmish replay AI does not inherit the later medic production rule', () => {
  const game = new Game({ seed: 425, faction: 'vesper', difficulty: 'normal' });
  game.replayVersion = 22;
  enableEnemyRadar(game);
  const rifle = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'rifle');
  rifle.hp -= 45;
  game._aiTick();
  assert.equal(game.buildings.filter(building => building.owner === 'enemy')
    .some(building => building.queue.some(item => item.defId === 'medic')), false);
});

test('version 22 objective teams reserve an escort and alternate exposed economy and command targets', () => {
  const game = new Game({ seed: 422, difficulty: 'normal' });
  game.replayVersion = 22;
  for (const unit of game.units.filter(unit => unit.owner === 'enemy')) unit.hp = 0;
  const command = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const refinery = game.buildings.find(building => building.owner === 'player' && building.defId === 'refinery');
  const observer = game._createUnit('enemy', 'scout', command.x + 2, command.y + 1);
  observer.order = { type: 'move', x: observer.x, y: observer.y, aiScout: true };
  const force = [
    ...Array.from({ length: 8 }, (_, i) => game._createUnit('enemy', 'artillery', command.x + 3 + i, command.y + 2)),
    ...Array.from({ length: 2 }, (_, i) => game._createUnit('enemy', 'lightTank', command.x + 4 + i, command.y + 3)),
  ];
  game._aiIntel = [command, refinery].map(building => ({ id: building.id, defId: building.defId,
    x: building.x, y: building.y, building: true, seen: game.time }));

  assert.equal(game._launchAiWave(), true);
  const firstTeam = force.filter(unit => unit.order.aiTeam === 0);
  assert.equal(firstTeam.length, 5, 'team stays within the existing first-wave size cap');
  assert.ok(firstTeam.some(unit => ['line', 'screen'].includes(unit.order.aiTeamRole)),
    'a specialist-heavy packet reserves at least one escort');
  assert.ok(firstTeam.some(unit => unit.order.aiTeamRole === 'siege'));
  assert.ok(firstTeam.every(unit => ['factory', 'refinery'].includes(game.getEntity(unit.order.targetId)?.defId)),
    'first objective favors the observed economy');

  assert.equal(game._launchAiWave(), true);
  const secondTeam = force.filter(unit => unit.order.aiTeam === 1);
  assert.equal(secondTeam.length, 5);
  assert.ok(secondTeam.every(unit => unit.order.targetId === command.id),
    'the next comparable wave pressures the command structure');
});

test('AI diverts a limited squad to a visible threat near a harvester, then releases it', () => {
  const game = new Game({ seed: 43, difficulty: 'normal' });
  const harvester = game.units.find(u => u.owner === 'enemy' && u.defId === 'harvester');
  const threat = game._createUnit('player', 'lightTank', harvester.x + 2, harvester.y);
  game._aiTick();
  const defenders = enemyCombat(game).filter(u => u._aiDefenseTarget === threat.id);
  assert.ok(defenders.length > 0 && defenders.length <= 3);
  assert.ok(defenders.every(u => u.order.type === 'attack' && u.order.targetId === threat.id));
  threat.x = 25; threat.y = 40;
  game._aiTick();
  assert.ok(defenders.every(u => !u._aiDefenseTarget && u.order.type !== 'attack'));
});

test('v56 harvesters retreat on visible ground threats while v55 keeps harvesting', () => {
  const setup = replayVersion => {
    const game = new Game({ seed: 56, difficulty: 'normal' });
    game.replayVersion = replayVersion;
    const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
    harvester.cargo = 320;
    harvester._harvestPhase = 'field';
    harvester._harvestTile = { x: 53, y: 18 };
    const threat = game._createUnit('player', 'lightTank', harvester.x + 3, harvester.y);
    return { game, harvester, threat };
  };
  const legacy = setup(55);
  legacy.game._aiRetreatHarvesters();
  assert.equal(legacy.harvester._harvestPhase, 'field');
  assert.deepEqual(legacy.harvester._harvestTile, { x: 53, y: 18 });

  const current = setup(56);
  assert.equal(current.game.isVisible(current.threat, 'enemy'), true);
  current.game._aiRetreatHarvesters();
  assert.equal(current.harvester.order.type, 'harvest', 'the normal harvest cycle remains active');
  assert.equal(current.harvester._harvestPhase, 'return', 'a visible attacker triggers a dock retreat');
  assert.equal(current.harvester.cargo, 320, 'the retreat carries its gathered cargo back to safety');
  assert.equal(current.harvester._harvestTile, null, 'the exposed field assignment is released');
  for (let i = 0; i < 1800 && current.harvester._harvestPhase === 'return'; i++)
    current.game._updateHarvester(current.harvester, 0.1);
  assert.equal(current.harvester.cargo, 0, 'the harvester unloads its cargo at the refinery');
  assert.equal(current.harvester._harvestPhase, 'field', 'the harvester resumes its ordinary work cycle');

  const hidden = setup(56);
  const originalVisible = hidden.game.isVisible.bind(hidden.game);
  hidden.game.isVisible = (entity, owner) => entity.id === hidden.threat.id && owner === 'enemy'
    ? false : originalVisible(entity, owner);
  hidden.game._aiRetreatHarvesters();
  assert.equal(hidden.harvester._harvestPhase, 'field', 'unseen threats do not inform the AI');
});

test('v56 harvesters do not retreat to a field threat outside the danger radius', () => {
  const game = new Game({ seed: 5601, difficulty: 'normal' });
  game.replayVersion = 56;
  const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
  harvester._harvestPhase = 'field';
  const threat = game._createUnit('player', 'lightTank', harvester.x + 6, harvester.y);
  const isVisible = game.isVisible.bind(game);
  game.isVisible = (entity, owner) => entity.id === threat.id && owner === 'enemy' ? true : isVisible(entity, owner);
  game._aiRetreatHarvesters();
  assert.equal(harvester._harvestPhase, 'field');
});

test('an unversioned save without the v56 retreat marker keeps v55 skirmish AI', () => {
  const game = new Game({ seed: 5602 });
  const save = JSON.parse(game.serialize());
  save.replayVersion = null;
  delete save.aiHarvesterRetreatRulesVersion;
  assert.equal(Game.deserialize(save).replayVersion, 55);
});

test('current skirmish AI contests a visible medic supporting an assault near its assets', () => {
  const make = (replayVersion, mode = 'skirmish') => {
    const game = new Game({ seed: 44, difficulty: 'normal' });
    game.replayVersion = replayVersion;
    game.mode = mode;
    for (const unit of game.units.filter(unit => unit.owner === 'player')) unit.hp = 0;
    const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
    const medic = game._createUnit('player', 'medic', harvester.x + 1.2, harvester.y);
    const rifle = game._createUnit('player', 'rifle', harvester.x + 1.8, harvester.y + 0.4);
    const defenders = enemyCombat(game);
    game._aiDefend(defenders);
    return { game, medic, rifle, defenders };
  };

  const current = make(null);
  assert.ok(current.defenders.some(unit => unit.order?.targetId === current.medic.id),
    'the capped defensive response can pressure a medic only while it supports a nearby armed unit');
  assert.ok(current.defenders.filter(unit => unit._aiDefenseTarget === current.medic.id).length <= 3);

  const replay = make(22);
  assert.ok(!replay.defenders.some(unit => unit.order?.targetId === replay.medic.id),
    'older replays retain their historical response to armed threats only');
  assert.ok(replay.defenders.some(unit => unit._aiDefenseTarget === replay.rifle.id));

  const campaign = make(null, 'campaign');
  assert.ok(!campaign.defenders.some(unit => unit.order?.targetId === campaign.medic.id),
    'authored campaign defense does not inherit the skirmish support-target rule');
});

function relayResponseFixture(replayVersion = 37) {
  const game = new Game({ seed: 437, difficulty: 'normal' });
  game.replayVersion = replayVersion;
  for (const unit of game.units.filter(unit => unit.owner === 'enemy')) unit.hp = 0;
  for (const relay of game.relays) relay.owner = null;
  const target = game.relays[0];
  target.owner = 'player'; target.x = 52.5; target.y = 13.5;
  game.relayDominion = { owner: 'player', elapsed: 20, required: 90, majority: 2 };
  // Keep the fixture's path graph small and explicit: the dividing line models
  // a fully blocked crossing, while the response tests still use production
  // component-based reachability logic.
  game._groundComponents = () => {
    const result = new Int32Array(game.width * game.height);
    for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++)
      result[y * game.width + x] = x < 40 ? 0 : 1;
    return result;
  };
  const attackers = [
    game._createUnit('enemy', 'lightTank', 49.5, 12.5, { type: 'attack', targetId: 'player-command' }),
    game._createUnit('enemy', 'buggy', 50.5, 13.5, { type: 'attack', targetId: 'player-refinery' }),
    game._createUnit('enemy', 'guardian', 48.5, 13.5, { type: 'attack', targetId: 'player-factory' }),
    game._createUnit('enemy', 'scout', 45.5, 13.5, { type: 'attack', targetId: 'player-command' }),
  ];
  const home = [
    game._createUnit('enemy', 'rifle', 54.5, 11.5, { type: 'guard', x: 54.5, y: 11.5 }),
    game._createUnit('enemy', 'rocket', 55.5, 12.5, { type: 'guard', x: 55.5, y: 12.5 }),
  ];
  return { game, target, attackers, home };
}

test('v37 relay response recalls the nearest assault units only after the ordinary pool is exhausted', () => {
  const { game, target, attackers, home } = relayResponseFixture();
  game._aiStrategicRelays([...attackers, ...home]);
  const recalled = attackers.filter(unit => unit._relayAssignment === target.id);
  assert.deepEqual(recalled.map(unit => unit.id), attackers.slice(0, 3).map(unit => unit.id),
    'the three nearest otherwise unavailable attackers are recalled to pause the countdown');
  assert.ok(recalled.every(unit => unit.order.aiRelayResponse && unit.order.relayId === target.id));
  assert.equal(attackers[3].order.type, 'attack', 'the farther assault unit keeps its existing order');
  assert.ok(home.every(unit => unit.order.type === 'guard' && !unit._relayAssignment),
    'the response keeps two non-defense-responder units at home');
  assert.deepEqual(attackers[0]._aiRelayResponseOrder,
    { type: 'attack', targetId: 'player-command' }, 'the exact original assault order is retained');
});

test('v39 sends one urgent responder through contact until it enters the visible relay radius', () => {
  const { game, target, attackers, home } = relayResponseFixture(39);
  attackers[1].x = 49.5;
  attackers[1].y = 11.5;
  home[0].x = 57.5; home[0].y = 12.5;
  home[1].x = 58.5; home[1].y = 12.5;
  const priorOrder = { type: 'attack', targetId: 'player-refinery' };
  const garrison = game._createUnit('enemy', 'rifle', 49.6, 13.5, priorOrder);
  game._createUnit('player', 'rifle', 50.5, 13.5);

  assert.equal(game.isVisible({ x: target.x, y: target.y, owner: 'player' }, 'enemy'), true);
  game._aiStrategicRelays([...attackers, ...home, garrison]);

  const urgent = [...attackers, ...home, garrison].filter(unit => unit._aiRelayUrgentRelayId === target.id);
  assert.equal(urgent.length, 1, 'one prioritized responder is committed');
  assert.equal(urgent[0], garrison, 'the nearby long-range garrison is pulled into the response');
  assert.equal(urgent[0]._relayAssignment, target.id);
  assert.deepEqual(urgent[0]._aiRelayResponseOrder, priorOrder,
    'the garrison order is saved exactly before the urgent move');
  assert.equal(urgent[0]._aiRelayResponsePriorAssignment, null,
    'the original relay assignment is retained for restoration');
  assert.equal(urgent[0].order.type, 'move');
  assert.equal(urgent[0].order.attackMove, undefined,
    'urgent movement does not stop to fire before reaching the capture radius');

  for (let i = 0; i < 500 && Math.hypot(urgent[0].x - target.x, urgent[0].y - target.y) > 2.3 && urgent[0].hp > 0; i++)
    game._updateUnit(urgent[0], 0.1);
  assert.ok(Math.hypot(urgent[0].x - target.x, urgent[0].y - target.y) <= 2.3,
    'the urgent responder actually enters Relay Dominion contest range');

  game.relayDominion.owner = null;
  game._aiStrategicRelays([...attackers, ...home, garrison]);
  assert.deepEqual(urgent[0].order, priorOrder, 'the garrison resumes its exact prior order');
  assert.equal(urgent[0]._relayAssignment, null, 'the prior unassigned state is restored');
  assert.equal(urgent[0]._aiRelayUrgentRelayId, null);
});

test('v39 counterattacks only visible player relays and v38 keeps attack-move responses', () => {
  const unseen = relayResponseFixture(39);
  unseen.target.y = 30.5;
  assert.equal(unseen.game.isVisible({ x: unseen.target.x, y: unseen.target.y, owner: 'player' }, 'enemy'), false);
  unseen.game._aiStrategicRelays([...unseen.attackers, ...unseen.home]);
  assert.equal(unseen.game._aiRelayTarget, null,
    'v39 does not use hidden player ownership to pick a countdown target');
  assert.ok([...unseen.attackers, ...unseen.home].every(unit => !unit._aiRelayUrgentRelayId));

  const legacy = relayResponseFixture(38);
  legacy.game._aiStrategicRelays([...legacy.attackers, ...legacy.home]);
  const legacyResponders = [...legacy.attackers, ...legacy.home]
    .filter(unit => unit._aiRelayResponseRelayId === legacy.target.id);
  assert.ok(legacyResponders.length > 0);
  assert.ok(legacyResponders.every(unit => unit.order.attackMove === true && !unit._aiRelayUrgentRelayId),
    'v38 retains its prior attack-move response behavior');
});

test('v40 scouts one reachable public relay during a blind countdown, then contests only after sight', () => {
  const setup = replayVersion => {
    const { game } = relayResponseFixture(replayVersion);
    const [first, second, owned] = game.relays;
    first.owner = second.owner = 'player';
    first.x = 20.5; first.y = 24.5;
    second.x = 30.5; second.y = 25.5;
    owned.owner = 'enemy';
    game._groundComponents = () => new Int32Array(game.width * game.height);
    const fighters = [
      game._createUnit('enemy', 'rifle', 49.5, 13.5),
      game._createUnit('enemy', 'rocket', 50.5, 13.5),
    ];
    fighters[0].order = { type: 'guard', x: 49.5, y: 13.5, stance: 'defensive' };
    assert.ok([first, second].every(relay =>
      !game.isVisible({ x: relay.x, y: relay.y, owner: 'player' }, 'enemy')));
    return { game, fighters, first, second };
  };

  const legacy = setup(39);
  legacy.game._aiStrategicRelays(legacy.fighters);
  assert.ok(legacy.fighters.every(unit => !unit._relayAssignment),
    'version 39 retains its two-unit home reserve when no relay is visible');

  const current = setup(40);
  const priorOrders = new Map(current.fighters.map(unit => [unit.id, structuredClone(unit.order)]));
  current.game._aiStrategicRelays(current.fighters);
  const recon = current.fighters.find(unit => unit._relayAssignment);
  assert.ok(recon, 'one available ground squad checks a public site');
  assert.equal(current.fighters.filter(unit => unit._relayAssignment).length, 1);
  assert.equal(current.game._aiRelayTarget, null, 'hidden ownership does not become an urgent target');
  assert.equal(recon.order.attackMove, true, 'the blind approach remains an ordinary cautious move');
  const destination = current.game.relays.find(relay => relay.id === recon._relayAssignment);
  assert.ok([current.first, current.second].includes(destination));
  const loadedRecon = Game.deserialize(current.game.serialize());
  assert.deepEqual(loadedRecon.getEntity(recon.id).order, recon.order);
  loadedRecon._groundComponents = () => new Int32Array(loadedRecon.width * loadedRecon.height);
  loadedRecon.relayDominion.owner = null;
  loadedRecon._aiStrategicRelays(current.fighters.map(unit => loadedRecon.getEntity(unit.id)));
  assert.deepEqual(loadedRecon.getEntity(recon.id).order, priorOrders.get(recon.id),
    'the saved scout restores its exact prior order when the countdown ends');

  recon.x = destination.x; recon.y = destination.y - 4;
  assert.equal(current.game.isVisible({ x: destination.x, y: destination.y, owner: 'player' }, 'enemy'), true);
  current.game._aiStrategicRelays(current.fighters);
  assert.equal(current.game._aiRelayTarget, destination.id);
  assert.ok(current.fighters.some(unit => unit._aiRelayUrgentRelayId === destination.id),
    'a live observation promotes the recon into the existing direct contest response');
  current.game.relayDominion.owner = null;
  current.game._aiStrategicRelays(current.fighters);
  assert.deepEqual(recon.order, priorOrders.get(recon.id),
    'the promoted responder also resumes its pre-scout order');

  const saved = JSON.parse(current.game.serialize());
  delete saved.relayDominionReconRulesVersion;
  saved.replayVersion = null;
  assert.equal(Game.deserialize(saved).replayVersion, 39,
    'an unversioned pre-v40 save retains its earlier relay policy');
});

test('v40 blind recon selects the same public site for each hidden owner state', () => {
  const selected = owner => {
    const { game } = relayResponseFixture(40);
    const [first, second, owned] = game.relays;
    first.x = 20.5; first.y = 24.5; first.owner = owner;
    second.x = 30.5; second.y = 25.5; second.owner = 'player';
    owned.owner = 'enemy';
    game._groundComponents = () => new Int32Array(game.width * game.height);
    const originalVisible = game.isVisible.bind(game);
    game.isVisible = (entity, viewer) => viewer === 'enemy' &&
      [first, second].some(relay => entity.x === relay.x && entity.y === relay.y)
      ? false : originalVisible(entity, viewer);
    const fighters = [game._createUnit('enemy', 'rifle', 49.5, 13.5),
      game._createUnit('enemy', 'rocket', 50.5, 13.5)];
    game._aiStrategicRelays(fighters);
    return fighters.find(unit => unit._relayAssignment)?.order?.relayId;
  };
  assert.ok(selected('player'));
  assert.equal(selected(null), selected('player'));
  assert.equal(selected('enemy'), selected('player'));
});

test('v40 blind recon yields to protected tasks and an emergency defense order', () => {
  const { game } = relayResponseFixture(40);
  for (const relay of game.relays.slice(0, 2)) {
    relay.owner = 'player'; relay.x = 20.5 + (relay.id === game.relays[1].id ? 10 : 0); relay.y = 24.5;
  }
  game._groundComponents = () => new Int32Array(game.width * game.height);
  const defender = game._createUnit('enemy', 'rifle', 49.5, 13.5);
  const raider = game._createUnit('enemy', 'buggy', 50.5, 13.5);
  defender._aiDefenseTarget = 'visible-threat';
  raider._aiRaidTarget = 'visible-harvester';
  game._aiStrategicRelays([defender, raider]);
  assert.ok([defender, raider].every(unit => !unit._relayAssignment));

  defender._aiDefenseTarget = null;
  game._aiStrategicRelays([defender, raider]);
  assert.ok(defender._aiRelayReconRelayId);
  assert.ok(!raider._relayAssignment);
  defender._aiDefenseTarget = 'visible-threat';
  defender._relayAssignment = null;
  defender.order = { type: 'attack', targetId: 'visible-threat', aiDefense: true };
  game._aiStrategicRelays([defender, raider]);
  assert.deepEqual(defender.order, { type: 'attack', targetId: 'visible-threat', aiDefense: true });
  assert.equal(defender._aiRelayReconRelayId, null);
  assert.equal(defender._aiRelayResponseOrder, null);
});

test('v41 funds a lost final refinery from surplus defenses and restarts loaded harvesters', () => {
  const setup = replayVersion => {
    const game = new Game({ seed: 61041, difficulty: 'normal', victoryMode: 'elimination' });
    game.replayVersion = replayVersion;
    const lostRefinery = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'refinery');
    lostRefinery.hp = 0;
    lostRefinery._dead = true;
    for (let i = 0; i < 3; i++) game._createBuilding('enemy', 'turret', 2 + i, 2, 1);
    const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
    harvester.cargo = 700;
    harvester._harvestPhase = 'return';
    harvester.order = { type: 'idle' };
    game.credits.enemy = 836;
    game._refreshPower();
    return { game, harvester };
  };
  const legacy = setup(40);
  legacy.game._aiTick();
  assert.equal(legacy.game.buildings.filter(building => building.owner === 'enemy' &&
    building.defId === 'refinery' && building.hp > 0).length, 0);
  assert.equal(legacy.harvester.order.type, 'idle');

  const { game, harvester } = setup(41);
  game._aiTick();
  const replacement = game.buildings.find(building => building.owner === 'enemy' &&
    building.defId === 'refinery' && building.hp > 0);
  assert.ok(replacement, 'the AI funds and places one replacement refinery');
  assert.equal(game.buildings.filter(building => building.owner === 'enemy' &&
    building.defId === 'turret' && building.hp > 0).length, 1,
  'at most two surplus turrets are sold, leaving a defense standing');
  assert.equal(harvester.order.type, 'idle', 'harvesters wait for a working refinery');

  const loaded = Game.deserialize(game.serialize());
  const loadedRefinery = loaded.getEntity(replacement.id);
  loadedRefinery.progress = 1;
  loaded._refreshPower();
  loaded._aiTick();
  const resumed = loaded.getEntity(harvester.id);
  assert.equal(resumed.order.type, 'harvest', 'a saved loaded harvester resumes its return trip');
  assert.equal(resumed._harvestPhase, 'return');
  resumed.x = loadedRefinery.x + loadedRefinery.w + 0.4;
  resumed.y = loadedRefinery.y + loadedRefinery.h / 2;
  const creditsBefore = loaded.credits.enemy;
  loaded._updateHarvester(resumed, 3);
  assert.equal(loaded.credits.enemy, creditsBefore + 700, 'the recovered dock can realize its cargo');

  const oldSave = JSON.parse(game.serialize());
  oldSave.replayVersion = null;
  delete oldSave.economyRecoveryRulesVersion;
  assert.equal(Game.deserialize(oldSave).replayVersion, 40);
});

test('v41 urgent relay response crosses a short fog gap using only its last observed site', () => {
  const setup = replayVersion => {
    const { game, target, attackers, home } = relayResponseFixture(replayVersion);
    let visible = true;
    const originalVisible = game.isVisible.bind(game);
    game.isVisible = (entity, owner) => owner === 'enemy' &&
      entity.x === target.x && entity.y === target.y ? visible : originalVisible(entity, owner);
    const combat = [...attackers, ...home];
    game._aiStrategicRelays(combat);
    const responder = combat.find(unit => unit._aiRelayUrgentRelayId === target.id);
    assert.ok(responder);
    return { game, target, combat, responder, hide: () => { visible = false; } };
  };

  const legacy = setup(40);
  legacy.hide(); legacy.game.time = 2;
  legacy.game._aiStrategicRelays(legacy.combat);
  assert.equal(legacy.responder._aiRelayUrgentRelayId, null,
    'version 40 releases an urgent order immediately when sight drops');

  const current = setup(41);
  const priorOrder = structuredClone(current.responder._aiRelayResponseOrder);
  current.hide(); current.game.time = 2;
  current.game._aiStrategicRelays(current.combat);
  assert.equal(current.responder._aiRelayUrgentRelayId, current.target.id);
  assert.equal(current.responder.order.aiRelayUrgent, true);
  assert.equal(current.responder._aiRelayUrgentLastSeenAt, 0);
  const saved = Game.deserialize(current.game.serialize());
  saved.isVisible = (entity, owner) => owner === 'enemy' &&
    entity.x === current.target.x && entity.y === current.target.y ? false :
    Game.prototype.isVisible.call(saved, entity, owner);
  const restored = saved.getEntity(current.responder.id);
  saved.time = 8;
  saved._aiStrategicRelays(current.combat.map(unit => saved.getEntity(unit.id)));
  assert.equal(restored._aiRelayUrgentRelayId, current.target.id,
    'save/load preserves the short continuation window');
  saved.time = 12;
  saved._aiStrategicRelays(current.combat.map(unit => saved.getEntity(unit.id)));
  assert.equal(restored._aiRelayUrgentRelayId, null, 'the remembered site expires without renewed sight');
  assert.deepEqual(restored.order, priorOrder);
  const oldSave = JSON.parse(current.game.serialize());
  oldSave.replayVersion = null;
  delete oldSave.relayResponsePersistenceRulesVersion;
  assert.equal(Game.deserialize(oldSave).replayVersion, 40);
});

test('v41 fog continuation yields to defense and releases a relay observed changing hands', () => {
  const { game, target, attackers, home } = relayResponseFixture(41);
  const combat = [...attackers, ...home];
  game._aiStrategicRelays(combat);
  const responder = combat.find(unit => unit._aiRelayUrgentRelayId === target.id);
  assert.ok(responder);
  responder._aiDefenseTarget = 'visible-threat';
  responder._relayAssignment = null;
  responder.order = { type: 'attack', targetId: 'visible-threat', aiDefense: true };
  game.time = 2;
  game._aiStrategicRelays(combat);
  assert.equal(responder._aiRelayUrgentRelayId, null);
  assert.deepEqual(responder.order, { type: 'attack', targetId: 'visible-threat', aiDefense: true });

  responder._aiDefenseTarget = null;
  game._aiStrategicRelays(combat);
  const next = combat.find(unit => unit._aiRelayUrgentRelayId === target.id);
  assert.ok(next);
  target.owner = 'enemy';
  game.time = 4;
  game._aiStrategicRelays(combat);
  assert.equal(next._aiRelayUrgentRelayId, null,
    'a visible relay that changed hands is no longer treated as the remembered player site');
});

test('v39 keeps the visible countdown target stable and releases its responder when the contest succeeds', () => {
  const { game, target, attackers, home } = relayResponseFixture(39);
  const otherVisibleRelay = game.relays[1];
  otherVisibleRelay.owner = 'player';
  otherVisibleRelay.x = 53.5; otherVisibleRelay.y = 13.5;
  assert.equal(game.isVisible({ x: otherVisibleRelay.x, y: otherVisibleRelay.y, owner: 'player' }, 'enemy'), true);

  game._aiStrategicRelays([...attackers, ...home]);
  const responder = [...attackers, ...home].find(unit => unit._aiRelayUrgentRelayId === target.id);
  assert.ok(responder, 'a visible active countdown gets one urgent responder');
  game._aiStrategicRelays([...attackers, ...home]);
  assert.equal(game._aiRelayTarget, target.id,
    'a second visible player relay does not pull the response off the active countdown');
  assert.equal(responder._aiRelayUrgentRelayId, target.id);

  game.relayDominion.owner = null;
  game._aiStrategicRelays([...attackers, ...home]);
  assert.equal(responder._aiRelayUrgentRelayId, null,
    'a successful contest releases the temporary urgent assignment');
  assert.equal(responder._aiRelayResponseRelayId, null);
});

test('v43 keeps one observed countdown target through short fog and cancels it safely', () => {
  const setup = replayVersion => {
    const { game, target, attackers, home } = relayResponseFixture(replayVersion);
    game._aiStrategicRelays([...attackers, ...home]);
    assert.equal(game._aiRelayTarget, target.id);
    const alternative = game.relays[1];
    alternative.owner = 'player';
    alternative.x = 52.5; alternative.y = 13.5;
    // The previously observed target is now out of sight while another player
    // relay remains visible, as can happen on separated map lanes.
    target.y = 30.5;
    game.time = 2;
    game._aiStrategicRelays([...attackers, ...home]);
    return { game, target, alternative, attackers, home };
  };

  const legacy = setup(42);
  assert.equal(legacy.game._aiRelayTarget, legacy.alternative.id,
    'version 42 keeps its prior nearest-visible-target behavior');

  const current = setup(43);
  assert.equal(current.game._aiRelayTarget, current.target.id,
    'version 43 holds the last observed target despite another visible relay');
  assert.equal(current.game._aiRelayCommittedTargetId, current.target.id);
  assert.equal(current.game._aiRelayCommittedTargetLastSeenAt, 0);
  assert.ok([...current.attackers, ...current.home].some(unit =>
    unit._aiRelayUrgentRelayId === current.target.id),
  'the response continues toward the committed target during the fog window');

  const resumed = Game.deserialize(current.game.serialize());
  assert.equal(resumed._aiRelayCommittedTargetLastSeenAt, 0, 'save/load retains the observation time');
  resumed._groundComponents = current.game._groundComponents;
  resumed.time = 12;
  resumed._aiStrategicRelays([...current.attackers, ...current.home].map(unit => resumed.getEntity(unit.id)));
  assert.equal(resumed._aiRelayTarget, current.alternative.id,
    'after ten unseen seconds the AI may choose the currently visible alternative');

  const changed = setup(43);
  changed.target.owner = 'enemy';
  changed.target.y = 13.5;
  changed.game.time = 4;
  changed.game._aiStrategicRelays([...changed.attackers, ...changed.home]);
  assert.equal(changed.game._aiRelayTarget, changed.alternative.id,
    'a visible ownership change immediately releases the committed target');

  const unreachable = setup(43);
  unreachable.game._groundComponents = () => {
    const components = new Int32Array(unreachable.game.width * unreachable.game.height);
    for (let y = 0; y < unreachable.game.height; y++) for (let x = 0; x < unreachable.game.width; x++)
      components[y * unreachable.game.width + x] = y >= 25 ? 2 : 1;
    return components;
  };
  unreachable.game._aiStrategicRelays([...unreachable.attackers, ...unreachable.home]);
  assert.equal(unreachable.game._aiRelayTarget, unreachable.alternative.id,
    'an unreachable commitment yields to a reachable visible relay');
  assert.equal(unreachable.game._aiRelayCommittedTargetId, unreachable.alternative.id);

  const defended = relayResponseFixture(43);
  defended.game._aiStrategicRelays([...defended.attackers, ...defended.home]);
  const protectedResponder = [...defended.attackers, ...defended.home]
    .find(unit => unit._aiRelayUrgentRelayId === defended.target.id);
  assert.ok(protectedResponder);
  protectedResponder._aiDefenseTarget = 'visible-raider';
  protectedResponder._relayAssignment = null;
  protectedResponder.order = { type: 'attack', targetId: 'visible-raider', aiDefense: true };
  defended.game._aiStrategicRelays([protectedResponder]);
  assert.equal(defended.game._aiRelayCommittedTargetId, null,
    'a higher-priority base defense cancels a commitment when no responder remains available');
  assert.equal(protectedResponder._aiRelayUrgentRelayId, null);

  const save = JSON.parse(current.game.serialize());
  save.replayVersion = null;
  delete save.relayDominionTargetCommitmentRulesVersion;
  const legacySave = Game.deserialize(save);
  assert.equal(legacySave.replayVersion, 42,
    'an unversioned v42 save without the marker keeps its original target selection rules');
  legacySave._groundComponents = current.game._groundComponents;
  legacySave._aiStrategicRelays([...current.attackers, ...current.home]
    .map(unit => legacySave.getEntity(unit.id)));
  assert.equal(legacySave._aiRelayTarget, current.alternative.id,
    'the migrated legacy save switches to the visible target as v42 did');

  const fresh = new Game({ seed: 80043 });
  assert.equal(fresh.relayDominionTargetCommitmentRulesVersion, 43,
    'new games carry the v43 migration marker');
});

test('a two-squad last stand commits one response to a visible countdown', () => {
  const { game, target, attackers, home } = relayResponseFixture();
  for (const unit of [...home, ...attackers.slice(2)]) unit.hp = 0;
  game._aiStrategicRelays(attackers.slice(0, 2));
  const responders = attackers.slice(0, 2).filter(unit => unit._relayAssignment === target.id);
  assert.equal(responders.length, 1);
  assert.equal(responders[0].id, attackers[1].id, 'nearest squad answers first');
  assert.equal(attackers[0].order.type, 'attack', 'the other squad keeps the assault alive');
});

test('v37 relay response skips an unreachable player relay and does not recall across a blocked route', () => {
  const { game, target, attackers, home } = relayResponseFixture();
  target.x = 32.5; target.y = 13.5;
  game._aiStrategicRelays([...attackers, ...home]);
  assert.equal(game._aiRelayTarget, null);
  assert.ok(attackers.every(unit => unit.order.type === 'attack' && !unit._relayAssignment));
});

test('v37 does not redirect committed assaults to an unseen relay', () => {
  const { game, target, attackers, home } = relayResponseFixture();
  target.y = 30.5;
  assert.equal(game.isVisible({ x: target.x, y: target.y, owner: 'player' }, 'enemy'), false);
  game._aiStrategicRelays([...attackers, ...home]);
  assert.ok(attackers.every(unit => unit._aiRelayResponseRelayId == null &&
    unit.order.type === 'attack'));
});

test('v37 relay response excludes defense, raid, recovery, scout, support, and embarked units', () => {
  const { game, target, home } = relayResponseFixture();
  const protectedUnits = [
    ['lightTank', { _aiDefenseTarget: 'visible-player-threat' }],
    ['buggy', { _aiRaidTarget: 'visible-player-harvester' }],
    ['guardian', { _aiRecovering: 'enemy-workshop' }],
    ['artillery', { _aiRecoverWreck: true }],
    ['scout', { order: { type: 'attack', targetId: 'player-command', aiScout: true } }],
    ['lightTank', { embarkedIn: 'carrier1' }],
    ['apc', {}], ['dropship', {}], ['medic', {}], ['engineer', {}], ['harvester', {}],
  ].map(([defId, fields]) => {
    const unit = game._createUnit('enemy', defId, 50.5, 13.5,
      fields.order || { type: 'attack', targetId: 'player-command' });
    Object.assign(unit, Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'order')));
    return unit;
  });
  game._aiStrategicRelays([...protectedUnits, ...home]);
  assert.ok(protectedUnits.every(unit => unit._aiRelayResponseRelayId == null &&
    (!unit._relayAssignment || unit._relayAssignment !== target.id)));
  assert.ok(home.every(unit => !unit._relayAssignment),
    'protected units cannot be used to make an ordinary relay assignment either');
});

test('v37 relay response restores its saved attack after pressure ends, including after save/load', () => {
  const { game, target, attackers, home } = relayResponseFixture();
  game._aiStrategicRelays([...attackers, ...home]);
  const resumed = Game.deserialize(game.serialize());
  const recalled = attackers.filter(unit => unit._aiRelayResponseRelayId);
  const savedOrders = new Map(recalled.map(unit => [unit.id, structuredClone(unit._aiRelayResponseOrder)]));
  resumed.relayDominion.owner = null;
  resumed._aiStrategicRelays(resumed.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
    !['harvester', 'engineer', 'medic'].includes(unit.defId)));
  for (const attacker of recalled) {
    const restored = resumed.getEntity(attacker.id);
    assert.deepEqual(restored.order, savedOrders.get(attacker.id));
    assert.equal(restored._relayAssignment, null);
    assert.equal(restored._aiRelayResponseRelayId, null);
  }
  assert.equal(resumed._aiRelayTarget, null);
  assert.ok(target.id);
});

test('base-defense orders supersede a temporary relay recall', () => {
  const { game, attackers, home } = relayResponseFixture();
  game._aiStrategicRelays([...attackers, ...home]);
  const responder = attackers[0];
  assert.ok(responder._aiRelayResponseRelayId);
  responder._aiDefenseTarget = 'visible-raider';
  responder._relayAssignment = null;
  responder.order = { type: 'attack', targetId: 'visible-raider', aiDefense: true };
  game._aiStrategicRelays([...attackers, ...home]);
  assert.deepEqual(responder.order, { type: 'attack', targetId: 'visible-raider', aiDefense: true });
  assert.equal(responder._aiRelayResponseRelayId, null);
  assert.equal(responder._aiRelayResponseOrder, null);
});

test('v36 and older saves migrate without inheriting v37 relay-response rules', () => {
  const current = new Game({ seed: 438 });
  const v36Save = JSON.parse(current.serialize());
  delete v36Save.relayResponseRulesVersion;
  v36Save.replayVersion = null;
  assert.equal(Game.deserialize(v36Save).replayVersion, 36);

  const olderSave = { ...v36Save };
  delete olderSave.unitAbilityRulesVersion;
  assert.equal(Game.deserialize(olderSave).replayVersion, 35);
});

test('unversioned in-progress saves migrate to v38 unless they carry the v39 relay-response marker', () => {
  const current = JSON.parse(new Game({ seed: 438 }).serialize());
  assert.equal(current.relayDominionCounterattackRulesVersion, 39);
  assert.equal(Game.deserialize(current).replayVersion, undefined,
    'the current marker keeps a live save on current rules');
  const v38 = { ...current };
  delete v38.relayDominionCounterattackRulesVersion;
  assert.equal(Game.deserialize(v38).replayVersion, 38,
    'unversioned in-progress saves without the new marker preserve v38 rules');
});

test('v36 skirmish replay does not recall attack orders for relay pressure', () => {
  const { game, target, attackers, home } = relayResponseFixture(36);
  game._aiStrategicRelays([...attackers, ...home]);
  assert.ok(attackers.every(unit => unit.order.type === 'attack' && !unit._relayAssignment));
  assert.ok(target.id);
});

test('defensive response scales with difficulty', () => {
  for (const [difficulty, expected] of [['easy', 2], ['normal', 3], ['hard', 4]]) {
    const game = new Game({ seed: 46, difficulty });
    const harvester = game.units.find(u => u.owner === 'enemy' && u.defId === 'harvester');
    const threat = game._createUnit('player', 'lightTank', harvester.x + 2, harvester.y);
    for (let i = 0; i < 2; i++) game._createUnit('enemy', 'rifle', harvester.x - i, harvester.y - 2);
    game._aiTick();
    assert.equal(enemyCombat(game).filter(u => u._aiDefenseTarget === threat.id).length, expected,
      `${difficulty} defender limit`);
  }
});

test('damaged enemy armor disengages to a powered workshop and resumes its saved order after repairs', () => {
  const game = new Game({ seed: 48, difficulty: 'normal' });
  const bay = game._createBuilding('enemy', 'serviceBay', 40, 10, 1);
  game._refreshPower();
  const tank = game._createUnit('enemy', 'lightTank', 43, 11);
  tank.hp = tank.maxHp * 0.5;
  tank.order = { type: 'attackMove', x: 15, y: 30 };

  game._aiRecoverArmor([tank]);
  assert.equal(tank._aiRecovering, bay.id);
  assert.equal(game._isPassable(Math.floor(tank.order.x), Math.floor(tank.order.y)), true);
  assert.ok(game._distanceToEntity(tank.order.x, tank.order.y, bay) <= 2.5);

  tank.x = 41; tank.y = 11;
  const loaded = Game.deserialize(game.serialize());
  const restoredTank = loaded.getEntity(tank.id);
  loaded.credits.enemy = 1000;
  loaded._updateBuildings(1);
  assert.ok(restoredTank.hp > tank.hp);
  restoredTank.hp = restoredTank.maxHp * 0.9;
  loaded._aiRecoverArmor([restoredTank]);
  assert.equal(restoredTank._aiRecovering, null);
  assert.deepEqual(restoredTank.order, { type: 'attackMove', x: 15, y: 30 });
});

test('assault waves leave recovering armor and its workshop path alone', () => {
  const game = new Game({ seed: 49, difficulty: 'normal' });
  const bay = game._createBuilding('enemy', 'serviceBay', 40, 10, 1);
  game._refreshPower();
  const tank = game._createUnit('enemy', 'lightTank', 43, 11);
  tank.hp = tank.maxHp * 0.5;
  tank.order = { type: 'attackMove', x: 15, y: 30 };
  game._aiRecoverArmor([tank]);
  tank.path = [{ x: 42, y: 12 }];
  tank._pathGoal = { ...tank._aiRecoveryPoint };
  const path = structuredClone(tank.path);
  game._aiRecoverArmor([tank]);
  assert.deepEqual(tank.path, path, 'an unchanged workshop destination keeps the current path');
  assert.equal(game._launchAiWave(), true);
  assert.equal(tank._aiRecovering, bay.id);
  assert.deepEqual(tank.order, { type: 'move', ...tank._aiRecoveryPoint });
  assert.deepEqual(tank.path, path);
});

test('recovering armor travels to a passable workshop approach, repairs, and resumes its order', () => {
  const game = new Game({ seed: 50, difficulty: 'normal' });
  const bay = game._createBuilding('enemy', 'serviceBay', 35, 6, 1);
  game._refreshPower();
  assert.equal(bay.powered, true);
  const tank = game._createUnit('enemy', 'lightTank', 42.5, 7.5);
  tank.hp = tank.maxHp * 0.5;
  tank.order = { type: 'attackMove', x: 15, y: 30 };
  game.credits.enemy = 10000;
  const start = { x: tank.x, y: tank.y };

  game._aiRecoverArmor([tank]);
  const target = { ...tank._aiRecoveryPoint };
  assert.ok(target.x !== bay.x + 1 || target.y !== bay.y + 1,
    'the destination is outside the blocked workshop footprint');
  assert.equal(game._isPassable(Math.floor(target.x), Math.floor(target.y)), true);
  assert.ok(game._distanceToEntity(target.x, target.y, bay) <= 2.5);

  let moved = false, repaired = false, maxStep = 0;
  for (let i = 0; i < 600 && tank._aiRecovering; i++) {
    const before = { x: tank.x, y: tank.y, hp: tank.hp };
    game.update(0.1);
    const step = Math.hypot(tank.x - before.x, tank.y - before.y);
    if (step > 0.001) moved = true;
    maxStep = Math.max(maxStep, step);
    if (tank.hp > before.hp) repaired = true;
  }

  assert.equal(moved, true, 'the tank reaches the workshop through normal movement');
  assert.ok(maxStep < 1, 'the tank advances at its movement speed without teleporting');
  assert.equal(repaired, true, 'the workshop repairs the tank after it arrives');
  assert.ok(Math.hypot(tank.x - start.x, tank.y - start.y) > 1);
  assert.ok(tank.hp >= tank.maxHp * 0.9);
  assert.equal(tank._aiRecovering, null);
  assert.deepEqual(tank.order, { type: 'attackMove', x: 15, y: 30 });
});

test('defenders split their response across two simultaneous assault lanes on every skirmish map and faction', () => {
  for (const mapId of ['shard-valley', 'twin-passes', 'delta-crossing', 'canyon-ring', 'storm-basin']) {
    for (const faction of ['aegis', 'vesper']) {
      const game = new Game({ seed: 43, difficulty: 'normal', mapId, faction });
      const factory = game.buildings.find(b => b.owner === 'enemy' && b.defId === 'factory');
      const harvester = game.units.find(u => u.owner === 'enemy' && u.defId === 'harvester');
      const harvesterRaider = game._createUnit('player', 'lightTank', harvester.x, harvester.y);
      const factoryRaider = game._createUnit('player', 'lightTank', factory.x + 1.5, factory.y + 1.5);
      game._updateFog();
      game.selection = [harvesterRaider.id];
      assert.equal(game.issueAttack(harvester.id).ok, true, `${mapId} ${faction}: harvester order`);
      game.selection = [factoryRaider.id];
      assert.equal(game.issueAttack(factory.id).ok, true, `${mapId} ${faction}: factory order`);

      game._aiTick();

      const defenders = enemyCombat(game).filter(u => u._aiDefenseTarget);
      assert.ok(defenders.some(u => u._aiDefenseTarget === harvesterRaider.id), `${mapId} ${faction}: harvester lane`);
      assert.ok(defenders.some(u => u._aiDefenseTarget === factoryRaider.id), `${mapId} ${faction}: factory lane`);
      assert.ok(defenders.length <= 3, `${mapId} ${faction}: normal difficulty keeps the global response limit`);
      assert.ok(defenders.every(u => u.order.type === 'attack' && u.order.aiDefense));
    }
  }
});

test('visible aircraft prompt rocket production and visible harvesters can draw raiders', () => {
  const game = new Game({ seed: 44, difficulty: 'normal' });
  game.credits.enemy = 5000;
  game._createUnit('player', 'orca', 50, 13);
  game._aiTick();
  assert.ok(game.buildings.some(b => b.owner === 'enemy' && b.queue.some(q => q.defId === 'rocket')));

  const harvester = game.units.find(u => u.owner === 'player' && u.defId === 'harvester');
  const raider = game._createUnit('enemy', 'buggy', harvester.x + 2, harvester.y);
  game._aiTick();
  assert.equal(raider._aiRaidTarget, harvester.id);
  assert.equal(raider.order.targetId, harvester.id);
});

test('harvester raids prefer a nearby exposed economy target over an escorted target', () => {
  const game = new Game({ seed: 440, difficulty: 'normal' });
  for (const unit of game.units) if (unit.owner === 'player' && unit.defId === 'harvester') unit.hp = 0;
  const escorted = game._createUnit('player', 'harvester', 34.5, 24.5);
  const exposed = game._createUnit('player', 'harvester', 41.5, 24.5);
  game._createUnit('player', 'lightTank', 35, 25);
  const raider = game._createUnit('enemy', 'buggy', 32.5, 24.5);
  game._createUnit('enemy', 'scout', 41.5, 24.5);
  game._updateFog();

  game._aiRaidHarvesters([raider]);

  assert.equal(raider._aiRaidTarget, exposed.id,
    'a modestly longer approach is worthwhile when the closer Harvester has a combat escort');
  assert.equal(raider.order.targetId, exposed.id);
  assert.ok(game.isVisible(escorted, 'enemy') && game.isVisible(exposed, 'enemy'));
});

test('harvester raids account for powered ground defenses around an economy target', () => {
  const game = new Game({ seed: 4401, difficulty: 'normal' });
  for (const unit of game.units) if (unit.owner === 'player' && unit.defId === 'harvester') unit.hp = 0;
  const defended = game._createUnit('player', 'harvester', 34.5, 24.5);
  const exposed = game._createUnit('player', 'harvester', 42.5, 24.5);
  const tower = game._createBuilding('player', 'guardTower', 35, 23, 1);
  game._refreshPower();
  const raider = game._createUnit('enemy', 'buggy', 32.5, 24.5);
  game._createUnit('enemy', 'scout', 42.5, 24.5);
  game._updateFog();
  assert.equal(tower.powered, true);

  game._aiRaidHarvesters([raider]);

  assert.equal(raider._aiRaidTarget, exposed.id,
    'a powered ground defense makes the closer target less attractive');
  assert.ok(game.isVisible(defended, 'enemy') && game.isVisible(exposed, 'enemy'));
});

test('harvester raid target stays committed when exposure changes, then new raids use distance and stable ID ties', () => {
  const game = new Game({ seed: 441, difficulty: 'normal' });
  for (const unit of game.units) if (unit.owner === 'player' && unit.defId === 'harvester') unit.hp = 0;
  const first = game._createUnit('player', 'harvester', 35.5, 24.5);
  const second = game._createUnit('player', 'harvester', 39.5, 24.5);
  const raider = game._createUnit('enemy', 'buggy', 33.5, 24.5);
  game._updateFog();
  game._aiRaidHarvesters([raider]);
  assert.equal(raider._aiRaidTarget, first.id, 'equal exposure favors the closer Harvester');

  game._createUnit('player', 'lightTank', first.x + 0.5, first.y);
  game._updateFog();
  game._aiRaidHarvesters([raider]);
  assert.equal(raider._aiRaidTarget, first.id, 'an assigned raid does not switch targets every AI tick');

  const tieGame = new Game({ seed: 442, difficulty: 'normal' });
  for (const unit of tieGame.units) if (unit.owner === 'player' && unit.defId === 'harvester') unit.hp = 0;
  const lowerId = tieGame._createUnit('player', 'harvester', 35.5, 24.5);
  const higherId = tieGame._createUnit('player', 'harvester', 37.5, 24.5);
  const tieRaider = tieGame._createUnit('enemy', 'buggy', 36.5, 24.5);
  tieGame.units.reverse();
  tieGame._updateFog();
  tieGame._aiRaidHarvesters([tieRaider]);
  assert.equal(tieRaider._aiRaidTarget, lowerId.id,
    `equal raid scores use stable entity IDs, not unit-array order (other target ${higherId.id})`);
});

test('pre-v14 skirmish replay keeps first-visible harvester raid targeting', () => {
  const game = new Game({ seed: 443, difficulty: 'normal' });
  game.replayVersion = 13;
  for (const unit of game.units) if (unit.owner === 'player' && unit.defId === 'harvester') unit.hp = 0;
  const first = game._createUnit('player', 'harvester', 40.5, 24.5);
  const closer = game._createUnit('player', 'harvester', 34.5, 24.5);
  const raider = game._createUnit('enemy', 'buggy', 32.5, 24.5);
  game._createUnit('enemy', 'scout', 40.5, 24.5);
  game._updateFog();

  game._aiRaidHarvesters([raider]);

  assert.equal(raider._aiRaidTarget, first.id,
    `legacy replay preserves the old first-visible target even when ${closer.id} is closer`);
});

test('Vesper answers observed armor with researched stealth tanks while Aegis fields rockets', () => {
  for (const [playerFaction, expected] of [['aegis', 'stealthTank'], ['vesper', 'rocket']]) {
    const game = new Game({ seed: 44, faction: playerFaction, difficulty: 'normal' });
    const factory = game.buildings.find(b => b.owner === 'enemy' && b.defId === 'factory');
    game._createBuilding('enemy', 'tech', factory.x + 5, factory.y + 2, 1);
    game.credits.enemy = 5000;
    const threats = [0, 1].map(i => game._createUnit('player', 'guardian', factory.x + i, factory.y + 1));
    game._updateFog();
    assert.ok(threats.every(unit => game.isVisible(unit, 'enemy')));
    const replay = Game.deserialize(game.serialize());

    game._aiTick();
    replay._aiTick();

    const production = game.buildings.filter(b => b.owner === 'enemy').flatMap(b => b.queue);
    assert.ok(production.some(item => item.defId === expected),
      `${game.enemyFaction} should counter observed armor with ${expected}`);
    assert.deepEqual(replay.buildings.filter(b => b.owner === 'enemy').flatMap(b => b.queue), production,
      `${game.enemyFaction} counter production should replay after save/load`);
  }
});

test('AI intelligence and orders remain deterministic across identical seeds and save/load', () => {
  const a = new Game({ seed: 45 });
  const b = new Game({ seed: 45 });
  a._aiTick(); b._aiTick();
  a._launchAiWave(); b._launchAiWave();
  assert.deepEqual(a._aiIntel, b._aiIntel);
  assert.deepEqual(a.units.map(u => u.order), b.units.map(u => u.order));
  const loaded = Game.deserialize(a.serialize());
  assert.deepEqual(loaded._aiIntel, a._aiIntel);
  assert.equal(loaded._aiScoutStep, a._aiScoutStep);
});

test('Relay Dominion pressure sends a bounded contest squad while base defenders stay on the threat', () => {
  const game = new Game({ seed: 48, difficulty: 'normal' });
  game.replayVersion = 38;
  for (const relay of game.relays.slice(0, 2)) relay.owner = 'player';
  game.relayDominion.owner = 'player';
  game.relayDominion.elapsed = 25;
  const harvester = game.units.find(u => u.owner === 'enemy' && u.defId === 'harvester');
  const threat = game._createUnit('player', 'lightTank', harvester.x + 2, harvester.y);
  for (let i = 0; i < 6; i++) game._createUnit('enemy', 'rifle', 46.5 + i % 3, 16.5 + Math.floor(i / 3));

  game._aiTick();
  const defenders = enemyCombat(game).filter(u => u._aiDefenseTarget === threat.id);
  const contest = enemyCombat(game).filter(u => u._relayAssignment === game._aiRelayTarget);
  assert.equal(defenders.length, 3);
  assert.ok(contest.length >= 2 && contest.length <= 3);
  assert.ok(contest.every(u => u.order.relayId === game._aiRelayTarget &&
    u.order.attackMove && !u._aiDefenseTarget));
  assert.equal(game.relays.find(r => r.id === game._aiRelayTarget).owner, 'player');
  const orders = contest.map(u => ({ id: u.id, order: structuredClone(u.order) }));
  game._aiTick();
  assert.deepEqual(orders.map(({ id }) => game.getEntity(id).order), orders.map(({ order }) => order),
    'repeated AI ticks keep the contest squad on one target');

  const loaded = Game.deserialize(game.serialize());
  loaded._aiTick();
  assert.equal(loaded._aiRelayTarget, game._aiRelayTarget);
  assert.deepEqual(loaded.units.map(u => u.order), game.units.map(u => u.order));
});

test('AI divides relay reserve across two reachable relays while the v47 Marshal commits an extra unit', () => {
  const legacy = new Game({ seed: 49 });
  legacy.replayVersion = 46;
  legacy._aiTick();
  const legacyAssignments = enemyCombat(legacy).filter(u => u._relayAssignment);
  assert.equal(legacyAssignments.length, 2);
  assert.equal(new Set(legacyAssignments.map(u => u._relayAssignment)).size, 2);
  assert.equal(legacy._aiRelayTarget, null);

  const marshal = new Game({ seed: 49 });
  assert.equal(marshal.aiCommanderProfileId, 'relay-marshal');
  marshal._aiTick();
  const currentAssignments = enemyCombat(marshal).filter(u => u._relayAssignment);
  assert.equal(currentAssignments.length, 3);
  assert.equal(new Set(currentAssignments.map(u => u._relayAssignment)).size, 3);
  assert.equal(marshal._aiRelayTarget, null);
});

test('Cadet AI delays the initial relay rush through 45 seconds, including after early capture', () => {
  const game = new Game({ seed: 49, difficulty: 'easy' });
  game._aiTick();
  assert.equal(enemyCombat(game).filter(u => u._relayAssignment).length, 0);
  game.relays[0].owner = 'player';
  game._aiTick();
  assert.equal(enemyCombat(game).filter(u => u._relayAssignment).length, 0,
    'the current onboarding window continues through an early player capture');
  game.time = 44.9;
  game._aiTick();
  assert.equal(enemyCombat(game).filter(u => u._relayAssignment).length, 0);
  game.time = 45;
  game._aiTick();
  assert.ok(enemyCombat(game).some(u => u._relayAssignment));

  const legacyCapture = new Game({ seed: 49, difficulty: 'easy' });
  legacyCapture.replayVersion = 12;
  legacyCapture.relays[0].owner = 'player';
  legacyCapture._aiTick();
  assert.ok(enemyCombat(legacyCapture).some(u => u._relayAssignment),
    'version 12 playback still responds immediately to an early capture');

  const legacyNeutral = new Game({ seed: 49, difficulty: 'easy' });
  legacyNeutral.replayVersion = 12;
  legacyNeutral.time = 17.9;
  legacyNeutral._aiTick();
  assert.equal(enemyCombat(legacyNeutral).filter(u => u._relayAssignment).length, 0);
  legacyNeutral.time = 18;
  legacyNeutral._aiTick();
  assert.ok(enemyCombat(legacyNeutral).some(u => u._relayAssignment),
    'version 12 playback retains its 18-second neutral-relay gate');

  const campaign = new Game({ seed: 49, difficulty: 'easy', mode: 'campaign' });
  campaign.relays[0].owner = 'player';
  campaign._aiTick();
  assert.ok(enemyCombat(campaign).some(u => u._relayAssignment),
    'the new onboarding pause is limited to solo skirmish');
});

test('AI skips an unreachable relay during a countdown', () => {
  const game = new Game({ seed: 50 });
  game.replayVersion = 38;
  for (const relay of game.relays.slice(0, 2)) relay.owner = 'player';
  game.relayDominion.owner = 'player';
  const blocked = game.relays[0];
  game.terrain[Math.floor(blocked.y)][Math.floor(blocked.x)].walkable = false;
  game._aiTick();
  assert.equal(game._aiRelayTarget, game.relays[1].id);
  assert.ok(enemyCombat(game).filter(u => u._relayAssignment).every(u =>
    u._relayAssignment === game.relays[1].id));
});

test('AI holds two owned relays with a bounded garrison that assault waves do not take', () => {
  const game = new Game({ seed: 56 });
  for (const relay of game.relays.slice(0, 2)) relay.owner = 'enemy';
  game.relayDominion.owner = 'enemy';
  for (let i = 0; i < 8; i++) game._createUnit('enemy', 'rifle', 46.5 + i % 4, 16.5 + Math.floor(i / 4));
  game._aiTick();
  const garrisons = game.relays.slice(0, 2).map(relay =>
    enemyCombat(game).filter(u => u._relayAssignment === relay.id));
  assert.ok(garrisons.every(group => group.length === 1));
  assert.ok(garrisons.every(([u]) => u.order.type === 'guard' &&
    u.order.relayId === u._relayAssignment));
  const ids = garrisons.flat().map(u => u.id);
  assert.equal(game._launchAiWave(), true);
  assert.ok(ids.every(id => game.getEntity(id)._relayAssignment &&
    game.getEntity(id).order.type === 'guard'));
  game._aiTick();
  assert.ok(ids.every(id => game.getEntity(id)._relayAssignment &&
    game.getEntity(id).order.type === 'guard'));
  const loaded = Game.deserialize(game.serialize());
  loaded._aiTick();
  assert.ok(ids.every(id => loaded.getEntity(id)._relayAssignment === game.getEntity(id)._relayAssignment &&
    loaded.getEntity(id).order.type === 'guard'));
});

test('a small army releases its relay garrison to interrupt a reachable player countdown', () => {
  for (const mapId of ['shard-valley', 'twin-passes', 'delta-crossing', 'canyon-ring', 'storm-basin']) {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const game = new Game({ seed: 80217, mapId, difficulty });
      game.replayVersion = 38;
      game.units = game.units.filter(u => u.owner !== 'enemy' || u.defId === 'harvester');
      const [owned, ...playerHeld] = game.relays;
      owned.owner = 'enemy';
      for (const relay of playerHeld) relay.owner = 'player';
      game.relayDominion.owner = 'player';
      game.relayDominion.elapsed = 30;
      const garrison = game._createUnit('enemy', 'rifle', owned.x, owned.y);
      garrison._relayAssignment = owned.id;
      garrison.order = { type: 'guard', x: owned.x, y: owned.y, relayId: owned.id };
      const fighters = [
        game._createUnit('enemy', 'rifle', owned.x + 0.2, owned.y),
        game._createUnit('enemy', 'rocket', owned.x, owned.y + 0.2),
      ];
      for (const fighter of fighters) fighter.order = { type: 'attack', targetId: 'active-fight' };
      const before = fighters.map(u => structuredClone(u.order));

      game._aiStrategicRelays([garrison, ...fighters]);
      assert.ok(playerHeld.some(r => r.id === garrison._relayAssignment),
        `${mapId} ${difficulty}: the only eligible squad contests the countdown`);
      assert.equal(garrison.order.type, 'move');
      assert.equal(garrison.order.relayId, garrison._relayAssignment);
      assert.deepEqual(fighters.map(u => u.order), before,
        `${mapId} ${difficulty}: active fighters stay on their orders`);
      assert.equal([garrison, ...fighters].filter(u => u._relayAssignment).length, 1,
        `${mapId} ${difficulty}: two ground squads remain outside the relay reserve`);

      const loaded = Game.deserialize(game.serialize());
      game._aiStrategicRelays([garrison, ...fighters]);
      loaded._aiStrategicRelays([garrison, ...fighters].map(u => loaded.getEntity(u.id)));
      assert.equal(loaded._aiRelayTarget, game._aiRelayTarget);
      assert.deepEqual([garrison, ...fighters].map(u => loaded.getEntity(u.id).order),
        [garrison, ...fighters].map(u => u.order), `${mapId} ${difficulty}: save/load keeps orders stable`);
    }
  }
});

test('legacy saves initialize intelligence state and superweapons wait for a sighting', () => {
  const data = JSON.parse(new Game({ seed: 47 }).serialize());
  delete data._aiIntel;
  delete data._aiScoutStep;
  const game = Game.deserialize(data);
  game._aiTick();
  assert.ok(Array.isArray(game._aiIntel));
  assert.ok(Number.isInteger(game._aiScoutStep));

  game._createBuilding('enemy', 'warhead', 40, 5, 1);
  game.superweapon.enemy = 1;
  game._updateSuperweapon(0.1);
  assert.equal(game.superweapon.enemy, 1);

  const scout = game.units.find(u => u.owner === 'enemy' && u.defId === 'scout');
  const command = game.buildings.find(b => b.owner === 'player' && b.defId === 'command');
  scout.x = command.x + 3.5; scout.y = command.y + 1.5;
  game._updateSuperweapon(0.1);
  assert.equal(game.superweapon.enemy, 0);
});

test('skirmish transport production is one bounded carrier and stays out of easy and campaign games', () => {
  const game = new Game({ seed: 61, difficulty: 'normal' });
  for (let i = 0; i < 3; i++) game._createUnit('enemy', 'rifle', 45.5 + i, 14.5);
  game.credits.enemy = 5000;
  game._aiTransportTick();
  game._aiTransportTick();
  const factory = game.buildings.find(b => b.owner === 'enemy' && b.defId === 'factory');
  assert.equal(factory.queue.filter(q => q.defId === 'apc').length, 1);
  const easy = new Game({ seed: 62, difficulty: 'easy' });
  const campaign = new Game({ seed: 63, difficulty: 'hard', mode: 'campaign' });
  for (const candidate of [easy, campaign]) {
    for (let i = 0; i < 3; i++) candidate._createUnit('enemy', 'rifle', 45.5 + i, 14.5);
    candidate.credits.enemy = 5000;
    candidate._aiTransportTick();
    assert.equal(candidate.buildings.flatMap(b => b.queue || []).filter(q => q.defId === 'apc').length, 0);
  }
});

test('Delta Crossing AI airlifts its opening squad across water without retasking or transport production', () => {
  for (const difficulty of ['normal', 'hard']) {
    const game = new Game({ seed: 99173, mapId: 'delta-crossing', difficulty });
    const carrier = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'dropship');
    const squad = carrier._aiTransportSquadIds.map(id => game.getEntity(id));
    const hidden = game._createUnit('player', 'lightTank', 5.5, 5.5);
    assert.equal(game.isVisible(hidden, 'enemy'), false);
    game._aiTick();
    assert.equal(carrier._aiTransportRelayId, game.relays[2].id);
    assert.ok(squad.every(unit => unit.order.type === 'board' && unit.order.carrierId === carrier.id));
    for (let i = 0; i < 50; i++) game.update(0.1);
    assert.equal(carrier.order.type, 'unload');
    assert.equal(carrier.order.relayId, game.relays[2].id);
    assert.equal(carrier.passengerIds.length, 2);
    assert.ok(carrier.y > 24.5, 'the aircraft crosses the water with both passengers');
    assert.ok(!game._aiIntel.some(item => item.id === hidden.id));
    const before = structuredClone(carrier.order);
    game._aiTick();
    assert.deepEqual(carrier.order, before, 'other AI routines leave the insertion flight alone');
    for (let i = 0; i < 70; i++) game.update(0.1);
    assert.equal(carrier.passengerIds.length, 0);
    assert.ok(squad.every(unit => !unit.embarkedIn && unit._relayAssignment === game.relays[2].id));
    assert.ok(squad.every(unit => unit.y > 24.5 &&
      game._isPassable(Math.floor(unit.x), Math.floor(unit.y))));
    assert.equal(carrier._aiTransportComplete, true);
    assert.equal(game.buildings.flatMap(building => building.queue || [])
      .filter(item => ['apc', 'dropship'].includes(item.defId)).length, 0);
  }
});

test('Delta Crossing airlift flight replays exactly after save and load', () => {
  const game = new Game({ seed: 99173, mapId: 'delta-crossing', difficulty: 'normal' });
  for (let i = 0; i < 50; i++) game.update(0.1);
  const replay = Game.deserialize(game.serialize());
  for (let i = 0; i < 70; i++) { game.update(0.1); replay.update(0.1); }
  assert.deepEqual(replay.units, game.units);
  assert.deepEqual(replay.relays, game.relays);
  assert.equal(replay.randomState, game.randomState);
});

test('AI boards infantry for a reachable relay flank without targeting hidden player units', () => {
  const game = new Game({ seed: 64, difficulty: 'normal' });
  const relay = game.relays[2];
  relay.owner = 'player';
  const hidden = game._createUnit('player', 'lightTank', 10.5, 10.5);
  const carrier = game._createUnit('enemy', 'apc', 42.5, 25.5);
  const squad = [
    game._createUnit('enemy', 'rifle', 42.5, 26.1),
    game._createUnit('enemy', 'rocket', 43.1, 25.5),
  ];
  game._aiTransportTick();
  assert.ok(squad.every(u => u.order.type === 'board' && u.order.carrierId === carrier.id));
  assert.equal(carrier._aiTransportRelayId, relay.id);
  assert.equal(game.isVisible(hidden, 'enemy'), false);
  assert.ok(!game._aiIntel.some(item => item.id === hidden.id));
  assert.ok(!squad.some(u => u.order.targetId === hidden.id));

  for (const unit of squad) game._updateUnit(unit, 0.1);
  assert.equal(carrier.passengerIds.length, 2);
  game._aiTransportTick();
  assert.equal(carrier.order.type, 'unload');
  assert.equal(carrier.order.relayId, relay.id);
  assert.equal(carrier.order.targetId, undefined);
  const passengerOrders = squad.map(u => structuredClone(u.order));
  game._aiTick();
  assert.deepEqual(squad.map(u => u.order), passengerOrders,
    'the combat AI leaves embarked passengers under the carrier order');
  assert.equal(carrier.order.type, 'unload', 'the unarmed carrier is not retasked as an attacker');
});

test('AI transport unloads safely and its in-flight orders survive save and replay', () => {
  const game = new Game({ seed: 65, difficulty: 'normal' });
  const relay = game.relays[2];
  relay.owner = 'player';
  const carrier = game._createUnit('enemy', 'apc', 42.5, 25.5);
  const squad = [
    game._createUnit('enemy', 'rifle', 42.5, 26.1),
    game._createUnit('enemy', 'flamer', 43.1, 25.5),
  ];
  game._aiTransportTick();
  squad.forEach(unit => game._updateUnit(unit, 0.1));
  game._aiTransportTick();
  const replay = Game.deserialize(game.serialize());
  const advance = state => {
    for (let i = 0; i < 220; i++) {
      state.time += 0.1;
      state._aiTransportTick();
      for (const unit of state.units) state._updateUnit(unit, 0.1);
    }
  };
  advance(game);
  advance(replay);
  const summary = state => ({
    carrier: state.getEntity(carrier.id),
    squad: squad.map(unit => state.getEntity(unit.id)),
  });
  const original = summary(game), loaded = summary(replay);
  assert.deepEqual(loaded.carrier.order, original.carrier.order);
  assert.deepEqual(loaded.squad.map(u => ({ x: u.x, y: u.y, embarkedIn: u.embarkedIn, order: u.order })),
    original.squad.map(u => ({ x: u.x, y: u.y, embarkedIn: u.embarkedIn, order: u.order })));
  assert.equal(original.carrier.passengerIds.length, 0);
  assert.ok(original.squad.every(u => !u.embarkedIn && u._relayAssignment === relay.id));
  assert.ok(original.squad.every(u => game._isPassable(Math.floor(u.x), Math.floor(u.y))));
});

test('AI transport preserves its squad on relay retarget and releases passengers if no relay is reachable', () => {
  const game = new Game({ seed: 66, difficulty: 'normal' });
  const components = game._groundComponents();
  const relayComponents = game.relays.map(relay =>
    components[Math.floor(relay.y) * game.width + Math.floor(relay.x)]);
  const sharedComponent = relayComponents.find((id, index) => id >= 0 &&
    relayComponents.some((other, otherIndex) => otherIndex !== index && other === id));
  const carrierTile = game.terrain.flatMap((row, y) => row.map((tile, x) => ({ tile, x, y })))
    .filter(({ tile, x, y }) => tile.walkable &&
      components[y * game.width + x] === sharedComponent)
    .sort((a, b) => Math.min(...game.relays.map(r => Math.hypot(a.x + 0.5 - r.x, a.y + 0.5 - r.y))) -
      Math.min(...game.relays.map(r => Math.hypot(b.x + 0.5 - r.x, b.y + 0.5 - r.y))))[0];
  assert.ok(carrierTile);
  const carrier = game._createUnit('enemy', 'apc', carrierTile.x + 0.5, carrierTile.y + 0.5);
  const squad = [
    game._createUnit('enemy', 'rifle', carrier.x, carrier.y + 0.2),
    game._createUnit('enemy', 'rocket', carrier.x + 0.2, carrier.y),
  ];
  const reachable = game._groundComponents();
  const region = reachable[Math.floor(carrier.y) * game.width + Math.floor(carrier.x)];
  const relayCandidates = game.relays.filter(relay =>
    reachable[Math.floor(relay.y) * game.width + Math.floor(relay.x)] === region);
  assert.ok(relayCandidates.length >= 2);
  const originalTarget = relayCandidates[0], alternate = relayCandidates[1];
  originalTarget.owner = 'player';
  game._aiTransportTick();
  squad.forEach(unit => game._updateUnit(unit, 0.1));
  game._aiTransportTick();
  const assignedSquad = [...carrier._aiTransportSquadIds];
  assert.equal(carrier.order.relayId, originalTarget.id);

  originalTarget.owner = 'enemy';
  alternate.owner = 'player';
  game._aiTransportTick();
  assert.deepEqual(carrier._aiTransportSquadIds, assignedSquad,
    'retargeting keeps the passengers attached to the original squad');
  assert.equal(carrier.order.relayId, alternate.id);

  for (const relay of game.relays) relay.owner = 'enemy';
  game._aiTransportTick();
  assert.equal(carrier._aiTransportComplete, true);
  assert.deepEqual(carrier.passengerIds, []);
  assert.ok(squad.every(unit => !unit.embarkedIn && unit.order.type === 'idle'));
});

test('current skirmish recalls a bounded assault response to a visible harvester raid; v24 keeps the wave', () => {
  const setup = replayVersion => {
    const game = new Game({ seed: 841, difficulty: 'normal' });
    game.replayVersion = replayVersion;
    game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId === 'harvester');
    const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
    const threat = game._createUnit('player', 'lightTank', harvester.x + 2, harvester.y);
    const defenders = Array.from({ length: 5 }, (_, index) =>
      game._createUnit('enemy', 'lightTank', harvester.x + 3 + index * 0.2, harvester.y + 1));
    for (const defender of defenders) defender.order = { type: 'attack', targetId: 'player-objective' };
    return { game, harvester, threat, defenders };
  };
  const old = setup(24);
  assert.equal(old.game.isVisible(old.threat, 'enemy'), true);
  old.game._aiDefend(old.defenders);
  assert.ok(old.defenders.every(unit => unit.order.targetId === 'player-objective'));

  const current = setup(25);
  current.game._aiDefend(current.defenders);
  const recalled = current.defenders.filter(unit => unit._aiDefenseTarget === current.threat.id);
  assert.equal(recalled.length, 3, 'normal difficulty preserves the three-unit defender cap');
  assert.ok(recalled.every(unit => unit.order.aiDefense && unit.order.targetId === current.threat.id));
  assert.equal(current.defenders.filter(unit => unit.order.targetId === 'player-objective').length, 2);

  const loaded = Game.deserialize(current.game.serialize());
  current.game._aiDefend(current.defenders);
  loaded._aiDefend(current.defenders.map(unit => loaded.getEntity(unit.id)));
  assert.deepEqual(current.defenders.map(unit => loaded.getEntity(unit.id).order),
    current.defenders.map(unit => unit.order), 'recall stays deterministic after save and load');

  current.threat.x = 8.5; current.threat.y = 8.5;
  current.game._aiDefend(current.defenders);
  assert.ok(recalled.every(unit => !unit._aiDefenseTarget && unit.order.targetId === 'player-objective'),
    'recalled attackers resume their original objective when the raider leaves sight');
});

test('emergency recall requires a close asset threat and uses available guards before an assault', () => {
  const game = new Game({ seed: 842, difficulty: 'normal' });
  game.replayVersion = 25;
  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId === 'harvester');
  const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
  harvester.x = 25.5; harvester.y = 25.5;
  const guard = game._createUnit('enemy', 'lightTank', harvester.x + 3, harvester.y + 1);
  const attacker = game._createUnit('enemy', 'lightTank', harvester.x + 3.2, harvester.y + 1);
  const distant = game._createUnit('enemy', 'lightTank', harvester.x + 14, harvester.y + 1);
  attacker.order = { type: 'attack', targetId: 'player-objective' };
  distant.order = { type: 'attack', targetId: 'player-objective' };
  const threat = game._createUnit('player', 'lightTank', harvester.x + 2, harvester.y);
  game._aiDefend([attacker, distant, guard]);
  assert.equal(guard._aiDefenseTarget, threat.id);
  assert.equal(attacker._aiDefenseTarget, threat.id);
  assert.equal(distant._aiDefenseTarget, undefined, 'distant assaults stay committed');

  guard._aiDefenseTarget = null; guard.order = { type: 'idle' };
  attacker._aiDefenseTarget = null; attacker.order = { type: 'attack', targetId: 'player-objective' };
  threat.x = harvester.x + 6;
  game._aiDefend([attacker, distant, guard]);
  assert.equal(attacker._aiDefenseTarget, null, 'assaults are not recalled outside the close-asset trigger');
});

test('a public move into an exposed economy lane can trigger emergency recall', () => {
  const game = new Game({ seed: 843, difficulty: 'normal' });
  game.replayVersion = 25;
  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId === 'harvester');
  const harvester = game.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester');
  harvester.x = 25.5; harvester.y = 25.5;
  const defender = game._createUnit('enemy', 'lightTank', harvester.x + 3, harvester.y + 1);
  const assaultOrder = { type: 'attack', targetId: 'player-objective', aiTeam: 7, aiTeamRole: 'line' };
  defender.order = structuredClone(assaultOrder);
  const raider = game._createUnit('player', 'lightTank', harvester.x + 9, harvester.y + 3);
  game._aiDefend([defender]);
  assert.equal(defender._aiDefenseTarget, undefined);
  game.select([raider.id]);
  assert.equal(game.issueMove(harvester.x + 2, harvester.y + 3).ok, true);
  for (let i = 0; i < 60; i++) game._updateUnit(raider, 0.1);
  assert.ok(Math.hypot(raider.x - harvester.x, raider.y - harvester.y) < 5.5);
  game._aiDefend([defender]);
  assert.equal(defender._aiDefenseTarget, raider.id);
  const loaded = Game.deserialize(game.serialize());
  game.select([raider.id]);
  assert.equal(game.issueMove(harvester.x + 11, harvester.y + 3).ok, true);
  for (let i = 0; i < 80; i++) game._updateUnit(raider, 0.1);
  assert.equal(game.isVisible(raider, 'enemy'), false);
  game._aiDefend([defender]);
  assert.deepEqual(defender.order, assaultOrder);
  assert.equal(defender._aiDefenseResumeOrder, null);

  const loadedRaider = loaded.getEntity(raider.id);
  loaded.select([loadedRaider.id]);
  assert.equal(loaded.issueMove(harvester.x + 11, harvester.y + 3).ok, true);
  for (let i = 0; i < 80; i++) loaded._updateUnit(loadedRaider, 0.1);
  loaded._aiDefend([loaded.getEntity(defender.id)]);
  assert.deepEqual(loaded.getEntity(defender.id).order, assaultOrder,
    'a save during the diversion restores the same assault after withdrawal');
});
