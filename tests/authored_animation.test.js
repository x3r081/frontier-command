import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Renderer3D,compactAuthoredModel,projectileYaw} from '../src/visual/renderer3d.js';

test('projectile trail stays behind the shot at every heading',()=>{
  const up=new THREE.Vector3(0,1,0);
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    const yaw=projectileYaw(4,7,4+dx,7+dy);
    const nose=new THREE.Vector3(0,0,-1).applyAxisAngle(up,yaw);
    const direction=new THREE.Vector3(dx,0,dy).normalize();
    assert.ok(nose.distanceTo(direction)<1e-10,`shot heading ${dx},${dy} must face its target`);
  }
});

test('impact shards keep a readable shape without increasing their count',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  renderer.quality='balanced';
  renderer.effectGroup=new THREE.Group();
  renderer.effects=new Map();
  renderer.entities=new Map();
  renderer.camera=new THREE.PerspectiveCamera();
  renderer.centerX=renderer.centerY=0;
  renderer.scorches=new Map();
  renderer._effectSmokeMap=()=>null;
  renderer._addScorch=()=>{};
  const impact={id:'impact-1',type:'impact',radius:0.7,ttl:1,maxTtl:1,x:0,y:0,owner:'player'};
  const game={time:1,effects:[impact],isVisible:()=>true};
  renderer._syncEffects(game,1);
  const effect=renderer.effects.get('impact-1');
  const shards=[];
  effect.traverse(node=>{if(node.userData.spark) shards.push(node);});
  assert.equal(shards.length,6,'impact keeps a fixed six-shard budget');
  assert.ok(shards.every(shard=>shard.geometry.parameters.depth===0.42),
    'shards should be long enough to read as fragments at tactical zoom');
  const initialHeight=shards[0].position.y;
  impact.ttl=0.4;
  game.time=1.6;
  renderer._syncEffects(game,1.6);
  assert.ok(shards[0].position.y>initialHeight+0.3,'impact shards should rise as the effect ages');
});

test('projectile wake grows from launch point and fades with the shot',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  renderer.quality='balanced';
  renderer.effectGroup=new THREE.Group();
  renderer.effects=new Map();
  renderer.entities=new Map();
  renderer.camera=new THREE.PerspectiveCamera();
  renderer.centerX=renderer.centerY=0;
  renderer.scorches=new Map();
  renderer._effectSmokeMap=()=>null;
  const shot={id:'shot-1',type:'projectile',damageType:'cannon',radius:0.2,ttl:1,maxTtl:1,
    x:0,y:0,launchX:0,launchY:0,tx:8,ty:0,owner:'player'};
  const game={time:1,effects:[shot],isVisible:()=>true};
  renderer._syncEffects(game,1);
  const effect=renderer.effects.get('shot-1');
  const wake=effect.userData.projectileWake;
  assert.ok(wake?.isLine,'balanced quality should add one lightweight wake line');
  const positions=wake.geometry.attributes.position;
  shot.ttl=0.5;
  shot.x=4;
  game.time=1.5;
  renderer._syncEffects(game,1.5);
  assert.equal(effect.userData.projectileProgress,0.5);
  assert.ok(positions.getX(0)<-3.9,'wake source should remain at the launch point');
  assert.equal(positions.count,9,'wake should use a fixed, small segment budget');
  assert.ok(Math.abs(positions.getY(8)-0.3)<1e-5,'wake should meet the projectile center');
  assert.ok(wake.material.opacity>0,'wake should remain visible while the projectile flies');

  renderer.quality='eco';
  const eco=renderer._makeEffect({...shot,id:'eco-shot'});
  assert.equal(eco.userData.projectileWake,undefined,'eco quality should not allocate the wake');

  renderer.quality='balanced';
  const enemyShot={...shot,id:'enemy-shot',owner:'enemy',sourceId:'hidden-gun',ttl:0.8};
  const enemyGame={time:2,effects:[enemyShot],getEntity:()=>({owner:'enemy'}),
    isVisible:entity=>entity.type==='projectile'};
  renderer._syncEffects(enemyGame,2);
  assert.equal(renderer.effects.get('enemy-shot').userData.projectileWake.visible,false,
    'a visible shot cannot reveal an unseen enemy muzzle through its wake');
  enemyGame.isVisible=()=>true;
  renderer._syncEffects(enemyGame,2.1);
  assert.equal(renderer.effects.get('enemy-shot').userData.projectileWake.visible,true,
    'the wake appears after the enemy firing position is actually visible');
});

async function authoredAnimation(defId,file,building=false,faction='aegis') {
  const bytes=await readFile(new URL(`../public/assets/models/${file}`,import.meta.url));
  const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(payload,'',resolve,reject));
  const group=new THREE.Group();
  group.userData.authoredVisual=gltf.scene;
  group.add(gltf.scene);
  const renderer=Object.create(Renderer3D.prototype);
  const entity={id:'u1',defId,faction,x:0,y:0,...(building?{w:2,h:2}:{})};
  const animation=renderer._prepareAnimation(group,entity);
  return {renderer,group,entity,animation};
}

test('static model batching keeps animated arms and Command Rig wheels visible',async()=>{
  for(const [key,defId,file,movingCount] of [
    ['rifle','rifle','rifle-infantry.glb',4],
    ['scoutVesper','scout','vesper-scout.glb',4],
    ['mcv','mcv','mcv.glb',8],
  ]) {
    const bytes=await readFile(new URL(`../public/assets/models/${file}`,import.meta.url));
    const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(payload,'',resolve,reject));
    const visibleCount=()=>{
      let count=0;
      gltf.scene.traverse(part=>{if(part.isMesh&&part.visible)count++;});
      return count;
    };
    const before=visibleCount();
    assert.equal(compactAuthoredModel(gltf.scene,key),true);
    assert.ok(visibleCount()<before/2,`${key} static parts should render in fewer batches`);
    const group=new THREE.Group();
    group.userData.authoredVisual=gltf.scene;
    group.add(gltf.scene);
    const renderer=Object.create(Renderer3D.prototype);
    const animation=renderer._prepareAnimation(group,{id:'u1',defId,x:0,y:0});
    if(defId==='mcv') {
      assert.ok(animation.wheels.length>=movingCount);
      assert.ok(animation.wheels.every(wheel=>wheel.part.visible));
    } else {
      assert.equal(animation.arms.length,movingCount);
      assert.ok(animation.arms.every(arm=>arm.part.visible));
    }
  }
});

test('authored GLB animation nodes resolve after glTF name sanitization',async()=>{
  const striker=await authoredAnimation('lightTank','striker-tank.glb');
  assert.equal(striker.animation.pivot?.children[0]?.name,'Rotating_turret_assembly');
  assert.equal(striker.animation.wheels.length,0,'joined wheel hubs must not orbit as one mesh');

  const radar=await authoredAnimation('radar','radar-array.glb',true);
  assert.ok(radar.animation.pivot,'radar dish should have a moving pivot');
  assert.ok(radar.animation.lights.length>0,'radar emissive cues should be found');

  const defense=await authoredAnimation('turret','defense-turret.glb',true);
  assert.ok(defense.animation.pivot,'defense gun should have a moving pivot');
  assert.ok(defense.animation.pivot.getObjectByName('Rotating_gun_assembly'),
    'the upgraded emplacement keeps all traversing equipment on one aimable assembly');
  assert.ok(defense.animation.pivot.getObjectByName('Targeting_optic'),
    'the targeting lens follows the gun while retaining its operating light');
  assert.ok(defense.animation.lights.length>0,'the optic retains its active/idle pulse');
  assert.equal(defense.animation.muzzleSocket.position.z,-1.125,
    'the muzzle socket sits at the authored twin barrel tips');

  const workshop=await authoredAnimation('serviceBay','service-bay.glb',true);
  assert.ok(workshop.animation.gantry,'workshop gantry should be found');

  const dropship=await authoredAnimation('dropship','dropship.glb');
  assert.ok(dropship.animation.frontFan&&dropship.animation.rearFan,'both lift fans should have pivots');

  const harvester=await authoredAnimation('harvester','harvester.glb');
  assert.equal(harvester.animation.cargo.length,1,'joined cargo shard mesh should be found');

  const mcv=await authoredAnimation('mcv','mcv.glb');
  assert.ok(mcv.animation.wheels.length>=8,'separate MCV wheels should animate');
});

test('both Command Yard faction cranes resolve and sweep while operational',async()=>{
  for(const [faction,file,nodeName] of [
    ['aegis','command-yard.glb','Aegis_construction_jib'],
    ['vesper','vesper-command-yard.glb','Vesper_salvage_signal_arm'],
  ]) {
    const {renderer,group,entity,animation}=await authoredAnimation('command',file,true,faction);
    assert.equal(animation.commandGantry?.name,nodeName,`${faction} crane node should survive GLB export`);
    const state={group,animation,building:true};
    renderer._animateEntity(state,{...entity,progress:1,powered:true},{},1);
    const first=animation.commandGantry.rotation.y;
    renderer._animateEntity(state,{...entity,progress:1,powered:true},{},2);
    assert.notEqual(animation.commandGantry.rotation.y,first,`${faction} crane should sweep when powered`);
  }
});

test('Striker turret tracks a visible projectile and recoils',async()=>{
  const {renderer,group,entity,animation}=await authoredAnimation('lightTank','striker-tank.glb');
  const state={group,animation,building:false};
  group.rotation.y=-Math.PI/2;
  renderer._animateEntity(state,entity,{effects:[{type:'projectile',sourceId:'u1',tx:0,ty:5}]},1);
  assert.ok(Math.abs(animation.pivot.rotation.y)>0.1,'turret should turn toward the shot');
  assert.ok(animation.pivot.position.z>-0.035,'gun assembly should recoil');
});

test('Brace and Ghost Run get transient battlefield cues from live ability clocks',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  const material=new THREE.MeshStandardMaterial();
  const visual=new THREE.Group();
  visual.userData.motionLegs=[];
  visual.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material));
  const group=new THREE.Group();
  group.add(visual);group.userData.authoredVisual=visual;
  const animation={phase:0};
  const state={group,animation,building:false};
  const game={time:10};
  renderer._syncUnitAbilityVisuals(state,{defId:'guardian',faction:'aegis',braceUntil:17},game,1);
  assert.equal(animation.braceCue.visible,true);
  game.time=17;
  renderer._syncUnitAbilityVisuals(state,{defId:'guardian',faction:'aegis',braceUntil:17},game,2);
  assert.equal(animation.braceCue.visible,false,'Brace cue ends with the authoritative ability clock');

  game.time=10;
  renderer._syncUnitAbilityVisuals(state,{defId:'stealthTank',faction:'vesper',ghostRunUntil:16},game,3);
  assert.equal(animation.ghostRunCue.visible,true);
  assert.equal(material.transparent,true);
  assert.ok(material.opacity<1,'Ghost Run phases the unit silhouette');
  game.time=16;
  renderer._syncUnitAbilityVisuals(state,{defId:'stealthTank',faction:'vesper',ghostRunUntil:16},game,4);
  assert.equal(animation.ghostRunCue.visible,false);
  assert.equal(material.transparent,false,'the original material state is restored when Ghost Run expires');
  assert.equal(material.opacity,1);
});

test('authored infantry arm nodes resolve and make restrained gait and firing motions',async()=>{
  for (const [defId,file] of [
    ['rifle','rifle-infantry.glb'],
    ['rocket','rocket-infantry.glb'],
    ['engineer','engineer.glb'],
  ]) {
    const {renderer,group,entity,animation}=await authoredAnimation(defId,file);
    assert.equal(animation.arms.length,4,`${defId} should expose two upper arms and two forearms`);
    assert.deepEqual(animation.arms.map(arm=>arm.part.name).sort(),
      ['ArmL_forearm','ArmL_upper','ArmR_forearm','ArmR_upper']);

    const state={group,animation,building:false};
    const rightUpper=animation.arms.find(arm=>arm.side>0&&arm.segment==='upper');
    const idlePose=rightUpper.pose.clone();
    animation.motion=1;
    animation.travel=Math.PI/2;
    renderer._animateEntity(state,entity,{effects:[]},1);
    assert.ok(Math.abs(rightUpper.part.rotation.x-idlePose.x)>0.05,
      `${defId} arm should swing with the walking cycle`);

    animation.motion=0;
    renderer._animateEntity(state,entity,{effects:[{
      id:`${defId}-shot`,type:'projectile',sourceId:entity.id,
    }]},2);
    assert.ok(Math.abs(rightUpper.part.rotation.x-idlePose.x)>0.05,
      `${defId} arm should recoil when its projectile appears`);

    renderer._animateEntity(state,entity,{effects:[]},3);
    assert.ok(Math.abs(rightUpper.part.rotation.x-idlePose.x)<1e-4,
      `${defId} arm should settle back to its authored idle pose`);
  }
});
