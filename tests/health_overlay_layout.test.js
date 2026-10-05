import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function healthBarLayout(){
  const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  const start=source.indexOf('function layoutHealthOverlayBars(');
  const end=source.indexOf('\nfunction draw3dHealthOverlay',start);
  assert.ok(start>=0&&end>start,'main.js contains the health-bar layout helper');
  const sandbox={};
  vm.runInNewContext(`${source.slice(start,end)}\nglobalThis.layoutHealthOverlayBars=layoutHealthOverlayBars;`,sandbox);
  return sandbox.layoutHealthOverlayBars;
}

test('health-bar layout separates overlapping bars in priority order',async()=>{
  const layout=await healthBarLayout();
  const placed=layout([
    {id:'other',x:100,y:100,w:42,priority:0,minY:0,maxY:300},
    {id:'recent',x:100,y:100,w:42,priority:1,minY:0,maxY:300},
    {id:'critical',x:100,y:100,w:42,priority:2,minY:0,maxY:300},
    {id:'selected',x:100,y:100,w:42,priority:3,minY:0,maxY:300},
  ]);

  assert.equal(placed.map(bar=>bar.id).join(','),'selected,critical,recent,other');
  assert.equal(placed[0].offset,0,'selected bar keeps its projected anchor when a lane is free');
  for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++){
    const a=placed[i],b=placed[j];
    const horizontal=a.x<b.x+b.w+2&&a.x+a.w+2>b.x;
    const vertical=a.y<b.y+8&&a.y+8>b.y;
    assert.ok(!horizontal||!vertical,`${a.id} and ${b.id} bars do not overlap`);
  }
  assert.ok(placed.every(bar=>Math.abs(bar.offset)<=32),'lane displacement remains bounded');
});

test('health-bar layout keeps edge bars inside the battlefield viewport',async()=>{
  const layout=await healthBarLayout();
  const placed=layout([
    {id:'upper-a',x:40,y:1,w:36,priority:3,minY:0,maxY:194},
    {id:'upper-b',x:40,y:1,w:36,priority:0,minY:0,maxY:194},
    {id:'lower-a',x:40,y:199,w:36,priority:2,minY:0,maxY:194},
    {id:'lower-b',x:40,y:199,w:36,priority:1,minY:0,maxY:194},
  ]);
  assert.ok(placed.every(bar=>bar.y>=0&&bar.y<=194),'all six-pixel bars fit within the viewport');
  assert.ok(Math.abs(placed.find(bar=>bar.id==='upper-a').offset)<Math.abs(placed.find(bar=>bar.id==='upper-b').offset),
    'priority keeps the important upper-edge bar closest to its source');
  assert.ok(Math.abs(placed.find(bar=>bar.id==='lower-a').offset)<Math.abs(placed.find(bar=>bar.id==='lower-b').offset),
    'priority keeps the important lower-edge bar closest to its source');
});
