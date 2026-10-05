import { Game } from '../src/game/engine.js';
import { Renderer3D } from '../src/visual/renderer3d.js';

const canvas=document.querySelector('#battlefield');
const report=document.querySelector('#report');
const q=new URLSearchParams(location.search);
const width=Number(q.get('width'))||innerWidth;
const height=Number(q.get('height'))||innerHeight;
const dpr=Math.min(devicePixelRatio||1,2);
const renderer=new Renderer3D(canvas);
renderer.resize(width,height,dpr);
renderer.setView(32,24,1);
const mapIds={shard:'shard-valley',twin:'twin-passes',delta:'delta-crossing',canyon:'canyon-ring',storm:'storm-basin'};
const composition=['lightTank','rifle','rocket','scout','flamer','artillery'];
let game;
let caseName='sparse-shard';
let quality='ultra';
let frameTimes=[];
let renderTimes=[];
let lastFrame=0;
let measuredFrames=0;
let startedAt=0;
let lastRenderStats=null;
let cameraX=32,cameraY=24,cameraZoom=1,landmarkFocused=false;

function makeCase(name) {
  caseName=name;
  const [density,terrain]=name.split('-');
  const mapId=mapIds[terrain]||mapIds.shard;
  game=new Game({seed:7351,difficulty:'normal',faction:'aegis',mode:'skirmish',mapId,victoryMode:'dominion'});
  if(density==='dense') {
    const occupied=[];
    const pick=(owner,index)=>{
      const cx=31.5+(owner==='player'?-1:1)*(2.5+Math.floor(index/6)*0.42);
      const cy=22.5-3.5+(index%6)*1.35;
      for(let radius=0;radius<=7;radius++) {
        for(let y=Math.floor(cy)-radius;y<=Math.floor(cy)+radius;y++) {
          for(let x=Math.floor(cx)-radius;x<=Math.floor(cx)+radius;x++) {
            if(radius&&Math.max(Math.abs(x-Math.floor(cx)),Math.abs(y-Math.floor(cy)))!==radius)continue;
            if(!game._isPassable(x,y))continue;
            const point={x:x+0.5,y:y+0.5};
            if(occupied.some(other=>Math.hypot(point.x-other.x,point.y-other.y)<0.8))continue;
            occupied.push(point);return point;
          }
        }
      }
      return {x:cx,y:cy};
    };
    for(const owner of ['player','enemy'])for(let i=0;i<24;i++) {
      const point=pick(owner,i);
      game._createUnit(owner,composition[i%composition.length],point.x,point.y);
    }
    // A visible battle is needed to compare the maps' terrain and visual load.
  }
  if(density==='dense'||density==='landmark') game.fog=game.fog.map(row=>row.map(()=>2));
  game.storm.phase=density==='landmark'?'calm':'surge';
  game.storm.x=31.5;game.storm.y=22.5;game.storm.radius=7.5;
  frameTimes=[];renderTimes=[];measuredFrames=0;lastFrame=0;startedAt=0;
  cameraX=32;cameraY=24;cameraZoom=1;landmarkFocused=false;
  report.textContent=`Loading ${name} · ${quality} · ${width}×${height} CSS px · DPR ${dpr}…`;
}

function percentile(values,p) {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return +sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(3);
}

function frame(now) {
  if(!startedAt)startedAt=now;
  if(game) {
    const begin=performance.now();
    renderer.render(game,{centerX:cameraX,centerY:cameraY,zoom:cameraZoom,time:now/1000});
    if(caseName.startsWith('landmark-')&&!landmarkFocused&&renderer.macroLandmarkPlacements.length) {
      const landmark=renderer.macroLandmarkPlacements[0];
      cameraX=landmark.px;cameraY=landmark.pz;cameraZoom=1.45;
      landmarkFocused=true;
    }
    renderTimes.push(performance.now()-begin);
    if(now-startedAt>1200) {
      if(lastFrame)frameTimes.push(now-lastFrame);
      measuredFrames++;
      lastRenderStats={...renderer.renderer.info.render,memory:{...renderer.renderer.info.memory},dpr:renderer.dpr,
        canvas:[canvas.width,canvas.height],units:game.units.length,buildings:game.buildings.length,
        features:game.terrain.flat().reduce((out,tile)=>(out[tile.type]=(out[tile.type]||0)+1,out),{})};
      if(measuredFrames===240) {
        report.textContent=JSON.stringify({case:caseName,quality,viewport:{width,height,dpr},sampleFrames:measuredFrames,
          draw: lastRenderStats,
          renderMs:{p50:percentile(renderTimes.slice(-240),0.5),p95:percentile(renderTimes.slice(-240),0.95),p99:percentile(renderTimes.slice(-240),0.99)},
          rafMs:{p50:percentile(frameTimes,0.5),p95:percentile(frameTimes,0.95),p99:percentile(frameTimes,0.99)},
        },null,2);
      }
    }
    lastFrame=now;
  }
  requestAnimationFrame(frame);
}

document.querySelector('#controls').addEventListener('click',event=>{
  const caseButton=event.target.closest('[data-case]');
  if(caseButton)makeCase(caseButton.dataset.case);
  const qualityButton=event.target.closest('[data-quality]');
  if(qualityButton) {
    quality=qualityButton.dataset.quality;renderer.setGraphicsQuality(quality);
    if(game)makeCase(caseName);
  }
});

renderer.assetsReady.then(()=>{makeCase('sparse-shard');requestAnimationFrame(frame);});

window.addEventListener('resize',()=>{
  renderer.resize(innerWidth,innerHeight,dpr);
});
