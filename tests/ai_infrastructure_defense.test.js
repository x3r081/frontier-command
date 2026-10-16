import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_INFRASTRUCTURE_DEFENSE_RULES_VERSION, Game } from '../src/game/engine.js';

function infrastructureRaid(replayVersion = AI_INFRASTRUCTURE_DEFENSE_RULES_VERSION) {
  const game = new Game({ seed: 481516, difficulty: 'normal', mode: 'skirmish', replayVersion });
  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId === 'harvester');
  const tech = game._createBuilding('enemy', 'tech', 30, 25, 1);
  tech.powered = true;
  const defender = game._createUnit('enemy', 'lightTank', 24.5, 26.5);
  const raider = game._createUnit('player', 'lightTank', 33.5, 26.5);
  game._updateFog();
  assert.equal(game.isVisible(raider, 'enemy'), true, 'enemy infrastructure observes the attacking tank');
  assert.equal(game.isVisible(tech, 'player'), true, 'the player can see the attacked research center');
  game.select([raider.id]);
  assert.equal(game.issueAttack(tech.id).ok, true, 'the raid uses the public attack order');
  return { game, tech, defender, raider };
}

test('rules 64 recalls a nearby defender for a visible raid on operational tech', () => {
  const legacy = infrastructureRaid(63);
  legacy.game.update(12);
  assert.equal(legacy.defender.order.type, 'idle', 'rules 63 keeps its original protected assets');
  assert.equal(legacy.raider.hp, legacy.raider.maxHp,
    'the defender stays outside passive acquisition range in the legacy ruleset');

  const campaign = infrastructureRaid(64);
  campaign.game.mode = 'campaign';
  campaign.game._aiDefend([campaign.defender]);
  assert.equal(campaign.defender.order.type, 'idle', 'campaign keeps its authored defense policy');

  const current = infrastructureRaid();
  current.game.update(12);
  assert.equal(current.defender._aiDefenseTarget, current.raider.id);
  assert.equal(current.defender.order.targetId, current.raider.id);
  assert.equal(current.defender.order.aiDefense, true);
  assert.ok(current.defender.x > 24.5, 'the assigned defender approaches from outside firing range');
  assert.ok(current.raider.hp < legacy.raider.hp,
    'the bounded defense response puts the attacking tank under fire during normal fixed ticks');
});

test('infrastructure defense ignores threats outside enemy vision', () => {
  const { game, defender, raider } = infrastructureRaid();
  const isVisible = game.isVisible.bind(game);
  game.isVisible = (entity, viewer) => entity === raider && viewer === 'enemy'
    ? false : isVisible(entity, viewer);

  game._aiDefend([defender]);

  assert.equal(defender._aiDefenseTarget, undefined);
  assert.equal(defender.order.type, 'idle');
});

test('completed unpowered support stays protected while unfinished support is excluded', () => {
  const completed = infrastructureRaid();
  completed.tech.powered = false;
  completed.game._aiDefend([completed.defender]);
  assert.equal(completed.defender._aiDefenseTarget, completed.raider.id,
    'a completed research center remains a valuable asset during a power outage');

  const unfinished = infrastructureRaid();
  unfinished.tech.hp = 0;
  const radar = unfinished.game._createBuilding('enemy', 'radar', 30, 25, 0.5);
  radar.powered = false;
  const isVisible = unfinished.game.isVisible.bind(unfinished.game);
  unfinished.game.isVisible = (entity, viewer) => entity === unfinished.raider && viewer === 'enemy'
    ? true : isVisible(entity, viewer);
  unfinished.game._aiDefend([unfinished.defender]);
  assert.equal(unfinished.defender._aiDefenseTarget, undefined,
    'an unfinished radar does not become a protected asset before it is operational');
  assert.equal(unfinished.defender.order.type, 'idle');
});

test('the bounded response assigns defenders across two infrastructure raid fronts', () => {
  const game = new Game({ seed: 481517, difficulty: 'normal', mode: 'skirmish',
    replayVersion: AI_INFRASTRUCTURE_DEFENSE_RULES_VERSION });
  game.units = game.units.filter(unit => unit.owner !== 'enemy' || unit.defId === 'harvester');
  for (const [defId, x, y] of [['tech', 24, 25], ['power', 42, 30]]) {
    const building = game._createBuilding('enemy', defId, x, y, 1);
    building.powered = true;
  }
  const defenders = [
    game._createUnit('enemy', 'lightTank', 22.5, 27.5),
    game._createUnit('enemy', 'lightTank', 22.5, 28.5),
    game._createUnit('enemy', 'lightTank', 41.5, 34.5),
  ];
  const raiders = [
    game._createUnit('player', 'lightTank', 30.5, 27.5),
    game._createUnit('player', 'lightTank', 47.5, 34.5),
  ];
  game._updateFog();
  assert.ok(raiders.every(raider => game.isVisible(raider, 'enemy')));

  game._aiDefend(defenders);

  const assigned = defenders.filter(defender => defender._aiDefenseTarget);
  assert.equal(assigned.length, 3, 'normal difficulty keeps the existing three-unit response cap');
  for (const raider of raiders)
    assert.ok(assigned.some(defender => defender._aiDefenseTarget === raider.id),
      'each exposed infrastructure front receives a responder');
});

test('markerless unversioned skirmish saves retain rules 63 defense behavior', () => {
  const { game, defender, raider } = infrastructureRaid();
  const save = JSON.parse(game.serialize());
  save.replayVersion = null;
  assert.equal(Game.deserialize(save).replayVersion, null,
    'current unversioned saves preserve the live-rules sentinel');
  delete save.aiInfrastructureDefenseRulesVersion;

  const loaded = Game.deserialize(save);
  const loadedDefender = loaded.getEntity(defender.id);
  const loadedRaider = loaded.getEntity(raider.id);
  assert.equal(loaded.replayVersion, AI_INFRASTRUCTURE_DEFENSE_RULES_VERSION - 1);
  loaded._aiDefend([loadedDefender]);
  assert.equal(loadedDefender.order.type, 'idle');
  assert.equal(loadedDefender._aiDefenseTarget, undefined);
  delete save.matchedPaceRulesVersion;
  assert.equal(Game.deserialize(save).replayVersion, 62,
    'an older missing movement marker takes precedence over the new marker');
});
