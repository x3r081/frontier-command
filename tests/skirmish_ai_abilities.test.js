import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';

const casts = game => game.events.filter(event => event.type === 'commandAbility' &&
  event.owner === 'enemy');

function lostContact(replayVersion = null) {
  const game = new Game({ seed: 91 });
  game.replayVersion = replayVersion;
  game.time = 10;
  const target = game._createUnit('player', 'rifle', 25.5, 25.5);
  const observer = game._createUnit('enemy', 'scout', 25.5, 26.5);
  assert.equal(game.isVisible(target, 'enemy'), true);
  game._aiObserve();
  observer.x = 51; observer.y = 6;
  const squad = [game._createUnit('enemy', 'rifle', 33.5, 25.5),
    game._createUnit('enemy', 'rifle', 33.5, 26.5)];
  assert.equal(game.isVisible(target, 'enemy'), false);
  game.time = 15;
  game.commandEnergy.enemy = 70;
  return { game, target, squad };
}

test('v27 AI scans a recent last sighting near its squad, not a hidden current position', () => {
  const { game, target, squad } = lostContact(27);
  target.x = 10.5; target.y = 20.5;
  game._aiUseCommandAbilities(squad);
  assert.deepEqual(casts(game).map(event => [event.abilityId, event.x, event.y]),
    [['scan', 25.5, 25.5]]);
  assert.equal(game.commandEnergy.enemy, 45);
  assert.equal(game.isVisible(target, 'enemy'), false,
    'the scan reveals its selected area, not a hidden unit elsewhere');
  game._aiUseCommandAbilities(squad);
  assert.equal(casts(game).length, 1, 'active scans and cooldown prevent repeated casts');
});

test('AI saves scans when intelligence is stale, no squad can follow up, or replay predates v27', () => {
  const stale = lostContact(27);
  stale.game.time = 23;
  stale.game._aiUseCommandAbilities(stale.squad);
  assert.equal(casts(stale.game).length, 0);

  const unsupported = lostContact(27);
  unsupported.game._aiUseCommandAbilities(unsupported.squad.slice(0, 1));
  assert.equal(casts(unsupported.game).length, 0);

  const legacy = lostContact(26);
  legacy.game._aiUseCommandAbilities(legacy.squad);
  assert.equal(casts(legacy.game).length, 0);

  const lowEnergy = lostContact(27);
  lowEnergy.game.commandEnergy.enemy = 54;
  lowEnergy.game._aiUseCommandAbilities(lowEnergy.squad);
  assert.equal(casts(lowEnergy.game).length, 0,
    'reconnaissance still requires an energy reserve');

  const ready = lostContact(27);
  ready.game.commandEnergy.enemy = 55;
  ready.game._aiUseCommandAbilities(ready.squad);
  assert.deepEqual(casts(ready.game).map(event => event.abilityId), ['scan']);
  assert.equal(ready.game.commandEnergy.enemy, 30);
});

test('v27 AI shields a wounded squad in visible combat before overcharging it', () => {
  const game = new Game({ seed: 92 });
  game.replayVersion = 27;
  game.commandEnergy.enemy = 100;
  const squad = [game._createUnit('enemy', 'rifle', 25.5, 25.5),
    game._createUnit('enemy', 'rifle', 26.5, 25.5),
    game._createUnit('enemy', 'rifle', 26.5, 26.5)];
  const threat = game._createUnit('player', 'rifle', 28.5, 25.5);
  squad[0].hp *= 0.5;
  assert.equal(game.isVisible(threat, 'enemy'), true);

  game._aiUseCommandAbilities(squad);
  assert.deepEqual(casts(game).map(event => event.abilityId), ['shield']);
  assert.equal(game.commandEnergy.enemy, 55);
  assert.ok(squad.every(unit => unit.shieldHp > 0));

  game._aiUseCommandAbilities(squad);
  assert.deepEqual(casts(game).map(event => event.abilityId), ['shield', 'overcharge']);
  assert.equal(game.commandEnergy.enemy, 15);
});

test('visible combat takes priority over a valid last-sighting scan', () => {
  const { game, squad } = lostContact(27);
  squad[0].hp *= 0.5;
  const threat = game._createUnit('player', 'rifle', 35.5, 25.5);
  assert.equal(game.isVisible(threat, 'enemy'), true);
  game._aiUseCommandAbilities(squad);
  assert.deepEqual(casts(game).map(event => event.abilityId), ['shield']);
  assert.equal(game.scans.length, 0);
});

test('v27 AI reserves shield energy when overcharging production between fights', () => {
  const game = new Game({ seed: 93 });
  game.replayVersion = 27;
  const producer = game.buildings.find(building => building.owner === 'enemy' &&
    building.defId === 'barracks');
  producer.queue.push({ defId: 'rifle', progress: 0 });
  game.commandEnergy.enemy = 84;
  game._aiUseCommandAbilities([]);
  assert.equal(casts(game).length, 0);

  game.commandEnergy.enemy = 85;
  game._aiUseCommandAbilities([]);
  assert.deepEqual(casts(game).map(event => event.abilityId), ['overcharge']);
  assert.equal(game.commandEnergy.enemy, 45);
  game.commandCooldowns.enemy.overcharge = 0;
  game.commandEnergy.enemy = 100;
  game._aiUseCommandAbilities([]);
  assert.equal(casts(game).length, 1, 'production still under the effect is not boosted again');
});
