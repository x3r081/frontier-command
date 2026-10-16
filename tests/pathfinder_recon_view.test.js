import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/game/engine.js';
import {pathfinderReconView} from '../src/ui/pathfinderReconView.js';

test('Pathfinder readout follows actual high-ground and ion-storm sight rules',()=>{
  const game=new Game({seed:24,difficulty:'normal'});
  const scout=game.units.find(unit=>unit.owner==='player'&&unit.defId==='scout');
  game.select(scout.id);
  game.terrain[Math.floor(scout.y)][Math.floor(scout.x)].elevation=0;
  game.storm.phase='calm';
  assert.equal(pathfinderReconView(game).sight,8);
  assert.equal(pathfinderReconView(game).reach,3.2);
  game.terrain[Math.floor(scout.y)][Math.floor(scout.x)].elevation=1;
  assert.equal(pathfinderReconView(game).sight,9);
  assert.equal(pathfinderReconView(game).reach,3.7);
  game.storm.phase='surge';game.storm.x=scout.x;game.storm.y=scout.y;
  const view=pathfinderReconView(game);
  assert.equal(view.sight,9*.58);
  assert.equal(view.reach,3.7);
  assert.equal(view.stormReduced,true);
});

test('Recon readout never projects hostile, transported, dead, or mixed selections',()=>{
  const game=new Game({seed:24,difficulty:'normal'});
  const scout=game.units.find(unit=>unit.owner==='player'&&unit.defId==='scout');
  const other=game.units.find(unit=>unit.owner==='player'&&unit.id!==scout.id);
  game.selection=[scout.id,other.id];assert.equal(pathfinderReconView(game),null);
  game.selection=[scout.id];scout.embarkedIn='carrier';assert.equal(pathfinderReconView(game),null);
  delete scout.embarkedIn;scout.hp=0;assert.equal(pathfinderReconView(game),null);
  scout.hp=75;scout.owner='enemy';assert.equal(pathfinderReconView(game),null);
});
