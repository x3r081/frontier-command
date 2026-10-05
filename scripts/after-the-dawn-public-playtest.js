// Public-command playtest for the fixed-force After the Dawn rescue. The policy
// chooses units by their visible roles and uses boarding, unloading, and
// direct attack commands; campaign state is read only for assertions.
import assert from 'node:assert/strict';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

for (const difficulty of ['normal', 'hard']) {
  let game = createCampaignGame(12, difficulty, 481516);
  const ships = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'dropship');
  const engineer = game.units.find(unit => unit.owner === 'player' && unit.defId === 'engineer');
  assert.equal(ships.length, 2, `${difficulty}: both rescue transports are present`);
  assert.ok(engineer, `${difficulty}: the signal engineer is present`);

  const advance = steps => {
    for (let i = 0; i < steps && game.status === 'playing'; i++) {
      game.update(0.2);
      updateCampaign(game, 12, 0.2);
    }
  };

  // Split the six-person team by role: engineer, anti-armor, and medic travel
  // together; the rifle/flamer screen occupies the second transport.
  const firstTeam = game.units.filter(unit => unit.owner === 'player' &&
    ['engineer', 'rocket', 'medic'].includes(unit.defId));
  const secondTeam = game.units.filter(unit => unit.owner === 'player' &&
    ['flamer', 'rifle'].includes(unit.defId));
  assert.equal(firstTeam.length + secondTeam.length, 6, `${difficulty}: full team accounted for`);
  game.select(firstTeam.map(unit => unit.id));
  assert.equal(game.issueBoard(ships[0].id).ok, true);
  game.select(secondTeam.map(unit => unit.id));
  assert.equal(game.issueBoard(ships[1].id).ok, true);
  advance(50);
  assert.deepEqual(ships.map(ship => ship.passengerIds.length), [4, 2],
    `${difficulty}: transports complete loading`);

  // Save and reload while the team is embarked, as a player could between legs.
  game = game.constructor.deserialize(game.serialize());
  let loadedShips = ships.map(ship => game.getEntity(ship.id));
  assert.equal(game.campaignState.phase, 'secure-landing');
  game.select(loadedShips[0].id);
  assert.equal(game.issueUnload(41.5, 29.5).ok, true);
  game.select(loadedShips[1].id);
  assert.equal(game.issueUnload(41.5, 32.5).ok, true);
  if (difficulty === 'hard') {
    for (let i = 0; i < 600 && game.status === 'playing' && game.campaignState.phase === 'secure-landing'; i++) advance(1);
  } else {
    advance(300);
  }
  assert.equal(game.campaignState.phase, 'extract-engineer',
    `${difficulty}: engineer presence and relay hold complete the landing objective`);
  assert.equal(game.status, 'playing', `${difficulty}: landing does not prematurely end the mission`);
  assert.equal(game.relays[2].owner, 'player');
  assert.ok(game.kills.player > 0, `${difficulty}: team engages the defenders`);

  let survivingEngineer = game.getEntity(engineer.id);
  assert.ok(survivingEngineer.hp > 0, `${difficulty}: engineer survives the landing`);
  let engineerAlreadyBoarded = false;
  if (difficulty === 'hard') {
    assert.equal(game.campaignState.extractionPatrolWarned, true, 'the east-bank patrol warning has fired');
    assert.equal(game.campaignState.extractionPatrolFired, false, 'the warning arrives before the patrol');
    for (let i = 0; i < 10; i++) advance(1);
    assert.ok(game.campaignState.extractionPatrolWarningElapsed >= 1.9 &&
      game.campaignState.extractionPatrolWarningElapsed <= 2.1, 'the warning clock advances before saving');
    const warningSave = game.serialize();
    const idleGame = game.constructor.deserialize(warningSave);
    const idleEngineer = idleGame.getEntity(engineer.id);
    const idleShips = loadedShips.map(ship => idleGame.getEntity(ship.id));
    for (let i = 0; i < 150 && idleGame.status === 'playing'; i++) {
      idleGame.update(0.2);
      updateCampaign(idleGame, 12, 0.2);
    }
    assert.equal(idleGame.status, 'defeat', 'ignoring the warning loses the engineer');
    assert.equal(idleEngineer.hp, 0);
    console.log(`hard idle: ${idleGame.status} at ${idleGame.campaignState.elapsed.toFixed(1)}s; engineer ${idleEngineer.hp}/${idleEngineer.maxHp}; ship ${idleShips[0].hp.toFixed(1)} HP`);

    game = game.constructor.deserialize(warningSave);
    loadedShips = loadedShips.map(ship => game.getEntity(ship.id));
    survivingEngineer = game.getEntity(engineer.id);
    assert.equal(game.campaignState.extractionPatrolFired, false,
      'saving during the warning does not deploy the patrol early');
    assert.ok(Math.abs(game.campaignState.extractionPatrolWarningElapsed - 2) < 1e-9,
      'the warning clock survives save and reload');
    assert.equal(game.events.filter(event => event.type === 'campaignThreatWarning').length, 1,
      'reload does not replay the warning cue');
    game.select(survivingEngineer.id);
    assert.equal(game.issueBoard(loadedShips[0].id).ok, true, 'board the engineer during the warning');
    advance(15);
    assert.equal(game.campaignState.extractionPatrolFired, true, 'the patrol arrives after the warning window');
    assert.equal(game.units.filter(unit => unit.owner === 'enemy' && ['buggy', 'rifle'].includes(unit.defId) && unit.hp > 0).length,
      2, 'exactly one patrol is deployed after reloading the warning save');
    const beforeSave = game.visibleEnemies.filter(unit => ['buggy', 'rifle'].includes(unit.defId))
      .map(unit => [unit.id, unit.defId, unit.x, unit.y, unit.hp]);
    game = game.constructor.deserialize(game.serialize());
    loadedShips = loadedShips.map(ship => game.getEntity(ship.id));
    survivingEngineer = game.getEntity(engineer.id);
    assert.equal(game.campaignState.extractionPatrolFired, true,
      'the extraction patrol deployment survives a save during the encounter');
    const patrol = game.visibleEnemies.filter(unit => ['buggy', 'rifle'].includes(unit.defId));
    assert.deepEqual(patrol.map(unit => [unit.id, unit.defId, unit.x, unit.y, unit.hp]), beforeSave,
      'the visible patrol replays from the saved encounter state');
    assert.equal(patrol.length, 2, 'the east-bank patrol is visible when its reinforcement cue fires');
    engineerAlreadyBoarded = true;
    const buggy = patrol.find(unit => unit.defId === 'buggy');
    const rifle = patrol.find(unit => unit.defId === 'rifle');
    const rockets = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rocket' && unit.hp > 0);
    const infantryScreen = game.units.filter(unit => unit.owner === 'player' &&
      ['flamer', 'rifle'].includes(unit.defId) && unit.hp > 0);
    game.select(rockets.map(unit => unit.id));
    assert.equal(game.issueAttack(buggy.id).ok, true);
    game.select(infantryScreen.map(unit => unit.id));
    assert.equal(game.issueAttack(rifle.id).ok, true);
    advance(100);
    assert.ok(survivingEngineer.hp > 0, 'the extraction order protects the engineer');
    assert.equal(game.status, 'playing', 'the warned response keeps the mission winnable');
  }
  if (!engineerAlreadyBoarded) {
    game.select(survivingEngineer.id);
    assert.equal(game.issueBoard(loadedShips[0].id).ok, true);
    advance(20);
  } else {
    advance(20);
  }
  assert.deepEqual(loadedShips[0].passengerIds, [survivingEngineer.id]);
  game.select(loadedShips[0].id);
  assert.equal(game.issueUnload(22.5, 29.5).ok, true);
  advance(150);

  assert.equal(game.status, 'victory', `${difficulty}: engineer reaches west-bank extraction`);
  assert.equal(game.campaignResult.mission, 'after-the-dawn');
  assert.equal(game.campaignResult.keyAssetSurvived, true);
  assert.equal(survivingEngineer.embarkedIn, null);
  assert.ok(survivingEngineer.x < 30);
  console.log(`${difficulty}: ${game.status} at ${game.campaignState.elapsed.toFixed(1)}s; engineer ${survivingEngineer.hp.toFixed(1)}/${survivingEngineer.maxHp} HP; player kills ${game.kills.player}`);
}
