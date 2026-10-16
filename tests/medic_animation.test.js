import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Renderer3D, compactAuthoredModel } from '../src/visual/renderer3d.js';

test('Medic leg assemblies survive batching, walk independently, and settle back to their authored pose', async () => {
  const bytes = await readFile(new URL('../public/assets/models/medic.glb', import.meta.url));
  const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength), '')).scene;
  compactAuthoredModel(source, 'medic');
  const renderer = Object.create(Renderer3D.prototype);
  renderer.assetModels = new Map([['medic', source]]);
  const make = id => {
    const entity = { id, defId: 'medic', faction: 'aegis', owner: 'player', x: 0, y: 0 };
    const group = renderer._authoredModel(entity);
    return { entity, state: { group, defId: 'medic', animation: renderer._prepareAnimation(group, entity) } };
  };
  const a = make('u1'), b = make('u2');
  assert.equal(a.state.animation.medicLegs.length, 2);
  assert.equal(a.state.animation.arms.length, 4);
  const bPose = b.state.animation.medicLegs.map(leg => leg.part.quaternion.toArray());
  const motion = a.state.animation;
  motion.motion = 1; motion.travel = Math.PI / 2 - motion.phase;
  renderer._animateEntity(a.state, a.entity, { effects: [] }, 1);
  assert.ok(motion.medicLegs[0].part.rotation.x > motion.medicLegs[0].pose.x + .2);
  assert.ok(motion.medicLegs[1].part.rotation.x < motion.medicLegs[1].pose.x - .2);
  assert.deepEqual(b.state.animation.medicLegs.map(leg => leg.part.quaternion.toArray()), bPose,
    'walking one Medic must not move another instance');
  motion.motion = 0;
  renderer._animateEntity(a.state, a.entity, { effects: [] }, 2);
  for (const leg of motion.medicLegs) assert.ok(Math.abs(leg.part.rotation.x - leg.pose.x) < 1e-12);
});
