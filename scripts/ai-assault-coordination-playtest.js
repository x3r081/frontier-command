// Controlled defended-route comparison; this is not a normal-match balance benchmark.
// After setup, normal AI wave selection and the 30 Hz update drive both runs.
import {Game} from '../src/game/engine.js';
const dt=1/30;
function run(replayVersion){
 const g=new Game({seed:303,difficulty:'normal',faction:'aegis',victoryMode:'elimination',replayVersion});
 g.units=[];g.buildings=[];g.relays=[];g.credits.enemy=0;
 for(const row of g.terrain)for(const t of row)Object.assign(t,{type:'sand',resource:0,elevation:0,walkable:true,buildable:true});
 const target=g._createBuilding('player','command',12,25,1);
 g._createBuilding('player','power',8,22,1);
 const tower=g._createBuilding('player','turret',20,26,1);
 g._createBuilding('enemy','command',54,6,1);
 const force=['artillery','rocket','lightTank','buggy'].map((id,i)=>g._createUnit('enemy',id,44.5,25.5+i));
 g.scans.push({owner:'enemy',x:16,y:27,radius:12,until:90});g._refreshPower();g._updateFog();
 if(!g._launchAiWave())throw Error('no wave');
 const assignments=force.map(u=>({type:u.order.type,target:g.getEntity(u.order.targetId)?.defId}));
 let release=null;const crossing=new Map();const coordinated=force.some(u=>u.order.aiMarchPace>0);
 while(g.time<40&&g.status==='playing'){
  g.update(dt);
  if(coordinated&&release===null&&force.every(u=>!u.order.aiMarchPace))release=+g.time.toFixed(2);
  for(const u of force)if(!crossing.has(u.id)&&u.x<=30)crossing.set(u.id,+g.time.toFixed(2));
 }
 return {replayVersion,coordinated,time:+g.time.toFixed(2),release,assignments,status:g.status,targetHP:Math.max(0,Math.round(target.hp)),towerHP:Math.max(0,Math.round(tower.hp)),units:force.map(u=>({type:u.defId,hp:Math.max(0,Math.round(u.hp)),crossing:crossing.get(u.id),x:+u.x.toFixed(1)}))};
}
console.log(JSON.stringify(run(64)));console.log(JSON.stringify(run(65)));
