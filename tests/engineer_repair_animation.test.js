import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Renderer3D, compactAuthoredModel } from '../src/visual/renderer3d.js';

async function engineerFixture({ reducedMotion = false } = {}) {
  const bytes = await readFile(new URL('../public/assets/models/engineer.glb', import.meta.url));
  const source = (await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  compactAuthoredModel(source, 'engineer');
  const renderer = Object.create(Renderer3D.prototype);
  renderer.assetModels = new Map([['engineer', source]]);
  renderer.entityGroup = new THREE.Group();
  renderer.reducedMotionQuery = { matches: reducedMotion };
  renderer.visualHeightAt = () => 0;
  const engineer = { id: 'u1', defId: 'engineer', faction: 'aegis', owner: 'player', x: 0, y: 0 };
  const group = renderer._authoredModel(engineer);
  renderer.entityGroup.add(group);
  const state = { group, defId: 'engineer', animation: renderer._prepareAnimation(group, engineer) };
  return { renderer, engineer, state };
}

function repairGame(engineer, { progress = 0.2, targetVisible = true, time = 1,
  targetDefId = 'lightTank', targetX = 0.8, replayVersion = null } = {}) {
  const patient = { id: 'u2', defId: targetDefId, owner: engineer.owner, hp: 60, maxHp: 100,
    x: targetX, y: 0.15 };
  return {
    time,
    replayVersion,
    units: [engineer, patient],
    unitDefs: { engineer: { armor: 'infantry' }, lightTank: { armor: 'light' },
      guardian: { armor: 'heavy' }, artillery: { armor: 'heavy' },
      orca: { armor: 'light', flying: true } },
    effects: [],
    isVisible: unit => targetVisible || unit.id !== patient.id,
  };
}

test('authored spanner forearm works only during a valid, observable repair channel', async () => {
  const { renderer, engineer, state } = await engineerFixture();
  const toolArm = state.animation.engineerToolArm;
  assert.ok(toolArm, 'the Engineer GLB keeps its right forearm/spanner pivot');
  assert.ok(toolArm.part.children.some(child => child.isMesh), 'the tool geometry remains on the authored pivot');
  assert.equal(state.animation.engineerRepairCue.parent, state.group,
    'the contact cue stays outside the physical model for death handling');

  engineer.order = { type: 'fieldRepair', targetId: 'u2' };
  engineer.facing = 0;
  engineer._fieldRepairProgress = 0.2;
  renderer._animateEntity(state, engineer, repairGame(engineer), 1);
  assert.equal(state.animation.engineerRepairCue.visible, true);
  assert.ok(Math.abs(state.group.rotation.y -
    (-Math.atan2(0.15, 0.8) - Math.PI / 2)) < 1e-12,
  'the rendered Engineer turns its tool toward the patient while repairing');
  const workingPose = toolArm.part.quaternion.clone();
  const sparkPositions = state.animation.engineerRepairSparks.map(spark => spark.position.toArray());
  renderer._animateEntity(state, engineer, repairGame(engineer, { time: 1.4 }), 1.4);
  assert.ok(toolArm.part.quaternion.angleTo(workingPose) > 0.01, 'the tool makes a small time-based work stroke');
  assert.notDeepEqual(state.animation.engineerRepairSparks.map(spark => spark.position.toArray()), sparkPositions,
    'the contact sparks pulse while game time advances');

  engineer._fieldRepairProgress = 0;
  state.group.rotation.y = -Math.PI / 2;
  renderer._animateEntity(state, engineer, repairGame(engineer, { progress: 0 }), 1.5);
  assert.equal(state.animation.engineerRepairCue.visible, false, 'the contact cue clears when the channel stops');
  assert.equal(state.group.rotation.y, -Math.PI / 2, 'normal simulation facing is preserved after repair ends');

  engineer.owner = 'enemy';
  engineer.order = { type: 'follow', targetId: 'u2' };
  engineer._fieldRepairProgress = 0.2;
  renderer._animateEntity(state, engineer, repairGame(engineer, { targetVisible: false }), 1.6);
  assert.equal(state.animation.engineerRepairCue.visible, false, 'hidden opponent patients cannot produce a repair cue');

  engineer.owner = 'player';
  renderer._animateEntity(state, engineer, repairGame(engineer, { replayVersion: 86 }), 1.7);
  assert.equal(state.animation.engineerRepairCue.visible, false, 'archived rules 86 do not animate Follow repair');
  renderer._animateEntity(state, engineer, repairGame(engineer, { replayVersion: 87, targetDefId: 'orca' }), 1.8);
  assert.equal(state.animation.engineerRepairCue.visible, false, 'aircraft cannot be field repair patients');
  renderer._animateEntity(state, engineer, repairGame(engineer, { replayVersion: 87, targetX: 1.4 }), 1.9);
  assert.equal(state.animation.engineerRepairCue.visible, false, 'a stale out-of-range channel is not drawn');

  renderer.quality = 'eco';
  renderer._animateEntity(state, engineer, repairGame(engineer), 2);
  const visibleCueMeshes = [];
  state.animation.engineerRepairCue.traverse(object => {
    if (object.isMesh && object.visible) visibleCueMeshes.push(object);
  });
  assert.equal(visibleCueMeshes.length, 2, 'Eco keeps only the compact contact ring and core');
  assert.ok(state.animation.engineerRepairSparks.every(spark => !spark.visible),
    'Eco omits the three animated spark meshes');

  renderer.zoom = 1;
  renderer._animateEntity(state, engineer, repairGame(engineer, { targetDefId: 'guardian', replayVersion: 87 }), 2.1);
  state.group.updateWorldMatrix(true, true);
  const heavyContact = state.animation.engineerRepairCue.getWorldPosition(new THREE.Vector3());
  const displayedGuardianScale = 1.48 * 1.12;
  const expectedNearHullDistance = Math.hypot(
    Math.min(0.57 * displayedGuardianScale + 0.075, Math.hypot(0.8, 0.15) - 0.40), 0.16);
  assert.ok(Math.abs(Math.hypot(heavyContact.x - 0.8, heavyContact.z - 0.15) -
    expectedNearHullDistance) < 1e-6,
  'heavy-vehicle contact stays beside the hull with the tool-side offset');
  assert.ok(Math.hypot(heavyContact.x - engineer.x, heavyContact.z - engineer.y) >= 0.39,
    'heavy-vehicle contact clears the Engineer body center');
  assert.ok(Math.abs(heavyContact.y - (0.628 * displayedGuardianScale + 0.155)) < 1e-6,
    'heavy-vehicle contact clears the displayed Guardian roofline');

  renderer._animateEntity(state, engineer, repairGame(engineer, { targetDefId: 'artillery', replayVersion: 87 }), 2.2);
  state.group.updateWorldMatrix(true, true);
  const artilleryContact = state.animation.engineerRepairCue.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.hypot(artilleryContact.x - 0.8, artilleryContact.z - 0.15) <=
    Math.hypot(engineer.x - 0.8, engineer.y - 0.15) - 0.20 + 1e-6,
  'artillery contact stays within the close repair channel rather than beyond the Engineer');
  assert.ok(Math.hypot(artilleryContact.x - engineer.x, artilleryContact.z - engineer.y) >= 0.39,
    'artillery contact clears the Engineer body center');
  assert.ok(artilleryContact.y < 1.1, 'artillery contact uses chassis height rather than full barrel height');
});

test('repair pose and contact cue honor reduced motion and pause with game time', async () => {
  const { renderer, engineer, state } = await engineerFixture({ reducedMotion: true });
  engineer.order = { type: 'follow', targetId: 'u2' };
  engineer._fieldRepairProgress = 0.2;
  renderer._animateEntity(state, engineer, repairGame(engineer, { time: 2 }), 2);
  const armPose = state.animation.engineerToolArm.part.quaternion.toArray();
  const sparkPositions = state.animation.engineerRepairSparks.map(spark => spark.position.toArray());
  renderer._animateEntity(state, engineer, repairGame(engineer, { time: 2 }), 9);
  assert.deepEqual(state.animation.engineerToolArm.part.quaternion.toArray(), armPose,
    'render-frame time does not animate a paused repair channel');
  renderer._animateEntity(state, engineer, repairGame(engineer, { time: 8 }), 9);
  assert.deepEqual(state.animation.engineerToolArm.part.quaternion.toArray(), armPose,
    'reduced motion holds the same work pose as game time advances');
  assert.deepEqual(state.animation.engineerRepairSparks.map(spark => spark.position.toArray()), sparkPositions,
    'reduced motion keeps sparks static');
});
