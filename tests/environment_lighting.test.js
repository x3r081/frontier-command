import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnvironmentPixels,
  environmentIntensityForQuality,
  ENVIRONMENT_TEXTURE_BUDGET,
} from '../src/visual/environmentLighting.js';

const pixel = (data, width, x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];

test('procedural environment stays within its fixed texture budget and carries sky, horizon, and ground bands', () => {
  const {width, height, inputBytes, pmremHalfFloatBytes} = ENVIRONMENT_TEXTURE_BUDGET;
  const style = {ambientSky:0x96b8c8,horizon:0x887766,ambientGround:0x26302c,sun:0xffddb0};
  const data = buildEnvironmentPixels(style);
  assert.equal(data.length, inputBytes);
  assert.equal(inputBytes, width * height * 4);
  assert.equal(pmremHalfFloatBytes, 336 * 256 * 8);
  const sky = pixel(data,width,128,126);
  const horizon = pixel(data,width,128,64);
  const ground = pixel(data,width,128,2);
  assert.notDeepEqual(sky,horizon);
  assert.notDeepEqual(horizon,ground);
  assert.ok(sky[2] > sky[0], 'upper reflection should retain a cool sky tint');
  assert.ok(ground[0] < horizon[0] && ground[1] < horizon[1], 'lower hemisphere should be subdued');
  const sunCenter = pixel(data,width,25,95);
  const nearbySky = pixel(data,width,42,95);
  assert.ok(sunCenter[0] > nearbySky[0], 'muted warm reflection should align with the key light direction');
});

test('theater palette changes the environment and Eco disables environment reflections', () => {
  const valley = buildEnvironmentPixels({ambientSky:0xaec7c2,horizon:0x82928a,ambientGround:0x26352d,sun:0xffddb0});
  const storm = buildEnvironmentPixels({ambientSky:0xc4b7e8,horizon:0x70638d,ambientGround:0x28233b,sun:0xc8b8f5});
  assert.notDeepEqual(pixel(valley,256,128,126),pixel(storm,256,128,126));
  assert.equal(environmentIntensityForQuality('eco'),0);
  assert.ok(environmentIntensityForQuality('balanced')>0);
  assert.ok(environmentIntensityForQuality('ultra')>environmentIntensityForQuality('balanced'));
});
