import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function makeRenderer() {
  const view=Object.create(Renderer3D.prototype);
  view.terrainGroup=new THREE.Group();view.tmpObj=new THREE.Object3D();
  view.wreckVisuals=new Map();view.wreckMeshes=null;view.wreckGroup=null;
  view.wreckWorkRing=null;view.wreckWelding=null;view.wreckCapacity=32;view._wreckSignature='';
  view.visualHeightAt=()=>0;
  view._setGroundPosition=(object,x,y,z)=>object.position.set(x,y,z);
  return view;
}

test('wreck silhouettes use the public restored vehicle type and stay within the 32 wreck batch cap',()=>{
  const view=makeRenderer();
  const wrecks=[
    {id:'wreck1',x:2.5,y:3.5,value:60,faction:'aegis',restoreDefId:'lightTank'},
    {id:'wreck2',x:4.5,y:3.5,value:60,faction:'vesper',restoreDefId:'guardian'},
  ];
  view._syncWrecks({width:10,height:8,fog:Array.from({length:8},()=>Array(10).fill(2)),wrecks,units:[]},4);
  assert.equal(view.wreckMeshes.length,5,'hull, turret, tracks, barrel, and subdued hot metal are fixed shared batches');
  assert.equal(view.wreckMeshes[0].count,2);
  const light=new THREE.Matrix4(),heavy=new THREE.Matrix4();
  view.wreckMeshes[0].getMatrixAt(0,light);view.wreckMeshes[0].getMatrixAt(1,heavy);
  assert.ok(heavy.elements[0]>light.elements[0],'heavy tank wreck has a broader hull silhouette');
  assert.equal(view.wreckWorkRing.count,0);
  assert.equal(view.wreckWelding.count,0);
  assert.equal(view.wreckCapacity,32);
});

test('recommission ring and welding cue require an active visible Engineer and clear on wait, movement, or lost fog',()=>{
  const view=makeRenderer();
  const wreck={id:'wreck3',x:3.5,y:4.5,value:70,faction:'vesper',restoreDefId:'guardian'};
  const engineer={id:'eng1',owner:'player',defId:'engineer',x:3.8,y:4.5,hp:100,
    order:{type:'recommissionWreck',wreckId:wreck.id},_wreckRecommissionProgress:6,_wreckRecommissionWaiting:null};
  const fog=Array.from({length:9},()=>Array(9).fill(2));
  const game={width:9,height:9,fog,wrecks:[wreck],units:[engineer],isVisible:()=>true};
  assert.deepEqual(view._orderEndpoint(game,engineer),{x:wreck.x,y:wreck.y,type:'recommissionWreck'},'selected order routes end at the current visible wreck record');
  view._syncWrecks(game,2);
  assert.equal(view.wreckWorkRing.count,6,'six of twelve progress ticks show at halfway');
  assert.equal(view.wreckWelding.count,1,'one compact welding arc runs from Engineer to hull');
  assert.equal(view.wreckWorkRing.instanceColor.getX(0)>0,true);

  // Competing commanders can work on the same hull. Keep the shared work
  // buffers bounded even when visible workers outnumber the wreck cap.
  game.units=Array.from({length:33},(_,i)=>({...engineer,id:`eng${i}`,_wreckRecommissionProgress:12}));
  view._syncWrecks(game,2.05);
  assert.equal(view.wreckWelding.count,32);
  assert.equal(view.wreckWorkRing.count,32*12);
  game.units=[engineer];

  engineer._wreckRecommissionWaiting='credits';view._syncWrecks(game,2.1);
  assert.equal(view.wreckWorkRing.count,0);assert.equal(view.wreckWelding.count,0);
  engineer._wreckRecommissionWaiting=null;engineer.x=7;view._syncWrecks(game,2.2);
  assert.equal(view.wreckWorkRing.count,0,'a moving Engineer gets no work cue');
  engineer.x=3.8;fog[4][3]=1;view._syncWrecks(game,2.3);
  assert.equal(view.wreckWorkRing.count,0,'unobserved wrecks have no progress overlay');
  assert.equal(view._orderEndpoint(game,engineer),null,'routes do not expose targets outside current visibility');
});

test('enemy restoration work is never inferred from a private order',()=>{
  const view=makeRenderer();
  const wreck={id:'wreck4',x:2.5,y:2.5,value:40,faction:'aegis',restoreDefId:'lightTank'};
  const engineer={id:'enemy-eng',owner:'enemy',defId:'engineer',x:2.5,y:2.5,hp:80,
    order:{type:'recommissionWreck',wreckId:wreck.id},_wreckRecommissionProgress:8,_wreckRecommissionWaiting:null};
  const game={width:6,height:6,fog:Array.from({length:6},()=>Array(6).fill(2)),wrecks:[wreck],units:[engineer],isVisible:()=>false};
  view._syncWrecks(game,1);
  assert.equal(view.wreckWorkRing.count,0);
  assert.equal(view.wreckWelding.count,0);
  game.units[0]={...engineer,order:undefined};view._syncWrecks(game,1.1);
  assert.equal(view.wreckWorkRing.count,0,'a redacted enemy order produces no guessed activity');
});
