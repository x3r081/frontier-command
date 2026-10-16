import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Renderer3D,compactAuthoredModel} from '../src/visual/renderer3d.js';

const INFANTRY_BONES=[
  'FC_Root','FC_Pelvis','FC_Spine','FC_Thigh_L','FC_Shin_L','FC_Foot_L',
  'FC_Thigh_R','FC_Shin_R','FC_Foot_R','FC_UpperArm_L','FC_Forearm_L',
  'FC_UpperArm_R','FC_Forearm_R','FC_Weapon',
];

async function loadAsset(file,modelKey) {
  const bytes=await readFile(new URL(`../public/assets/models/${file}`,import.meta.url));
  const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const gltf=await new GLTFLoader().parseAsync(payload,'');
  compactAuthoredModel(gltf.scene,modelKey);
  return gltf.scene;
}

function skinnedMeshes(root) {
  const result=[];
  root.traverse(object=>{if(object.isSkinnedMesh)result.push(object);});
  return result;
}

function bonePose(animation) {
  return Object.fromEntries(Object.entries(animation.rigBones).map(([name,bone])=>[
    name,{position:bone.position.toArray(),quaternion:bone.quaternion.toArray()},
  ]));
}

function weaponTipY(visual,weaponBone) {
  visual.updateMatrixWorld(true);
  const tip=new THREE.Vector3();
  let maximum=-Infinity;
  let vertices=0;
  for(const mesh of skinnedMeshes(visual)) {
    mesh.skeleton.update();
    const joint=mesh.skeleton.bones.indexOf(weaponBone);
    if(joint<0)continue;
    const indices=mesh.geometry.attributes.skinIndex;
    const weights=mesh.geometry.attributes.skinWeight;
    for(let index=0;index<indices.count;index++) {
      let total=0;
      for(let channel=0;channel<4;channel++)
        if(indices.getComponent(index,channel)===joint)total+=weights.getComponent(index,channel);
      if(total<0.99)continue;
      mesh.getVertexPosition(index,tip);
      mesh.localToWorld(tip);
      weaponBone.worldToLocal(tip);
      maximum=Math.max(maximum,tip.y);
      vertices++;
    }
  }
  assert.ok(vertices>0,'the exported carbine should have vertices weighted to FC_Weapon');
  return maximum;
}

test('Aegis and Vesper Pathfinders route, clone, animate, and place their muzzle at the carbine tip',async()=>{
  const models={
    aegis:await loadAsset('scout.glb','scout'),
    vesper:await loadAsset('vesper-scout.glb','scoutVesper'),
  };
  const renderer=Object.create(Renderer3D.prototype);
  renderer.assetModels=new Map([['scout',models.aegis],['scoutVesper',models.vesper]]);
  renderer.assetVersions=new Map([['scout',1],['scoutVesper',1]]);

  for(const faction of ['aegis','vesper']) {
    const entityA={id:`${faction}-pathfinder-a`,defId:'scout',faction,x:0,y:0,facing:0};
    const entityB={id:`${faction}-pathfinder-b`,defId:'scout',faction,x:0,y:0,facing:0};
    const groupA=renderer._authoredModel(entityA);
    const groupB=renderer._authoredModel(entityB);
    assert.ok(groupA&&groupB,`${faction} should resolve an authored Pathfinder GLB`);
    const visualA=groupA.userData.authoredVisual;
    const visualB=groupB.userData.authoredVisual;
    const factionPrefix=faction==='vesper'?'Vesper Pathfinder':'Aegis Pathfinder';
    const materials=[];
    visualA.traverse(object=>{
      for(const material of (Array.isArray(object.material)?object.material:[object.material]))
        if(material?.name)materials.push(material.name);
    });
    assert.ok(materials.some(name=>name.startsWith(factionPrefix)),
      `${faction} routing should use the corresponding authored palette`);

    const animationA=renderer._prepareAnimation(groupA,entityA);
    const animationB=renderer._prepareAnimation(groupB,entityB);
    assert.equal(animationA.rigged,true,`${faction} should bind to the infantry animation rig`);
    assert.equal(animationB.rigged,true);
    assert.deepEqual(Object.keys(animationA.rigBones).sort(),[...INFANTRY_BONES].sort(),
      `${faction} should expose the exact shared 14-bone infantry rig`);
    assert.deepEqual(Object.keys(animationB.rigBones).sort(),[...INFANTRY_BONES].sort());

    const meshesA=skinnedMeshes(visualA),meshesB=skinnedMeshes(visualB);
    assert.ok(meshesA.length>0,`${faction} should remain skinned after GLTF loading`);
    assert.equal(meshesA.length,meshesB.length);
    assert.equal(new Set(meshesA.map(mesh=>mesh.skeleton)).size,1,
      'each scout clone should use one local skeleton across all material primitives');
    assert.equal(new Set(meshesB.map(mesh=>mesh.skeleton)).size,1);
    assert.notEqual(meshesA[0].skeleton,meshesB[0].skeleton,
      'two scouts must not share their mutable skeleton palette');
    for(const name of INFANTRY_BONES)
      assert.notEqual(animationA.rigBones[name],animationB.rigBones[name],
        `${name} should be independent between scouts`);
    for(let index=0;index<meshesA.length;index++) {
      assert.equal(meshesA[index].geometry,meshesB[index].geometry,
        'cloned scouts should share immutable authored geometry');
      assert.equal(meshesA[index].userData.sharedAssetGeometry,true);
      assert.equal(meshesB[index].userData.sharedAssetGeometry,true);
    }

    const weapon=animationA.rigBones.FC_Weapon;
    const expectedMuzzle=faction==='vesper'?0.695625:0.7425;
    assert.equal(animationA.muzzleSocket.parent,weapon,
      `${faction} muzzle socket should follow FC_Weapon`);
    assert.ok(Math.abs(animationA.muzzleSocket.position.y-expectedMuzzle)<1e-8,
      `${faction} should use its authored muzzle length`);
    assert.ok(Math.abs(weaponTipY(visualA,weapon)-animationA.muzzleSocket.position.y)<0.002,
      `${faction} muzzle socket should land at the skinned carbine tip`);

    const sharedGeometry=[...new Set(meshesA.map(mesh=>mesh.geometry))];
    const geometryBefore=sharedGeometry.map(geometry=>geometry.attributes.position.array.slice());
    const poseB=bonePose(animationB);
    animationA.motion=1;
    animationA.travel=Math.PI/2-animationA.phase;
    const stateA={group:groupA,animation:animationA,building:false};
    const shot={type:'projectile',id:`${faction}-shot`,sourceId:entityA.id,ttl:1,maxTtl:1};
    renderer._animateEntity(stateA,entityA,{effects:[shot]},1);
    assert.ok(animationA.rigBones.FC_Thigh_L.quaternion.angleTo(animationA.rigPose.FC_Thigh_L)>0.05,
      `${faction} gait should move the first scout's leg bone`);
    assert.ok(animationA.rigBones.FC_Weapon.quaternion.angleTo(animationA.rigPose.FC_Weapon)>0.04,
      `${faction} recoil should move the first scout's weapon bone`);
    assert.deepEqual(bonePose(animationB),poseB,
      `${faction} gait and recoil should leave the second scout untouched`);
    for(let index=0;index<sharedGeometry.length;index++)
      assert.deepEqual(sharedGeometry[index].attributes.position.array,geometryBefore[index],
        'animation should leave shared geometry immutable');
  }
});
