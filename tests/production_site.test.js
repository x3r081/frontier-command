import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 12345,
  scenarioId: SKIRMISH_MAPS[0].id };
const makeGame = (extra = {}) => new Game({ mode: envelope.mode, difficulty: envelope.difficulty,
  faction: envelope.faction, seed: envelope.seed, mapId: envelope.scenarioId, ...extra });

test('queueUnit can choose a producer while one argument keeps shortest-queue routing', () => {
  const game = makeGame();
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const secondBarracks = game._createBuilding('player', 'barracks', 2, 2);

  assert.equal(game.queueUnit('rifle').buildingId, barracks.id,
    'one-argument routing keeps its existing tie-break when queues are equal');
  assert.equal(game.queueUnit('rifle', barracks.id).buildingId, barracks.id,
    'an explicit producer is honored even when another queue is shorter');
  assert.equal(game.queueUnit('rifle').buildingId, secondBarracks.id,
    'one-argument routing still chooses the shortest queue');
  assert.equal(barracks.queue.length, 2);
  assert.equal(secondBarracks.queue.length, 1);
});

test('invalid, foreign, mismatched, and full production sites reject without side effects', () => {
  const game = makeGame();
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const enemyBarracks = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'barracks');
  const secondBarracks = game._createBuilding('player', 'barracks', 2, 2);
  const unfinishedBarracks = game._createBuilding('player', 'barracks', 4, 2, 0);
  const destroyedBarracks = game._createBuilding('player', 'barracks', 6, 2);
  destroyedBarracks.hp = 0;
  const snapshot = () => ({ credits: game.credits.player,
    queues: game.buildings.map(building => [building.id, structuredClone(building.queue)]),
    events: game.events.length });
  const rejectWithoutMutation = (defId, producerId, reason) => {
    const before = snapshot();
    const result = game.queueUnit(defId, producerId);
    assert.equal(result.ok, false);
    assert.match(result.reason, reason);
    assert.deepEqual(snapshot(), before);
  };

  rejectWithoutMutation('rifle', 'b999999', /production building/i);
  rejectWithoutMutation('rifle', enemyBarracks.id, /production building/i);
  rejectWithoutMutation('rifle', factory.id, /production building/i);
  rejectWithoutMutation('rifle', unfinishedBarracks.id, /production building/i);
  rejectWithoutMutation('rifle', destroyedBarracks.id, /production building/i);

  barracks.queue = Array.from({ length: 5 }, () => ({ defId: 'rifle', progress: 0 }));
  rejectWithoutMutation('rifle', barracks.id, /queue is full/i);
  assert.equal(game.queueUnit('rifle').buildingId, secondBarracks.id,
    'the legacy call can still route to another available producer');
});

test('explicit production site is a version 67 replay command', () => {
  const legacyGame = makeGame({ replayVersion: 66 });
  const legacyFactory = legacyGame.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const legacyCredits = legacyGame.credits.player;
  assert.equal(legacyGame.queueUnit('apc', legacyFactory.id).ok, false,
    'the simulation rejects a site choice under old replay rules');
  assert.equal(legacyGame.credits.player, legacyCredits);
  assert.equal(legacyFactory.queue.length, 0);

  const game = makeGame();
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);

  assert.equal(game.queueUnit('apc', factory.id).ok, true);
  clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  recorder.dispose();
  assert.deepEqual(recorder.commands.map(command => [command.method, command.args]), [
    ['queueUnit', ['apc', factory.id]],
  ]);
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks, 67), true);
  assert.throws(() => validateSoloReplay(envelope, [{ ...recorder.commands[0], args: ['apc', null] }],
    clock.completedTicks, 67), /invalid solo command/i);
  assert.throws(() => createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 66),
    /production site selection requires replay version 67/i);

  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 67);
  playback.step(clock.completedTicks);
  assert.deepEqual(playback.game.buildings.find(building => building.id === factory.id).queue,
    game.buildings.find(building => building.id === factory.id).queue);
  assert.equal(playback.game.credits.player, game.credits.player);
});
