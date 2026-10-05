import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CADET_RELAY_DOMINION_SECONDS, RELAY_DOMINION_MAJORITY, RELAY_DOMINION_SECONDS } from '../src/game/engine.js';

function giveMajority(game, owner) {
  for (const relay of game.relays.slice(0, RELAY_DOMINION_MAJORITY)) {
    relay.owner = owner;
    relay.progress = owner === 'player' ? 1 : -1;
    relay.contested = false;
  }
}

test('skirmish player wins after a continuous relay majority hold', () => {
  const game = new Game({ seed: 51 });
  giveMajority(game, 'player');
  game._updateRelayDominion(0);
  assert.deepEqual(game.relayDominion, {
    owner: 'player', elapsed: 0, required: RELAY_DOMINION_SECONDS,
    majority: RELAY_DOMINION_MAJORITY,
  });
  game._updateRelayDominion(RELAY_DOMINION_SECONDS - 0.1);
  assert.equal(game.status, 'playing');
  game._updateRelayDominion(0.1);
  assert.equal(game.status, 'victory');
  assert.equal(game.winner, 'player');
  assert.equal(game.events.filter(event => event.type === 'relayDominionStarted').length, 1);
  assert.equal(game.events.filter(event => event.type === 'relayDominionComplete').length, 1);
  assert.equal(game.events.at(-1).reason, 'relayDominion');
  game._updateRelayDominion(1);
  assert.equal(game.events.filter(event => event.type === 'relayDominionComplete').length, 1);
});

test('multiplayer enemy can win through the normal update loop', () => {
  const game = new Game({ seed: 52, mode: 'multiplayer' });
  giveMajority(game, 'enemy');
  game.update(0.1);
  assert.equal(game.relayDominion.owner, 'enemy');
  assert.equal(game.relayDominion.elapsed, 0);
  game.relayDominion.elapsed = RELAY_DOMINION_SECONDS - 0.1;
  game.update(0.1);
  assert.equal(game.status, 'defeat');
  assert.equal(game.winner, 'enemy');
  assert.equal(game.events.at(-1).reason, 'relayDominion');
});

test('Cadet skirmish grants a longer relay response window and preserves it through saves', () => {
  const game = new Game({ seed: 520, mode: 'skirmish', difficulty: 'easy' });
  assert.equal(game.relayDominion.required, CADET_RELAY_DOMINION_SECONDS);
  giveMajority(game, 'enemy');
  game._updateRelayDominion(0);
  game._updateRelayDominion(RELAY_DOMINION_SECONDS);
  assert.equal(game.status, 'playing');
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.relayDominion.required, CADET_RELAY_DOMINION_SECONDS);
  loaded._updateRelayDominion(CADET_RELAY_DOMINION_SECONDS - RELAY_DOMINION_SECONDS);
  assert.equal(loaded.status, 'defeat');
});

test('losing or contesting the majority resets progress and emits transitions once', () => {
  const game = new Game({ seed: 53, mode: 'multiplayer' });
  giveMajority(game, 'player');
  game._updateRelayDominion(0);
  game._updateRelayDominion(40);
  game.relays[0].contested = true;
  game._updateRelayDominion(1);
  game._updateRelayDominion(1);
  assert.equal(game.relayDominion.owner, null);
  assert.equal(game.relayDominion.elapsed, 0);
  assert.equal(game.events.filter(event => event.type === 'relayDominionBroken').length, 1);
  game.relays[0].contested = false;
  game._updateRelayDominion(0);
  game._updateRelayDominion(50);
  assert.equal(game.status, 'playing', 'the earlier hold does not contribute');
  game.relays[0].owner = 'enemy';
  game.relays[2].owner = 'enemy';
  game._updateRelayDominion(0);
  assert.equal(game.relayDominion.owner, 'enemy');
  assert.equal(game.relayDominion.elapsed, 0);
  assert.equal(game.events.filter(event => event.type === 'relayDominionStarted').length, 3);
});

test('campaign excludes Relay Dominion even with all relays held', () => {
  const game = new Game({ seed: 54, mode: 'campaign' });
  for (const relay of game.relays) relay.owner = 'player';
  game._updateRelayDominion(RELAY_DOMINION_SECONDS + 1);
  assert.equal(game.status, 'playing');
  assert.equal(game.relayDominion.owner, null);
  assert.equal(game.events.some(event => event.type.startsWith('relayDominion')), false);
});

test('elimination skirmish keeps relay benefits without an automatic relay victory', () => {
  const game = new Game({ seed: 541, mode: 'skirmish', victoryMode: 'elimination' });
  giveMajority(game, 'player');
  game._updateRelayDominion(RELAY_DOMINION_SECONDS + 1);
  assert.equal(game.status, 'playing');
  assert.equal(game.relayDominion.owner, null);
  assert.equal(game.events.some(event => event.type.startsWith('relayDominion')), false);
  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.victoryMode, 'elimination');
  loaded.update(0.1);
  assert.equal(loaded.status, 'playing');
  assert.equal(loaded.relayDominion.owner, null);
  loaded.buildings = loaded.buildings.filter(building => building.owner !== 'enemy');
  loaded.units = loaded.units.filter(unit => unit.owner !== 'enemy');
  loaded.update(0.1);
  assert.equal(loaded.status, 'victory');
  assert.equal(loaded.winner, 'player');
});

test('multiplayer elimination disables relay victory and resolves both sides symmetrically', () => {
  const game = new Game({ seed: 551, mode: 'multiplayer', victoryMode: 'elimination' });
  assert.equal(game.victoryMode, 'elimination');
  giveMajority(game, 'player');
  game.update(0.1);
  assert.equal(game.status, 'playing', 'relay majority does not end elimination');
  assert.equal(game.relayDominion.owner, null);

  const loaded = Game.deserialize(game.serialize());
  assert.equal(loaded.victoryMode, 'elimination');
  assert.equal(loaded.relayDominion.owner, null);
  loaded.units = loaded.units.filter(unit => unit.owner !== 'enemy');
  loaded.buildings = loaded.buildings.filter(building => building.owner !== 'enemy');
  loaded.update(0.1);
  assert.equal(loaded.status, 'victory');
  assert.equal(loaded.winner, 'player');

  const inverse = new Game({ seed: 552, mode: 'multiplayer', victoryMode: 'elimination' });
  inverse.commandOwner = 'enemy';
  inverse.units = inverse.units.filter(unit => unit.owner !== 'player');
  inverse.buildings = inverse.buildings.filter(building => building.owner !== 'player');
  inverse.update(0.1);
  assert.equal(inverse.status, 'defeat');
  assert.equal(inverse.winner, 'enemy');
});

test('legacy skirmish saves default to Relay Dominion and stale holds do not carry into elimination', () => {
  const game = new Game({ seed: 542, mode: 'skirmish' });
  giveMajority(game, 'enemy');
  game._updateRelayDominion(0);
  game._updateRelayDominion(42);
  const legacy = JSON.parse(game.serialize());
  delete legacy.victoryMode;
  assert.equal(Game.deserialize(legacy).victoryMode, 'dominion');
  legacy.victoryMode = 'elimination';
  const elimination = Game.deserialize(legacy);
  assert.equal(elimination.relayDominion.owner, null);
  assert.equal(elimination.relayDominion.elapsed, 0);
});

test('skirmish objective describes the chosen victory rules after launch and reload', () => {
  const dominion = new Game({ seed: 548, mode: 'skirmish' });
  assert.match(dominion.mission.objective, /two of three relays for 90 seconds/);
  const cadet = new Game({ seed: 549, mode: 'skirmish', difficulty: 'easy' });
  assert.match(cadet.mission.objective, /two of three relays for 120 seconds/);
  const elimination = new Game({ seed: 550, mode: 'skirmish', victoryMode: 'elimination' });
  assert.match(elimination.mission.objective, /powered defenses, and active industry/);
  const oldSave = JSON.parse(elimination.serialize());
  oldSave.mission.objective = 'Destroy the enemy base.';
  assert.equal(Game.deserialize(oldSave).mission.objective, elimination.mission.objective);
});

test('elimination ends when only passive infrastructure and harvesters remain', () => {
  const game = new Game({ seed: 543, mode: 'skirmish', victoryMode: 'elimination' });
  game.units = game.units.filter(unit => unit.owner !== 'player' || unit.defId === 'harvester');
  game.buildings = game.buildings.filter(building => building.owner !== 'player' ||
    ['power', 'refinery', 'radar', 'tech'].includes(building.defId));
  assert.ok(game.buildings.some(building => building.owner === 'player'));
  game.update(0.1);
  assert.equal(game.status, 'defeat');

  const viable = new Game({ seed: 544, mode: 'skirmish', victoryMode: 'elimination' });
  viable.units = viable.units.filter(unit => unit.owner !== 'player');
  viable.buildings = viable.buildings.filter(building => building.owner !== 'player' || building.defId === 'barracks');
  viable.update(0.1);
  assert.equal(viable.status, 'playing', 'a surviving barracks can rebuild an army');
});

test('powered defensive weapons remain a threat in Elimination', () => {
  const armed = new Game({ seed: 546, mode: 'skirmish', victoryMode: 'elimination' });
  armed.units = armed.units.filter(unit => unit.owner === 'player');
  armed.buildings = armed.buildings.filter(building => building.owner === 'player');
  armed._createBuilding('enemy', 'power', 38, 12);
  const tower = armed._createBuilding('enemy', 'turret', 41, 12);
  armed._refreshPower();
  assert.equal(tower.powered, true);
  armed.update(0.1);
  assert.equal(armed.status, 'playing', 'an armed defense must still be neutralized');
  tower.hp = 0;
  armed.update(0.1);
  assert.equal(armed.status, 'victory', 'power alone cannot prolong the match');

  const inert = new Game({ seed: 547, mode: 'skirmish', victoryMode: 'elimination' });
  inert.units = inert.units.filter(unit => unit.owner === 'player');
  inert.buildings = inert.buildings.filter(building => building.owner === 'player');
  const powerlessTower = inert._createBuilding('enemy', 'turret', 41, 12);
  inert._refreshPower();
  assert.equal(powerlessTower.powered, false);
  inert.update(0.1);
  assert.equal(inert.status, 'victory', 'a powerless defense cannot hold a spent army in play');
});

test('a simultaneous Elimination wipe is not ranked as a player victory', () => {
  const game = new Game({ seed: 545, mode: 'skirmish', victoryMode: 'elimination' });
  game.units = [];
  game.buildings = [];
  game.update(0.1);
  assert.equal(game.status, 'defeat');
  assert.equal(game.winner, 'enemy');
});

test('save/load resumes a hold and legacy saves start with a safe empty timer', () => {
  const game = new Game({ seed: 55, mode: 'multiplayer' });
  giveMajority(game, 'enemy');
  game._updateRelayDominion(0);
  game._updateRelayDominion(62.5);
  const loaded = Game.deserialize(game.serialize());
  assert.deepEqual(loaded.relayDominion, game.relayDominion);
  loaded._updateRelayDominion(RELAY_DOMINION_SECONDS - 62.5);
  assert.equal(loaded.winner, 'enemy');

  const legacy = JSON.parse(game.serialize());
  delete legacy.relayDominion;
  assert.deepEqual(Game.deserialize(legacy).relayDominion, {
    owner: null, elapsed: 0, required: RELAY_DOMINION_SECONDS,
    majority: RELAY_DOMINION_MAJORITY,
  });
});
