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
      if(!result||distance<result.distance)result={mesh,index:i,distance,weight};
    }
  });
  return result;
}

test('Vesper Rocket uses its faction GLB and keeps its rigged launcher, armor, and gait intact',async()=>{
  const [aegis,vesper]=await Promise.all([
    loadModel('rocket-infantry.glb'),loadModel('vesper-rocket-infantry.glb'),
  ]);
  assert.equal(compactAuthoredModel(vesper.scene,'rocketVesper'),true,
    'the faction model should use the same static compaction pipeline as infantry');
  const renderer=Object.create(Renderer3D.prototype);
  renderer.assetModels=new Map([['rocket',aegis.scene],['rocketVesper',vesper.scene]]);
  renderer.assetVersions=new Map([['rocket',1],['rocketVesper',98]]);

  // A captured Vesper unit retains its original faction identity for the
  // physical asset even though ownership has changed.
  const entity={id:'captured-vesper-rocket',defId:'rocket',faction:'vesper',owner:'player',x:0,y:0,facing:0};
  const group=renderer._authoredModel(entity);
  assert.ok(group,'the Vesper faction route should yield an authored model');
  const visual=group.userData.authoredVisual;
  let skinnedMeshes=0,hasVesperMaterial=false;
  visual.traverse(object=>{
    if(object.isSkinnedMesh)skinnedMeshes++;
    for(const material of (Array.isArray(object.material)?object.material:[object.material]))
      if(material?.name?.startsWith('Vesper '))hasVesperMaterial=true;
  });
  assert.ok(hasVesperMaterial,'a captured Vesper Rocket should still use its Vesper-authored materials');
  assert.ok(skinnedMeshes>0,'the complete Vesper mesh should remain attached to the shared infantry rig');
  assert.equal(visual.getObjectByName('FC_Weapon')?.isBone,true);

  const animation=renderer._prepareAnimation(group,entity);
  assert.equal(animation.rigged,true,'the shared animated infantry bones should resolve');
  assert.equal(animation.muzzleSocket?.parent,animation.rigBones.FC_Weapon,
    'the muzzle socket should follow the weapon bone');
  const weightedParts=[
    ['launcher shield',[-.2125,.78125,-.05625],'FC_Weapon',0.10],
    ['launcher sight',[-.2125,.8625,-.09375],'FC_Weapon',0.12],
    ['violet optic',[-.2125,.8925,-.25625],'FC_Weapon',0.10],
    ['shoulder pauldron',[-.30625,.51875,-.00625],'FC_UpperArm_L',0.12],
    ['reload cassette',[.2125,.4625,.21875],'FC_Spine',0.15],
  ];
  for(const [part,target,bone,tolerance] of weightedParts) {
    const vertex=closestWeightedVertex(visual,target,bone);
    assert.ok(vertex&&vertex.distance<tolerance,
      `${part} should be weighted to ${bone}, near its exported authored position`);
  }
  assert.ok(visual.children.every(child=>!child.isMesh||child.isSkinnedMesh),
    'no rigid, detached body or launcher meshes should remain outside the skin');

  const weaponVertex=closestWeightedVertex(visual,weightedParts[0][1],'FC_Weapon');
  const shieldBefore=weaponVertex.mesh.getVertexPosition(weaponVertex.index,new THREE.Vector3());
  const groupState={group,animation,building:false};
  animation.motion=1;
  animation.travel=Math.PI/2-animation.phase;
  const game={effects:[{id:'rocket-shot',type:'projectile',sourceId:entity.id,tx:4,ty:0}]};
  renderer._animateEntity(groupState,entity,game,1);
  group.updateMatrixWorld(true);
  const shieldAfter=weaponVertex.mesh.getVertexPosition(weaponVertex.index,new THREE.Vector3());
  assert.ok(animation.rigBones.FC_Thigh_L.quaternion.angleTo(new THREE.Quaternion())>0.05,
    'the authored legs should flex during gait');
  assert.ok(animation.rigBones.FC_Weapon.quaternion.angleTo(animation.rigPose.FC_Weapon)>0.04,
    'a rendered Rocket shot should animate the weapon bone');
  assert.ok(shieldAfter.distanceTo(shieldBefore)>0.01,
    'the shield surface should move with its weapon bone instead of detaching');
  assert.ok(animation.muzzleSocket.parent===animation.rigBones.FC_Weapon,
    'aim/recoil motion keeps the muzzle attached to the moving launcher');
});
