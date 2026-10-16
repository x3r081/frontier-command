// Public-order artillery deployment, scan spotting, contact and release in Dawnfall.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';
import { SIEGE_ANCHOR_RULES_VERSION } from '../src/game/engine.js';
import { createSoloRecorder, createSoloPlayback } from '../src/game/replay.js';

export function runSiegeAnchorDawnfallPlaytest() {
  const version=SIEGE_ANCHOR_RULES_VERSION;
  const envelope={mode:'campaign',scenarioId:'dawnfall',difficulty:'normal',faction:'aegis',seed:941};
  const game=createCampaignGame(6,'normal',941,'standard','none','none','none','none',null,version);
  game.replayVersion=version;
  const clock={completedTicks:0}, recorder=createSoloRecorder(game,clock), checkpoints={};
  const crawler=game.units.find(unit=>unit.owner==='player'&&unit.defId==='artillery');
  const guards=game.units.filter(unit=>unit.owner==='player'&&unit.defId==='guardian');
  const command=(method,ids,...args)=>{game.select(ids);const result=game[method](...args);assert.equal(result.ok,true,`${method}: ${result.reason||''}`);return result;};
  const step=()=>{assert.ok(game.time<120,'bounded two-minute route');game.update(1/30);updateCampaign(game,6,1/30,version);clock.completedTicks++;game.events.splice(0);};
  const advance=predicate=>{while(!predicate()&&game.status==='playing'&&crawler.hp>0)step();assert.ok(predicate(),`route interrupted at ${game.time.toFixed(2)}s, crawler HP ${crawler.hp}`);};
  const capture=label=>{checkpoints[label]={game:game.serialize(),completedTicks:clock.completedTicks,crawlerId:crawler.id};};
  try {
    command('issueMove',guards.map(unit=>unit.id),26.5,34.5,true);
    command('issueMove',crawler.id,26.5,34.5);
    advance(()=>Math.hypot(crawler.x-26.5,crawler.y-34.5)<.85);
    command('issueMove',guards.map(unit=>unit.id),37.5,24.5,true);
    command('issueMove',crawler.id,36.5,24.5);
    advance(()=>Math.hypot(crawler.x-36.5,crawler.y-24.5)<.85);
    command('issueGuard',guards.filter(unit=>unit.hp>0).map(unit=>unit.id));
    command('useCommandAbility',crawler.id,'scan',45,24);
    const ordinaryRange=game._unitWeaponRange(crawler,game.unitDefs.artillery.weapon);
    const target=game.visibleEnemies.filter(entity=>'w' in entity&&entity.hp>0&&
      game._distanceToEntity(crawler.x,crawler.y,entity)>ordinaryRange&&
      game._distanceToEntity(crawler.x,crawler.y,entity)<=ordinaryRange+2&&
      game._hasLineOfSight(crawler.x,crawler.y,...Object.values(game._entityCenter(entity))))
      .sort((a,b)=>game._distanceToEntity(crawler.x,crawler.y,a)-game._distanceToEntity(crawler.x,crawler.y,b))[0];
    assert.ok(target,'Tactical Scan reveals a clear structure in the extra range band');
    const distance=game._distanceToEntity(crawler.x,crawler.y,target), hpBefore=target.hp;
    command('issueSetTargetPriority',crawler.id,'structures');capture('approach');
    command('useUnitAbility',crawler.id,crawler.id,'siegeAnchor');capture('setup');
    advance(()=>game.time>=crawler.order.readyAt);capture('anchored');
    let projectile=null;
    advance(()=>{projectile ||= game.effects.find(effect=>effect.type==='projectile'&&effect.sourceId===crawler.id&&effect.targetId===target.id);return Boolean(projectile);});
    advance(()=>target.hp<hpBefore);capture('contact');
    const contact={seconds:+game.time.toFixed(3),targetId:target.id,defId:target.defId,distance:+distance.toFixed(3),ordinaryRange,anchoredRange:game._unitWeaponRange(crawler,game.unitDefs.artillery.weapon),damage:+(hpBefore-target.hp).toFixed(2),projectileId:projectile.id,crawlerHp:+crawler.hp.toFixed(2)};
    command('issueMove',crawler.id,34.5,25.5);assert.equal(crawler.order.type,'move');
    assert.equal(game._unitWeaponRange(crawler,game.unitDefs.artillery.weapon),ordinaryRange);capture('released');
    for(let i=0;i<12&&game.status==='playing';i++)step();
    const playback=createSoloPlayback(envelope,recorder.commands,clock.completedTicks,version);
    playback.step(clock.completedTicks);playback.game.events.splice(0);game.events.splice(0);
    assert.ok(isDeepStrictEqual(JSON.parse(playback.game.serialize()),JSON.parse(game.serialize())),'full parsed replay state matches after normal notification consumption');
    return {status:game.status,seconds:+game.time.toFixed(3),version,envelope,contact,commands:recorder.commands,completedTicks:clock.completedTicks,replayMatches:true,checkpoints};
  } finally {recorder.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const{checkpoints,commands,...summary}=runSiegeAnchorDawnfallPlaytest();console.log(JSON.stringify({...summary,commandCount:commands.length,checkpoints:Object.fromEntries(Object.entries(checkpoints).map(([name,state])=>[name,{ticks:state.completedTicks,bytes:state.game.length}]))},null,2));}
