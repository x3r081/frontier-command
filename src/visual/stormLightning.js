const BOLT_COUNT = 4;
const MAIN_SEGMENTS = 7;
const BRANCHES_PER_BOLT = 2;
const BRANCH_SEGMENTS = 3;

function pulseEnvelope(beat,center,width) {
  const x = Math.max(0,Math.min(1,1-Math.abs(beat-center)/width));
  return x*x*(3-2*x);
}

function seededUnit(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function addRibbon(points, width, positions, indices) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const sx = -dz / length * width, sz = dx / length * width;
    const base = positions.length / 3;
    positions.push(a.x + sx,a.y,a.z + sz, a.x - sx,a.y,a.z - sz,
      b.x + sx,b.y,b.z + sz, b.x - sx,b.y,b.z - sz);
    indices.push(base,base+1,base+2, base+2,base+1,base+3);
  }
}

/** Deterministic thin ribbon bolts: four trunks and two forks per trunk. */
export function buildStormLightningBuffers() {
  const positions = [], indices = [];
  for (let bolt = 0; bolt < BOLT_COUNT; bolt++) {
    const angle = bolt * Math.PI / 2 + 0.24;
    const startRadius = 0.38 + seededUnit(bolt + 1) * 0.16;
    const endRadius = 1.34 + seededUnit(bolt + 21) * 0.34;
    const points = [];
    for (let step = 0; step <= MAIN_SEGMENTS; step++) {
      const t = step / MAIN_SEGMENTS;
      const radial = startRadius + (endRadius - startRadius) * t;
      const jitter = step === 0 || step === MAIN_SEGMENTS ? 0 : (seededUnit(bolt * 19 + step + 3) - 0.5) * 0.42;
      const side = step === 0 || step === MAIN_SEGMENTS ? 0 : (seededUnit(bolt * 31 + step + 7) - 0.5) * 0.34;
      points.push({
        x: Math.cos(angle) * (radial + jitter) + Math.cos(angle + Math.PI / 2) * side,
        y: 2.52 - t * 2.34,
        z: Math.sin(angle) * (radial + jitter) + Math.sin(angle + Math.PI / 2) * side,
      });
    }
    addRibbon(points,0.036,positions,indices);
    for (let branch = 0; branch < BRANCHES_PER_BOLT; branch++) {
      const start = points[2 + branch * 2];
      const direction = angle + (branch === 0 ? -0.88 : 0.91);
      const branchPoints = [start];
      for (let step = 1; step <= BRANCH_SEGMENTS; step++) {
        const t = step / BRANCH_SEGMENTS;
        const spread = 0.14 + t * (0.36 + seededUnit(bolt * 11 + branch * 5 + 2) * 0.20);
        branchPoints.push({
          x: start.x + Math.cos(direction) * spread + (seededUnit(step + bolt * 23) - 0.5) * 0.11,
          y: start.y - t * (0.48 + branch * 0.22),
          z: start.z + Math.sin(direction) * spread + (seededUnit(step + bolt * 29) - 0.5) * 0.11,
        });
      }
      addRibbon(branchPoints,0.021,positions,indices);
    }
  }
  return {positions:new Float32Array(positions),indices:new Uint16Array(indices)};
}

export function stormFlashStrength(phase, phaseTime, quality, reducedMotion = false) {
  if (phase !== 'surge' || reducedMotion || quality === 'eco') return 0;
  const qualityScale = quality === 'ultra' ? 1 : quality === 'balanced' ? 0.65 : 0;
  if (qualityScale === 0 || !Number.isFinite(phaseTime)) return 0;
  const beat = ((phaseTime % 3.8) + 3.8) % 3.8;
  return qualityScale * Math.max(pulseEnvelope(beat,0.16,0.19),pulseEnvelope(beat,0.43,0.20)*0.62);
}

export const STORM_LIGHTNING_BUDGET = Object.freeze({
  bolts: BOLT_COUNT,
  branchesPerBolt: BRANCHES_PER_BOLT,
  triangles: 104,
  drawCalls: 1,
});
