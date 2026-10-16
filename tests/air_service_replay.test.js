import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKIRMISH_MAPS, BUILDING_DEFS, UNIT_DEFS } from '../src/game/engine.js';
import { SoloClock, SOLO_STEP_SECONDS } from '../src/game/soloClock.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';

const envelope = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 12345,
  scenarioId: SKIRMISH_MAPS[0].id };

test('public aircraft rearm records and replays as a version 66 no-argument command', () => {
  const game = new Game({ mode: envelope.mode, difficulty: envelope.difficulty,
    faction: envelope.faction, seed: envelope.seed, mapId: envelope.scenarioId });
  const clock = new SoloClock();
  const recorder = createSoloRecorder(game, clock);
  const step = () => clock.advance(SOLO_STEP_SECONDS, dt => game.update(dt));
  const waitFor = (predicate, description) => {
    while (!predicate() && game.status === 'playing' && clock.completedTicks < 120 * 30) step();
    assert.equal(predicate(), true, `${description} before the 120 second fixture limit`);
  };
  const findPlacement = defId => {
    const def = BUILDING_DEFS[defId];
    const yard = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
    const candidates = [];
    for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++)
      candidates.push({ x, y, distance: Math.hypot(x + def.w / 2 - (yard.x + yard.w / 2),
        y + def.h / 2 - (yard.y + yard.h / 2)) });
    candidates.sort((left, right) => left.distance - right.distance);
    return candidates.find(({ x, y }) => game.canPlaceBuilding(defId, x, y).ok);
  };

  for (const defId of ['power', 'radar', 'helipad']) {
    assert.equal(game.startConstruction(defId).ok, true, `start ${defId}`);
    waitFor(() => game.construction?.ready, `${defId} construction to become ready`);
    const placement = findPlacement(defId);
    assert.ok(placement, `a legal ${defId} site exists inside the player base perimeter`);
    assert.equal(game.issueBuild(defId, placement.x, placement.y).ok, true, `place ${defId}`);
    waitFor(() => game.buildings.some(building => building.owner === 'player' &&
      building.defId === defId && building.progress >= 1), `${defId} to finish construction`);
  }

  assert.equal(game.queueUnit('orca').ok, true, 'train the gunship through the public production command');
  waitFor(() => game.units.some(unit => unit.owner === 'player' && unit.defId === 'orca'), 'Orca production');
  const orca = game.units.find(unit => unit.owner === 'player' && unit.defId === 'orca');
  game.select(orca.id);
  assert.equal(game.issueForceFire(orca.x + 4, orca.y).ok, true, 'issue a legal ground force fire order');
  waitFor(() => orca.ammo < UNIT_DEFS.orca.ammoMax, 'the Orca to spend ammunition');
  assert.equal(orca.ammo, UNIT_DEFS.orca.ammoMax - 1, 'the fixture fires exactly one shot');
  game.select(orca.id);
  assert.equal(game.issueRearm().ok, true, 'a partially loaded gunship can be ordered to rearm');
  waitFor(() => orca.ammo === UNIT_DEFS.orca.ammoMax && orca.order?.type === 'idle',
    'the gunship to finish rearming');
  recorder.dispose();

  assert.ok(clock.completedTicks <= 120 * 30, 'the public setup and reload stay within 120 simulation seconds');
  const rearm = recorder.commands.find(command => command.method === 'issueRearm');
  assert.ok(rearm, 'the recorder captures the player rearm command');
  assert.deepEqual(rearm.args, [], 'rearm is represented as a no-argument command');
  assert.equal(validateSoloReplay(envelope, recorder.commands, clock.completedTicks), true);
  const malformed = structuredClone(recorder.commands);
  malformed.find(command => command.method === 'issueRearm').args = [orca.id];
  assert.throws(() => validateSoloReplay(envelope, malformed, clock.completedTicks), /invalid solo command/i);
  assert.throws(() => createSoloPlayback(envelope, recorder.commands, clock.completedTicks, 65),
    /aircraft rearm requires replay version 66/i);

  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks);
  playback.step(clock.completedTicks);
  const replayedOrca = playback.game.getEntity(orca.id);
  assert.deepEqual({ ammo: replayedOrca.ammo, order: replayedOrca.order, resumeOrder: replayedOrca._resumeOrder },
    { ammo: orca.ammo, order: orca.order, resumeOrder: orca._resumeOrder });
  assert.equal(playback.game.time, game.time);
  assert.equal(playback.game.status, game.status);
});

