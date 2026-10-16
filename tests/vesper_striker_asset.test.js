import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Renderer3D} from '../src/visual/renderer3d.js';

async function loadModel(file) {
  const bytes=await readFile(new URL(`../public/assets/models/${file}`,import.meta.url));
  const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  return new Promise((resolve,reject)=>new GLTFLoader().parse(payload,'',resolve,reject));
}

test('Vesper Striker routes to its authored GLB and aims/recoils around the exported turret pivot',async()=>{
  const [aegis,vesper]=await Promise.all([
    loadModel('striker-tank.glb'),loadModel('vesper-striker-tank.glb'),
  ]);
  const renderer=Object.create(Renderer3D.prototype);
  renderer.assetModels=new Map([
    ['lightTank',aegis.scene],['vesperLightTank',vesper.scene],
  ]);
  renderer.assetVersions=new Map();

  const entity={id:'vesper-striker-1',defId:'lightTank',faction:'vesper',x:0,y:0};
  const group=renderer._authoredModel(entity);
  assert.ok(group,'the Vesper faction route should produce an authored model');
  const visual=group.userData.authoredVisual;
  assert.ok(visual.getObjectByName('Vesper_track_belt'),
    'the routed visual should come from the Vesper Striker GLB');
  assert.equal(visual.getObjectByName('Continuous_tank_tread'),undefined,
    'the Vesper route should not silently select the Aegis Striker GLB');

  const animation=renderer._prepareAnimation(group,entity);
  assert.ok(animation.pivot?.getObjectByName('Rotating_turret_assembly'),
    'the exact exported turret assembly should be attached under the animation pivot');
  assert.equal(animation.muzzleSocket?.parent,animation.pivot,
    'the muzzle socket must follow the moving turret assembly');
  group.updateMatrixWorld(true);
  const muzzleBefore=animation.muzzleSocket.getWorldPosition(new THREE.Vector3());
  assert.ok(muzzleBefore.distanceTo(new THREE.Vector3(0,0.655,-0.789))<1e-5,
    `neutral muzzle should match the authored barrel face before display scaling; got ${muzzleBefore.toArray()}`);

  const staticTrack=visual.getObjectByName('Vesper_track_belt');
  assert.ok(staticTrack?.isMesh,'the GLB should retain a static track anchor outside the turret');
  const trackBefore=staticTrack.getWorldPosition(new THREE.Vector3());
  const state={group,animation,building:false};
  const game={effects:[{type:'projectile',sourceId:entity.id,tx:4,ty:0}]};
  renderer._animateEntity(state,entity,game,1);
  group.updateMatrixWorld(true);
  const muzzleAfter=animation.muzzleSocket.getWorldPosition(new THREE.Vector3());
  const trackAfter=staticTrack.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(animation.pivot.rotation.y)>0.1,'the turret should aim toward its rendered shot');
  assert.ok(animation.pivot.position.z>animation.turretBaseZ,'the turret assembly should recoil');
  assert.ok(muzzleAfter.distanceTo(muzzleBefore)>0.1,'aim and recoil should move the muzzle');
  assert.ok(trackAfter.distanceTo(trackBefore)<1e-8,'aim and recoil must leave the hull/track stationary');
});
