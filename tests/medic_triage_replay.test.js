import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, BUILDING_DEFS, MEDIC_ESCORT_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloEnvelope, validateSoloReplay, SOLO_REPLAY_VERSION } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const envelope = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };
const publicSnapshot = game => structuredClone({ units: game.units, buildings: game.buildings,
  credits: game.credits, terrain: game.terrain, effects: game.effects, time: game.time, status: game.status });

function runPublicMedicFollow(replayVersion) {
  const game = new Game({ ...envelope, mapId: envelope.scenarioId, replayVersion });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const patient = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle' &&
    !unit.embarkedIn && unit.hp > 0);
  assert.ok(barracks && patient, 'ordinary seed-24 Aegis opening provides a Barracks and living Rifle');
  const advance = () => { game.update(SOLO_STEP_SECONDS); clock.completedTicks++; };
  const waitFor = (predicate, description) => {
    for (let tick = 0; tick < 70 * 30 && !predicate() && game.status === 'playing'; tick++) advance();
    assert.ok(predicate(), `${description} completes during ordinary simulation`);
  };
  const connectedSite = defId => {
    const definition = BUILDING_DEFS[defId];
    const candidates = [];
    for (let y = 1; y < game.height - definition.h - 1; y++) for (let x = 1; x < game.width - definition.w - 1; x++) {
      if (game.canPlaceBuilding(defId, x, y, 'player').ok)
        candidates.push({ x, y, distance: Math.hypot(x + definition.w / 2 - 8.5, y + definition.h / 2 - 35.5) });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    return candidates[0];
  };
  for (const defId of ['power', 'radar']) {
    assert.equal(game.startConstruction(defId).ok, true, `pay to start ${defId}`);
    waitFor(() => game.construction?.ready, `${defId} construction`);
    const site = connectedSite(defId);
    assert.ok(site, `a legal connected ${defId} placement exists`);
    assert.equal(game.issueBuild(defId, site.x, site.y).ok, true, `place ${defId}`);
  }
  assert.equal(game.queueUnit('medic', barracks.id).ok, true, 'the Medic enters its ordinary paid queue');
  waitFor(() => game.units.some(unit => unit.owner === 'player' && unit.defId === 'medic' && unit.hp > 0),
    'the Medic finishes production');
  const medic = game.units.find(unit => unit.owner === 'player' && unit.defId === 'medic' && unit.hp > 0);
  game.select(medic.id);
  assert.equal(game.issueFollow(patient.id).ok, true, 'the existing public Follow command selects its patient');
  for (let tick = 0; tick < 30; tick++) advance();
  recorder.dispose();

  validateSoloReplay(envelope, recorder.commands, clock.completedTicks, replayVersion);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, replayVersion);
  playback.step(clock.completedTicks);
  return { game, medic, patient, commands: recorder.commands, played: playback.game,
    ticks: clock.completedTicks };
}

test('paid Medic Follow command is recorded and exact in rules 83 and archived rules 82', () => {
  assert.equal(MEDIC_ESCORT_RULES_VERSION, 83);
  assert.equal(SOLO_REPLAY_VERSION, 83);
  for (const version of [82, MEDIC_ESCORT_RULES_VERSION]) {
    const result = runPublicMedicFollow(version);
    assert.deepEqual(result.commands.map(command => command.method), [
      'startConstruction', 'issueBuild', 'startConstruction', 'issueBuild', 'queueUnit', 'issueFollow',
    ]);
    assert.deepEqual(result.commands.at(-1).args, [result.patient.id],
      'Medic patient choice remains the ordinary one-argument Follow command');
    assert.deepEqual(publicSnapshot(result.played), publicSnapshot(result.game),
      `rules ${version} playback reproduces the paid Medic and its Follow patient exactly`);
    assert.equal(result.played.getEntity(result.medic.id).order.targetId, result.patient.id);
  }
});

test('the Iron Reclaimed archived version-73 minimum remains valid', () => {
  const archivedEnvelope = { mode: 'campaign', difficulty: 'normal', faction: 'aegis', seed: 24,
    scenarioId: 'iron-reclaimed' };
  assert.doesNotThrow(() => validateSoloEnvelope(archivedEnvelope, 73));
  assert.equal(validateSoloReplay(envelope, [], 1, SOLO_REPLAY_VERSION), true);
});
