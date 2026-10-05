import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function makeRenderer() {
  const renderer=Object.create(Renderer3D.prototype);
  renderer.scene=new THREE.Scene();
  renderer.assetModels=new Map();
  renderer.relays=new Map();
  return renderer;
}

function gameWithRelay({owner='player',fogState=2,contested=false,elapsed=0,replayVersion=39}={}) {
  const relay={id:'relay-1',x:1.5,y:1.5,owner,progress:owner==='player'?1:-1,contested,protocol:'shelter'};
  const fog=Array.from({length:4},()=>Array(4).fill(fogState));
  return {relays:[relay],fog,faction:'aegis',enemyFaction:'vesper',units:[],unitDefs:{},storm:null,
    time:20,replayVersion,relayDominion:{owner,elapsed,required:60,majority:2}};
}

test('secure relays pulse in countdown faction color and strengthen with progress',()=>{
  const renderer=makeRenderer();
  const game=gameWithRelay({owner:'player',elapsed:0});
  renderer._syncRelays(game,20);
  const visual=renderer.relays.get('relay-1');
  const {capture,halo,haloUpper,beacon,capstone}=visual.userData;
  const early={ringScale:capture.scale.x,haloScale:halo.scale.x,beacon:beacon.intensity,core:capstone.material.color.getHex()};
  assert.equal(capture.material.color.getHex(),0x48d8ef,'player countdown reuses the Aegis signal hue');
  game.relayDominion.elapsed=45;
  renderer._syncRelays(game,20);
  assert.ok(capture.scale.x>early.ringScale,'the world-scale capture ring expands as the countdown advances');
  assert.ok(halo.scale.x>early.haloScale,'the existing corona grows with countdown progress');
  assert.ok(beacon.intensity>early.beacon,'the existing beacon light pulses brighter without adding lights');
  assert.ok(capstone.rotation.y>0);
  assert.ok(haloUpper.scale.x>1);
});

test('enemy countdown color is shown only for an enemy relay with full current sight',()=>{
  const renderer=makeRenderer();
  const game=gameWithRelay({owner:'enemy',elapsed:30,fogState:2});
  renderer._syncRelays(game,20);
  const visual=renderer.relays.get('relay-1');
  assert.equal(visual.userData.capture.material.color.getHex(),0xff725d,'visible Vesper countdown uses coral');
  assert.ok(visual.userData.halo.scale.x>1);
  game.fog[1][1]=1;
  renderer._syncRelays(game,21);
  assert.equal(visual.visible,true,'explored relay keeps its neutral silhouette');
  assert.equal(visual.userData.capstone.visible,false,'explored fog does not retain hidden ownership');
  assert.equal(visual.userData.halo.visible,false,'countdown signal disappears when the enemy state is no longer live');
  assert.equal(visual.userData.capture.material.color.getHex(),0xa4b1ac);
  assert.equal(visual.userData.capture.scale.x,1);
  game.fog[1][1]=0;
  renderer._syncRelays(game,22);
  assert.equal(visual.visible,false,'unexplored enemy relay remains fully hidden');
});

test('contested relays keep their capture indicator and do not receive Dominion highlighting',()=>{
  const renderer=makeRenderer();
  const game=gameWithRelay({owner:'player',contested:true,elapsed:55});
  renderer._syncRelays(game,20);
  const visual=renderer.relays.get('relay-1');
  assert.equal(visual.userData.capture.scale.x,1,'contest cancels the secure-relay scale pulse');
  assert.equal(visual.userData.beacon.intensity,1.18,'contest receives no countdown beacon boost');
  assert.ok(visual.userData.progressSegments.every(segment=>segment.visible),'existing contested capture arcs remain visible');
  assert.equal(visual.userData.progressSegments[0].material.color.getHex(),0x48d8ef);
  assert.equal(visual.userData.progressSegments[1].material.color.getHex(),0xff725d);
});

test('pre-v39 replays keep the historical relay presentation',()=>{
  const renderer=makeRenderer();
  const game=gameWithRelay({owner:'player',elapsed:55,replayVersion:38});
  renderer._syncRelays(game,20);
  const visual=renderer.relays.get('relay-1');
  assert.equal(visual.userData.capture.scale.x,1);
  assert.equal(visual.userData.beacon.intensity,1.18);
});
