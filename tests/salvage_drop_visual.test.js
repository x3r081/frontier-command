import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function renderer(quality='eco') {
  const result=Object.create(Renderer3D.prototype);
  result.scene=new THREE.Scene();
  result.quality=quality;
  result.assetModels=new Map();
  result.assetVersions=new Map();
  result.salvageDropVisual=null;
  result.salvageDropModelVersion=0;
  return result;
}

test('public salvage drop telegraph remains visible through unexplored fog without consulting hidden units',()=>{
  const view=renderer('eco');
  const game={time:10,faction:'aegis',fog:[[0]],units:[{owner:'enemy',x:90,y:90,privateOrder:'attack'}],
    salvageDrop:{phase:'incoming',x:4.5,y:6.5,warningAt:8,landsAt:14,expiresAt:40,captureOwner:null,captureProgress:0}};
  view._syncSalvageDrop(game,10);
  const visual=view.salvageDropVisual;
  assert.ok(visual?.visible,'public location telegraph should not be hidden by unexplored fog');
  assert.deepEqual(visual.position.toArray(),[4.5,0,6.5]);
  assert.equal(visual.userData.marker.visible,true);
  assert.equal(visual.userData.pod.visible,true);
  assert.equal(visual.userData.light,null,'Eco quality omits the per-drop point light');
  assert.equal(visual.userData.ring.renderOrder,12,'the public reticle draws over the fog veil');
  assert.equal(visual.userData.ring.material.depthTest,false,'the reticle is not hidden behind the fog plane');
  assert.equal(visual.userData.beacon.renderOrder,13,'the beacon core draws above the fog veil');
  assert.equal(visual.userData.beacon.material.depthTest,false);
  assert.equal(game.units[0].x,90,'rendering does not inspect or mutate enemy unit state');
});

test('active salvage capture cue maps five seconds to a full progress arc and respects capture owner',()=>{
  const view=renderer('balanced');
  const game={time:20,faction:'aegis',salvageDrop:{phase:'active',x:2,y:3,landsAt:18,expiresAt:50,captureOwner:'enemy',captureProgress:2.5}};
  view._syncSalvageDrop(game,20);
  const {ring,contestRing,progress,marker}=view.salvageDropVisual.userData;
  assert.equal(marker.visible,false);
  assert.equal(contestRing.visible,false);
  assert.equal(ring.material.depthTest,false,'the active public site remains readable through shroud');
  assert.equal(ring.material.opacity,.5);
  assert.equal(ring.material.color.getHex(),0xff806b);
  assert.equal(progress.material.color.getHex(),0xff806b);
  assert.equal(progress.geometry.drawRange.count,192);
  game.salvageDrop.captureOwner='player';game.salvageDrop.captureProgress=5;
  view._syncSalvageDrop(game,20.1);
  assert.equal(progress.material.color.getHex(),0x66e8d6);
  assert.equal(progress.geometry.drawRange.count,384);
  game.salvageDrop.contested=true;
  view._syncSalvageDrop(game,20.1);
  assert.equal(contestRing.visible,true,'public contest flag activates its separate outer signal');
  assert.ok([0x66e8d6,0xff806b].includes(contestRing.material.color.getHex()));
  assert.equal(contestRing.renderOrder,13);
  assert.equal(contestRing.material.depthTest,false,'contest signal remains above unexplored fog');
  game.salvageDrop.phase='claimed';
  view._syncSalvageDrop(game,20.2);
  assert.equal(contestRing.visible,false,'terminal drops do not retain a contest signal');
});

test('claimed and expired phases preserve a terminal marker while hiding the capsule',()=>{
  const view=renderer();
  const game={time:10,faction:'aegis',salvageDrop:{phase:'claimed',x:2,y:3,landsAt:4,expiresAt:8,captureOwner:'player',captureProgress:5}};
  view._syncSalvageDrop(game,10);
  assert.equal(view.salvageDropVisual.userData.pod.visible,false);
  assert.equal(view.salvageDropVisual.userData.ring.material.color.getHex(),0x66e8d6);
  game.salvageDrop.phase='expired';
  view._syncSalvageDrop(game,10.1);
  assert.equal(view.salvageDropVisual.userData.ring.material.color.getHex(),0x879392);
  game.salvageDrop=null;
  view._syncSalvageDrop(game,10.2);
  assert.equal(view.salvageDropVisual,null);
});
