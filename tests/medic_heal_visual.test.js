import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function makeRenderer() {
  const renderer=Object.create(Renderer3D.prototype);
  renderer.quality='eco';
  renderer.effectGroup=new THREE.Group();
  renderer.effects=new Map();
  renderer.entities=new Map();
  renderer.camera=new THREE.OrthographicCamera(-10,10,10,-10,0.1,100);
  renderer.centerX=renderer.centerY=0;
  renderer.scorches=new Map();
  renderer.visualHeightAt=(x,z)=>0.1*x+0.05*z;
  renderer._effectSmokeMap=()=>null;
  renderer._addScorch=()=>{};
  return renderer;
}

test('Medic heal tether tracks visible projected units, appears after IDs are revealed, and expires with its pulse',()=>{
  const renderer=makeRenderer();
  const sourceGroup=new THREE.Group(),targetGroup=new THREE.Group();
  sourceGroup.position.set(1.25,0.275,3.0);
  targetGroup.position.set(2.75,0.45,4.0);
  renderer.entities.set('medic-1',{group:sourceGroup});
  renderer.entities.set('rifle-1',{group:targetGroup});
  const source={id:'medic-1',owner:'player',defId:'medic',hp:80,x:1.25,y:3.0};
  const target={id:'rifle-1',owner:'player',defId:'rifle',hp:40,x:2.75,y:4.0};
  const heal={id:'heal-1',type:'heal',x:2.75,y:4.0,radius:0.6,ttl:0.5,maxTtl:0.55};
  const game={time:1,effects:[heal],units:[source,target],unitDefs:{rifle:{armor:'infantry'}},
    isVisible:()=>true};

  // A projected generic pulse may arrive before the private source/target IDs.
  renderer._syncEffects(game,1);
  assert.equal(renderer.effects.get(heal.id).children.some(child=>child.userData.healTether),false);
  Object.assign(heal,{sourceId:source.id,targetId:target.id,owner:'player'});
  renderer._syncEffects(game,1.05);
  const pulse=renderer.effects.get(heal.id);
  const tether=pulse.children.find(child=>child.userData.healTether);
  assert.ok(tether?.isLine,'revealed Medic and patient IDs create a tether on the same effect');
  assert.equal(tether.geometry.attributes.position.count,2,'tether stays a single two-point line');
  assert.equal(tether.visible,true);

  const positions=tether.geometry.attributes.position;
  const pulseScale=pulse.scale.x;
  for(const [index,group,offset] of [[0,sourceGroup,0.4],[1,targetGroup,0.4]]) {
    const world=new THREE.Vector3(positions.getX(index),positions.getY(index),positions.getZ(index))
      .multiplyScalar(pulseScale).add(pulse.position);
    assert.ok(world.distanceTo(new THREE.Vector3(group.position.x,group.position.y+offset,group.position.z))<1e-5,
      `endpoint ${index} follows the current entity pose through the animated pulse scale`);
  }
  assert.ok(tether.material.opacity>0&&tether.material.opacity<0.78,'tether fades with the heal pulse');

  sourceGroup.position.x+=0.3;
  renderer._syncEffects(game,1.1);
  const movedSourceWorld=new THREE.Vector3(positions.getX(0),positions.getY(0),positions.getZ(0))
    .multiplyScalar(pulse.scale.x).add(pulse.position);
  assert.ok(Math.abs(movedSourceWorld.x-sourceGroup.position.x)<1e-5,'tether follows the Medic movement');
  sourceGroup.visible=false;
  renderer._syncEffects(game,1.15);
  assert.equal(tether.visible,false,'a hidden Medic never leaves a guessed tether');
  sourceGroup.visible=true;
  target.embarkedIn='transport-1';
  renderer._syncEffects(game,1.2);
  assert.equal(tether.visible,false,'an embarked patient suppresses the tether');
  delete target.embarkedIn;

  const generic={id:'generic-heal',type:'heal',x:1,y:1,radius:0.6,ttl:0.4,maxTtl:0.55};
  game.effects=[heal,generic];
  renderer._syncEffects(game,1.25);
  assert.equal(renderer.effects.get(generic.id).children.some(child=>child.userData.healTether),false,
    'other heal effects without source/target metadata remain unlinked');

  let geometryDisposed=false,materialDisposed=false;
  tether.geometry.addEventListener('dispose',()=>geometryDisposed=true);
  tether.material.addEventListener('dispose',()=>materialDisposed=true);
  game.effects=[generic];
  renderer._syncEffects(game,1.3);
  assert.equal(renderer.effects.has(heal.id),false,'expired effect is removed from the effect cache');
  assert.equal(pulse.parent,null,'expired pulse is removed from the scene group');
  assert.equal(geometryDisposed,true,'effect cleanup disposes the tether geometry');
  assert.equal(materialDisposed,true,'effect cleanup disposes the tether material');
});
