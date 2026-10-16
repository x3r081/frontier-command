import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Renderer3D,compactAuthoredModel} from '../src/visual/renderer3d.js';

async function loadModel(file) {
  const bytes=await readFile(new URL(`../public/assets/models/${file}`,import.meta.url));
  const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  return new Promise((resolve,reject)=>new GLTFLoader().parse(payload,'',resolve,reject));
}

function closestWeightedVertex(root,target,boneName) {
  let result=null;
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const boneIndex=mesh.skeleton.bones.findIndex(bone=>bone.name===boneName);
    if(boneIndex<0)return;
    const position=mesh.geometry.attributes.position;
    const skinIndex=mesh.geometry.attributes.skinIndex;
    const skinWeight=mesh.geometry.attributes.skinWeight;
    for(let i=0;i<position.count;i++) {
      let weight=0;
      for(let j=0;j<4;j++)if(skinIndex.getComponent(i,j)===boneIndex)weight+=skinWeight.getComponent(i,j);
      if(weight<0.99)continue;
      const distance=Math.hypot(position.getX(i)-target[0],position.getY(i)-target[1],position.getZ(i)-target[2]);
      if(!result||distance<result.distance)result={mesh,index:i,distance};
    }
  });
  return result;
}

test('Vesper Rifle routes to its authored GLB and preserves the shared rifle rig and muzzle',async()=>{
  const [aegis,vesper]=await Promise.all([
    loadModel('rifle-infantry.glb'),loadModel('vesper-rifle-infantry.glb'),
  ]);
  assert.equal(compactAuthoredModel(vesper.scene,'rifleVesper'),true);
  const renderer=Object.create(Renderer3D.prototype);
  renderer.assetModels=new Map([['rifle',aegis.scene],['rifleVesper',vesper.scene]]);
  renderer.assetVersions=new Map([['rifle',76],['rifleVesper',99]]);

  // Ownership may change after capture, but the unit's authored faction stays
  // Vesper and continues selecting its original silhouette.
  const entity={id:'captured-vesper-rifle',defId:'rifle',faction:'vesper',owner:'player',x:0,y:0,facing:0};
  const group=renderer._authoredModel(entity);
  assert.ok(group,'the Vesper faction route should yield an authored model');
  const visual=group.userData.authoredVisual;
  let skinnedMeshes=0,hasVesperMaterial=false;
  visual.traverse(object=>{
    if(object.isSkinnedMesh)skinnedMeshes++;
    for(const material of (Array.isArray(object.material)?object.material:[object.material]))
      if(material?.name?.startsWith('Vesper '))hasVesperMaterial=true;
  });
  assert.ok(hasVesperMaterial,'captured ownership must not replace the original Vesper materials');
  assert.ok(skinnedMeshes>0,'the exported soldier should remain attached to its rig');
  const aegisGroup=renderer._authoredModel({...entity,faction:'aegis'});
  let aegisHasVesperMaterial=false;
  aegisGroup.userData.authoredVisual.traverse(object=>{
    for(const material of (Array.isArray(object.material)?object.material:[object.material]))
      if(material?.name?.startsWith('Vesper '))aegisHasVesperMaterial=true;
  });
  assert.equal(aegisHasVesperMaterial,false,'the existing Aegis Rifle route should remain unchanged');

  const animation=renderer._prepareAnimation(group,entity);
  assert.equal(animation.rigged,true);
  assert.deepEqual(Object.keys(animation.rigBones).sort(),[
    'FC_Root','FC_Pelvis','FC_Spine','FC_UpperArm_L','FC_Forearm_L','FC_UpperArm_R','FC_Forearm_R',
    'FC_Weapon','FC_Thigh_L','FC_Shin_L','FC_Foot_L','FC_Thigh_R','FC_Shin_R','FC_Foot_R',
  ].sort(),'the Vesper model should keep all 14 shared infantry animation bones');
  assert.equal(animation.muzzleSocket?.parent,animation.rigBones.FC_Weapon);
  assert.equal(animation.muzzleSocket.position.y,0.775,
    'the muzzle stays at the shared rifle weapon socket');

  for(const [part,target,bone,tolerance] of [
    ['rifle receiver',[.19375,.55625,-.18125],'FC_Weapon',0.08],
    ['rifle optic',[.19375,.66875,-.23375],'FC_Weapon',0.08],
    ['slung field strap',[-.03125,.44375,-.17375],'FC_Spine',0.08],
    ['team shoulder tab',[-.18125,.50625,-.02],'FC_UpperArm_L',0.08],
    ['hip field cassette',[-.2125,.35,.015],'FC_Spine',0.13],
  ]) {
    const vertex=closestWeightedVertex(visual,target,bone);
    assert.ok(vertex&&vertex.distance<tolerance,`${part} should follow ${bone}`);
  }
  assert.ok(visual.children.every(child=>!child.isMesh||child.isSkinnedMesh),
    'weapon and field gear must stay skinned with the body instead of detaching');

  const receiver=closestWeightedVertex(visual,[.19375,.55625,-.18125],'FC_Weapon');
  const receiverBefore=receiver.mesh.getVertexPosition(receiver.index,new THREE.Vector3());
  animation.motion=1;
  animation.travel=Math.PI/2-animation.phase;
  const state={group,animation,building:false};
  const game={effects:[{id:'rifle-shot',type:'projectile',sourceId:entity.id,tx:4,ty:0}]};
  renderer._animateEntity(state,entity,game,1);
  group.updateMatrixWorld(true);
  const receiverAfter=receiver.mesh.getVertexPosition(receiver.index,new THREE.Vector3());
  assert.ok(animation.rigBones.FC_Thigh_L.quaternion.angleTo(new THREE.Quaternion())>0.05,
    'the shared gait should flex the authored leg rig');
  assert.ok(animation.rigBones.FC_Weapon.quaternion.angleTo(animation.rigPose.FC_Weapon)>0.04,
    'a rendered rifle shot should move the weapon bone');
  assert.ok(receiverAfter.distanceTo(receiverBefore)>0.01,
    'the receiver should follow weapon recoil rather than remain detached');
});
