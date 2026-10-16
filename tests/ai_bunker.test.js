import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_FIELD_BUNKER_RULES_VERSION, Game, GARRISON_RULES_VERSION } from '../src/game/engine.js';

function threatenedGame({ difficulty = 'normal', replayVersion = 80, credits = 1600, spareRifles = 4 } = {}) {
  const game = new Game({ seed: 12, mode: 'skirmish', difficulty, replayVersion });
  game.time = 10;
  const threat = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  threat.x = 56; threat.y = 20;
  for (let i = 0; i < spareRifles; i++) game._createUnit('enemy', 'rifle', 50 + i * 0.4, 25);
  game.credits.enemy = credits;
  return { game, threat };
}

test('rules 80 enables only Veteran and Elite skirmish policy and pins markerless v79 saves', () => {
  assert.equal(AI_FIELD_BUNKER_RULES_VERSION, 80);
  assert.equal(threatenedGame().game._aiFieldBunkerEnabled(), true);
  assert.equal(threatenedGame({ difficulty: 'hard' }).game._aiFieldBunkerEnabled(), true);
  assert.equal(threatenedGame({ difficulty: 'easy' }).game._aiFieldBunkerEnabled(), false);
  assert.equal(new Game({ seed: 12, mode: 'campaign', difficulty: 'normal', replayVersion: 80 })
    ._aiFieldBunkerEnabled(), false);
  assert.equal(threatenedGame({ replayVersion: 79 }).game._aiFieldBunkerEnabled(), false);

  const old = JSON.parse(threatenedGame().game.serialize());
  old.replayVersion = null;
  old.garrisonRulesVersion = GARRISON_RULES_VERSION;
  delete old.aiFieldBunkerRulesVersion;
  const restored = Game.deserialize(old);
  assert.equal(restored.replayVersion, 79);
  assert.equal(restored._aiFieldBunkerEnabled(), false);
});

test('visible threat starts one legal paid bunker before optional builds, with surplus infantry only', () => {
  const { game, threat } = threatenedGame();
  const events = [];
  game._aiObserve();
  const observed = game._aiFieldBunkerThreat();
  const planned = game._aiFieldBunkerPlacement(observed.industry, observed.threat);
  assert.ok(planned);
  assert.equal(game.canPlaceBuilding('bunker', planned.x, planned.y, 'enemy').ok, true);
  game.onEvent = event => events.push({ event, credits: game.credits.enemy });
  game._aiTick();

  const bunkers = game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'bunker');
  assert.equal(bunkers.length, 1);
  const bunker = bunkers[0];
  assert.equal(bunker.progress, 0);
  assert.deepEqual({ x: bunker.x, y: bunker.y }, planned);
  assert.ok(game._aiIntel.some(item => item.id === threat.id && item.seen === game.time));
  assert.ok(events.some(({ event }) => event.type === 'constructionStarted' &&
    event.owner === 'enemy' && event.defId === 'bunker'));
  assert.equal(game.credits.enemy, 250);

  game._aiTick();
  assert.equal(game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'bunker').length, 1);
});

test('bunker placement uses observed intel and leaves replacement Harvester cash protected', () => {
  const hidden = threatenedGame({ spareRifles: 4 });
  hidden.threat.x = 1; hidden.threat.y = 1;
  hidden.game._aiObserve();
  assert.equal(hidden.game._aiFieldBunkerThreat(), null);
  assert.equal(hidden.game._aiFieldBunkerTick(false, { buildOnly: true }), false);

  const recovery = threatenedGame({ credits: 1900, spareRifles: 4 });
  recovery.game.units = recovery.game.units.filter(unit => unit.owner !== 'enemy' || unit.defId !== 'harvester');
  recovery.game._aiTick();
  const factory = recovery.game.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory');
  assert.ok(factory.queue.some(item => item.defId === 'harvester'));
  assert.equal(recovery.game.buildings.some(building => building.owner === 'enemy' && building.defId === 'bunker'), false);
  assert.equal(recovery.game.credits.enemy, 50);
});

test('completed bunker recruits valid surplus through normal approach and fires from its crew', () => {
  const { game, threat } = threatenedGame();
  game._aiTick();
  const bunker = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'bunker');
  assert.ok(bunker);
  bunker.progress = 1;
  game.time = 30; // The original visible observation has expired; crew completion is still useful.
  game.commandOwner = 'player';
  game.selection = ['player-selection'];
  assert.equal(game._aiFieldBunkerTick(false), true);
  assert.equal(game.commandOwner, 'player');
  assert.deepEqual(game.selection, ['player-selection']);
  assert.ok(game.units.some(unit => unit.owner === 'enemy' && unit.order?.type === 'garrison' &&
    unit.order.bunkerId === bunker.id));

  let fired = false;
  for (let frame = 0; frame < 240 && !fired; frame++) {
    game.update(1 / 30);
    fired = bunker.garrisonFireUntil > game.time;
  }
  assert.ok(game.units.some(unit => unit.embarkedIn === bunker.id));
  assert.equal(threat.hp < threat.maxHp, true);
  assert.equal(fired, true);
  assert.ok(bunker.garrisonFireUntil > 0);
});

test('garrison reservations reject committed relay, siege, transport, and recovery infantry', () => {
  const { game } = threatenedGame();
  const unit = game.units.find(candidate => candidate.owner === 'enemy' && candidate.defId === 'rifle');
  unit.order = { type: 'guard' };
  unit._aiRelayUrgentRelayId = 'relay1';
  assert.equal(game._aiFieldBunkerUnitUncommitted(unit), false);
  unit._aiRelayUrgentRelayId = null;
  unit._aiSiegeVantageTarget = 'observed-bunker';
  assert.equal(game._aiFieldBunkerUnitUncommitted(unit), false);
  unit._aiSiegeVantageTarget = null;
  unit._aiSalvageDropOrder = { type: 'idle' };
  assert.equal(game._aiFieldBunkerUnitUncommitted(unit), false);
  unit._aiSalvageDropOrder = null;
  unit.order = { type: 'guard', aiBloomEscort: true };
  assert.equal(game._aiFieldBunkerUnitUncommitted(unit), false);
});

test('Siege Director counters a visible bunker under current rules and releases it in fog', () => {
  for(const replayVersion of [79,80]){
    const game=new Game({seed:2,difficulty:'normal',mode:'skirmish',aiCommanderProfileId:'siege-director',replayVersion});
    const bunker=game._createBuilding('player','bunker',35,20,1);
    const yard=game._createBuilding('player','command',33,20,1);
    const cannon=game._createUnit('enemy','artillery',45,20);
    const escort=game._createUnit('enemy','lightTank',46,21);
    let bunkerVisible=false;
    game.isVisible=entity=>entity===yard||entity===bunker&&bunkerVisible;
    assert.equal(game._aiSiegeVisibleDefenses([cannon,escort]),false);
    bunkerVisible=true;
    assert.equal(game._aiSiegeVisibleDefenses([cannon,escort]),replayVersion>=80);
    if(replayVersion<80)continue;
    assert.equal(cannon.order.targetId,bunker.id);
    assert.equal(escort.order.targetId,cannon.id);
    bunkerVisible=false;
    game._aiSiegeVisibleDefenses([cannon,escort]);
    assert.equal(cannon.order.type,'idle','a hidden bunker does not retain the directed siege order');
    bunkerVisible=true;
    assert.equal(game._launchAiWave(),true);
    assert.equal(cannon.order.targetId,bunker.id,'the attack packet prioritizes the observed fortification over the nearby yard');
  }
});
