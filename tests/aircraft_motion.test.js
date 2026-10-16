import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Renderer3D} from '../src/visual/renderer3d.js';

function motionState(defId) {
  const visual=new THREE.Group();
  visual.rotation.set(0.025,0,-0.018);
  const group=new THREE.Group();
  group.userData.authoredVisual=visual;
  group.add(visual);
  return {group,defId,animation:{motion:0,travel:0,phase:0,wheels:[],flying:['orca','apache','dropship'].includes(defId)}};
}

function turnBankAtFrameRate(fps) {
  const renderer=Object.create(Renderer3D.prototype);
  const state=motionState('orca');
  const dt=1/fps;
  renderer._animateMotion(state,0,0,0,1);
  renderer._animateMotion(state,0.1,0.1,0,1+dt);
  renderer._animateMotion(state,0.1,0,0.1,1+2*dt);
  return {renderer,state,dt};
}

function sustainedPitchAtRenderRate(fps) {
  const renderer=Object.create(Renderer3D.prototype);
  const state=motionState('orca');
  renderer._animateMotion(state,0,0,0,1);
  let previousX=0;
  const simHz=30,simSpeed=2.5,seconds=0.8;
  for(let frame=1;frame<=Math.round(fps*seconds);frame++) {
    const tick=Math.floor(frame*simHz/fps+1e-9);
    const x=tick*simSpeed/simHz;
    const dx=x-previousX;
    previousX=x;
    renderer._animateMotion(state,Math.abs(dx),dx,0,1+frame/fps);
  }
  return state.animation.flightPitch;
}

test('Kestrel and Wraith bank into travel turns with frame-rate-stable decay',()=>{
  const at30=turnBankAtFrameRate(30);
  const at120=turnBankAtFrameRate(120);
  const bank30=at30.state.animation.flightBank;
  const bank120=at120.state.animation.flightBank;
  assert.ok(bank30 < -0.12 && bank120 < -0.12,
    'a positive-X to positive-Z path turn should create a visible bank');
  assert.ok(Math.abs(bank30-bank120)<0.03,'the turn impulse should not depend on render FPS');

  const retained=turnBankAtFrameRate(120);
  retained.renderer._animateMotion(retained.state,0,0,0,1+3*retained.dt);
  retained.renderer._animateMotion(retained.state,0.1,0.1,0,1+4*retained.dt);
  assert.ok(retained.state.animation.flightBank>0.12,
    'a simulation turn after intervening stationary render frames should use the prior travel direction');

  for(const defId of ['orca','apache']) {
    const {renderer,state,dt}=turnBankAtFrameRate(120);
    state.defId=defId;
    const baseZ=state.animation.flightBaseRotationZ;
    const heldBank=state.animation.flightBank;
    const heldTime=state.animation.lastFlightMotionTime;
    assert.ok(Math.abs(state.group.userData.authoredVisual.rotation.z-baseZ)>0.12);
    renderer._animateMotion(state,0,0,0,heldTime);
    assert.equal(state.animation.flightBank,heldBank,'a held frame should preserve the current bank');
    renderer._animateMotion(state,0,0,0.0001,heldTime+dt);
    assert.ok(Math.abs(state.animation.flightBank)>0.12,
      'a zero-displacement render between simulation steps should preserve travel direction');
    for(let i=1;i<=48;i++) renderer._animateMotion(state,0,0,0,1+2*dt+i*dt);
    assert.ok(Math.abs(state.animation.flightBank)<Math.abs(heldBank) && Math.abs(state.animation.flightBank)<0.04,
      `${defId} should settle close to level after stopping`);
    assert.ok(Math.abs(state.group.userData.authoredVisual.rotation.z-baseZ)<0.04);
  }
});

test('sustained aircraft pitch stays consistent when 30Hz motion renders at 30Hz or 120Hz',()=>{
  const pitch30=sustainedPitchAtRenderRate(30);
  const pitch120=sustainedPitchAtRenderRate(120);
  assert.ok(pitch30 < -0.025 && pitch120 < -0.025,'sustained travel should retain a visible nose-down pitch');
  assert.ok(Math.abs(pitch30-pitch120)<0.006,
    `pitch should be stable across render rates (30Hz ${pitch30}, 120Hz ${pitch120})`);
});

test('idle facing changes, replay jumps, ground units, and Dropship do not gain aircraft bank',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  renderer.tmpWheelQuat=new THREE.Quaternion();
  renderer.wheelAxis=new THREE.Vector3(1,0,0);
  const aircraft=motionState('apache');
  renderer._animateMotion(aircraft,0,0,0,1);
  renderer._animateMotion(aircraft,0,0,0,1.1);
  assert.equal(aircraft.animation.flightBank,0,'turning without movement must remain level');

  renderer._animateMotion(aircraft,2,2,0,1.2);
  assert.equal(aircraft.animation.flightBank,0,'a replay position jump must clear the bank');
  renderer._animateMotion(aircraft,0,0,0,0.9);
  assert.equal(aircraft.animation.flightBank,0,'a backward replay seek must clear the bank');

  for(const defId of ['lightTank','dropship']) {
    const state=motionState(defId);
    const before=state.group.userData.authoredVisual.rotation.clone();
    renderer._animateMotion(state,0.1,0,0.1,1);
    renderer._animateMotion(state,0.1,0.1,0,1.1);
    if(defId==='dropship') {
      assert.deepEqual(state.group.userData.authoredVisual.rotation.toArray(),before.toArray(),
        'Dropship pose should remain untouched by Kestrel/Wraith flight lean');
      assert.equal(state.animation.flightBank,undefined);
    } else {
      assert.equal(state.animation.flightBank,undefined,'ground motion should not gain aircraft state');
      assert.ok(state.animation.motion>0,'ground units should keep the existing speed-driven suspension path');
    }
  }
});
