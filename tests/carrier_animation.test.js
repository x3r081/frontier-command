import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Renderer3D} from '../src/visual/renderer3d.js';

async function carrierState() {
  const bytes=await readFile(new URL('../public/assets/models/apc.glb',import.meta.url));
  const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(
    bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',resolve,reject));
  const group=new THREE.Group();
  group.userData.authoredVisual=gltf.scene;group.add(gltf.scene);
  const renderer=Object.create(Renderer3D.prototype);
  renderer.tmpWheelQuat=new THREE.Quaternion();renderer.wheelAxis=new THREE.Vector3(0,1,0);
  const entity={id:'u1',defId:'apc',owner:'player',hp:200,x:10,y:10,passengerIds:[],order:{type:'idle'}};
  const state={group,defId:'apc',animation:renderer._prepareAnimation(group,entity)};
  return {renderer,state,entity};
}

const advance=(renderer,state,entity,game,from,to,move)=>{
  for(let t=from;t<to-1e-6;t+=1/30){
    move?.();renderer._animateEntity(state,entity,game,t);
    for(let held=0;held<3;held++)renderer._animateEntity(state,entity,game,t);
  }
};

test('authored carrier has six centered rolling assemblies and a mechanically hinged loading set',async()=>{
  const {renderer,state,entity}=await carrierState();
  const a=state.animation;
  assert.equal(a.wheels.length,6);
  assert.ok(a.wheels.every(wheel=>wheel.axis?.x===1&&wheel.part.visible));
  assert.equal(a.carrierParts.length,3);
  const hinges=a.carrierParts.map(item=>item.part.position.clone());
  const wheelCenters=a.wheels.map(wheel=>wheel.part.position.clone());
  const rest=a.wheels.map(wheel=>wheel.part.quaternion.clone());
  renderer._animateMotion(state,0.06,0,-0.06,1);
  assert.ok(a.wheels.every((wheel,i)=>wheel.part.quaternion.angleTo(rest[i])>0.3));
  assert.ok(a.wheels.every((wheel,i)=>wheel.part.position.equals(wheelCenters[i])));
  renderer._animateMotion(state,0.06,0,0.06,1.03);
  assert.ok(a.wheels.every((wheel,i)=>wheel.part.quaternion.angleTo(rest[i])<1e-6),
    'backward travel reverses wheel roll instead of continuing forward');

  a.motion=0;
  const game={units:[{id:'u2',owner:'player',hp:100,x:10.5,y:10,order:{type:'board',carrierId:'u1'}}]};
  advance(renderer,state,entity,game,2,2.8);
  assert.ok(a.carrierAperture>0.98);
  assert.ok(a.carrierParts.every((item,i)=>item.part.position.equals(hinges[i])),
    'doors and ramp rotate around their authored hinges');
  assert.ok(a.carrierParts.every(item=>item.part.quaternion.angleTo(item.rotation)>1.3));
  state.group.updateMatrixWorld(true);
  const ramp=a.carrierParts.find(item=>item.ramp);
  const bounds=new THREE.Box3().setFromObject(ramp.part);
  assert.ok(ramp.part.position.y>0.3,'ramp must hinge at the cabin threshold');
  assert.ok(bounds.min.y>=0&&bounds.max.z>0.85,'open ramp reaches rearward without penetrating the ground');
});

test('loading opens for nearby visible boarding and transfers, then stows for travel',async()=>{
  const {renderer,state,entity}=await carrierState();
  const a=state.animation,game={units:[],isVisible:()=>false};
  renderer._animateEntity(state,entity,game,1);
  entity.passengerIds=['u2'];
  advance(renderer,state,entity,game,1.03,1.8);
  assert.ok(a.carrierAperture>0.98,'a real passenger-count change opens the loading equipment');
  advance(renderer,state,entity,game,1.8,2.6,()=>{entity.y+=1/30;});
  assert.ok(a.carrierAperture<0.002,'equipment closes during sustained travel');

  entity.passengerIds=[];
  renderer._animateEntity(state,entity,game,3.2);
  game.units=[{id:'enemy',owner:'enemy',hp:100,x:10.5,y:10,order:{type:'board',carrierId:'u1'}}];
  advance(renderer,state,entity,game,3.23,4);
  assert.equal(a.carrierAperture,0,'unseen boarding intent cannot animate the visible carrier');
  game.isVisible=()=>true;
  advance(renderer,state,entity,game,4,4.8);
  assert.ok(a.carrierAperture>0.98);
  game.units=[];
  advance(renderer,state,entity,game,4.8,7.3);
  assert.ok(a.carrierAperture<0.001,'equipment returns to its closed pose after transfer');
});

test('held replay frames preserve the pose and discontinuities clear stale loading motion',async()=>{
  const {renderer,state,entity}=await carrierState();
  const game={units:[{owner:'player',hp:100,x:10.5,y:10,order:{type:'board',carrierId:'u1'}}]};
  advance(renderer,state,entity,game,1,1.7);
  const a=state.animation,held=a.carrierAperture,time=a.carrierLastTime;
  const poses=a.carrierParts.map(item=>item.part.quaternion.clone());
  renderer._animateEntity(state,entity,game,time);
  assert.equal(a.carrierAperture,held);
  assert.ok(a.carrierParts.every((item,i)=>item.part.quaternion.equals(poses[i])));
  renderer._animateEntity(state,entity,{units:[]},0.5);
  assert.equal(a.carrierAperture,0);
  assert.ok(a.carrierParts.every(item=>item.part.quaternion.angleTo(item.rotation)<1e-6));
  renderer._animateEntity(state,entity,game,3);
  assert.equal(a.carrierAperture,0,'a long render gap does not replay an old transfer');
});
