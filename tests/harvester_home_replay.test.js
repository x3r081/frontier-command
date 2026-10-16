import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game/engine.js';
import {SoloClock,SOLO_STEP_SECONDS} from '../src/game/soloClock.js';
import {createSoloRecorder,createSoloPlayback,validateSoloReplay} from '../src/game/replay.js';

const envelope={mode:'skirmish',difficulty:'easy',faction:'aegis',seed:24,
  scenarioId:'shard-valley',victoryMode:'elimination'};

test('paid refinery construction, home changes, cargo return and Auto Dock replay exactly',()=>{
  const game=new Game({...envelope,mapId:envelope.scenarioId,replayVersion:77});
  const clock=new SoloClock();
  const recorder=createSoloRecorder(game,clock);
  const advance=ticks=>{
    for(let i=0;i<ticks;i++){game.update(SOLO_STEP_SECONDS);clock.completedTicks++;}
  };
  const harvester=game.units.find(unit=>unit.owner==='player'&&unit.defId==='harvester');
  const startingRefinery=game.buildings.find(building=>building.owner==='player'&&building.defId==='refinery');
  game.select(harvester.id);
  assert.equal(game.issueAssignRefinery(startingRefinery.id).ok,true);
  assert.equal(game.startConstruction('refinery').ok,true);
  while(!game.construction.ready)advance(1);
  let site=null;
  for(let y=30;y<45&&!site;y++)for(let x=2;x<25;x++)
    if(game.canPlaceBuilding('refinery',x,y).ok){site={x,y};break;}
  assert.ok(site,'a revealed legal expansion footprint is available');
  const built=game.issueBuild('refinery',site.x,site.y);
  assert.equal(built.ok,true);
  game.select(harvester.id);
  assert.equal(game.issueAssignRefinery(built.id).ok,true);
  advance(30*8);
  if(harvester.cargo>0)assert.equal(game.issueReturnCargo().ok,true);
  advance(30*5);
  assert.equal(game.issueAssignRefinery(null).ok,true);
  advance(30*2);
  recorder.dispose();
  assert.equal(validateSoloReplay(envelope,recorder.commands,clock.completedTicks,77),true);
  const playback=createSoloPlayback(envelope,recorder.commands,clock.completedTicks,77);
  playback.step(clock.completedTicks);
  const state=value=>({units:value.units,buildings:value.buildings,credits:value.credits,
    terrain:value.terrain,time:value.time,status:value.status,effects:value.effects});
  assert.deepEqual(state(playback.game),state(game));
});

test('legacy and malformed home-refinery replay commands are rejected',()=>{
  const command={tick:0,sequence:0,method:'issueAssignRefinery',args:['b1'],selectedIds:[]};
  assert.throws(()=>createSoloPlayback(envelope,[command],1,76),/home refinery assignments require replay version 77/i);
  for(const args of [[1],['b0'],['b1','b2'],[{}]])
    assert.throws(()=>validateSoloReplay(envelope,[{...command,args}],1,77),/invalid solo command/i);
  for(const args of [[],[null]])assert.equal(validateSoloReplay(envelope,[{...command,args}],1,77),true);
});
