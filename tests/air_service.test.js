import test from 'node:test';
import assert from 'node:assert/strict';
import { AIR_SERVICE_RULES_VERSION, Game } from '../src/game/engine.js';

function arena(replayVersion) {
  const game = new Game({ seed: 4312, mode: 'multiplayer', replayVersion });
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  game._createBuilding('player', 'command', 2, 2);
  game._createBuilding('enemy', 'command', 56, 42);
  game._refreshPower();
  return game;
}

function addHelipad(game, progress = 1) {
  const power = game._createBuilding('player', 'power', 6, 6);
  const pad = game._createBuilding('player', 'helipad', 10, 10, progress);
  game._refreshPower();
  return { power, pad };
}

function advance(game, seconds) {
  const steps = Math.ceil(seconds * 30);
  for (let i = 0; i < steps; i++) game.update(1 / 30);
}

test('manual rearm returns a partly loaded gunship to a pad, refills it, then holds', () => {
  const game = arena();
  addHelipad(game);
  const aircraft = game._createUnit('player', 'orca', 11, 11, { type: 'move', x: 25.5, y: 11.5 });
  aircraft.ammo = 2;
  aircraft.path = [{ x: 14, y: 11 }]; aircraft._pathGoal = 'stale';
  aircraft._jamWaypoint = { x: 14, y: 11 }; aircraft._jamSeconds = 2;
  game.select(aircraft.id);

  assert.deepEqual(game.issueRearm(), { ok: true });
  assert.deepEqual(aircraft.order, { type: 'rearm' });
  assert.equal(aircraft._resumeOrder, null, 'manual service cancels the previous sortie order');
  assert.deepEqual(aircraft.path, []);
  assert.equal(aircraft._pathGoal, null);
  assert.equal(aircraft._jamWaypoint, null);
  assert.equal(aircraft._jamSeconds, 0);
  advance(game, 8);
  assert.equal(aircraft.ammo, 6);
  assert.deepEqual(aircraft.order, { type: 'idle' }, 'manual rearm holds at the pad when full');
  assert.equal(aircraft._resumeOrder, null);
  assert.ok(game.events.some(event => event.type === 'order' && event.order === 'rearm' &&
    event.ids.includes(aircraft.id)));
});

test('empty-aircraft ordinary moves remain legacy-stalled at v65 and travel at v66, including queued save state', () => {
  const legacy = arena(65);
  const oldAircraft = legacy._createUnit('player', 'orca', 20.5, 20.5);
  oldAircraft.ammo = 0;
  legacy.select(oldAircraft.id);
  assert.equal(legacy.issueMove(30.5, 20.5).ok, true);
  assert.deepEqual(oldAircraft.order, { type: 'move', x: 30.5, y: 20.5, attackMove: false });
  advance(legacy, 5);
  assert.deepEqual(oldAircraft.order, { type: 'rearm' });
  assert.equal(oldAircraft.x, 20.5, 'legacy rearm behavior stays unchanged without a pad');

  const current = arena();
  const aircraft = current._createUnit('player', 'orca', 20.5, 20.5);
  aircraft.ammo = 0;
  current.select(aircraft.id);
  assert.equal(current.issueMove(23.5, 20.5).ok, true);
  assert.equal(aircraft.order.type, 'forceMove');
  assert.equal(current.issueMove(30.5, 20.5, false, true).ok, true);
  assert.equal(aircraft.order.queue[0].type, 'forceMove');

  const restored = Game.deserialize(current.serialize());
  const loadedAircraft = restored.getEntity(aircraft.id);
  assert.equal(loadedAircraft.order.type, 'forceMove');
  assert.equal(loadedAircraft.order.queue[0].type, 'forceMove');
  advance(restored, 5);
  assert.ok(loadedAircraft.x > 28, 'the aircraft completes the queued move despite having no pad');
  assert.equal(loadedAircraft.ammo, 0);
});

test('rearm fails without a completed powered pad and leaves orders untouched, then works when restored', () => {
  const game = arena();
  const { pad } = addHelipad(game, 0.5);
  const aircraft = game._createUnit('player', 'apache', 20.5, 20.5, { type: 'guard', x: 20.5, y: 20.5 });
  aircraft.ammo = 3;
  aircraft._resumeOrder = { type: 'move', x: 27.5, y: 20.5 };
  aircraft.path = [{ x: 22, y: 20 }];
  game.select(aircraft.id);
  const priorOrder = structuredClone(aircraft.order);
  const priorResume = structuredClone(aircraft._resumeOrder);
  const priorPath = structuredClone(aircraft.path);
  const eventCount = game.events.length;

  assert.equal(game.issueRearm().ok, false, 'unfinished pads are not operational');
  pad.progress = 1; pad.powered = false;
  assert.equal(game.issueRearm().ok, false, 'unpowered pads are not operational');
  pad.powered = true; pad.hp = 0;
  assert.equal(game.issueRearm().ok, false, 'destroyed pads are not operational');
  assert.deepEqual(aircraft.order, priorOrder);
  assert.deepEqual(aircraft._resumeOrder, priorResume);
  assert.deepEqual(aircraft.path, priorPath);
  assert.equal(game.events.length, eventCount, 'rejected service requests do not emit an order');

  pad.hp = pad.maxHp;
  pad.progress = 1; pad.powered = true;
  assert.deepEqual(game.issueRearm(), { ok: true });
  assert.deepEqual(aircraft.order, { type: 'rearm' });
});

test('mixed selection orders only eligible armed aircraft to rearm', () => {
  const game = arena();
  addHelipad(game);
  const orca = game._createUnit('player', 'orca', 11, 11);
  const fullApache = game._createUnit('player', 'apache', 12, 11);
  const transport = game._createUnit('player', 'dropship', 13, 11);
  const rifle = game._createUnit('player', 'rifle', 14, 11);
  orca.ammo = 1;
  fullApache.ammo = 8;
  game.select([orca.id, fullApache.id, transport.id, rifle.id]);

  assert.deepEqual(game.issueRearm(), { ok: true });
  assert.deepEqual(orca.order, { type: 'rearm' });
  assert.deepEqual(fullApache.order, { type: 'idle' });
  assert.deepEqual(transport.order, { type: 'idle' });
  assert.deepEqual(rifle.order, { type: 'idle' });
});

test('automatic rearm still resumes its prior move order after refilling', () => {
  const game = arena();
  addHelipad(game);
  const aircraft = game._createUnit('player', 'orca', 11, 11, { type: 'move', x: 18.5, y: 11.5 });
  aircraft.ammo = 0;

  advance(game, 12);
  assert.equal(aircraft.ammo, 6);
  assert.equal(aircraft.order.type, 'move');
  assert.ok(aircraft.x > 11, 'the automatic sortie resumes travel after service');
});

test('v65 rejects manual rearm and markerless saves stay pinned to v65', () => {
  assert.equal(AIR_SERVICE_RULES_VERSION, 66);
  const legacy = arena(65);
  const aircraft = legacy._createUnit('player', 'orca', 11, 11);
  aircraft.ammo = 1;
  legacy.select(aircraft.id);
  assert.equal(legacy.issueRearm().ok, false);
  assert.deepEqual(aircraft.order, { type: 'idle' });

  const skirmish = new Game({ seed: 55, mode: 'skirmish' });
  const save = JSON.parse(skirmish.serialize());
  delete save.airServiceRulesVersion;
  const restored = Game.deserialize(save);
  assert.equal(restored.replayVersion, 65);
  assert.equal(restored.airServiceRulesVersion, AIR_SERVICE_RULES_VERSION);
  for(const mode of ['campaign','multiplayer']){
    save.mode=mode;
    assert.equal(Game.deserialize(save).replayVersion,65,
      `older ${mode} state retains its control rules`);
  }
});
