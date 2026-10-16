import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function renderer() {
  const result=Object.create(Renderer3D.prototype);
  result.orderGroup=new THREE.Group();
  result.orderMarkers=new Map();
  result.visualHeightAt=(x,z)=>0.2+x*0.01+z*0.02;
  return result;
}

test('selected completed friendly production building shows a terrain-following rally route',()=>{
  const view=renderer();
  const building={id:'b1',owner:'player',defId:'factory',x:4,y:6,w:3,h:3,hp:100,progress:1,
    rally:{x:12.5,y:9.5}};
  view._syncProductionRally({selection:['b1'],buildings:[building]},1);

  const marker=view.productionRallyMarker;
  assert.ok(marker);
  assert.equal(marker.group.visible,true);
  const positions=marker.line.geometry.attributes.position;
  assert.deepEqual([positions.getX(0),positions.getZ(0)],[5.5,7.5]);
  assert.deepEqual([positions.getX(positions.count-1),positions.getZ(positions.count-1)],[12.5,9.5]);
  assert.ok(Math.abs(positions.getY(0)-(0.2+5.5*0.01+7.5*0.02+0.12))<1e-6);
  assert.equal(marker.ring.position.x,12.5);
  assert.equal(marker.ring.position.z,9.5);

  view._syncProductionRally({selection:[],buildings:[building]},2);
  assert.equal(marker.group.visible,false);
});

test('rally route is not created for incomplete, dead, or enemy producers',()=>{
  const view=renderer();
  const base={id:'b2',owner:'player',defId:'barracks',x:1,y:2,w:2,h:2,hp:100,progress:1,rally:{x:8,y:8}};
  view._syncProductionRally({selection:['b2'],buildings:[{...base,progress:0.9}]},1);
  assert.equal(view.productionRallyMarker,undefined);

  view._syncProductionRally({selection:['b2'],buildings:[{...base,hp:0}]},1);
  assert.equal(view.productionRallyMarker,undefined);
  view._syncProductionRally({selection:['b2'],buildings:[{...base,owner:'enemy'}]},1);
  assert.equal(view.productionRallyMarker,undefined);
});
