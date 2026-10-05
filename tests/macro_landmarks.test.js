import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Game} from '../src/game/engine.js';
import {Renderer3D} from '../src/visual/renderer3d.js';

const profiles={
  'twin-passes':'passGate',
  'delta-crossing':'spillway',
  'canyon-ring':'oreHoist',
};

function landmarkRenderer(mapId) {
  const renderer=Object.create(Renderer3D.prototype);
  const source=new THREE.Group();
  source.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()));
  renderer.assetModels=new Map([[profiles[mapId],source]]);
  renderer.terrainGroup=new THREE.Group();
  renderer.macroLandmarkPlacements=[];
  renderer.fogCache=[];
  renderer.fogTexture=null;
  renderer.stormArrayTileIndex=-1;
  renderer.crystalTiles=new Map();
  renderer.decorativeCrystalTiles=new Map();
  renderer.environmentPropInstances=new Map();
  renderer.sandFormationInstances=new Map();
  return renderer;
}

test('authored macro landmarks place deterministically on blocked terrain with clearance',()=>{
  for(const mapId of Object.keys(profiles))for(const seed of [91,7351,46809]) {
    const game=new Game({seed,mapId,mode:'skirmish'});
    const a=landmarkRenderer(mapId),b=landmarkRenderer(mapId);
    a._addMacroLandmarks(game);b._addMacroLandmarks(game);
    const locations=renderer=>renderer.macroLandmarkPlacements.map(p=>[p.x,p.z]);
    assert.equal(a.macroLandmarkPlacements.length,2,`${mapId} should have two authored silhouettes`);
    assert.deepEqual(locations(a),locations(b),`${mapId} placements should replay identically`);
    for(const p of a.macroLandmarkPlacements) {
      for(let dz=0;dz<p.h;dz++)for(let dx=0;dx<p.w;dx++)
        assert.equal(game.terrain[p.z+dz][p.x+dx].type,'rock');
      assert.ok(game.relays.every(relay=>Math.hypot(p.px-relay.x,p.pz-relay.y)>=4));
      assert.ok(game.buildings.every(building=>building.hp<=0||
        Math.hypot(p.px-building.x-building.w/2,p.pz-building.y-building.h/2)>=5));
    }
  }
});

test('macro landmarks reveal only after their full footprint is explored',()=>{
  const game=new Game({seed:7351,mapId:'canyon-ring',mode:'skirmish'});
  const renderer=landmarkRenderer(game.mapId);
  renderer._addMacroLandmarks(game);
  renderer.fogTexture=new THREE.DataTexture(new Uint8Array(game.width*game.height),game.width,game.height);
  game.fog=game.fog.map(row=>row.map(()=>0));
  renderer._syncFog(game,true);
  assert.ok(renderer.macroLandmarkPlacements.every(p=>!p.visible));
  const p=renderer.macroLandmarkPlacements[0];
  for(let dz=0;dz<p.h;dz++)for(let dx=0;dx<p.w;dx++)game.fog[p.z+dz][p.x+dx]=1;
  renderer._syncFog(game);
  assert.equal(p.visible,true);
  const shown=new THREE.Matrix4();
  p.refs[0].mesh.getMatrixAt(p.refs[0].index,shown);
  assert.ok(shown.elements[13]>-1000,'revealed landmark should use its world transform');
  game.fog[p.z][p.x]=0;
  renderer._syncFog(game);
  assert.equal(p.visible,false);
});
