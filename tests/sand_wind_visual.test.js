import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer3D} from '../src/visual/renderer3d.js';

test('sand wind advances from render time and freezes for reduced motion',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  renderer.sandWindTimeUniform={value:0};
  renderer.vegetationWindMotionUniform={value:0};
  renderer.reducedMotionQuery={matches:false};
  renderer.quality='ultra';

  renderer._syncSandWind(12500);
  assert.equal(renderer.sandWindTimeUniform.value,12.5);
  assert.equal(renderer.vegetationWindMotionUniform.value,1);

  renderer.reducedMotionQuery.matches=true;
  renderer._syncSandWind(25000);
  assert.equal(renderer.sandWindTimeUniform.value,0);
  assert.equal(renderer.vegetationWindMotionUniform.value,0);

  renderer.reducedMotionQuery.matches=false;
  renderer.quality='eco';
  renderer._syncSandWind(30000);
  assert.equal(renderer.vegetationWindMotionUniform.value,0);
});

test('sand wind sync is safe before its uniform is initialized',()=>{
  const renderer=Object.create(Renderer3D.prototype);
  assert.doesNotThrow(()=>renderer._syncSandWind(1000));
});
