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
  renderer.quality='high';
  renderer.zoom=1;
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
  renderer._prepareAnimation=()=>({phase:0});
  renderer._syncDamageAppearance=()=>{};
  renderer._animateDamageSmoke=()=>{};
  renderer._animateMotion=()=>{};
  renderer._animateEntity=()=>{};
  renderer._syncRefineryTransfer=()=>{};
  renderer._setCampaignShield=()=>{};
  renderer._stampVehicleTracks=()=>{};
  return renderer;
}

function unit(id,{owner='player',suppressedUntil=0,hp=100,embarkedIn=null}={}) {
  return {id,owner,defId:'lightTank',faction:owner==='enemy'?'vesper':'aegis',x:4,y:4,
    hp,maxHp:100,suppressedUntil,embarkedIn,facing:0,veterancy:0,order:{type:'idle'}};
}

function game(units,time,isVisible=()=>true) {
  return {units,buildings:[],effects:[],selection:[],width:16,height:16,time,
    unitDefs:{lightTank:{armor:'light',radius:0.38,speed:2,flying:false}},
    isVisible,mode:'skirmish'};
}

test('suppression cue appears for either suppression window, hides immediately, and is reused',()=>{
  const renderer=makeRenderer();
  const target=unit('u1',{suppressedUntil:2});
  const match=game([target],1);

  renderer._syncEntities(match,1);
  const state=renderer.entities.get('u1');
  const cue=state.animation.suppressionCue;
  assert.ok(cue,'a suppressed mobile unit gets a cue lazily');
  assert.equal(cue.visible,true,'the two-second Specter ambush window is visible');
  assert.equal(cue.isMesh,true);
  assert.equal(cue.material.color.getHex(),0xff895f);

  match.time=2;
  renderer._syncEntities(match,2);
  assert.equal(cue.visible,false,'the cue disappears at expiry');

  target.suppressedUntil=5;
  match.time=2;
  renderer._syncEntities(match,2);
  assert.equal(state.animation.suppressionCue,cue,'the three-second Interdict window reuses the same cue');
  assert.equal(cue.visible,true);

  target.suppressedUntil=0;
  match.time=2.5;
  renderer._syncEntities(match,2.5);
  assert.equal(cue.visible,false,'clearing suppression hides the cue on the next sync');
  assert.equal(state.animation.suppressionCue,cue,'clearing does not allocate a replacement cue');
});

test('hidden, dead, and embarked suppressed enemies lose their cues through entity sync',()=>{
  const renderer=makeRenderer();
  const hidden=unit('u-hidden',{owner:'enemy',suppressedUntil:8});
  const dead=unit('u-dead',{owner:'enemy',suppressedUntil:8});
  const embarked=unit('u-embarked',{owner:'enemy',suppressedUntil:8});
  const units=[hidden,dead,embarked];
  const match=game(units,1);

  renderer._syncEntities(match,1);
  const cues=units.map(item=>renderer.entities.get(item.id).animation.suppressionCue);
  const groups=units.map(item=>renderer.entities.get(item.id).group);
  assert.ok(cues.every(cue=>cue?.visible),'visible enemies show the active suppression cue');

  dead.hp=0;
  embarked.embarkedIn='carrier';
  match.isVisible=item=>item.id!=='u-hidden';
  renderer._syncEntities(match,1.1);

  for(let i=0;i<units.length;i++) {
    assert.equal(renderer.entities.has(units[i].id),false,`${units[i].id} entity state is removed`);
    assert.equal(groups[i].visible,false,`${units[i].id} root is hidden during cleanup`);
    assert.equal(groups[i].parent,null,`${units[i].id} root is detached from the scene`);
  }
  assert.equal(renderer.entityGroup.children.length,0,'no hidden/dead/embarked suppression geometry remains in the scene');
});
