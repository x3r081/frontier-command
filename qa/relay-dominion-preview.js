import { Game } from '../src/game/engine.js';
import { Renderer3D } from '../src/visual/renderer3d.js';

const canvas=document.querySelector('#battlefield');
const status=document.querySelector('#status');
const errorBox=document.querySelector('#error');
const ownerControl=document.querySelector('#owner');
const fogControl=document.querySelector('#fog');
const contestedControl=document.querySelector('#contested');
let renderer;
let frame=0;

function showError(error) {
  errorBox.hidden=false;
  errorBox.textContent=`Renderer initialization failed\n${error?.message||error}`;
  status.textContent='Preview unavailable.';
}

try {
  const game=new Game({seed:54898,difficulty:'normal',faction:'aegis',mode:'skirmish',mapId:'shard-valley'});
  // Keep the real generated terrain, game state, and renderer, but remove
  // armies and bases so the preview contains no unrelated or hidden units.
  game.units=[];
  game.buildings=[];
  game.time=game.relayDominion.required*.75;

  const center={x:game.width/2,y:game.height/2};
  const focusRelays=game.relays.slice(0,2);
  focusRelays[0].x=center.x;
  focusRelays[0].y=center.y;
  focusRelays[1].x=center.x+5.2;
  focusRelays[1].y=center.y;
  for(const relay of game.relays.slice(2)) {
    relay.owner=null;
    relay.progress=0;
    relay.contested=false;
  }
  game.relayDominion={...game.relayDominion,owner:'player',elapsed:game.relayDominion.required*.75,majority:2};

  renderer=new Renderer3D(canvas);
  renderer.setGraphicsQuality('balanced');

  function updateScenario() {
    const owner=ownerControl.value;
    const fogState=Number(fogControl.value);
    const contested=contestedControl.checked;
    for(let i=0;i<focusRelays.length;i++) {
      const relay=focusRelays[i];
      relay.owner=owner;
      relay.progress=owner==='player'?1:-1;
      relay.contested=i===0&&contested;
      relay.protocol='shelter';
    }
    game.relayDominion.owner=owner;
    game.relayDominion.elapsed=game.relayDominion.required*.75;
    // Keep the field revealed except for a compact patch around these public
    // test objectives; this isolates the selected fog state in the renderer.
    for(const row of game.fog) row.fill(2);
    for(const relay of focusRelays) {
      const cx=Math.floor(relay.x),cy=Math.floor(relay.y);
      for(let y=Math.max(0,cy-3);y<=Math.min(game.height-1,cy+3);y++)
        for(let x=Math.max(0,cx-3);x<=Math.min(game.width-1,cx+3);x++)
          game.fog[y][x]=fogState;
    }
    status.innerHTML=`<strong>${owner==='player'?'Player':'Enemy'} countdown</strong> · 75% · `+
      `${contested?'central relay contested':'both secure relays'} · `+
      `${['unexplored','explored','visible'][fogState]}`;
  }

  ownerControl.addEventListener('change',updateScenario);
  fogControl.addEventListener('change',updateScenario);
  contestedControl.addEventListener('change',updateScenario);
  updateScenario();

  const resizeObserver=new ResizeObserver(()=>{
    renderer.resize(canvas.clientWidth,canvas.clientHeight,window.devicePixelRatio||1);
  });
  resizeObserver.observe(canvas.parentElement);
  window.addEventListener('beforeunload',()=>{
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    renderer?.dispose();
  },{once:true});

  await renderer.assetsReady;
  function draw(now) {
    try {
      renderer.render(game,{centerX:center.x+2.3,centerY:center.y,zoom:1.15,time:now/1000});
      frame=requestAnimationFrame(draw);
    } catch(error) {
      cancelAnimationFrame(frame);
      showError(error);
    }
  }
  status.innerHTML='<strong>Player countdown</strong> · 75% · both secure relays · visible';
  frame=requestAnimationFrame(draw);
} catch(error) {
  showError(error);
}
