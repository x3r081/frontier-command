import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectionRoster } from '../src/game/selectionRoster.js';
import { Game } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, SOLO_REPLAY_VERSION } from '../src/game/replay.js';

const defs = { rifle: { name: 'Rifle Squad' }, rocket: { name: 'Rocket Trooper' }, engineer: { name: 'Engineer' } };
const unit = (id, defId, extra = {}) => ({ id, defId, owner: 'player', faction: 'aegis', hp: 100, maxHp: 100, ...extra });
const arena = () => ({ unitDefs: defs, buildings: [], selection: ['u1', 'u2', 'u3', 'u4'], units: [
  unit('u1', 'rifle'), unit('u2', 'rifle', { hp: 50 }), unit('u3', 'rocket'), unit('u4', 'engineer'),
] });

test('unit types can receive separate orders and ALL restores the original force', () => {
  const roster = new SelectionRoster(), state = arena();
  let view = roster.sync(state);
  assert.equal(view.visible, true);
  assert.deepEqual(view.groups.map(group => [group.name, group.count, group.healthPct]), [
    ['Rifle Squad', 2, 75], ['Rocket Trooper', 1, 100], ['Engineer', 1, 100],
  ]);
  state.selection = roster.choose(view.groups[1].key);
  view = roster.sync(state);
  assert.deepEqual(view.selectedIds, ['u3']);
  assert.equal(view.isAll, false);
  assert.equal(view.groups[1].selectedCount, 1);
  state.units[2].order = { type: 'move', x: 20, y: 20 };
  assert.equal(roster.sync(state).groups.length, 3, 'issuing an order keeps the parent available');
  state.selection = roster.choose('all');
  assert.deepEqual(roster.sync(state).selectedIds, ['u1', 'u2', 'u3', 'u4']);
});

test('replaced network snapshots preserve cohorts while an external selection replaces the parent', () => {
  const roster = new SelectionRoster(), state = arena();
  const rifle = roster.sync(state).groups[0];
  state.selection = roster.choose(rifle.key);
  roster.sync(state);
  const next = structuredClone(state);
  next.units[0].hp = 25;
  assert.deepEqual(roster.sync(next).allIds, ['u1', 'u2', 'u3', 'u4']);
  next.selection = ['u4'];
  const view = roster.sync(next);
  assert.equal(view.visible, false);
  assert.deepEqual(view.allIds, ['u4']);
  assert.deepEqual(roster.choose('all'), ['u4']);
  roster.reset();
  assert.equal(roster.sync({ ...state, selection: [] }).visible, false);
});

test('death and boarding prune restore IDs without losing surviving units outside the filtered cohort', () => {
  const roster = new SelectionRoster(), state = arena();
  state.selection = roster.choose(roster.sync(state).groups[1].key);
  roster.sync(state);
  state.units[2].hp = 0;
  state.units[1].embarkedIn = 'u9';
  state.selection = [];
  const view = roster.sync(state);
  assert.equal(view.visible, true);
  assert.deepEqual(view.allIds, ['u1', 'u4']);
  assert.deepEqual(roster.choose('all'), ['u1', 'u4']);
});

test('roster never includes hostile, dead, embarked, or structure selections', () => {
  const roster = new SelectionRoster(), state = arena();
  state.units.push(unit('u5', 'rocket', { owner: 'enemy' }), unit('u6', 'rocket', { hp: 0 }),
    unit('u7', 'rocket', { embarkedIn: 'u8' }));
  state.selection.push('u5', 'u6', 'u7', 'u1');
  assert.deepEqual(roster.sync(state).allIds, ['u1', 'u2', 'u3', 'u4']);
  state.buildings.push({ id: 'b1', owner: 'player', hp: 100 });
  state.selection.push('b1');
  assert.equal(roster.sync(state).visible, false);
  assert.equal(roster.choose('all'), null);
});

test('same unit kind with different faction equipment remains distinct', () => {
  const roster = new SelectionRoster(), state = arena();
  state.units[1].faction = 'vesper';
  const groups = roster.sync(state).groups;
  assert.deepEqual(groups.slice(0, 2).map(group => group.name), ['Rifle Squad · Aegis', 'Rifle Squad · Vesper']);
  assert.deepEqual(roster.choose(groups[1].key), ['u2']);
});

test('filtered public orders record only the chosen unit type and replay exactly', () => {
  const game = new Game({ seed: 24, difficulty: 'easy', faction: 'aegis', mode: 'skirmish',
    mapId: 'shard-valley', replayVersion: SOLO_REPLAY_VERSION });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const roster = new SelectionRoster();
  game.select(game.units.filter(u => u.owner === 'player' && ['rifle', 'tank', 'scout'].includes(u.defId)).map(u => u.id));
  const view = roster.sync(game);
  const rifles = view.groups.find(group => group.defId === 'rifle');
  assert.ok(rifles);
  game.select(roster.choose(rifles.key));
  assert.equal(game.issueSetStance('defensive').ok, true);
  game.select(roster.choose('all'));
  assert.equal(game.issueGuard().ok, true);
  recorder.dispose();
  assert.deepEqual(recorder.commands[0].selectedIds, rifles.ids);
  const envelope = { mode: 'skirmish', seed: 24, difficulty: 'easy', faction: 'aegis',
    scenarioId: 'shard-valley', victoryMode: 'elimination' };
  game.update(SOLO_STEP_SECONDS);
  const playback = createSoloPlayback(envelope, recorder.commands, 1, SOLO_REPLAY_VERSION);
  playback.step(1);
  assert.deepEqual(playback.game.units.map(u => [u.id, u.order, u.stance]),
    game.units.map(u => [u.id, u.order, u.stance]));
});
