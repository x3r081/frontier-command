import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Renderer3D } from '../src/visual/renderer3d.js';

function renderer({ reducedMotion = false } = {}) {
  const view = Object.create(Renderer3D.prototype);
  Object.assign(view, {
    entityGroup: new THREE.Group(), effectGroup: new THREE.Group(), entities: new Map(),
    entitySyncLive: new Set(), entitySyncSelected: new Set(), entitySyncAcquiredTargets: new Set(),
    vehicleBuckets: new Map(), vehicleBucketPool: [], assetVersions: new Map(), quality: 'high',
    zoom: 1, visualHeightAt: () => 0, _authoredModel: () => null, _addTeamMarks: () => {},
    _selectionRing: () => {
      const material = new THREE.MeshBasicMaterial();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.45, 8), material);
      ring.userData.colorMaterial = material;
      return ring;
    },
    _veterancyRing: () => new THREE.Mesh(new THREE.RingGeometry(0.5, 0.54, 8),
      new THREE.MeshBasicMaterial()),
    _prepareAnimation: () => ({ phase: 0 }), _syncDamageAppearance: () => {},
    _animateDamageSmoke: () => {}, _animateMotion: () => {}, _animateEntity: () => {},
    _syncUnitAbilityVisuals: () => {}, _syncRefineryTransfer: () => {}, _setCampaignShield: () => {},
    _stampVehicleTracks: () => {}, unitLossGameRef: null, unitLossSeen: new Map(),
    unitLossLastTime: -Infinity, reducedMotionQuery: { matches: reducedMotion },
  });
  return view;
}

function rifle(id = 'u1', owner = 'player') {
  return { id, owner, defId: 'rifle', faction: owner === 'player' ? 'aegis' : 'vesper',
    x: 4, y: 4, hp: 30, maxHp: 100, facing: 0, veterancy: 0, order: { type: 'idle' } };
}

function match(units, time) {
  return { units, buildings: [], effects: [], events: [], selection: [], width: 16, height: 16,
    time, mode: 'skirmish', fog: Array.from({ length: 16 }, () => Array(16).fill(2)),
    unitDefs: { rifle: { armor: 'infantry', radius: 0.2, speed: 1.4, flying: false } },
    isVisible: () => true };
}

test('a recently rendered visible rifle death falls and fades before entity cleanup', () => {
  const view = renderer();
  const target = rifle();
  const game = match([target], 1);
  view._syncEntities(game, 1);
  const state = view.entities.get(target.id);
  assert.ok(state?.lastObservedUnit, 'the renderer retained a prior live observation');
  const originalOpacities = [];
  state.unitVisual.traverse(object => {
    if (object.isMesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) originalOpacities.push(material.opacity);
    }
  });

  game.units = [];
  game.time = 1.1;
  game.events.push({ type: 'unitLost', id: target.id, owner: target.owner,
    defId: target.defId, x: target.x, y: target.y, time: game.time });
  view.captureUnitLosses(game.events, game);
  view._syncEntities(game, 1.1);
  assert.ok(view.entities.has(target.id), 'the death effect retains the existing model briefly');
  const mesh = state.unitVisual;
  assert.ok(state.group.children.filter(child => child !== mesh).every(child => !child.visible),
    'team marks and tactical cues disappear while the body is down');
  const clonedMaterials = state.deathVisual.meshes.flatMap(({ records }) => records.map(record => record.clone));
  const disposedClones = new Set();
  clonedMaterials.forEach(material => material.addEventListener('dispose', () => disposedClones.add(material)));
  game.time = 1.38;
  view._syncEntities(game, 1.38);
  assert.notEqual(mesh.rotation.z, 0, 'the body tips onto its side');
  const corpseBounds = new THREE.Box3().setFromObject(mesh);
  assert.ok(corpseBounds.min.y >= state.group.position.y - 0.04,
    'the tipped body stays close to the ground plane');
  const stableBottom = corpseBounds.min.y;
  view._syncEntities(game, 1.38);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(mesh).min.y - stableBottom) < 1e-6,
    'repeated rendering at the same age does not accumulate fall rotation');
  const opacity = [];
  mesh.traverse(object => {
    if (object.isMesh) opacity.push((Array.isArray(object.material) ? object.material[0] : object.material).opacity);
  });
  assert.ok(opacity.some(value => value < 1), 'the per-entity material copy is fading');
  const originalAfter = [];
  state.deathVisual.meshes.forEach(({ original }) => {
    for (const material of Array.isArray(original) ? original : [original]) originalAfter.push(material.opacity);
  });
  assert.deepEqual(originalAfter, originalOpacities, 'shared/original materials stay unchanged');

  game.time = 1.66;
  view._syncEntities(game, 1.66);
  assert.equal(view.entities.has(target.id), false, 'the temporary visual is removed after 0.55 seconds');
  assert.equal(disposedClones.size, clonedMaterials.length, 'cleanup disposes every temporary fade material');
  assert.equal(state.deathVisual, null, 'cleanup releases retained death-pose references');
});

test('multiplayer snapshot adoption carries visible state and deduplicates repeated loss events', () => {
  const view = renderer();
  const target = rifle('u-mp');
  const previous = match([target], 4);
  previous.mode = 'multiplayer';
  previous.mapId = 'shard-valley';
  previous.terrain = [[{ type: 'sand' }]];
  view._syncEntities(previous, 4);

  const event = { type: 'unitLost', id: target.id, owner: target.owner, defId: target.defId,
    x: target.x, y: target.y, time: 4.1 };
  const next = match([], 4.1);
  Object.assign(next, { mode: 'multiplayer', mapId: previous.mapId, terrain: previous.terrain, events: [event] });
  assert.equal(view.adoptMultiplayerSnapshot(previous, next), true, 'the continuing match snapshot is adopted');
  const death = view.entities.get(target.id).deathVisual;
  assert.ok(death, 'the snapshot death event starts the visual from the prior observed model');

  const repeated = match([], 4.2);
  Object.assign(repeated, { mode: 'multiplayer', mapId: previous.mapId, terrain: previous.terrain,
    events: [{ ...event }] });
  assert.equal(view.adoptMultiplayerSnapshot(next, repeated), true);
  assert.equal(view.entities.get(target.id).deathVisual, death, 'repeated snapshot events do not restart the fall');
  assert.equal(death.startedAt, 4.1, 'the original simulation timestamp is retained');
});

test('boarding, fog loss, and unobserved deaths never leave infantry visuals', () => {
  const view = renderer();
  const friendly = rifle('u-boarded');
  const game = match([friendly], 1);
  view._syncEntities(game, 1);
  friendly.embarkedIn = 'carrier1';
  game.units = [];
  game.time = 1.1;
  view._syncEntities(game, 1.1);
  assert.equal(view.entities.has(friendly.id), false, 'boarding removes the existing model immediately');

  const enemy = rifle('u-fogged', 'enemy');
  const fogGame = match([enemy], 2);
  view._syncEntities(fogGame, 2);
  fogGame.units = [];
  fogGame.time = 2.1;
  fogGame.fog[4][4] = 0;
  fogGame.events.push({ type: 'unitLost', id: enemy.id, owner: enemy.owner,
    defId: enemy.defId, x: enemy.x, y: enemy.y, time: fogGame.time });
  view.captureUnitLosses(fogGame.events, fogGame);
  view._syncEntities(fogGame, 2.1);
  assert.equal(view.entities.has(enemy.id), false, 'a death in lost sight is not shown');

  const neverSeen = rifle('u-never-seen', 'enemy');
  fogGame.time = 3;
  fogGame.fog[4][4] = 0;
  fogGame.events.push({ type: 'unitLost', id: neverSeen.id, owner: neverSeen.owner,
    defId: neverSeen.defId, x: neverSeen.x, y: neverSeen.y, time: fogGame.time });
  view.captureUnitLosses(fogGame.events, fogGame);
  assert.equal(view.entities.has(neverSeen.id), false, 'an unseen death has no retained model to animate');

  const reduced = renderer({ reducedMotion: true });
  const target = rifle('u-reduced');
  const reducedGame = match([target], 1);
  reduced._syncEntities(reducedGame, 1);
  reducedGame.units = [];
  reducedGame.time = 1.1;
  reducedGame.events.push({ type: 'unitLost', id: target.id, owner: target.owner,
    defId: target.defId, x: target.x, y: target.y, time: reducedGame.time });
  reduced.captureUnitLosses(reducedGame.events, reducedGame);
  reduced._syncEntities(reducedGame, 1.1);
  assert.equal(reduced.entities.has(target.id), false, 'reduced motion removes the model without animation');
});
