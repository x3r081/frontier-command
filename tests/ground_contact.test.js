import test from 'node:test';
import assert from 'node:assert/strict';
import {ShaderLib, Matrix4, Quaternion, Raycaster, Vector3, InstancedMesh} from 'three';
import {createGroundContactBatch} from '../src/visual/groundContact.js';

test('ground contact batch applies entry transforms, footprints, and opacity', () => {
  const batch = createGroundContactBatch({capacity: 2});
  const {mesh} = batch;
  batch.sync([
    {id: 'infantry', x: 2, z: 3, y: 0.2, facing: Math.PI / 2, radius: 0.25, infantry: true},
    {id: 'vehicle', x: -1, z: 4, facing: 0.3, radius: 0.8, infantry: false, opacity: 0.4},
    {id: 'overflow', x: 90, z: 90, radius: 1, infantry: false},
  ]);

  assert.ok(mesh instanceof InstancedMesh);
  assert.equal(mesh.count, 2);
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.receiveShadow, false);
  const hits = [];
  assert.equal(mesh.raycast(new Raycaster(), hits), undefined);
  assert.deepEqual(hits, []);
  assert.ok(Math.abs(mesh.geometry.getAttribute('instanceOpacity').array[0] - 0.27) < 1e-6);
  assert.ok(Math.abs(mesh.geometry.getAttribute('instanceOpacity').array[1] - 0.4) < 1e-6);

  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const matrix = new Matrix4();
  mesh.getMatrixAt(0, matrix);
  matrix.decompose(position, rotation, scale);
  assert.ok(Math.abs(position.x - 2) < 1e-6);
  assert.ok(Math.abs(position.y - 0.2) < 1e-6);
  assert.ok(Math.abs(position.z - 3) < 1e-6);
  assert.ok(Math.abs(scale.x - 0.6) < 1e-6);
  assert.ok(Math.abs(scale.y - 1) < 1e-6);
  assert.ok(Math.abs(scale.z - 0.4) < 1e-6);
  const localNormal = new Vector3(0, 1, 0).applyQuaternion(rotation);
  assert.ok(Math.abs(localNormal.y - 1) < 1e-6);
  const vertices = mesh.geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) assert.ok(Math.abs(vertices.getY(i)) < 1e-6);
  const worldVertex = new Vector3(vertices.getX(0), vertices.getY(0), vertices.getZ(0));
  worldVertex.applyMatrix4(matrix);
  assert.ok(Math.abs(worldVertex.y - 0.2) < 1e-6);

  batch.dispose();
});

test('sync clears removed instances and an empty visible set', () => {
  const batch = createGroundContactBatch({capacity: 3});
  assert.equal(batch.mesh.count, 0);
  assert.equal(batch.mesh.visible, false);
  const opacity = batch.mesh.geometry.getAttribute('instanceOpacity');
  batch.sync([
    {id: 'first', x: 1, z: 2, radius: 0.5, infantry: false},
    {id: 'second', x: 3, z: 4, radius: 0.25, infantry: true},
  ]);
  assert.equal(batch.mesh.count, 2);
  const matrixVersion = batch.mesh.instanceMatrix.version;
  const opacityVersion = opacity.version;
  batch.sync([
    {id: 'first', x: 1, z: 2, radius: 0.5, infantry: false},
    {id: 'second', x: 3, z: 4, radius: 0.25, infantry: true},
  ]);
  assert.equal(batch.mesh.instanceMatrix.version, matrixVersion);
  assert.equal(opacity.version, opacityVersion);

  batch.sync([{id: 'remaining', x: 5, z: 6, radius: 0.5, infantry: false}]);
  assert.equal(batch.mesh.count, 1);
  assert.ok(Math.abs(opacity.array[0] - 0.24) < 1e-6);
  assert.deepEqual(Array.from(opacity.array.slice(1)), [0, 0]);

  batch.sync([]);
  assert.equal(batch.mesh.count, 0);
  assert.deepEqual(Array.from(opacity.array), [0, 0, 0]);
  batch.dispose();
});

test('shader hook adds the soft UV ellipse before the real basic shader output', () => {
  const batch = createGroundContactBatch({capacity: 1});
  const shader = {
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  };
  batch.mesh.material.onBeforeCompile(shader, {});

  assert.match(shader.vertexShader, /attribute vec2 groundContactUv;/);
  assert.match(shader.vertexShader, /vGroundUv = groundContactUv;/);
  const maskOffset = shader.fragmentShader.indexOf('diffuseColor.a *= vGroundOpacity');
  const outputOffset = shader.fragmentShader.indexOf('#include <opaque_fragment>');
  assert.ok(maskOffset >= 0);
  assert.ok(outputOffset > maskOffset);
  assert.match(shader.fragmentShader, /smoothstep\([^;]+length\(\(vGroundUv/);
  assert.doesNotMatch(shader.fragmentShader, /gl_FragColor\.a \*= vGroundOpacity/);
  batch.dispose();
});

test('dispose releases owned resources exactly once and prevents later sync', () => {
  const batch = createGroundContactBatch({capacity: 1});
  let geometryDisposals = 0;
  let materialDisposals = 0;
  batch.mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  batch.mesh.material.addEventListener('dispose', () => materialDisposals++);
  batch.sync([{id: 'unit', x: 1, z: 2, radius: 0.3, infantry: false}]);

  batch.dispose();
  batch.dispose();
  batch.sync([{id: 'later', x: 8, z: 9, radius: 1, infantry: false}]);
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(batch.mesh.count, 1);
});
