import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Game} from '../src/game/engine.js';
import {Renderer3D} from '../src/visual/renderer3d.js';

function scene() {
  const game=new Game({seed:77});
  game.units=[];
  game.buildings=[];
  for(const row of game.fog)row.fill(2);
  const renderer=Object.create(Renderer3D.prototype);
  Object.assign(renderer,{scene:new THREE.Scene(),entities:new Map(),quality:'balanced',
    centerX:20,centerY:20,groundContactBatch:null,groundContactEntries:[],groundContactPool:[],
    visualHeightUniforms:{},groundReliefMaterials:[]});
  const add=(owner,type,x,z)=>{
    const unit=game._createUnit(owner,type,x,z);
    const group=new THREE.Group();
    renderer.entities.set(unit.id,{group,building:false});
    return unit;
  };
  return {game,renderer,add};
}

test('ground contacts follow the visible living ground roster, including fog changes',()=>{
  const {game,renderer,add}=scene();
  const rifle=add('player','rifle',20.5,20.5);
  const enemy=add('enemy','rocket',23.5,20.5);
  add('player','orca',21.5,20.5);
  const passenger=add('player','rifle',20.5,21.5);passenger.embarkedIn='u999';
  const lost=add('player','rifle',20.5,22.5);lost.hp=0;
  const absent=add('player','rifle',20.5,23.5);renderer.entities.delete(absent.id);
  renderer._syncGroundContacts(game);
  assert.deepEqual(renderer.groundContactEntries.map(entry=>entry.id),[rifle.id,enemy.id]);
  assert.equal(renderer.groundContactBatch.mesh.count,2);
  game.fog[20][23]=1;
  renderer._syncGroundContacts(game);
  assert.deepEqual(renderer.groundContactEntries.map(entry=>entry.id),[rifle.id]);
  assert.equal(renderer.groundContactBatch.mesh.count,1,'explored fog retains no enemy contact');
  game.fog[20][23]=0;
  rifle.embarkedIn='u999';
  renderer._syncGroundContacts(game);
  assert.equal(renderer.groundContactBatch.mesh.count,0);
  assert.equal(renderer.groundContactBatch.mesh.visible,false);
  renderer._clearGroundContacts();
  assert.equal(renderer.scene.children.length,0);
});

test('Eco contact budget keeps the nearest rendered units and releases map-owned resources',()=>{
  const {game,renderer,add}=scene();
  renderer.quality='eco';
  for(let i=0;i<110;i++)add('player','rifle',20+(i%10)*.1,20+Math.floor(i/10)*.1);
  const nearest=game.units[0];
  game.units.reverse();
  renderer._syncGroundContacts(game);
  assert.equal(renderer.groundContactBatch.mesh.count,96);
  assert.equal(renderer.groundContactEntries[0].id,nearest.id);
  let disposed=0;
  renderer.groundContactBatch.mesh.geometry.addEventListener('dispose',()=>disposed++);
  renderer._clearGroundContacts();
  renderer._clearGroundContacts();
  assert.equal(disposed,1);
  assert.equal(renderer.groundContactBatch,null);
  assert.equal(renderer.groundContactEntries.length,0);
  assert.equal(renderer.scene.children.length,0);
});
