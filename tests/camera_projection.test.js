import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function cameraRenderer(width,height) {
  const renderer=Object.create(Renderer3D.prototype);
  renderer.width=width;
  renderer.height=height;
  renderer.cameraDirection=new THREE.Vector3(1,1.24,1).normalize();
  renderer.camera=new THREE.OrthographicCamera(-1,1,1,-1,0.1,220);
  renderer.raycaster=new THREE.Raycaster();
  renderer.groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  renderer.tmpVec=new THREE.Vector3();
  renderer.skyBackdrop={position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),scale:new THREE.Vector3()};
  renderer.atmosphere={position:new THREE.Vector3()};
  renderer.sun={position:new THREE.Vector3(),target:{position:new THREE.Vector3(),updateMatrixWorld(){}}};
  return renderer;
}

function projectGround(renderer,x,z) {
  const point=new THREE.Vector3(x,0,z).project(renderer.camera);
  return {x:(point.x+1)*renderer.width/2,y:(1-point.y)*renderer.height/2};
}

test('fixed-plane camera deltas match screen pixels across viewports and zoom levels',()=>{
  for(const [width,height,zoom] of [[1280,800,0.65],[1024,768,1],[390,844,1.8]]) {
    const renderer=cameraRenderer(width,height);
    renderer.setView(20,16,zoom);
    renderer.visualHeightAt=()=>{throw new Error('camera pan must not sample raised terrain');};
    const dx=width*0.11,dy=-height*0.08;
    const delta=renderer.screenDeltaToWorld(dx,dy);
    renderer.setView(20+delta.x,16+delta.y,zoom);
    const previousCenter=projectGround(renderer,20,16);
    assert.ok(Math.abs(previousCenter.x-(width/2-dx))<1e-7,`pan x at ${width}x${height}, zoom ${zoom}`);
    assert.ok(Math.abs(previousCenter.y-(height/2-dy))<1e-7,`pan y at ${width}x${height}, zoom ${zoom}`);
  }
});

test('camera drag follows the pointer while camera movement goes the inverse screen direction',()=>{
  const width=1200,height=760,centerX=20,centerY=16,zoom=1.1;
  const renderer=cameraRenderer(width,height);
  renderer.setView(centerX,centerY,zoom);
  const dragX=64,dragY=-32;
  const dragDelta=renderer.screenDeltaToWorld(-dragX,-dragY);
  renderer.setView(centerX+dragDelta.x,centerY+dragDelta.y,zoom);
  const draggedPoint=projectGround(renderer,centerX,centerY);
  assert.ok(Math.abs(draggedPoint.x-(width/2+dragX))<1e-7);
  assert.ok(Math.abs(draggedPoint.y-(height/2+dragY))<1e-7);

  renderer.setView(centerX,centerY,zoom);
  const moveDelta=renderer.screenDeltaToWorld(dragX,dragY);
  renderer.setView(centerX+moveDelta.x,centerY+moveDelta.y,zoom);
  const movedPoint=projectGround(renderer,centerX,centerY);
  assert.ok(Math.abs(movedPoint.x-(width/2-dragX))<1e-7);
  assert.ok(Math.abs(movedPoint.y-(height/2-dragY))<1e-7);
});
