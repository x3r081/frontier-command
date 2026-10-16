import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Renderer3D,compactAuthoredModel} from '../src/visual/renderer3d.js';

async function loadModel(file,key) {
  const bytes=await readFile(new URL(`../public/assets/models/${file}`,import.meta.url));
  const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(payload,'',resolve,reject));
  compactAuthoredModel(gltf.scene,key);
  return gltf.scene;
}

function makeRenderer() {
  const renderer=Object.create(Renderer3D.prototype);
  renderer.entityGroup=new THREE.Group();
  renderer.effectGroup=new THREE.Group();
  renderer.entities=new Map();
  renderer.entitySyncLive=new Set();
  renderer.entitySyncSelected=new Set();
  renderer.entitySyncAcquiredTargets=new Set();
  renderer.vehicleBuckets=new Map();
  renderer.vehicleBucketPool=[];
  renderer.assetVersions=new Map([['refinery',1],['vesperRefinery',1]]);
  renderer.assetModels=new Map();
  renderer.quality='high';
  renderer.zoom=1;
  renderer.visualHeightAt=()=>0;
  renderer.visualHeightUniforms={};
  renderer._syncDamageAppearance=()=>{};
  renderer._animateDamageSmoke=()=>{};
  renderer._animateMotion=()=>{};
  renderer._animateEntity=()=>{};
  renderer._syncRefineryTransfer=()=>{};
  renderer._setCampaignShield=()=>{};
  renderer._stampVehicleTracks=()=>{};
  return renderer;
}

function factionColors(group) {
  const colors=[];
  group.traverse(node=>{
    if(!node.isMesh||!node.material) return;
    for(const material of (Array.isArray(node.material)?node.material:[node.material]))
      if(material.color) colors.push(material.color.getHex());
  });
  return colors;
}

test('captured refinery rebuilds authored model and team marks for its new faction',async()=>{
  const renderer=makeRenderer();
  renderer.assetModels.set('refinery',await loadModel('refinery.glb','refinery'));
  renderer.assetModels.set('vesperRefinery',await loadModel('vesper-refinery.glb','vesperRefinery'));
  const refinery={id:'b1',defId:'refinery',owner:'player',faction:'aegis',x:4,y:4,w:3,h:3,
    hp:100,maxHp:100,progress:1};
  const match={buildings:[refinery],units:[],effects:[],selection:[],width:16,height:16,
    unitDefs:{},buildingDefs:{},isVisible:()=>true,mode:'skirmish'};

  renderer._syncEntities(match,1);
  const aegisState=renderer.entities.get(refinery.id);
  const aegisGroup=aegisState.group;
  const aegisAccent=[];
  aegisGroup.userData.authoredVisual.traverse(node=>{
    if(!node.isMesh) return;
    for(const material of (Array.isArray(node.material)?node.material:[node.material]))
      if(material.name==='TeamAccent') aegisAccent.push(material.color.getHex());
  });
  assert.ok(aegisAccent.length>0,'the Aegis authored refinery includes its faction accent');
  assert.ok(aegisAccent.includes(0x56e8ff),'the authored accent uses Aegis colors');
  assert.ok(factionColors(aegisGroup).includes(0x47d9ef),'the Aegis team marks are present');

  let oldOverlayDisposed=false;
  aegisState.ring.children[0].geometry.addEventListener('dispose',()=>{oldOverlayDisposed=true;});
  refinery.owner='enemy';
  refinery.faction='vesper';
  renderer._syncEntities(match,2);

  const vesperState=renderer.entities.get(refinery.id);
  assert.notEqual(vesperState,aegisState,'capture replaces the cached entity state');
  assert.notEqual(vesperState.group,aegisGroup,'capture rebuilds the entity root');
  assert.equal(aegisGroup.visible,false,'the old faction root is hidden during cleanup');
  assert.equal(aegisGroup.parent,null,'the old faction root is detached from the scene');
  assert.equal(oldOverlayDisposed,true,'the old faction overlays are disposed');
  assert.equal(renderer.entityGroup.children.length,1,'only the replacement refinery remains in the scene');
  assert.equal(vesperState.owner,'enemy');
  assert.equal(vesperState.faction,'vesper');
  assert.equal(vesperState.version,1,'both faction assets can share the same load version');
  assert.ok(vesperState.group.userData.authoredVisual,'the replacement uses an authored GLB');
  assert.ok(vesperState.group.userData.authoredVisual.getObjectByName('Crucible_one'),
    'the replacement contains the authored Vesper refinery vessel');
  assert.ok(factionColors(vesperState.group).includes(0xff795e),'the Vesper team marks are present');
  assert.ok(!factionColors(vesperState.group).includes(0x47d9ef),'Aegis team marks are gone');
});
