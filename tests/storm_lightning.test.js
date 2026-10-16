import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStormLightningBuffers,
  stormFlashStrength,
  STORM_LIGHTNING_BUDGET,
} from '../src/visual/stormLightning.js';

test('storm discharge is one bounded jagged branched ribbon batch', () => {
  const {positions,indices}=buildStormLightningBuffers();
  assert.equal(positions.length/3,208);
  assert.equal(indices.length/3,STORM_LIGHTNING_BUDGET.triangles);
  assert.equal(STORM_LIGHTNING_BUDGET.drawCalls,1);
  const ys=[];
  for(let i=1;i<positions.length;i+=3) ys.push(positions[i]);
  assert.ok(Math.min(...ys)>0.1 && Math.max(...ys)>2.4);
  const horizontalSpread=Math.max(...positions.filter((_,i)=>i%3===0))-
    Math.min(...positions.filter((_,i)=>i%3===0));
  assert.ok(horizontalSpread>2.5,'bolt trunks and forks span a readable area');
});

test('lightning flashes follow surge simulation time and stop for Eco or reduced motion', () => {
  const peak=stormFlashStrength('surge',0.16,'ultra');
  assert.ok(peak>0.99);
  assert.ok(stormFlashStrength('surge',0.16,'balanced')<peak);
  assert.equal(stormFlashStrength('surge',0.16,'eco'),0);
  assert.equal(stormFlashStrength('surge',0.16,'ultra',true),0);
  assert.equal(stormFlashStrength('warning',0.16,'ultra'),0);
  assert.equal(stormFlashStrength('surge',3.0,'ultra'),0);
});
