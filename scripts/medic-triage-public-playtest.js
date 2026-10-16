// Bounded rules-83 Medic-follow route from an untouched ordinary seed-24
// skirmish. Only public player commands and fixed-step simulation updates run.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Game, MEDIC_ESCORT_RULES_VERSION } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const ENVELOPE = { mode: 'skirmish', difficulty: 'normal', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };
const MAX_SECONDS = 150;
const APPROACH = { x: 42.5, y: 16.5 };

function publicSnapshot(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, credits: game.credits,
    terrain: game.terrain, effects: game.effects, time: game.time, status: game.status });
}

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function connectedSite(game, defId) {
  const definition = game.buildingDefs[defId];
  const candidates = [];
  for (let y = 1; y < game.height - definition.h - 1; y++) {
    for (let x = 1; x < game.width - definition.w - 1; x++) {
      if (!game.canPlaceBuilding(defId, x, y, 'player').ok) continue;
      const centerX = x + definition.w / 2, centerY = y + definition.h / 2;
      const distance = Math.hypot(centerX - 8.5, centerY - 35.5);
      candidates.push({ x, y, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  assert.ok(candidates.length, `seed-24 home should have a legal connected ${defId} site`);
  return candidates[0];
}

export function runMedicTriagePublicPlaytest() {
  const game = new Game({ ...ENVELOPE, mapId: ENVELOPE.scenarioId,
    replayVersion: MEDIC_ESCORT_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const startingCredits = game.credits.player;
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const patient = game.units.find(unit => unit.owner === 'player' && unit.defId === 'rifle' && unit.hp > 0);
  const escortForce = ['rifle', 'scout', 'lightTank'].map(defId => game.units.find(unit =>
    unit.owner === 'player' && unit.defId === defId && unit.hp > 0 && !unit.embarkedIn));
  assert.ok(barracks && patient && escortForce.every(Boolean), 'seed 24 should retain its opening Barracks and escort force');

  // The Field Medic requires Radar. Add the ordinary power/radar prerequisites
  // by the normal paid construction and placement flow.
  const stepsPerSecond = Math.round(1 / SOLO_STEP_SECONDS);
  const advance = seconds => {
    const ticks = Math.round(seconds * stepsPerSecond);
    for (let tick = 0; tick < ticks && game.status === 'playing'; tick++) {
      game.update(SOLO_STEP_SECONDS);
      clock.completedTicks++;
    }
  };
  const construct = (defId, waitSeconds) => {
    requireOk(game.startConstruction(defId), `pay to start ${defId}`);
    let ticks = 0;
    const limit = Math.ceil(waitSeconds * stepsPerSecond);
    while (!game.construction?.ready && ticks++ < limit && game.status === 'playing') {
      game.update(SOLO_STEP_SECONDS);
      clock.completedTicks++;
    }
    assert.ok(game.construction?.ready, `${defId} construction should complete within ${waitSeconds}s`);
    const site = connectedSite(game, defId);
    requireOk(game.issueBuild(defId, site.x, site.y), `place the paid ${defId}`);
  };

  construct('power', 35);
  construct('radar', 55);
  const creditsBeforeMedic = game.credits.player;
  requireOk(game.queueUnit('medic', barracks.id), 'pay the normal price for the Field Medic');
  const creditsAfterMedic = game.credits.player;
  const initialUnitIds = new Set(game.units.map(unit => unit.id));
  let medic = null;
  let followOrderTime = null;
  let healObservation = null;
  const deadline = Math.round(MAX_SECONDS / SOLO_STEP_SECONDS);

  for (let tick = clock.completedTicks; tick < deadline && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;
    if (!medic) {
      medic = game.units.find(unit => unit.owner === 'player' && unit.defId === 'medic' &&
        !initialUnitIds.has(unit.id) && unit.hp > 0) || null;
      if (medic) {
        game.select(medic.id);
        requireOk(game.issueFollow(patient.id), 'order the paid Medic to follow the opening Rifle');
        followOrderTime = +game.time.toFixed(2);
        const livingForce = escortForce.filter(unit => unit.hp > 0 && !unit.embarkedIn);
        assert.ok(livingForce.includes(patient), 'the opening Rifle should survive until the Medic joins');
        game.select(livingForce.map(unit => unit.id));
        requireOk(game.issueMove(APPROACH.x, APPROACH.y, true), 'send the escorted opening force into enemy contact');
      }
    }
    if (!medic || medic.order?.type !== 'follow' || medic.order.targetId !== patient.id || patient.hp <= 0) continue;
    const effect = game.effects.find(candidate => candidate.type === 'heal' &&
      candidate.sourceId === medic.id && candidate.targetId === patient.id && candidate.owner === 'player');
    if (effect) {
      healObservation = { time: +game.time.toFixed(2), medicId: medic.id, patientId: patient.id,
        patientHp: +patient.hp.toFixed(2), medicOrder: { ...medic.order }, effect: { ...effect } };
      break;
    }
  }
  recorder.dispose();

  assert.ok(medic, 'the paid Medic should complete production');
  assert.ok(healObservation, 'the followed living Rifle should receive an observed Medic heal');
  assert.ok(healObservation.patientHp > 0 && healObservation.medicOrder.type === 'follow' &&
    healObservation.medicOrder.targetId === patient.id, 'heal should occur while following the living patient');
  assert.equal(startingCredits - creditsBeforeMedic, 300 + 800,
    'the two prerequisite structures should use their ordinary costs');
  assert.equal(creditsBeforeMedic - creditsAfterMedic, game.unitDefs.medic.cost,
    'Medic training should deduct its normal cost at queue insertion');
  validateSoloReplay(ENVELOPE, recorder.commands, clock.completedTicks, MEDIC_ESCORT_RULES_VERSION);
  const playback = createSoloPlayback(ENVELOPE, recorder.commands, clock.completedTicks, MEDIC_ESCORT_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(publicSnapshot(playback.game), publicSnapshot(game),
    'prerequisite construction, paid Medic production, following, combat and healing should replay exactly');

  return { envelope: ENVELOPE, seconds: +game.time.toFixed(2), startingCredits,
    creditsBeforeMedic, creditsAfterMedic, finalCredits: game.credits.player,
    powerBuildings: game.buildings.filter(building => building.owner === 'player' && building.defId === 'power')
      .map(({ id, x, y, progress }) => ({ id, x, y, progress })),
    radarId: game.buildings.find(building => building.owner === 'player' && building.defId === 'radar')?.id,
    barracksId: barracks.id, medicId: medic.id, patientId: patient.id, followOrderTime,
    firstHeal: healObservation, commands: recorder.commands, replayMatches: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runMedicTriagePublicPlaytest(), null, 2));
}
