import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

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
  renderer.assetVersions=new Map();
  renderer.quality='balanced';
  renderer.zoom=1;
  renderer.camera=new THREE.PerspectiveCamera();
  renderer.visualHeightAt=()=>0;
  renderer._authoredModel=()=>null;
  renderer._addTeamMarks=()=>{};
  renderer._selectionRing=()=>{
    const material=new THREE.MeshBasicMaterial();
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.4,0.45,8),material);
    ring.userData.colorMaterial=material;
    return ring;
  };
  renderer._veterancyRing=()=>new THREE.Mesh(new THREE.RingGeometry(0.5,0.54,8),
    new THREE.MeshBasicMaterial());
  renderer._prepareAnimation=()=>null;
  renderer._syncDamageAppearance=()=>{};
  renderer._animateDamageSmoke=()=>{};
  renderer._animateEntity=()=>{};
  renderer._syncRefineryTransfer=()=>{};
  renderer._setCampaignShield=()=>{};
  renderer._stampVehicleTracks=()=>{};
  return renderer;
}

function building({owner='player',faction='aegis',powerStandby=true,powered=false}={}) {
  return {id:'b1',owner,faction,defId:'power',x:4,y:5,w:2,h:2,hp:600,maxHp:600,
    progress:1,powerStandby,powered};
}

function game(buildings,isVisible=()=>true) {
  return {buildings,units:[],effects:[],selection:[],width:16,height:16,
    unitDefs:{},isVisible,mode:'skirmish'};
}

test('completed standby building shows a steady reusable cue and clears it immediately when restored',()=>{
  const renderer=makeRenderer();
  const plant=building();
  const match=game([plant]);

  renderer._syncEntities(match,1);
  const state=renderer.entities.get(plant.id);
  const cue=state.standbyCue;
  assert.ok(cue?.visible,'the completed standby building has a visible cue');
  assert.equal(cue.children.length,2,'the cue uses a dark keyline and one merged amber double bar');
  assert.ok(cue.children.every(child=>child.isMesh),'the cue adds two mesh draws');
  assert.equal(cue.children[1].geometry.getAttribute('position').count,8,
    'the amber pause bars have only two quads');
  assert.deepEqual(cue.children.map(child=>child.renderOrder),[11,12],
    'transparent cue meshes draw the amber bars after their plate');
  assert.ok(cue.children.every(child=>child.material.transparent&&child.material.depthWrite===false),
    'the cue uses ordered transparent draws without writing depth');
  assert.ok(cue.children.every(child=>child.material.forceSinglePass),
    'flat billboards avoid the extra back-face pass for double-sided transparency');
  assert.ok(cue.children[0].geometry.parameters.width>=0.7,
    'the outlined pause symbol remains readable at command zoom');
  assert.ok(cue.position.y>=2.5,'the cue clears the building health overlay at world height 1.85');

  renderer._syncEntities(match,1.2);
  assert.equal(state.standbyCue,cue,'consecutive frames reuse the same geometry');
  assert.equal(cue.visible,true,'standby status remains visible between updates');

  plant.powerStandby=false;
  plant.powered=true;
  renderer._syncEntities(match,1.3);
  assert.equal(cue.visible,false,'restoring power hides the cue in the same entity sync');
});

test('enemy standby cue obeys fog visibility and is rebuilt after ownership changes',()=>{
  const renderer=makeRenderer();
  const plant=building({owner:'enemy',faction:'vesper'});
  const match=game([plant]);

  renderer._syncEntities(match,1);
  const firstState=renderer.entities.get(plant.id);
  const firstCue=firstState.standbyCue;
  assert.equal(firstCue.visible,true);

  match.isVisible=()=>false;
  renderer._syncEntities(match,1.1);
  assert.equal(renderer.entities.has(plant.id),false,'hidden enemies are removed by the existing fog gate');
  assert.equal(firstState.group.visible,false,'the hidden enemy group and cue are hidden together');

  match.isVisible=()=>true;
  renderer._syncEntities(match,1.2);
  const visibleState=renderer.entities.get(plant.id);
  const visibleCue=visibleState.standbyCue;
  assert.ok(visibleCue.visible,'the cue returns when the building is observed again');

  plant.owner='player';
  plant.faction='aegis';
  renderer._syncEntities(match,1.3);
  assert.notEqual(renderer.entities.get(plant.id),visibleState,'capture rebuilds the owner-bound entity');
  assert.notEqual(renderer.entities.get(plant.id).standbyCue,visibleCue,'capture creates a cue in the new entity state');
  assert.equal(renderer.entities.get(plant.id).standbyCue.visible,true);
});
