import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/engine.js';
import { activateSelectedUnitAbility, getFieldAbilityCohort } from '../src/game/fieldAbilities.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay, SOLO_REPLAY_VERSION } from '../src/game/replay.js';

function arena(faction = 'aegis', replayVersion) {
  const game = new Game({ faction, seed: 914, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);
  return game;
}

function addUnits(game, defId, count, owner = 'player') {
  return Array.from({ length: count }, (_, index) =>
    game._createUnit(owner, defId, 20.5 + index * 2, 20.5));
}

test('selected Guardian cohort activates every ready member and skips cooldown members', () => {
  const game = arena();
  const [ready, cooling, active] = addUnits(game, 'guardian', 3);
  cooling.abilityCooldown = 8;
  active.abilityCooldown = 12;
  active.braceUntil = game.time + 4;
  game.select([ready.id, cooling.id, active.id]);

  const cohort = getFieldAbilityCohort(game);
  assert.deepEqual(cohort, {
    abilityId: 'brace', ids: [ready.id, cooling.id, active.id], readyIds: [ready.id],
    activeIds: [active.id], coolingIds: [cooling.id], needsMoveIds: [],
    nextCooldown: 8, activeRemaining: 4,
  });
  const result = activateSelectedUnitAbility(game, 'brace');
  assert.equal(result.ok, true);
  assert.deepEqual(result.activatedIds, [ready.id]);
  assert.deepEqual(result.skippedIds, [cooling.id, active.id]);
  assert.ok(ready.braceUntil > game.time);
  assert.equal(cooling.braceUntil, 0);
  assert.equal(active.braceUntil, 4);
});

test('Specter cohort distinguishes moving, force-moving, and idle members', () => {
  const game = arena('vesper');
  const [moving, forceMoving, idle] = addUnits(game, 'stealthTank', 3);
  moving.order = { type: 'move', x: 31, y: 20.5 };
  forceMoving.order = { type: 'forceMove', x: 31, y: 22.5 };
  idle.order = { type: 'idle' };
  game.select([moving.id, forceMoving.id, idle.id]);

  const cohort = getFieldAbilityCohort(game);
  assert.deepEqual(cohort.readyIds, [moving.id, forceMoving.id]);
  assert.deepEqual(cohort.needsMoveIds, [idle.id]);
  assert.deepEqual(cohort.coolingIds, []);
  const result = activateSelectedUnitAbility(game, 'ghostRun');
  assert.equal(result.ok, true);
  assert.deepEqual(result.activatedIds, [moving.id, forceMoving.id]);
  assert.deepEqual(result.skippedIds, [idle.id]);
  assert.ok(moving.ghostRunUntil > game.time);
  assert.ok(forceMoving.ghostRunUntil > game.time);
  assert.equal(idle.ghostRunUntil, 0);
  assert.deepEqual(idle.order, { type: 'idle' }, 'activation does not create or change an order');
});

test('invalid or mixed selections never become a partial cohort', () => {
  const cases = [
    ['foreign unit', game => addUnits(game, 'guardian', 1, 'enemy')],
    ['dead unit', game => { const [unit] = addUnits(game, 'guardian', 1); unit.hp = 0; return [unit]; }],
    ['embarked unit', game => { const [unit] = addUnits(game, 'guardian', 1); unit.embarkedIn = 'carrier-1'; return [unit]; }],
    ['mixed eligible types', game => [...addUnits(game, 'guardian', 1), ...addUnits(game, 'stealthTank', 1)]],
    ['other selected unit', game => [...addUnits(game, 'guardian', 1), ...addUnits(game, 'lightTank', 1)]],
    ['invalid id', game => { const [unit] = addUnits(game, 'guardian', 1); return [unit, { id: 'missing' }]; }],
  ];

  for (const [label, create] of cases) {
    const game = arena();
    const members = create(game);
    game.selection = members.map(member => member.id);
    assert.equal(getFieldAbilityCohort(game), null, label);
    const result = activateSelectedUnitAbility(game, 'brace');
    assert.equal(result.ok, false, label);
    assert.deepEqual(result.activatedIds, [], label);
  }

  const game = arena();
  const [guardian] = addUnits(game, 'guardian', 1);
  game.selection = [guardian.id];
  game.buildings.push({ id: 'building-1', owner: 'player', hp: 100, defId: 'factory' });
  game.selection.push('building-1');
  assert.equal(getFieldAbilityCohort(game), null, 'building selection rejects the whole cohort');
});

test('wrong ability and a cohort with no ready members return actionable failures', () => {
  const game = arena();
  const [guardian] = addUnits(game, 'guardian', 1);
  game.select([guardian.id]);
  assert.equal(activateSelectedUnitAbility(game, 'ghostRun').ok, false);

  guardian.abilityCooldown = 5;
  const cooling = activateSelectedUnitAbility(game, 'brace');
  assert.equal(cooling.ok, false);
  assert.match(cooling.reason, /cooling down/i);

  const specters = arena('vesper');
  const [idle] = addUnits(specters, 'stealthTank', 1);
  idle.order = { type: 'idle' };
  specters.select([idle.id]);
  const waiting = activateSelectedUnitAbility(specters, 'ghostRun');
  assert.equal(waiting.ok, false);
  assert.match(waiting.reason, /requires a move order/i);
});

test('cohort activation records only existing per-unit commands in a v77 solo replay', () => {
  const envelope = {
    mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 914,
    scenarioId: 'shard-valley', mapId: 'shard-valley', victoryMode: 'elimination',
  };
  const game = new Game({ ...envelope, replayVersion: SOLO_REPLAY_VERSION });
  const [first, second] = addUnits(game, 'guardian', 2);
  game.select([first.id, second.id]);
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);

  const result = activateSelectedUnitAbility(game, 'brace');
  assert.equal(result.ok, true);
  assert.deepEqual(recorder.commands.map(command => [command.method, command.args]), [
    ['useUnitAbility', [first.id, 'brace']],
    ['useUnitAbility', [second.id, 'brace']],
  ]);
  game.update(SOLO_STEP_SECONDS);
  clock.completedTicks++;
  recorder.dispose();

  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, SOLO_REPLAY_VERSION), true);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, SOLO_REPLAY_VERSION);
  const replayGuardians = addUnits(playback.game, 'guardian', 2);
  assert.deepEqual(replayGuardians.map(unit => unit.id), [first.id, second.id]);
  playback.step(clock.completedTicks);
  assert.ok(playback.game.getEntity(first.id).braceUntil > 0);
  assert.ok(playback.game.getEntity(second.id).braceUntil > 0);
});
