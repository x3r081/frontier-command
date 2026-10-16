import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, MEDIC_ESCORT_RULES_VERSION } from '../src/game/engine.js';

function arena(replayVersion) {
  const game = new Game({ seed: 4831, replayVersion });
  game.units = [];
  game.buildings = [];
  game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  return game;
}

function medicAndRifles(game) {
  const medic = game._createUnit('player', 'medic', 20.5, 20.5);
  const patient = game._createUnit('player', 'rifle', 21.5, 20.5);
  const other = game._createUnit('player', 'rifle', 22.5, 20.5);
  medic._healCooldown = 0;
  patient.hp = patient.maxHp - 20;
  other.hp = other.maxHp - 60;
  return { medic, patient, other };
}

test('Medic follow triage favors its injured living infantry patient and marks the heal effect', () => {
  const game = arena();
  const { medic, patient, other } = medicAndRifles(game);
  medic.order = { type: 'follow', targetId: patient.id };

  game._updateMedic(medic, 0.1);

  assert.equal(patient.hp, patient.maxHp, 'the followed patient receives up to the normal 22 HP heal');
  assert.equal(other.hp, other.maxHp - 60, 'the more injured nearby rifle waits while the followed patient is hurt');
  assert.deepEqual(medic.order, { type: 'follow', targetId: patient.id });
  assert.deepEqual(game.effects.at(-1), {
    id: game.effects.at(-1).id, type: 'heal', x: patient.x, y: patient.y,
    radius: 0.6, ttl: 0.55, maxTtl: 0.55,
    sourceId: medic.id, targetId: patient.id, owner: 'player',
  });
});

test('healthy or out-of-range followed patients fall back to ordinary nearby triage', () => {
  for (const invalid of ['healthy', 'far']) {
    const game = arena();
    const { medic, patient, other } = medicAndRifles(game);
    medic.order = { type: 'follow', targetId: patient.id };
    if (invalid === 'healthy') patient.hp = patient.maxHp;
    else patient.x = 30.5;

    game._updateMedic(medic, 0.1);

    assert.equal(other.hp, other.maxHp - 38, `${invalid} escort target should not suppress ordinary triage`);
  }
});

test('version 82 and markerless version 82 saves retain ordinary triage and old heal effects', () => {
  const old = arena(82);
  const { medic, patient, other } = medicAndRifles(old);
  medic.order = { type: 'follow', targetId: patient.id };
  old._updateMedic(medic, 0.1);
  assert.equal(other.hp, other.maxHp - 38, 'old rules still heal the most-injured nearby rifle');
  assert.equal('sourceId' in old.effects.at(-1), false, 'archived heal effect shape remains unchanged');

  const save = JSON.parse(old.serialize());
  delete save.medicEscortRulesVersion;
  const loaded = Game.deserialize(save);
  assert.equal(loaded.replayVersion, 82);
  assert.equal(loaded.medicEscortRulesVersion, MEDIC_ESCORT_RULES_VERSION);
  const restoredMedic = loaded.getEntity(medic.id);
  const restoredPatient = loaded.getEntity(patient.id);
  const restoredOther = loaded.getEntity(other.id);
  restoredMedic._healCooldown = 0;
  restoredMedic.order = { type: 'follow', targetId: restoredPatient.id };
  restoredPatient.hp = restoredPatient.maxHp - 20;
  restoredOther.hp = restoredOther.maxHp - 60;
  loaded._updateMedic(restoredMedic, 0.1);
  assert.equal(restoredOther.hp, restoredOther.maxHp - 38);
});

test('rules 83 skip dead patients, while archived version 82 retains the revive behavior', () => {
  const prepare = replayVersion => {
    const game = arena(replayVersion);
    const patient = game._createUnit('player', 'rifle', 20.5, 20.5);
    patient.hp = 0.1;
    game.terrain[20][20].type = 'crystal';
    game.terrain[20][20].walkable = true;
    const medic = game._createUnit('player', 'medic', 21.5, 20.5);
    medic._healCooldown = 0;
    return { game, patient };
  };

  const current = prepare();
  current.game.update(0.1);
  assert.equal(current.game.getEntity(current.patient.id), null,
    'a patient killed by crystal ion damage is removed instead of being revived later in the tick');

  const archived = prepare(82);
  archived.game.update(0.1);
  assert.ok(archived.game.getEntity(archived.patient.id)?.hp > 0,
    'archived rules retain the prior dead-patient selection behavior');
});
