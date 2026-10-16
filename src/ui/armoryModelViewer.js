const MODEL_CATALOG = Object.freeze({
  scout: { aegis: 'scout.glb', vesper: 'vesper-scout.glb' },
  rifle: { all: 'rifle-infantry.glb?rev=76' },
  rocket: { all: 'rocket-infantry.glb?rev=76' },
  engineer: { all: 'engineer.glb?rev=1' },
  harvester: { aegis: 'harvester.glb', vesper: 'vesper-harvester.glb' },
  mcv: { aegis: 'mcv.glb?rev=85', vesper: 'vesper-mcv.glb?rev=85' },
  buggy: { aegis: 'recon-buggy.glb', vesper: 'vesper-recon-buggy.glb' },
  apc: { all: 'apc.glb?rev=1' },
  dropship: { all: 'dropship.glb' },
  lightTank: { all: 'striker-tank.glb' },
  artillery: { aegis: 'siege-crawler.glb?rev=1', vesper: 'vesper-siege-crawler.glb?rev=89' },
  guardian: { aegis: 'aegis-heavy-tank-game.glb?rev=2' },
  medic: { all: 'medic.glb?rev=86' },
  orca: { aegis: 'gunship.glb?rev=1' },
  flamer: { vesper: 'flamer.glb' },
  stealthTank: { vesper: 'stealth-tank.glb?rev=2' },
  apache: { vesper: 'apache.glb' },
});

const DEFAULT_ROTATION = Math.PI - 0.48;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function resolveModel(defId, faction) {
  const entry = MODEL_CATALOG[defId];
  const file = entry?.[faction] || entry?.all;
  return file ? `/assets/models/${file}` : null;
}

function makeButton(label, action, glyph) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'armory-model-control';
  button.dataset.modelAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.textContent = glyph;
  return button;
}

function disposeScene(THREE, scene) {
  if (!scene) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  scene.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const image = texture.source?.data;
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  scene.clear();
}

/**
 * Mount one lazy-loaded, manually rotatable Armory unit preview.
 * The caller owns the fallback portrait and controls its visibility in onReady/onFallback.
 * Returns a synchronous cleanup function; imports and model loading continue internally.
 */
export function mountArmoryModelViewer(container, {
  defId, faction = 'aegis', name = 'unit', onReady, onFallback,
} = {}) {
  let disposed = false;
  let raf = 0;
  let renderer = null;
  let scene = null;
  let model = null;
  let modelRoot = null;
  let observer = null;
  let resizeObserver = null;
  let pointer = null;
  let visible = true;
  let THREERef = null;
  let fitRadius = 1.6;
  let modelCenterY = 0.72;

  const root = document.createElement('section');
  root.className = 'armory-model-viewer';
  root.setAttribute('aria-label', `${name} 3D model preview`);
  const stage = document.createElement('div');
  stage.className = 'armory-model-stage';
  const status = document.createElement('span');
  status.className = 'armory-model-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading 3D model…';
  const controls = document.createElement('div');
  controls.className = 'armory-model-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '3D model controls');
  controls.append(
    makeButton('Rotate left', 'left', '↶'),
    makeButton('Rotate right', 'right', '↷'),
    makeButton('Zoom out', 'out', '−'),
    makeButton('Zoom in', 'in', '+'),
    makeButton('Reset model view', 'reset', '⌂'),
  );
  root.append(stage, controls, status);
  container.append(root);

  const fallback = reason => {
    if (disposed) return;
    cancelRender();
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (renderer) {
      renderer.dispose();
      renderer.renderLists?.dispose();
      renderer.forceContextLoss?.();
      renderer = null;
    }
    if (THREERef && scene) disposeScene(THREERef, scene);
    scene = model = modelRoot = camera = null;
    stage.replaceChildren();
    root.classList.add('is-fallback');
    status.textContent = '3D preview unavailable. Showing field portrait.';
    onFallback?.(reason);
  };
  const cancelRender = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const draw = () => {
    if (disposed || !renderer || !visible || document.hidden || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!disposed && renderer && visible && !document.hidden) renderer.render(scene, camera);
    });
  };
  const fitCamera = width => {
    if (!camera) return;
    const aspect = Math.max(0.1, width / Math.max(1, stage.clientHeight));
    const span = Math.max(3.3, fitRadius * 2.2 / Math.min(1, aspect));
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.position.set(3.25, modelCenterY + 1.78, 4.4);
    camera.lookAt(0, modelCenterY, 0);
    camera.updateProjectionMatrix();
  };
  let camera;

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelRender();
    observer?.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', onPointerEnd);
    stage.removeEventListener('pointercancel', onPointerEnd);
    controls.removeEventListener('click', onControlClick);
    if (renderer) {
      renderer.dispose();
      renderer.renderLists?.dispose();
      renderer.forceContextLoss?.();
    }
    if (THREERef) disposeScene(THREERef, scene);
    root.remove();
  };

  function onVisibilityChange() {
    if (document.hidden) cancelRender();
    else draw();
  }
  function onPointerDown(event) {
    if (!renderer || !modelRoot) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointer = { id: event.pointerId, x: event.clientX };
    stage.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!renderer || !modelRoot || !pointer || event.pointerId !== pointer.id) return;
    const delta = event.clientX - pointer.x;
    pointer.x = event.clientX;
    modelRoot.rotation.y += delta * 0.009;
    draw();
  }
  function onPointerEnd(event) {
    if (pointer?.id === event.pointerId) pointer = null;
  }
  function onControlClick(event) {
    const action = event.target.closest('[data-model-action]')?.dataset.modelAction;
    if (!action || !camera || !modelRoot) return;
    if (action === 'left') modelRoot.rotation.y -= Math.PI / 12;
    else if (action === 'right') modelRoot.rotation.y += Math.PI / 12;
    else if (action === 'in') camera.zoom = clamp(camera.zoom * 1.18, 0.8, 2.7);
    else if (action === 'out') camera.zoom = clamp(camera.zoom / 1.18, 0.8, 2.7);
    else if (action === 'reset') {
      modelRoot.rotation.y = DEFAULT_ROTATION;
      camera.zoom = 1;
    }
    camera.updateProjectionMatrix();
    draw();
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerEnd);
  stage.addEventListener('pointercancel', onPointerEnd);
  controls.addEventListener('click', onControlClick);
  document.addEventListener('visibilitychange', onVisibilityChange);
  observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) draw(); else cancelRender();
    }) : null;
  observer?.observe(container);

  const modelPath = resolveModel(defId, faction);
  if (!modelPath) {
    fallback(new Error(`No Armory model is cataloged for ${faction} ${defId}.`));
    return cleanup;
  }

  Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js')])
    .then(async ([THREE, loaderModule]) => {
      if (disposed) return;
      THREERef = THREE;
      const loader = new loaderModule.GLTFLoader();
      const gltf = await loader.loadAsync(modelPath);
      if (disposed) {
        disposeScene(THREE, gltf.scene);
        return;
      }
      scene = new THREE.Scene();
      scene.background = null;
      scene.add(new THREE.HemisphereLight(0xd6f3e7, 0x19231f, 1.85));
      const keyLight = new THREE.DirectionalLight(0xfff2d8, 3.1);
      keyLight.position.set(-3.5, 5.5, 4.5);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(768, 768);
      keyLight.shadow.camera.left = -3;
      keyLight.shadow.camera.right = 3;
      keyLight.shadow.camera.top = 4;
      keyLight.shadow.camera.bottom = -2;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.camera.updateProjectionMatrix();
      scene.add(keyLight);
      const rim = new THREE.DirectionalLight(0x9ac9ff, 1.25);
      rim.position.set(4, 3, -4);
      scene.add(rim);

      model = gltf.scene;
      modelRoot = new THREE.Group();
      const modelFrame = new THREE.Group();
      modelFrame.add(model);
      modelRoot.add(modelFrame);
      model.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material?.name === 'TeamAccent') {
            material.color?.setHex(faction === 'vesper' ? 0xff8367 : 0x56e8ff);
            material.emissive?.setHex(faction === 'vesper' ? 0xe74e30 : 0x27c8ec);
            if (material.emissive) material.emissiveIntensity = 1.1;
          }
          if (material && 'roughness' in material) material.roughness = Math.max(0.45, material.roughness || 0);
        }
      });
      modelFrame.updateMatrixWorld(true);
      let bounds = new THREE.Box3().setFromObject(modelFrame);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = 2.25 / Math.max(size.x, size.y, size.z, 0.1);
      fitRadius = Math.max(0.4, size.length() * scale / 2);
      modelCenterY = size.y * scale / 2;
      modelFrame.scale.setScalar(scale);
      modelFrame.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(modelFrame);
      const center = bounds.getCenter(new THREE.Vector3());
      modelFrame.position.set(-center.x, -bounds.min.y, -center.z);
      modelRoot.rotation.y = DEFAULT_ROTATION;
      scene.add(modelRoot);

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.ShadowMaterial({ opacity: 0.26 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.001;
      ground.receiveShadow = true;
      scene.add(ground);
      const halo = new THREE.Mesh(new THREE.CircleGeometry(1.25, 48),
        new THREE.MeshBasicMaterial({ color: faction === 'vesper' ? 0xff755a : 0x8bddff,
          transparent: true, opacity: 0.075, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.006;
      scene.add(halo);

      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
      fitCamera(width);

      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      } catch (error) {
        disposeScene(THREE, scene);
        scene = null;
        model = modelRoot = null;
        fallback(error);
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.domElement.className = 'armory-model-canvas';
      renderer.domElement.setAttribute('role', 'img');
      renderer.domElement.setAttribute('aria-label', `${name} three-dimensional model preview. Drag to rotate; use the model controls to rotate or zoom.`);
      stage.append(renderer.domElement);
      resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
          if (!renderer || !camera) return;
          const nextWidth = Math.max(1, stage.clientWidth);
          const nextHeight = Math.max(1, stage.clientHeight);
          renderer.setSize(nextWidth, nextHeight, false);
          fitCamera(nextWidth);
          draw();
        }) : null;
      resizeObserver?.observe(stage);
      root.classList.remove('is-fallback');
      status.textContent = 'Drag to rotate. Use the controls to rotate or zoom.';
      onReady?.();
      draw();
    })
    .catch(error => fallback(error));

  return cleanup;
}

export const armoryModelPath = resolveModel;
