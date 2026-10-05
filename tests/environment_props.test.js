import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Renderer3D } from '../src/visual/renderer3d.js';

test('Shard Valley renders when no eligible tracked wreck site exists', () => {
  const renderer = Object.create(Renderer3D.prototype);
  renderer.assetModels = new Map([['trackWreck', new THREE.Group()]]);
  renderer.macroLandmarkPlacements = [];
  renderer.environmentPropCapacity = 12;
  renderer.terrainGroup = new THREE.Group();
  const terrain = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => ({ type: 'sand', resource: 0 })));
  const game = { mapId: 'shard-valley', width: 8, height: 8, terrain, buildings: [], relays: [] };

  assert.doesNotThrow(() => renderer._addEnvironmentProps(game));
  assert.equal(renderer.terrainGroup.children.length, 0);
});
