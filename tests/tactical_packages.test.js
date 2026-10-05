import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_ABILITIES, Game, TACTICAL_PACKAGE_DEFS } from '../src/game/engine.js';

function researchCenter(game, owner = 'player') {
  const center = game._createBuilding(owner, 'tech', owner === 'player' ? 4 : 54, owner === 'player' ? 36 : 4);
  game._refreshPower();
  center.powered = true;
  return center;
}

function packageReady(game, id) {
  researchCenter(game);
  game.credits.player = 5000;
  game.research.player.doctrine = 'logistics';
  assert.equal(game.chooseTacticalPackage(id).ok, true);
  game._updateResearch(TACTICAL_PACKAGE_DEFS[id].researchTime);
  assert.equal(game.research.player.tactical, id);
}

test('tactical package is a mutually exclusive powered second research tier and survives saves', () => {
  const game = new Game({ seed: 701, mode: 'skirmish' });
  researchCenter(game);
  game.credits.player = 5000;
  assert.equal(game.chooseTacticalPackage('breach').ok, false, 'a doctrine is required first');
  game.research.player.doctrine = 'logistics';
  const credits = game.credits.player;
  assert.deepEqual(game.chooseTacticalPackage('breach'), { ok: true });
  assert.equal(game.credits.player, credits - TACTICAL_PACKAGE_DEFS.breach.cost);
  game._updateResearch(10);
  const progress = game.research.player.tacticalProject.progress;
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').powered = false;
  game._updateResearch(9);
  assert.equal(game.research.player.tacticalProject.progress, progress);
  game.buildings.find(b => b.owner === 'player' && b.defId === 'tech').powered = true;
  const restored = Game.deserialize(game.serialize());
  assert.deepEqual(restored.research, game.research);
  game._updateResearch(28); restored._updateResearch(28);
  assert.deepEqual(restored.research, game.research);
  assert.equal(game.research.player.tactical, 'breach');
  assert.equal(game.chooseTacticalPackage('rally').ok, false);
  assert.equal(game.commandCooldowns.player.breach, 0);
});

test('Breach rewards targeting a visible structure and ground fire at that structure', () => {
  const game = new Game({ seed: 702, mode: 'skirmish' });
  packageReady(game, 'breach');
  const target = game._createBuilding('enemy', 'command', 20, 20, 1);
  game.fog[21][21] = 2;
  game.commandEnergy.player = 100;
  assert.equal(game.useCommandAbility('breach', 21.5, 21.5).ok, true);
  assert.equal(game.breachZones.length, 1);
  const before = target.hp;
  game._applyDamage(target, 100, 'ion', 'player', null,
    { x: 8, y: 8, defId: 'lightTank', owner: 'player', projectile: true });
  assert.equal(before - target.hp, 145);
  const saved = Game.deserialize(game.serialize());
  assert.deepEqual(saved.breachZones, game.breachZones);
  game._tick(12.1);
  assert.equal(game.breachZones.length, 0);
});

test('Interdiction suppresses only visible enemy mobile weapons', () => {
  const game = new Game({ seed: 703, mode: 'skirmish' });
  packageReady(game, 'interdict');
  const target = game._createUnit('enemy', 'lightTank', 25, 25);
  game.fog[25][25] = 2;
  game.commandEnergy.player = 100;
  assert.equal(game.canUseCommandAbility('interdict', 25.2, 25.2).ok, true);
  assert.equal(game.useCommandAbility('interdict', 25.2, 25.2).ok, true);
  assert.equal(target.suppressedUntil, 3);
  assert.equal(game.canUseCommandAbility('interdict', 40, 30).ok, false,
    'a pulse cannot be spent on a point without a visible mobile weapon');
  assert.equal(COMMAND_ABILITIES.interdict.cooldown, 90);
});

test('Rally heals, clears suppression, and changes orders only for units in its radius', () => {
  const game = new Game({ seed: 704, mode: 'skirmish' });
  packageReady(game, 'rally');
  const nearby = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle');
  Object.assign(nearby, { x: 10, y: 10, hp: 50, suppressedUntil: 4, order: { type: 'guard', x: 9, y: 9 } });
  const distant = game.units.find(unit => unit.owner === 'player' && unit !== nearby && unit.defId === 'rifle');
  if (distant) Object.assign(distant, { x: 35, y: 30, order: { type: 'guard', x: 35, y: 30 } });
  const worker = game.units.find(unit => unit.owner === 'player' && unit.defId === 'harvester');
  Object.assign(worker, { x: 10.8, y: 10, order: { type: 'harvest', x: 12, y: 10 } });
  game.fog[10][10] = 2;
  game.commandEnergy.player = 100;
  assert.equal(game.useCommandAbility('rally', 10.5, 10.5).ok, true);
  assert.equal(nearby.hp, Math.min(nearby.maxHp, 140));
  assert.equal(nearby.suppressedUntil, 0);
  assert.deepEqual(nearby.order, { type: 'move', x: 10.5, y: 10.5, attackMove: true });
  if (distant) assert.deepEqual(distant.order, { type: 'guard', x: 35, y: 30 });
  assert.deepEqual(worker.order, { type: 'harvest', x: 12, y: 10 }, 'Rally never retasks nearby economy units');
});

test('AI researches a second package and uses it only when its tactical situation supports it', () => {
  const game = new Game({ seed: 705, mode: 'skirmish' });
  researchCenter(game, 'enemy');
  game.research.enemy.doctrine = 'logistics';
  game.credits.enemy = 3000;
  game._aiTick();
  assert.ok(game.research.enemy.tacticalProject);

  game.research.enemy.tacticalProject = null;
  game.research.enemy.tactical = 'breach';
  game.commandEnergy.enemy = 100;
  const target = game._createBuilding('player', 'command', 49, 5, 1);
  const attacker = game._createUnit('enemy', 'lightTank', 46, 6);
  attacker.sight = 12;
  assert.equal(game.isVisible(target, 'enemy'), true);
  assert.equal(game._aiUsePackageAbility([attacker]), true);
  assert.equal(game.breachZones.length, 1);
  assert.equal(game.breachZones[0].owner, 'enemy');
});

test('AI package research responds to visible structures, mobile threats, and its own casualties', () => {
  const breach = new Game({ seed: 706, mode: 'skirmish' });
  const breachTarget = breach._createBuilding('player', 'factory', 51, 4, 1);
  const breachForce = breach._createUnit('enemy', 'lightTank', 50, 6);
  breachForce.sight = 12;
  assert.equal(breach.isVisible(breachTarget, 'enemy'), true);
  assert.equal(breach._aiTacticalPackageForSituation(), 'breach');

  const remembered = new Game({ seed: 712, mode: 'skirmish' });
  remembered._aiIntel.push({ id: 'factory-sighting', defId: 'factory', x: 8, y: 36,
    building: true, seen: remembered.time - 10 });
  assert.equal(remembered._aiTacticalPackageForSituation(), 'breach',
    'recent structure memory is valid research evidence even while outside current sight');

  const interdict = new Game({ seed: 707, mode: 'skirmish' });
  const spotter = interdict._createUnit('enemy', 'lightTank', 50, 6);
  spotter.sight = 12;
  for (let i = 0; i < 4; i++) interdict._createUnit('player', 'lightTank', 49 + i * 0.6, 7);
  assert.equal(interdict.units.filter(unit => unit.owner === 'player' && interdict.isVisible(unit, 'enemy')).length >= 4, true);
  assert.equal(interdict._aiTacticalPackageForSituation(), 'interdict');

  const rally = new Game({ seed: 708, mode: 'skirmish' });
  for (let i = 0; i < 3; i++) {
    const unit = rally._createUnit('enemy', 'lightTank', 50 + i * 0.4, 6);
    unit.hp = unit.maxHp * 0.5;
  }
  const contact = rally._createUnit('player', 'lightTank', 53, 6);
  assert.equal(rally.isVisible(contact, 'enemy'), true);
  assert.equal(rally._aiTacticalPackageForSituation(), 'rally');
});

test('AI does not spend Rally on damaged troops outside a visible engagement', () => {
  const game = new Game({ seed: 709, mode: 'skirmish' });
  game.research.enemy.tactical = 'rally';
  game.commandEnergy.enemy = 100;
  const wounded = game._createUnit('enemy', 'lightTank', 52, 6);
  wounded.hp = 100;
  assert.equal(game._aiUsePackageAbility([wounded]), false);
  assert.equal(game.commandCooldowns.enemy.rally, 0);
});

test('AI ignores hidden structures when choosing Breach and reserves Interdiction for an active front', () => {
  const hidden = new Game({ seed: 710, mode: 'skirmish' });
  hidden._createBuilding('player', 'factory', 4, 36, 1);
  assert.equal(hidden._aiTacticalPackageForSituation(), 'rally',
    'unseen player industry does not count as a Breach target');

  const game = new Game({ seed: 711, mode: 'skirmish' });
  game.research.enemy.tactical = 'interdict';
  game.commandEnergy.enemy = 100;
  const attacker = game._createUnit('enemy', 'lightTank', 50, 6);
  const spotter = game._createUnit('enemy', 'scout', 30.5, 20);
  spotter.sight = 12;
  const visibleButRemote = game._createUnit('player', 'lightTank', 32, 20);
  assert.equal(game.isVisible(visibleButRemote, 'enemy'), true);
  assert.equal(game._aiUsePackageAbility([attacker]), false);
  assert.equal(game.commandCooldowns.enemy.interdict, 0);
});

test('version 31 keeps its recorded package choice while current rules use the same visible structure evidence', () => {
  const fixture = replayVersion => {
    const game = new Game({ seed: 713, mode: 'skirmish' });
    game.replayVersion = replayVersion;
    const factory = game._createBuilding('player', 'factory', 51, 4, 1);
    const observer = game._createUnit('enemy', 'lightTank', 50, 6);
    observer.sight = 12;
    assert.equal(game.isVisible(factory, 'enemy'), true);
    const wounded = [];
    for (let i = 0; i < 3; i++) {
      const unit = game._createUnit('enemy', 'lightTank', 52 + i * 0.2, 6);
      unit.hp = unit.maxHp * 0.5;
      wounded.push(unit);
    }
    return { game, wounded };
  };
  const legacy = fixture(31);
  const current = fixture(null);
  assert.equal(legacy.game._aiTacticalPackageForSituation(), 'rally');
  assert.equal(current.game._aiTacticalPackageForSituation(), 'breach');

  const game = legacy.game;
  const wounded = legacy.wounded;
  game.research.enemy.tactical = 'rally';
  game.commandEnergy.enemy = 100;
  assert.equal(game._aiUsePackageAbility(wounded), true,
    'v31 keeps its original Rally cast rule even without a visible enemy front');
});

test('version 33 values a reached front over a distant remembered base while version 32 keeps its choice', () => {
  const fixture = version => {
    const game = new Game({ seed: 714, mode: 'skirmish' });
    game.replayVersion = version;
    game._aiIntel.push({ id: 'old-factory', defId: 'factory', x: 8, y: 36,
      building: true, seen: game.time - 10 });
    const front = game._createUnit('enemy', 'lightTank', 50, 6);
    front.sight = 12;
    const threat = game._createUnit('player', 'lightTank', 52, 6);
    assert.equal(game.isVisible(threat, 'enemy'), true);
    return game;
  };
  assert.equal(fixture(32)._aiTacticalPackageForSituation(), 'breach');
  assert.equal(fixture(33)._aiTacticalPackageForSituation(), 'interdict');
});

test('version 33 can choose Rally for a wounded forward group even with distant structure intel', () => {
  const game = new Game({ seed: 715, mode: 'skirmish' });
  game.replayVersion = 33;
  game._aiIntel.push({ id: 'old-factory', defId: 'factory', x: 8, y: 36,
    building: true, seen: game.time - 10 });
  for (let i = 0; i < 3; i++) {
    const ally = game._createUnit('enemy', 'lightTank', 50 + i * 0.4, 6);
    ally.hp = ally.maxHp * 0.5;
  }
  const threat = game._createUnit('player', 'lightTank', 52, 6);
  assert.equal(game.isVisible(threat, 'enemy'), true);
  assert.equal(game._aiTacticalPackageForSituation(), 'rally');
});
