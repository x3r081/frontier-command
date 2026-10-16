import * as THREE from 'three';

export const ENVIRONMENT_MAP_WIDTH = 256;
export const ENVIRONMENT_MAP_HEIGHT = 128;
export const ENVIRONMENT_TEXTURE_BUDGET = Object.freeze({
  width: ENVIRONMENT_MAP_WIDTH,
  height: ENVIRONMENT_MAP_HEIGHT,
  inputBytes: ENVIRONMENT_MAP_WIDTH * ENVIRONMENT_MAP_HEIGHT * 4,
  pmremFaceSize: 64,
  pmremPackedWidth: 336,
  pmremPackedHeight: 256,
  pmremHalfFloatBytes: 336 * 256 * 4 * 2,
});

const DEFAULT_STYLE = Object.freeze({
  sky: 0x1a3036,
  horizon: 0x82928a,
  ambientSky: 0xaec7c2,
  ambientGround: 0x26352d,
  sun: 0xffddb0,
});

function hexRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mixRgb(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Build a compact equirectangular sky/ground reflection map in sRGB bytes. */
export function buildEnvironmentPixels(style = DEFAULT_STYLE, width = ENVIRONMENT_MAP_WIDTH, height = ENVIRONMENT_MAP_HEIGHT) {
  if (!Number.isInteger(width) || width < 64 || !Number.isInteger(height) || height < 32) {
    throw new RangeError('Environment texture must be at least 64 × 32 pixels.');
  }
  const skyTop = hexRgb(style.ambientSky ?? DEFAULT_STYLE.ambientSky);
  const horizon = hexRgb(style.horizon ?? DEFAULT_STYLE.horizon);
  const ground = hexRgb(style.ambientGround ?? DEFAULT_STYLE.ambientGround);
  const sun = hexRgb(style.sun ?? DEFAULT_STYLE.sun);
  const data = new Uint8Array(width * height * 4);
  const lightLength = Math.hypot(21, 25, 15);
  const sunU = Math.atan2(-15, -21) / (2 * Math.PI) + 0.5;
  const sunV = Math.acos(25 / lightLength) / Math.PI;
  for (let y = 0; y < height; y++) {
    // Three's equirectangular shader maps asin(direction.y) / PI + 0.5;
    // DataTexture rows start at the bottom when flipY is false.
    const v = 1 - (y + 0.5) / height;
    const skyToHorizon = smoothstep(0.035, 0.53, v);
    const horizonToGround = smoothstep(0.52, 0.88, v);
    const vertical = mixRgb(mixRgb(skyTop, horizon, skyToHorizon), ground, horizonToGround);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const du = Math.min(Math.abs(u - sunU), 1 - Math.abs(u - sunU));
      const angular = Math.hypot(du * 2, v - sunV);
      const warmLobe = (1 - smoothstep(0.025, 0.19, angular)) * (1 - horizonToGround);
      const mutedDisc = 1 - smoothstep(0.016, 0.034, angular);
      const warm = mixRgb(vertical, sun, warmLobe * 0.18 + mutedDisc * 0.12);
      const i = (y * width + x) * 4;
      data[i] = Math.round(warm[0]);
      data[i + 1] = Math.round(warm[1]);
      data[i + 2] = Math.round(warm[2]);
      data[i + 3] = 255;
    }
  }
  return data;
}

export function environmentIntensityForQuality(quality) {
  return quality === 'ultra' ? 0.28 : quality === 'balanced' ? 0.19 : 0;
}

/** Create one PMREM target; caller owns and must dispose the returned target. */
export function createEnvironmentTarget(renderer, style = DEFAULT_STYLE) {
  if (!renderer?.isWebGLRenderer) return null;
  let source;
  let generator;
  try {
    source = new THREE.DataTexture(
      buildEnvironmentPixels(style), ENVIRONMENT_MAP_WIDTH, ENVIRONMENT_MAP_HEIGHT,
      THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    source.colorSpace = THREE.SRGBColorSpace;
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.magFilter = THREE.LinearFilter;
    source.minFilter = THREE.LinearFilter;
    source.generateMipmaps = false;
    source.needsUpdate = true;
    generator = new THREE.PMREMGenerator(renderer);
    generator.compileEquirectangularShader();
    return generator.fromEquirectangular(source);
  } catch {
    return null;
  } finally {
    source?.dispose();
    generator?.dispose();
  }
}

export const DEFAULT_ENVIRONMENT_STYLE = DEFAULT_STYLE;
