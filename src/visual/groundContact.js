import * as THREE from 'three';

const DEFAULT_CAPACITY = 256;
const DEFAULT_Y = 0.012;
const INFANTRY_OPACITY = 0.27;
const VEHICLE_OPACITY = 0.24;

/**
 * Build a bounded, single-draw-call batch of soft ground contact patches.
 * Entries are supplied by the renderer and are treated as the authoritative
 * visible set; this module does not inspect game state.
 */
export function createGroundContactBatch({capacity = DEFAULT_CAPACITY} = {}) {
  const instanceCapacity = Math.max(1, Math.floor(Number(capacity) || 1));
  const geometry = new THREE.PlaneGeometry(1, 1, 4, 4);
  geometry.rotateX(-Math.PI / 2);
  geometry.setAttribute('groundContactUv', geometry.getAttribute('uv'));
  const opacityAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCapacity), 1,
  );
  geometry.setAttribute('instanceOpacity', opacityAttribute);

  const material = new THREE.MeshBasicMaterial({
    color: 0x111b1a,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nattribute vec2 groundContactUv;\nvarying float vGroundOpacity;\nvarying vec2 vGroundUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundOpacity = instanceOpacity;\nvGroundUv = groundContactUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGroundOpacity;\nvarying vec2 vGroundUv;')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= vGroundOpacity * pow(1.0 - smoothstep(0.12, 1.0, length((vGroundUv - vec2(0.5)) * 2.0)), 1.5);\n\t#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'ground-contact-opacity-v1';

  const mesh = new THREE.InstancedMesh(geometry, material, instanceCapacity);
  mesh.name = 'ground-contact-batch';
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};

  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const yaw = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const transformCache = new Float64Array(instanceCapacity * 6);
  transformCache.fill(Number.NaN);
  const opacityCache = new Float64Array(instanceCapacity);
  opacityCache.fill(Number.NaN);
  let disposed = false;

  function sync(entries = []) {
    if (disposed) return;
    const count = Math.min(entries?.length ?? 0, instanceCapacity);
    let matrixChanged = false;
    let opacityChanged = false;
    for (let i = 0; i < count; i++) {
      const entry = entries[i];
      const radius = Math.max(0.01, Number(entry.radius) || 0.25);
      const infantry = Boolean(entry.infantry);
      const width = infantry ? Math.max(0.6, radius * 2.4) : radius * 1.9;
      const depth = infantry ? Math.max(0.4, radius * 1.6) : radius * 1.35;
      const opacity = entry.opacity == null
        ? (infantry ? INFANTRY_OPACITY : VEHICLE_OPACITY)
        : THREE.MathUtils.clamp(Number(entry.opacity) || 0, 0, 1);
      const x = Number(entry.x) || 0;
      const y = Number(entry.y ?? DEFAULT_Y) || 0;
      const z = Number(entry.z) || 0;
      const facing = Number(entry.facing) || 0;
      const cacheOffset = i * 6;
      if (transformCache[cacheOffset] !== x || transformCache[cacheOffset + 1] !== y ||
          transformCache[cacheOffset + 2] !== z || transformCache[cacheOffset + 3] !== width ||
          transformCache[cacheOffset + 4] !== depth || transformCache[cacheOffset + 5] !== facing) {
        position.set(x, y, z);
        scale.set(width, 1, depth);
        yaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, facing);
        rotation.copy(yaw);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(i, matrix);
        transformCache[cacheOffset] = x;
        transformCache[cacheOffset + 1] = y;
        transformCache[cacheOffset + 2] = z;
        transformCache[cacheOffset + 3] = width;
        transformCache[cacheOffset + 4] = depth;
        transformCache[cacheOffset + 5] = facing;
        matrixChanged = true;
      }
      if (opacityCache[i] !== opacity) {
        opacityAttribute.array[i] = opacity;
        opacityCache[i] = opacity;
        opacityChanged = true;
      }
    }

    // Clear the unused tail as well as shortening the draw range. This keeps
    // removed units from leaving stale matrices or opacity values behind.
    for (let i = count; i < instanceCapacity; i++) {
      if (opacityCache[i] !== 0) {
        opacityAttribute.array[i] = 0;
        opacityCache[i] = 0;
        opacityChanged = true;
      }
    }
    if (mesh.count !== count) mesh.count = count;
    mesh.visible = count > 0;
    if (matrixChanged) mesh.instanceMatrix.needsUpdate = true;
    if (opacityChanged) opacityAttribute.needsUpdate = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    geometry.dispose();
    material.dispose();
  }

  return {mesh, sync, dispose};
}
