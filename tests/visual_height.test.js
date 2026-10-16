import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildSandSurfaceGeometry,Renderer3D} from '../src/visual/renderer3d.js';

test('sand and crystal bed tops share one indexed world grid',()=>{
  const game={width:3,height:1,terrain:[[
    {type:'sand'},{type:'crystal'},{type:'water'},
  ]]};
  const geometry=buildSandSurfaceGeometry(game);
  assert.equal(geometry.index.count,2*8*8*6,
    'only sand and crystal tiles contribute surface triangles');
  const columns=game.width*8+1;
  const sharedEdgeVertex=4*columns+8;
  let sharedEdgeReferences=0;
  for(const index of geometry.index.array)if(index===sharedEdgeVertex)sharedEdgeReferences++;
  assert.ok(sharedEdgeReferences>0,
    'adjacent sand and crystal tiles reference the same boundary vertices');
  const position=geometry.getAttribute('position');
  assert.equal(position.getX(sharedEdgeVertex),1);
  assert.equal(position.getZ(sharedEdgeVertex),0.5);
  geometry.dispose();
});

function scene() {
  const game={width:32,height:24,buildings:[],bridges:[],terrain:[]};
  game.terrain=Array.from({length:game.height},(_,z)=>
    Array.from({length:game.width},(_,x)=>({type:'sand',elevation:
      x>=12&&x<18&&z>=10&&z<16?1:0})));
  const renderer=Object.create(Renderer3D.prototype);
  renderer.visualHeightUniforms={uVisualHeight:{value:null},uVisualHeightSize:{value:new THREE.Vector2()}};
  renderer._buildVisualHeightField(game);
  return {game,renderer};
}

test('raised surface is continuous at a shelf edge and keeps flat maps flat',()=>{
  const {game,renderer}=scene();
  const plateau=renderer.visualHeightAt(14,12);
  assert.ok(plateau>0.21&&plateau<0.23);
  assert.equal(renderer.visualHeightAt(5,5),0);
  assert.ok(Math.abs(renderer.visualHeightAt(12,12)-plateau/2)<0.002);
  let previous=0;
  for(let x=11.7;x<=12.3;x+=0.01){
    const height=renderer.visualHeightAt(x,12);
    assert.ok(height>=previous-1e-9,'shelf approach must never fold downward');
    assert.ok(height-previous<0.011,'shelf approach must not contain a vertical step');
    previous=height;
  }
  assert.equal(renderer.visualHeightAt(-10,-10),0);
  for(const row of game.terrain)for(const tile of row)tile.elevation=0;
  renderer._buildVisualHeightField(game);
  assert.equal(renderer.visualHeightAt(14,12),0);
  renderer.visualHeightUniforms.uVisualHeight.value.dispose();
});

test('static building pads flatten a straddled shelf and disappear with the building',()=>{
  const {game,renderer}=scene();
  const base=renderer.visualHeightAt(11.25,12);
  game.buildings.push({x:11,y:11,w:3,h:2,hp:100});
  renderer._syncVisualHeightFootprints(game);
  const center=renderer.visualHeightAt(12.5,12);
  assert.ok(center>0.21);
  assert.ok(Math.abs(renderer.visualHeightAt(11.25,12)-center)<0.002,
    'the full building footing must share its center height');
  game.buildings[0].hp=0;
  renderer._syncVisualHeightFootprints(game);
  assert.equal(renderer.visualHeightAt(11.25,12),base);
  renderer.visualHeightUniforms.uVisualHeight.value.dispose();
});

test('camera projection and clicks agree on visible shelf tops, approaches, and flat ground',()=>{
  const {renderer}=scene();
  renderer.width=1000;renderer.height=700;
  renderer.centerX=15;renderer.centerY=13;
  renderer.camera=new THREE.OrthographicCamera(-20,20,14,-14,0.1,200);
  const target=new THREE.Vector3(15,0,13);
  renderer.camera.position.copy(target).addScaledVector(new THREE.Vector3(1,1.24,1).normalize(),52);
  renderer.camera.lookAt(target);renderer.camera.updateMatrixWorld();
  renderer.raycaster=new THREE.Raycaster();
  renderer.groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  renderer.tmpVec=new THREE.Vector3();
  for(const [x,z] of [[5,5],[14,12],[17.8,13],[18,13],[18.1,13],[14,16],[14,16.1]]){
    const screen=renderer.worldToScreen(x,z);
    const point=renderer.screenToWorld(screen.x,screen.y);
    assert.ok(Math.hypot(point.x-x,point.y-z)<0.002,`click missed ground point ${x},${z}`);
  }
  const air=renderer.worldToScreen(14,12,0.85,{absoluteHeight:true});
  const expected=new THREE.Vector3(14,0.85,12).project(renderer.camera);
  assert.ok(Math.abs(air.y-(1-expected.y)*renderer.height/2)<1e-9,
    'an aircraft absolute altitude must not inherit the shelf height');
  renderer.visualHeightUniforms.uVisualHeight.value.dispose();
});
