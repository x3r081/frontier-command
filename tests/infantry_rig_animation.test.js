import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFile} from 'node:fs/promises';
import {Renderer3D,compactAuthoredModel} from '../src/visual/renderer3d.js';

async function fixture(defId='rifle') {
  const bytes=await readFile(new URL(`../public/assets/models/${defId==='rifle'?'rifle':'rocket'}-infantry.glb`,import.meta.url));
  const source=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  compactAuthoredModel(source,defId);
  const renderer=Object.create(Renderer3D.prototype);
  renderer.assetModels=new Map([[defId,source]]);renderer.entityGroup=new THREE.Group();renderer.entities=new Map();
  const create=id=>{
    const entity={id,defId,faction:'aegis',x:0,y:0};
    const group=renderer._authoredModel(entity);renderer.entityGroup.add(group);
    const state={group,defId,animation:renderer._prepareAnimation(group,entity)};
    renderer.entities.set(id,state);return{entity,state};
  };
  return{renderer,source,create};
}
function skins(group){const result=[];group.traverse(part=>{if(part.isSkinnedMesh)result.push(part);});return result;}
function footBounds(state,side){
  state.group.updateMatrixWorld(true);
  const box=new THREE.Box3(),point=new THREE.Vector3();
  for(const mesh of skins(state.group)){
    mesh.skeleton.update();const joint=mesh.skeleton.bones.findIndex(bone=>bone.name===`FC_Foot_${side}`);
    const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    for(let index=0;index<indices.count;index++){
      if(![0,1,2,3].some(channel=>indices.getComponent(index,channel)===joint&&weights.getComponent(index,channel)>0))continue;
      point.fromBufferAttribute(mesh.geometry.attributes.position,index);
      mesh.applyBoneTransform(index,point).applyMatrix4(mesh.matrixWorld);box.expandByPoint(point);
    }
  }
  assert.ok(!box.isEmpty());return box;
}
const pose=state=>Object.fromEntries(Object.entries(state.animation.rigBones).map(([name,bone])=>
  [name,[...bone.position.toArray(),...bone.quaternion.toArray()]]));

test('each infantry instance shares one local skin palette and keeps bones and material changes private',async()=>{
  const {renderer,create}=await fixture();const a=create('u1'),b=create('u2');
  const first=skins(a.state.group),second=skins(b.state.group);
  assert.equal(new Set(first.map(mesh=>mesh.skeleton)).size,1);
  assert.notEqual(first[0].skeleton,second[0].skeleton);
  assert.notEqual(a.state.animation.rigBones.FC_Spine,b.state.animation.rigBones.FC_Spine);
  assert.equal(first[0].geometry,second[0].geometry);
  assert.notEqual(first[0].material,second[0].material);
  const before=pose(b.state);
  a.state.animation.digInBlend=1;renderer._animateEntity(a.state,a.entity,{effects:[]},1);
  assert.deepEqual(pose(b.state),before);
  let skinDisposals=0,geometryDisposals=0;
  first[0].skeleton.computeBoneTexture();
  first[0].skeleton.boneTexture.addEventListener('dispose',()=>skinDisposals++);
  first[0].geometry.addEventListener('dispose',()=>geometryDisposals++);
  renderer._removeEntity(a.entity.id,a.state);
  assert.equal(skinDisposals,1,'removal releases the per-instance skin palette exactly once');
  assert.equal(geometryDisposals,0,'other soldiers still use the immutable geometry');
});

test('rifle and rocket crouches keep their articulated boot soles on the ground',async()=>{
  for(const defId of ['rifle','rocket']){
    const {renderer,create}=await fixture(defId);const {entity,state}=create('u1');
    const standingHeight=state.animation.rigBones.FC_Spine.getWorldPosition(new THREE.Vector3()).y;
    const standingMuzzle=renderer._weaponMuzzlePosition(entity.id,{units:[entity]},0,-4);
    assert.equal(state.animation.muzzleSocket.parent,state.animation.rigBones.FC_Weapon);
    state.animation.digInBlend=1;renderer._animateEntity(state,entity,{effects:[]},1);
    for(const side of ['L','R']){
      const box=footBounds(state,side);
      assert.ok(box.min.y>=-.012,`${defId} ${side} boot should not sink: ${box.min.y}`);
      assert.ok(box.min.y<=.025,`${defId} ${side} boot should remain planted: ${box.min.y}`);
    }
    const crouchedHeight=state.animation.rigBones.FC_Spine.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(crouchedHeight<standingHeight-.07,'the body lowers visibly');
    const crouchedMuzzle=renderer._weaponMuzzlePosition(entity.id,{units:[entity]},0,-4);
    assert.ok(crouchedMuzzle.y<standingMuzzle.y-.04,'shot origin follows the crouched weapon');
    assert.equal(renderer._weaponMuzzlePosition(entity.id,{units:[{...entity,owner:'enemy'}],isVisible:()=>false},0,-4),null,
      'the animated socket cannot reveal a hidden enemy source');
  }
});

test('30 Hz infantry movement stays consistent at 30, 60 and 120 rendered fps and freezes when paused',async()=>{
  const {renderer,create}=await fixture();
  const sample=fps=>{
    const {entity,state}=create('u1');renderer._animateMotion(state,0,0,0,0);
    let previousTick=0;
    for(let frame=1;frame<=fps*2;frame++){
      const tick=Math.floor(frame*30/fps+1e-9),distance=(tick-previousTick)*1.8/30;previousTick=tick;
      renderer._animateMotion(state,distance,distance,0,frame/fps);
      renderer._animateEntity(state,entity,{effects:[]},frame/fps);
    }
    return{entity,state};
  };
  const a=sample(30);
  for(const fps of [60,120]){
    const b=sample(fps);
    for(const name of ['FC_Thigh_L','FC_Shin_L','FC_Foot_L','FC_Weapon'])
      assert.ok(a.state.animation.rigBones[name].quaternion.clone().normalize().angleTo(b.state.animation.rigBones[name].quaternion.clone().normalize())<1e-6,`${name} at ${fps}fps`);
  }
  const frozen=pose(a.state);
  for(let repeat=0;repeat<5;repeat++){
    renderer._animateMotion(a.state,0,0,0,2);renderer._animateEntity(a.state,a.entity,{effects:[]},2);
  }
  assert.deepEqual(pose(a.state),frozen);
});

test('infantry recoil follows its own projectile and clears after a time discontinuity',async()=>{
  const {renderer,create}=await fixture();const {entity,state}=create('u1');
  renderer._animateEntity(state,entity,{effects:[]},1);
  const weapon=state.animation.rigBones.FC_Weapon,rest=weapon.quaternion.clone();
  renderer._animateEntity(state,entity,{effects:[{type:'projectile',id:'other',sourceId:'u2',ttl:1,maxTtl:1}]},1.1);
  assert.deepEqual(weapon.quaternion.toArray(),rest.toArray(),'another squad firing cannot kick this weapon');
  renderer._animateEntity(state,entity,{effects:[{type:'projectile',id:'own',sourceId:'u1',ttl:1,maxTtl:1}]},1.2);
  assert.ok(weapon.quaternion.clone().normalize().angleTo(rest.clone().normalize())>.02);
  renderer._animateEntity(state,entity,{effects:[]},4);
  assert.deepEqual(weapon.quaternion.toArray(),rest.toArray(),'a seek or long gap cannot leave the weapon in recoil');
});
