import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getCampaignFieldOrderView } from '../game/campaign.js';
import { unitWeaponRange, UNIT_PROMOTION_RULES_VERSION } from '../game/engine.js';

// The game owns tile coordinates. This renderer only maps tile (x, y) to
// Three.js ground (x, z); no game rules or positions are changed here.
const TILE_PIXELS = 32;
const STORM_BASIN_ARRAY_TILE = Object.freeze({x:24,z:11});
const MACRO_LANDMARKS = Object.freeze({
  'twin-passes': {key:'passGate',w:4,h:2,scale:0.88},
  'delta-crossing': {key:'spillway',w:4,h:3,scale:0.96},
  'canyon-ring': {key:'oreHoist',w:4,h:2,scale:1},
});
const GRAPHICS_QUALITY = Object.freeze({
  eco: { maxDpr: 1, shadowMapSize: 512, trackCapacity: 96, ruinCapacity: 8, ruinRubblePieces: 1, collapseCapacity: 2, environmentPropCapacity: 6, dustMoteCapacity: 28 },
  balanced: { maxDpr: 1.5, shadowMapSize: 1024, trackCapacity: 256, ruinCapacity: 16, ruinRubblePieces: 2, collapseCapacity: 5, environmentPropCapacity: 12, dustMoteCapacity: 64 },
  ultra: { maxDpr: 2, shadowMapSize: 2048, trackCapacity: 512, ruinCapacity: 24, ruinRubblePieces: 3, collapseCapacity: 10, environmentPropCapacity: 18, dustMoteCapacity: 112 },
});
const SKY = 0x1a3036;
const DOCTRINE_RING_COLORS = Object.freeze({rapid:0x72e8e9,reinforced:0xffd67d,precision:0xff8ca5});
const BUILDING_RUIN_LIFETIME = 150;
const BUILDING_COLLAPSE_DURATION = 0.92;
const GROUND_FLAT_ZONE_CAPACITY = 16;
const HIDDEN_INSTANCE_MATRIX = new THREE.Matrix4().makeTranslation(0,-10000,0);
const BUILDING_RUIN_FAMILIES = Object.freeze({
  command:'mast',radar:'mast',tech:'mast',
  refinery:'tank',power:'tank',advancedPower:'tank',silo:'tank',
  factory:'slab',barracks:'slab',serviceBay:'slab',helipad:'slab',vesperFactory:'slab',
  turret:'mount',guardTower:'mount',aaTower:'mount',sam:'mount',obelisk:'mount',superweapon:'mount',warhead:'mount',
  wall:'wall',
});
let sandDetailTexture;
function getSandDetailTexture() {
  if (!sandDetailTexture) {
    sandDetailTexture = new THREE.TextureLoader().load('/assets/sand-alluvial.webp');
    sandDetailTexture.wrapS = THREE.RepeatWrapping;
    sandDetailTexture.wrapT = THREE.RepeatWrapping;
    sandDetailTexture.colorSpace = THREE.NoColorSpace;
  }
  return sandDetailTexture;
}

export function projectileYaw(fromX, fromY, toX, toY) {
  // Authored projectiles face local -Z; the opposite side carries the trail.
  return Math.atan2(fromX - toX, fromY - toY);
}

// Each theater keeps the same readable ground types while shifting the light,
// sediment, and landmark colors enough to give the battlefield its own identity.
const MAP_STYLES = Object.freeze({
  'shard-valley': { sky:0x1a3036, horizon:0x82928a, haze:0xd9bf91, sun:0xffddb0, sunIntensity:3.25, ambientSky:0xaec7c2, ambientGround:0x26352d, ambientIntensity:0.84, rim:0x9bcfc2, rimIntensity:1.28, fogDensity:0.0068, hazeOpacity:0.54, silt:[0.70,0.75,0.69], ochre:[1.21,1.08,0.82], shelf:0x53615a, rock:0x58645e, vegetation:0x708772, patch:0xc1a778, mist:0x4a686c,
    valley:[43.0,-0.56,1.8] },
  'twin-passes': { sky:0x171f2b, horizon:0x738392, haze:0xc5c6ce, sun:0xd2d8ed, sunIntensity:3.12, ambientSky:0xb8c9e2, ambientGround:0x202c3a, ambientIntensity:0.82, rim:0x91baf0, rimIntensity:1.42, fogDensity:0.0084, hazeOpacity:0.60, silt:[0.57,0.65,0.77], ochre:[0.95,0.96,1.13], shelf:0x46515f, rock:0x667486, vegetation:0x627d84, patch:0xa7b6ca, mist:0x465b70 },
  'delta-crossing': { sky:0x10282d, horizon:0x668d83, haze:0xb4d7bf, sun:0xc6eadb, sunIntensity:3.02, ambientSky:0xb2d7ca, ambientGround:0x1c342e, ambientIntensity:0.92, rim:0x77d9ba, rimIntensity:1.35, fogDensity:0.0080, hazeOpacity:0.62, silt:[0.54,0.75,0.72], ochre:[0.89,1.09,0.99], shelf:0x42615b, rock:0x687f76, vegetation:0x658c72, patch:0x9dc5a5, mist:0x376c68 },
  'canyon-ring': { sky:0x281b1c, horizon:0x98715d, haze:0xf2b47d, sun:0xffc18e, sunIntensity:3.45, ambientSky:0xe7b99b, ambientGround:0x39251f, ambientIntensity:0.78, rim:0xffa071, rimIntensity:1.55, fogDensity:0.0060, hazeOpacity:0.49, silt:[0.73,0.62,0.57], ochre:[1.19,0.91,0.72], shelf:0x61443b, rock:0x927363, vegetation:0x817050, patch:0xd49a69, mist:0x755047 },
  'storm-basin': { sky:0x201a34, horizon:0x70638d, haze:0xc1abd9, sun:0xc8b8f5, sunIntensity:3.08, ambientSky:0xc4b7e8, ambientGround:0x28233b, ambientIntensity:0.84, rim:0xa38be8, rimIntensity:1.50, fogDensity:0.0090, hazeOpacity:0.66, silt:[0.62,0.61,0.79], ochre:[0.93,0.87,1.17], shelf:0x514665, rock:0x77718f, vegetation:0x728078, patch:0xb2a0d2, mist:0x665985 },
});

const hash = (x, z, seed = 0) => {
  let n = (Math.imul(x + 19, 374761393) + Math.imul(z + 97, 668265263) + Math.imul(seed + 1, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = v => v * v * (3 - 2 * v);
function noise(x,z,scale,seed) {
  const gx=x/scale,gz=z/scale,ix=Math.floor(gx),iz=Math.floor(gz);
  const tx=smooth(gx-ix),tz=smooth(gz-iz);
  const a=hash(ix,iz,seed)*(1-tx)+hash(ix+1,iz,seed)*tx;
  const b=hash(ix,iz+1,seed)*(1-tx)+hash(ix+1,iz+1,seed)*tx;
  return a*(1-tz)+b*tz;
}

function joinedGeometry(parts) {
  const geometries=parts.map(({geometry,position=[0,0,0],rotation=[0,0,0]})=>{
    const transform=new THREE.Object3D();
    transform.position.set(...position);transform.rotation.set(...rotation);transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);return geometry;
  });
  const joined=mergeGeometries(geometries,false);
  geometries.forEach(geometry=>geometry.dispose());
  return joined;
}

// Some authored units have dozens of separately named static parts. Merge
// compatible geometry once at load time, while leaving moving parts as real
// nodes. The source nodes keep their names for inspection and animation hooks.
function compactStaticModel(root, preserve=()=>false) {
  root.updateMatrixWorld(true);
  const inverseRoot=root.matrixWorld.clone().invert();
  const batches=new Map();
  root.traverse(object=>{
    if(!object.isMesh||!object.visible||preserve(object)||Array.isArray(object.material)||object.geometry.groups.length) return;
    const geometry=object.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverseRoot,object.matrixWorld));
    const attributes=Object.keys(geometry.attributes).sort().map(name=>{
      const attribute=geometry.attributes[name];
      return `${name}:${attribute.itemSize}:${attribute.normalized?1:0}`;
    }).join('|');
    const key=`${object.material.uuid}:${attributes}:${geometry.index?1:0}`;
    let batch=batches.get(key);
    if(!batch) batches.set(key,batch={material:object.material,geometries:[],sources:[]});
    batch.geometries.push(geometry);
    batch.sources.push(object);
  });
  for(const batch of batches.values()) {
    if(batch.geometries.length<2) {batch.geometries.forEach(geometry=>geometry.dispose());continue;}
    const merged=mergeGeometries(batch.geometries,false);
    batch.geometries.forEach(geometry=>geometry.dispose());
    if(!merged) continue;
    const mesh=new THREE.Mesh(merged,batch.material);
    mesh.name='Renderer static model batch';
    mesh.castShadow=true;mesh.receiveShadow=true;
    root.add(mesh);
    for(const source of batch.sources) {
      // Retain each source node and name, but avoid rebinding dozens of
      // materials or traversing hidden mesh parts during damage updates.
      source.userData.rendererBatchSource=true;
      // Entity clones share the template's hidden geometry and material. They
      // must not dispose those resources when leaving the battlefield.
      source.userData.sharedAssetGeometry=true;
      source.userData.sharedAssetMaterial=true;
      source.visible=false;
    }
  }
}

const COMPACT_INFANTRY = new Set(['scout','scoutVesper','rifle','rocket','engineer','medic','flamer']);
function preserveMovingModelPart(key,object) {
  const name=object.name.replace(/_/g,' ').replace(/(\d{3})$/,'.$1');
  if(COMPACT_INFANTRY.has(key)) return /^Arm\.?[LR] (?:upper|forearm)$/.test(name);
  if(key==='mcv') return /^(?:Run-flat wheel|Wheel hub)(?:\.\d+)?$/.test(name);
  return false;
}

export function compactAuthoredModel(root,key) {
  if(key!=='artillery'&&key!=='mcv'&&!COMPACT_INFANTRY.has(key)) return false;
  compactStaticModel(root,object=>preserveMovingModelPart(key,object));
  return true;
}

function scorchedFootprintGeometry() {
  const shape=new THREE.Shape();
  const steps=12;
  for(let i=0;i<steps;i++) {
    const angle=i*Math.PI*2/steps;
    const radius=0.40+(i%3)*0.045+0.025*Math.sin(i*4.7);
    const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
    if(i===0) shape.moveTo(x,z);else shape.lineTo(x,z);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape,1);
}

function collapsedMastGeometry() {
  return joinedGeometry([
    {geometry:new THREE.CylinderGeometry(0.10,0.13,0.48,7),position:[-0.05,0.24,0]},
    {geometry:new THREE.CylinderGeometry(0.065,0.09,0.42,6),position:[0.16,0.57,0],rotation:[0,0,-0.62]},
    {geometry:new THREE.BoxGeometry(0.42,0.075,0.10),position:[0.10,0.72,0.01],rotation:[0,0,0.10]},
  ]);
}

function collapsedTankGeometry() {
  return joinedGeometry([
    {geometry:new THREE.CylinderGeometry(0.31,0.31,0.82,9),position:[0,0.27,0],rotation:[Math.PI/2,0,0]},
    {geometry:new THREE.TorusGeometry(0.265,0.035,5,12),position:[0,0.27,-0.23]},
    {geometry:new THREE.TorusGeometry(0.265,0.035,5,12),position:[0,0.27,0.23]},
    {geometry:new THREE.BoxGeometry(0.16,0.12,0.13),position:[0.31,0.18,0.12],rotation:[0,0,-0.35]},
  ]);
}

function collapsedGantryGeometry() {
  return joinedGeometry([
    {geometry:new THREE.BoxGeometry(0.13,0.62,0.12),position:[-0.34,0.31,0],rotation:[0,0,-0.12]},
    {geometry:new THREE.BoxGeometry(0.13,0.43,0.12),position:[0.34,0.22,0],rotation:[0,0,0.18]},
    {geometry:new THREE.BoxGeometry(0.50,0.10,0.13),position:[-0.13,0.62,0.01],rotation:[0,0,-0.04]},
    {geometry:new THREE.BoxGeometry(0.27,0.09,0.13),position:[0.23,0.47,0.02],rotation:[0,0,0.28]},
  ]);
}

function collapsedWallGeometry() {
  return joinedGeometry([
    {geometry:new THREE.BoxGeometry(0.42,0.15,0.20),position:[-0.24,0.12,0]},
    {geometry:new THREE.BoxGeometry(0.30,0.20,0.18),position:[0.14,0.16,0],rotation:[0,0,-0.16]},
    {geometry:new THREE.BoxGeometry(0.20,0.11,0.16),position:[0.38,0.09,0.01],rotation:[0,0,0.22]},
  ]);
}

function tileColor(kind,x,z,detail=0,style=MAP_STYLES['shard-valley']) {
  // Storm Basin water varies in its continuous world-space flow shader. Large
  // per-tile tints make its shallow channels read as a checkerboard of slabs.
  if(kind==='water'&&style===MAP_STYLES['storm-basin']) return new THREE.Color(0x1c4d59);
  // Keep sand's discrete per-tile tint range narrow so its continuous
  // world-space shader carries the broad variation without a checker pattern.
  const macro=noise(x,z,12,64)*0.68+noise(x,z,5,65)*0.29+detail*0.03;
  const variation=clamp((macro-0.22)*1.75,0,1);
  const v=kind==='sand'?0.44+variation*0.12:variation;
  const c=kind==='rock'?new THREE.Color(style.rock):kind==='crystal'?new THREE.Color(0x285f5d):new THREE.Color(0x515e50);
  const hi=kind==='rock'?0x708078:kind==='crystal'?0x65a88a:0xb8a97d;
  c.lerp(new THREE.Color(hi),v);
  return c;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.13, flatShading: true, ...opts });
}

function addVegetationWind(material, timeUniform, motionUniform, sway, cacheKey) {
  material.customProgramCacheKey=()=>`vegetation-wind:${cacheKey}:v1`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.uVegetationWindTime=timeUniform;
    shader.uniforms.uVegetationWindMotion=motionUniform;
    shader.vertexShader=`uniform float uVegetationWindTime; uniform float uVegetationWindMotion;\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       vec3 vegetationWindWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;
       #else
       vec3 vegetationWindWorld=(modelMatrix*vec4(transformed,1.0)).xyz;
       #endif
       float vegetationTip=smoothstep(${cacheKey==='brush'?'-0.10':'0.13'},${cacheKey==='brush'?'0.14':'0.58'},transformed.y);
       float vegetationWave=sin(vegetationWindWorld.x*1.75+vegetationWindWorld.z*0.62+uVegetationWindTime*1.35);
       float vegetationCrossWave=sin(vegetationWindWorld.z*1.1-uVegetationWindTime*0.82+vegetationWindWorld.x*0.28);
       float vegetationSway=vegetationTip*uVegetationWindMotion*${sway.toFixed(3)};
       transformed.x+=vegetationWave*vegetationSway;
       transformed.z+=vegetationCrossWave*vegetationSway*0.32;`
    );
  };
  material.needsUpdate=true;
  return material;
}

function sandMaterial(style, groundQualityUniform, sandWindTimeUniform) {
  const material=mat(0xffffff,{roughness:0.98,metalness:0.01});
  // The shader embeds theater colors as source literals. Give each palette a
  // distinct program key so a later map cannot inherit the first map's GLSL.
  material.customProgramCacheKey=()=>`ground:${style.silt.join(',')}:${style.ochre.join(',')}:${style.valley?.join(',')||''}:wind-v1`;
  const flatZoneVectors=Array.from({length:GROUND_FLAT_ZONE_CAPACITY},()=>new THREE.Vector4());
  const flatZoneCountUniform={value:0};
  material.userData.groundFlatZoneState={vectors:flatZoneVectors,countUniform:flatZoneCountUniform};
  // Shard Valley's road follows an eroded basin. Its broad alluvial floor and
  // exposed shoulders are world-space color forms, so their edges flow across
  // tile boundaries without lifting build pads or altering pathing.
  const valley=style.valley;
  const landform=valley?`
       float basinAxis=${valley[0].toFixed(2)} + vGroundXZ.x*${valley[1].toFixed(2)} + sin(vGroundXZ.x*0.18)*${valley[2].toFixed(2)};
       float basinDist=abs(vGroundXZ.y-basinAxis+(broad-0.5)*2.7);
       float basinFloor=1.0-smoothstep(3.8,8.4,basinDist);
       float rockShoulder=smoothstep(6.0,10.0,basinDist)*(1.0-smoothstep(15.0,21.0,basinDist));
       diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.30,1.13,0.76),basinFloor*0.68);
       diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.45,0.67,0.67),rockShoulder*0.67);
       diffuseColor.rgb*=1.0+rockShoulder*0.055*sin(vGroundXZ.x*0.91+vGroundXZ.y*0.19+broad*2.0);`:'';
  material.onBeforeCompile=shader=>{
    shader.uniforms.uGroundQuality=groundQualityUniform;
    shader.uniforms.uSandWindTime=sandWindTimeUniform;
    shader.uniforms.uSandDetail={value:getSandDetailTexture()};
    shader.uniforms.uGroundFlatZones={value:flatZoneVectors};
    shader.uniforms.uGroundFlatZoneCount=flatZoneCountUniform;
    const reliefCode=`
      uniform vec4 uGroundFlatZones[${GROUND_FLAT_ZONE_CAPACITY}];
      uniform int uGroundFlatZoneCount;
      uniform float uGroundQuality;
      uniform float uSandWindTime;
      float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float groundNoise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(groundHash(i),groundHash(i+vec2(1.0,0.0)),f.x),
                   mix(groundHash(i+vec2(0.0,1.0)),groundHash(i+vec2(1.0,1.0)),f.x),f.y);
      }
      float groundRelief(vec2 p){
        float broad=groundNoise(p/22.0);
        float dunePhase=dot(p,vec2(0.12,0.055))*6.28318+(broad-0.5)*3.8;
        float height=0.18*sin(dunePhase);
        // Broad, noise-warped crests give raking light a real surface to catch
        // at command zoom. A restrained secondary fold breaks the long ridges;
        // the shared world-space phase keeps neighboring tiles seamless.
        if(uGroundQuality>0.5) height=0.29*sin(dunePhase)
          +0.035*sin(dunePhase*1.85+broad*1.6);
        if(uGroundQuality>1.5) height+=0.018*sin(dot(p,vec2(2.55,1.08))+groundNoise(p/5.5)*2.4);
        float mask=1.0;
        for(int i=0;i<${GROUND_FLAT_ZONE_CAPACITY};i++){
          if(i>=uGroundFlatZoneCount) break;
          vec4 zone=uGroundFlatZones[i];
          vec2 outside=max(abs(p-zone.xy)-zone.zw,vec2(0.0));
          mask*=smoothstep(0.0,1.35,length(outside));
        }
        ${style.valley?`float basinAxis=${style.valley[0].toFixed(2)}+p.x*${style.valley[1].toFixed(2)}+sin(p.x*0.18)*${style.valley[2].toFixed(2)};
        float basinDist=abs(p.y-basinAxis+(broad-0.5)*2.7);
        mask*=smoothstep(1.35,2.65,basinDist);`:''}
        return height*mask;
      }
    `;
    shader.vertexShader=`${reliefCode}\nvarying vec2 vGroundXZ; varying float vGroundTop;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       vec4 groundWorldPosition = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
       float groundInstanceYScale = length(instanceMatrix[1].xyz);
       #else
       vec4 groundWorldPosition = modelMatrix * vec4(transformed, 1.0);
       float groundInstanceYScale = 1.0;
       #endif`
       +`\n       vGroundXZ=groundWorldPosition.xz;
       vGroundTop=step(0.5,normal.y);
       float reliefFade=smoothstep(-0.5,0.5,transformed.y);
       transformed.y+=groundRelief(vGroundXZ)*0.82*reliefFade/max(groundInstanceYScale,0.001);`
    );
    shader.fragmentShader=`${reliefCode}\nvarying vec2 vGroundXZ; varying float vGroundTop; uniform sampler2D uSandDetail;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float broad = groundNoise(vGroundXZ/17.0);
       // A continuous cross-theater dune field adds soft, readable raking
       // light without tile decals or extra terrain meshes.
       float dunePhase=dot(vGroundXZ,vec2(0.12,0.055))*6.28318
         +(groundNoise(vGroundXZ/22.0)-0.5)*3.8;
       float duneLight=0.5+0.5*sin(dunePhase);
       // Slow gusts move across the mineral field as soft, narrow bands. The
       // low contrast keeps units and orders clear while making the ground
       // feel exposed to a steady crosswind at the default tactical zoom.
       float windGust=0.0;
       if(uGroundQuality>0.5){
         float gustPhase=dot(vGroundXZ,vec2(0.12,0.055))*6.28318
           +(broad-0.5)*2.1-uSandWindTime*0.12;
         windGust=pow(max(0.0,sin(gustPhase)),5.0);
       }
       float land = groundNoise(vGroundXZ/6.8)*0.48 + groundNoise(vGroundXZ/2.7)*0.34 + groundNoise(vGroundXZ*1.35)*0.18;
       // World-space grain stays continuous across tile boundaries and gives
       // the sand a little local breakup without extra textures or draw calls.
       vec3 sandDetail = vec3(0.5);
       float grain = 0.5;
       float strata = 0.0;
       float mineral = 0.0;
       float sediment = 0.0;
       float duneRidge = 0.0;
       float windRipples = 0.0;
       float seamShoulder = 0.0;
       float seamCore = 0.0;
       vec3 coolSilt = vec3(${style.silt.join(',')});
       vec3 ochreDust = vec3(${style.ochre.join(',')});
       vec3 paleMineral = vec3(0.91,0.94,0.84);
       if (uGroundQuality > 0.5) {
         // One seamless mask sample replaces three high-frequency hash fields.
         // The 16-unit world repeat keeps the sediment bands broad and the grit fine.
         sandDetail = texture2D(uSandDetail,vGroundXZ/16.0).rgb;
         grain = sandDetail.r;
         sediment = smoothstep(0.50,0.77,sandDetail.g);
         // Long, gently warped mineral seams give the broad sand floor a
         // readable geological direction without placing per-tile decals.
         float seamPath = vGroundXZ.x*0.34 + vGroundXZ.y*0.18
           + sin(vGroundXZ.x*0.075 + vGroundXZ.y*0.045)*2.1 + (broad-0.5)*2.8;
         float seamWave = abs(sin(seamPath*0.31 + groundNoise(vGroundXZ/8.0)*0.42));
         seamShoulder = 1.0-smoothstep(0.10,0.42,seamWave);
         seamCore = 1.0-smoothstep(0.035,0.20,seamWave);
       }
       if (uGroundQuality > 1.5) {
         strata = sin(vGroundXZ.x*0.54 + vGroundXZ.y*0.23 + groundNoise(vGroundXZ/5.0)*4.0);
         mineral = smoothstep(0.73,0.86,groundNoise(vGroundXZ/2.1+23.0));
         float duneWave = 0.5 + 0.5*sin(vGroundXZ.x*0.72 + vGroundXZ.y*0.31 + groundNoise(vGroundXZ/7.0)*5.0);
         duneRidge = smoothstep(0.66,0.93,duneWave);
         windRipples = sin(vGroundXZ.x*5.3 + vGroundXZ.y*2.1 + groundNoise(vGroundXZ/3.0)*3.0);
       }
       diffuseColor.rgb *= mix(coolSilt,ochreDust,smoothstep(0.24,0.75,land));
       diffuseColor.rgb *= 0.91+duneLight*0.18;
       diffuseColor.rgb *= mix(1.0,0.985+windGust*0.035,smoothstep(0.5,1.5,uGroundQuality));
       diffuseColor.rgb = mix(diffuseColor.rgb,diffuseColor.rgb*paleMineral,mineral*0.22);
       diffuseColor.rgb *= 0.86 + broad*0.27 + (grain-0.5)*0.18;
       float mineralGrit = smoothstep(0.77,0.95,sandDetail.b);
       diffuseColor.rgb = mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.10,1.08,0.98),mineralGrit*0.12);
       diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.62,0.77,0.75), sediment*0.27);
       diffuseColor.rgb *= 0.96 + strata*0.04 + duneRidge*0.065 + windRipples*0.015;
       // Apply the veins after the base palette so each theater keeps its own
       // mineral hue while the long seams stay visible at tactical zoom.
       vec3 seamTone = mix(coolSilt,ochreDust,0.64);
       diffuseColor.rgb = mix(diffuseColor.rgb,diffuseColor.rgb*vec3(0.62,0.70,0.69),seamShoulder*0.38);
       diffuseColor.rgb = mix(diffuseColor.rgb,diffuseColor.rgb*seamTone*1.55,seamCore*(0.66+grain*0.10));
       ${landform}`
    );
    // Match the displaced vertex silhouette with its continuous world-space
    // normal field. Tile coordinates and collision remain simulation-owned.
    shader.fragmentShader=shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       if(uGroundQuality>0.5&&vGroundTop>0.5){
         float reliefStep=0.14;
         float reliefX=(groundRelief(vGroundXZ+vec2(reliefStep,0.0))-groundRelief(vGroundXZ-vec2(reliefStep,0.0)))/(2.0*reliefStep);
         float reliefZ=(groundRelief(vGroundXZ+vec2(0.0,reliefStep))-groundRelief(vGroundXZ-vec2(0.0,reliefStep)))/(2.0*reliefStep);
         vec3 reliefNormal=normalize(vec3(-reliefX,1.0,-reliefZ));
         normal=normalize((viewMatrix*vec4(reliefNormal,0.0)).xyz);
       }`
    );
  };
  return material;
}

function rockMaterial() {
  const material=mat(0xffffff,{roughness:0.97,metalness:0.02});
  material.customProgramCacheKey=()=> 'rock-patch-edge-warp-v1';
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       vec4 rockWorldPosition=modelMatrix*instanceMatrix*vec4(transformed,1.0);
       #else
       vec4 rockWorldPosition=modelMatrix*vec4(transformed,1.0);
       #endif
       // A shared world-space warp keeps adjoining rock tiles joined. Only
       // the outer part of each tile moves, so rock patch borders stop reading
       // as one straight-edged slab while the tile grid and pathing stay fixed.
       float rockEdge=smoothstep(0.28,0.50,max(abs(transformed.x),abs(transformed.z)));
       vec2 rockXZ=rockWorldPosition.xz;
       vec2 edgeWarp=vec2(
         sin(rockXZ.x*0.71+sin(rockXZ.y*0.36)*2.1)+0.42*sin(rockXZ.y*1.13+rockXZ.x*0.19),
         cos(rockXZ.y*0.67+cos(rockXZ.x*0.31)*2.0)+0.42*cos(rockXZ.x*1.07-rockXZ.y*0.17));
       transformed.xz+=edgeWarp*(0.105*rockEdge);
       transformed.y+=sin(rockXZ.x*0.43+rockXZ.y*0.61)*0.022*rockEdge;`
    );
  };
  return material;
}

// Build connected rock fields as one continuous cap and a broken perimeter
// skirt. The simulation still owns tile-level rock occupancy; this mesh only
// replaces the raised box faces that made each field read as a tiled platform.
function rockFieldGeometry(game, style) {
  const seen=new Uint8Array(game.width*game.height), pieces=[];
  const isRock=(x,z)=>game.terrain[z]?.[x]?.type==='rock';
  const key=(x,z)=>z*game.width+x;
  const vertex=(x,z)=>[
    x+(hash(x,z,1101)-0.5)*0.46,
    z+(hash(x,z,1102)-0.5)*0.46,
  ];
  const topColor=new THREE.Color(style.rock), light=new THREE.Color(0x9b9b8c);
  const skirtColor=topColor.clone().lerp(light,0.08);
  const skirtPieces=[];
  for(let z=0;z<game.height;z++)for(let x=0;x<game.width;x++) {
    const start=key(x,z);
    if(seen[start]||!isRock(x,z))continue;
    const queue=[[x,z]], cells=[];seen[start]=1;
    for(let qi=0;qi<queue.length;qi++) {
      const [cx,cz]=queue[qi];cells.push([cx,cz]);
      for(const [nx,nz] of [[cx+1,cz],[cx-1,cz],[cx,cz+1],[cx,cz-1]]) {
        if(nx<0||nz<0||nx>=game.width||nz>=game.height||!isRock(nx,nz))continue;
        const i=key(nx,nz);if(seen[i])continue;seen[i]=1;queue.push([nx,nz]);
      }
    }
    const edges=[];
    for(const [cx,cz] of cells) {
      if(!isRock(cx,cz-1))edges.push([[cx,cz],[cx+1,cz]]);
      if(!isRock(cx+1,cz))edges.push([[cx+1,cz],[cx+1,cz+1]]);
      if(!isRock(cx,cz+1))edges.push([[cx+1,cz+1],[cx,cz+1]]);
      if(!isRock(cx-1,cz))edges.push([[cx,cz+1],[cx,cz]]);
    }
    const starts=new Map();
    for(let i=0;i<edges.length;i++) {
      const [a]=edges[i],k=`${a[0]},${a[1]}`;
      if(!starts.has(k))starts.set(k,[]);starts.get(k).push(i);
    }
    const unused=new Set(edges.map((_,i)=>i)), loops=[];
    while(unused.size) {
      const first=unused.values().next().value, loop=[];let edgeIndex=first, guard=0;
      while(unused.has(edgeIndex)&&guard++<=edges.length) {
        unused.delete(edgeIndex);const [a,b]=edges[edgeIndex];loop.push(a);
        const next=starts.get(`${b[0]},${b[1]}`)?.find(i=>unused.has(i));
        if(next===undefined)break;edgeIndex=next;
        if(edges[edgeIndex][0][0]===edges[first][0][0]&&edges[edgeIndex][0][1]===edges[first][0][1])break;
      }
      if(loop.length>=3)loops.push(loop);
    }
    const area=loop=>Math.abs(loop.reduce((sum,p,i)=>{const q=loop[(i+1)%loop.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
    loops.sort((a,b)=>area(b)-area(a));
    const boundary=loops[0];if(!boundary)continue;
    // Add a midpoint with a small normal offset to every exposed tile edge.
    // Tangential coordinates stay fixed, preserving each edge's order while
    // breaking the long ruler-straight runs at strategic zoom.
    const boundaries=loops.map(loop=>{
      const points=[];
      for(let i=0;i<loop.length;i++) {
        const a=loop[i],b=loop[(i+1)%loop.length],dx=b[0]-a[0],dz=b[1]-a[1];
        points.push(a);
        const displacement=(hash(a[0]+b[0],a[1]-b[1],1110)-0.5)*0.34;
        points.push([(a[0]+b[0])*0.5-dz*displacement,(a[1]+b[1])*0.5+dx*displacement]);
      }
      return points;
    }),outline=boundaries[0];
    const makePath=points=>{const path=new THREE.Path();const p=vertex(...points[0]);path.moveTo(p[0],p[1]);
      for(let i=1;i<points.length;i++){const q=vertex(...points[i]);path.lineTo(q[0],q[1]);}path.closePath();return path;};
    const shape=new THREE.Shape(),first=vertex(...outline[0]);shape.moveTo(first[0],first[1]);
    for(let i=1;i<outline.length;i++){const q=vertex(...outline[i]);shape.lineTo(q[0],q[1]);}
    shape.closePath();
    for(const hole of boundaries.slice(1))shape.holes.push(makePath(hole));
    let top=new THREE.ShapeGeometry(shape,1);
    if(top.index) { const flat=top.toNonIndexed();top.dispose();top=flat; }
    const source=top.attributes.position;
    // Add two deterministic midpoint-subdivision rounds to the existing cap
    // triangulation. This supplies enough vertices for a shallow fractured
    // profile while preserving every authored boundary point and draw batch.
    const boundarySegments=boundaries.map(loop=>loop.map(point=>vertex(...point)));
    const boundaryDistanceCache=new Map();
    const distanceToBoundary=(px,pz)=>{
      const cacheKey=`${px},${pz}`;
      if(boundaryDistanceCache.has(cacheKey))return boundaryDistanceCache.get(cacheKey);
      let nearest=Infinity;
      for(const loop of boundarySegments)for(let i=0;i<loop.length;i++) {
        const a=loop[i],b=loop[(i+1)%loop.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const t=clamp(((px-a[0])*dx+(pz-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
        nearest=Math.min(nearest,Math.hypot(px-(a[0]+dx*t),pz-(a[1]+dz*t)));
      }
      boundaryDistanceCache.set(cacheKey,nearest);
      return nearest;
    };
    const subdivided=[];
    const splitTriangle=(a,b,c,depth)=>{
      if(depth===0) { subdivided.push(a,b,c);return; }
      const midpoint=(p,q)=>[(p[0]+q[0])*0.5,(p[1]+q[1])*0.5];
      const ab=midpoint(a,b),bc=midpoint(b,c),ca=midpoint(c,a);
      splitTriangle(a,ab,ca,depth-1);splitTriangle(ab,b,bc,depth-1);
      splitTriangle(ca,bc,c,depth-1);splitTriangle(ab,bc,ca,depth-1);
    };
    for(let i=0;i<source.count;i+=3) {
      // ShapeGeometry's XY winding reverses when remapped to world XZ.
      const a=[source.getX(i),source.getY(i)],b=[source.getX(i+2),source.getY(i+2)],c=[source.getX(i+1),source.getY(i+1)];
      splitTriangle(a,b,c,2);
    }
    const positions=[],colors=[];
    for(const [wx,wz] of subdivided) {
      const base=0.025+hash(Math.floor(wx*7),Math.floor(wz*7),1103)*0.04;
      const interior=smooth((clamp((distanceToBoundary(wx,wz)-0.10)/0.55,0,1)));
      const strata=Math.sin(wx*0.76+Math.sin(wz*0.35)*1.2)*Math.cos(wz*0.62-wx*0.17);
      const fracture=(hash(Math.floor(wx*2),Math.floor(wz*2),1201)-0.5)*0.024;
      const height=base+interior*(strata*0.045+fracture);
      positions.push(wx,height,wz);
      const tint=0.70+hash(Math.floor(wx*3),Math.floor(wz*3),1104)*0.24;
      const c=topColor.clone().lerp(light,0.08+hash(Math.floor(wx*4),Math.floor(wz*4),1105)*0.10)
        .multiplyScalar(tint*(1.0+interior*strata*0.045));
      colors.push(c.r,c.g,c.b);
    }
    top.dispose();top=new THREE.BufferGeometry();
    top.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    top.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    // Keep the cap and skirt attribute layouts identical for the one-batch
    // merge; normals are rebuilt after both surfaces are joined.
    top.deleteAttribute('normal');top.deleteAttribute('uv');pieces.push(top);
    const sidePositions=[],sideColors=[];
    for(const loop of boundaries)for(let i=0;i<loop.length;i++) {
      const a=vertex(...loop[i]),b=vertex(...loop[(i+1)%loop.length]);
      const ay=0.025+hash(Math.floor(a[0]*7),Math.floor(a[1]*7),1103)*0.04;
      const by=0.025+hash(Math.floor(b[0]*7),Math.floor(b[1]*7),1103)*0.04;
      // The outer lip rises only a few centimeters above adjacent sand so the
      // field reads as a rocky outcrop rather than a raised table.
      const bottom=-0.005-(hash(Math.floor((a[0]+b[0])*5),Math.floor((a[1]+b[1])*5),1106)*0.035);
      // The exposed rim carries compressed horizontal sediment bands. The
      // world-space phase keeps neighboring edge facets in the same strata,
      // while a soft threshold leaves enough variation for the cliff face to
      // read as layered stone at command zoom without adding another material
      // or draw call.
      const faceTint=0.56+hash(i,cells.length,1107)*0.15;
      const cuts=[0,0.22,0.49,0.76,1];
      const bandTints=[0.91,1.06,0.87,1.0];
      for(let layer=0;layer<cuts.length-1;layer++) {
        const low=cuts[layer],high=cuts[layer+1];
        const yAt=(base,top,t)=>base+(top-base)*t;
        const verts=[[a[0],yAt(bottom,ay,low),a[1]],[b[0],yAt(bottom,by,low),b[1]],
          [b[0],yAt(bottom,by,high),b[1]],[a[0],yAt(bottom,ay,low),a[1]],
          [b[0],yAt(bottom,by,high),b[1]],[a[0],yAt(bottom,ay,high),a[1]]];
        const layerTint=faceTint*bandTints[layer];
        for(const v of verts) {
          sidePositions.push(...v);
          const grain=(hash(Math.floor(v[0]*5),Math.floor(v[2]*5),1108)-0.5)*0.05;
          const tint=layerTint+grain;
          sideColors.push(skirtColor.r*tint,skirtColor.g*tint,skirtColor.b*tint);
        }
      }
    }
    const skirt=new THREE.BufferGeometry();
    skirt.setAttribute('position',new THREE.Float32BufferAttribute(sidePositions,3));
    skirt.setAttribute('color',new THREE.Float32BufferAttribute(sideColors,3));
    skirt.computeVertexNormals();skirtPieces.push(skirt);
  }
  const merge=list=>{if(!list.length)return new THREE.BufferGeometry();const g=mergeGeometries(list,false);list.forEach(p=>p.dispose());if(!g)return new THREE.BufferGeometry();g.computeVertexNormals();g.computeBoundingSphere();return g;};
  return {top:merge(pieces),skirt:merge(skirtPieces)};
}

function waterMaterial(timeUniform,mapId) {
  const stormBasin=mapId==='storm-basin';
  const material=mat(0xffffff,stormBasin?{roughness:0.84,metalness:0.07}:{roughness:0.27,metalness:0.31});
  const delta=mapId==='delta-crossing';
  material.customProgramCacheKey=()=>`water-flow:${delta?'delta':stormBasin?'storm':'default'}:v3`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.uWaterTime=timeUniform;
    shader.vertexShader=`varying vec2 vWaterXZ;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
       vWaterXZ=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xz;
       #else
       vWaterXZ=(modelMatrix*vec4(transformed,1.0)).xz;
       #endif`
    );
    shader.fragmentShader=`varying vec2 vWaterXZ; uniform float uWaterTime;\n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      delta?`#include <color_fragment>
       // Long, broken lanes run with the east-west river instead of making
       // repeated bright spots. Phase moves downstream across the whole map.
       float lane=sin(vWaterXZ.y*2.75+sin(vWaterXZ.x*0.31)*1.15-uWaterTime*0.57);
       float braid=sin(vWaterXZ.y*1.35+sin(vWaterXZ.x*0.21-uWaterTime*0.16)*1.4);
       float breakUp=0.5+0.5*sin(vWaterXZ.x*0.92+vWaterXZ.y*0.37-uWaterTime*0.68);
       float streak=pow(max(0.0,lane),11.0)*smoothstep(0.24,0.82,breakUp);
       diffuseColor.rgb*=0.86+0.055*lane+0.045*braid;
       diffuseColor.rgb+=vec3(0.035,0.12,0.115)*streak;`
      :stormBasin?`#include <color_fragment>
       // The storm basin's shallow causeways read as one connected bed of
       // cold, silted water. Broad current bands replace the tiny tile-like
       // highlights; a low, broken sheen keeps the surface alive at zoom.
       float current=sin(vWaterXZ.y*0.58+sin(vWaterXZ.x*0.12)*0.95-uWaterTime*0.19);
       float crossCurrent=sin(vWaterXZ.y*1.12+sin(vWaterXZ.x*0.075-uWaterTime*0.08)*1.1);
       float ripple=sin(vWaterXZ.x*0.83+vWaterXZ.y*0.37-uWaterTime*0.23);
       float sheen=pow(max(0.0,sin(vWaterXZ.x*0.21+vWaterXZ.y*0.34-uWaterTime*0.16)),8.0);
       diffuseColor.rgb*=0.91+0.045*current+0.025*crossCurrent+0.012*ripple;
       diffuseColor.rgb+=vec3(0.012,0.038,0.039)*sheen;`
      :`#include <color_fragment>
       float flow=sin(vWaterXZ.x*2.1+vWaterXZ.y*0.7+uWaterTime*0.85);
       float crossWave=sin(vWaterXZ.y*3.3-vWaterXZ.x*0.5-uWaterTime*0.55);
       float glint=pow(max(0.0,flow*crossWave),5.0);
       diffuseColor.rgb*=0.91+0.075*flow+0.035*crossWave;
       diffuseColor.rgb+=vec3(0.10,0.22,0.21)*glint;`
    );
  };
  return material;
}

function fogMaterial(timeUniform, fogTexture, fogSize, fogQualityUniform, style) {
  const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:1,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  // Keep the unknown field cool and concealed on every theater; only a small
  // share of the local palette tints the mist.
  const mist=new THREE.Color(0x42666a).lerp(new THREE.Color(style.mist),0.18).multiplyScalar(0.38);
  const mistColor=`vec3(${mist.r.toFixed(4)},${mist.g.toFixed(4)},${mist.b.toFixed(4)})`;
  material.customProgramCacheKey=()=>`shroud:${style.mist}`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.uFogTime=timeUniform;
    shader.uniforms.uFogMap={value:fogTexture};
    shader.uniforms.uFogSize={value:new THREE.Vector2(fogSize.width,fogSize.height)};
    shader.uniforms.uFogQuality=fogQualityUniform;
    shader.vertexShader=`varying vec2 vFogWorld;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vFogWorld=(modelMatrix*vec4(transformed,1.0)).xz;`
    );
    shader.fragmentShader=`varying vec2 vFogWorld; uniform float uFogTime; uniform float uFogQuality; uniform sampler2D uFogMap; uniform vec2 uFogSize;
      float fogHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float fogNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(fogHash(i),fogHash(i+vec2(1.0,0.0)),f.x),mix(fogHash(i+vec2(0.0,1.0)),fogHash(i+vec2(1.0,1.0)),f.x),f.y);}
      \n${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       // Interpolate the full visibility field across tile centers. This
       // rounds corners and avoids a separate square silhouette per tile.
       vec2 drift=vec2(fogNoise(vFogWorld*0.42),fogNoise(vFogWorld*0.42+vec2(17.3,9.7)))-0.5;
       vec2 sampleUV=clamp((vFogWorld+drift*0.22)/uFogSize,vec2(0.0),vec2(1.0));
       float visibility=texture2D(uFogMap,sampleUV).r*2.0;
       // Previously scouted terrain remains legible as a dim map. The unknown
       // field stays nearly opaque so its route geometry cannot be inspected.
       float veil=mix(0.93,0.50,clamp(visibility,0.0,1.0))*(1.0-smoothstep(1.0,2.0,visibility));
       float cloud=sin(vFogWorld.x*0.23+uFogTime*0.12)*sin(vFogWorld.y*0.19-uFogTime*0.09);
       float billow=0.5;
       if(uFogQuality>1.5) billow=fogNoise(vFogWorld*0.16+drift*0.38+vec2(uFogTime*0.012,-uFogTime*0.009));
       float vapor=cloud*0.5+(billow-0.5)*0.7;
       // Each theater carries its own quiet mist hue. Color comes from the
       // map palette, not the concealed terrain below the shroud.
       vec3 shroud=${mistColor};
       vec3 exploredShroud=shroud*0.78;
       diffuseColor.rgb=mix(shroud,exploredShroud,clamp(visibility,0.0,1.0));
       diffuseColor.rgb += shroud*0.55*vapor;
       diffuseColor.a *= veil;`
    );
  };
  return material;
}

function addMesh(parent, geometry, material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function box(parent, material, w, h, d, x = 0, y = 0, z = 0) {
  return addMesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

function cylinder(parent, material, rt, rb, h, sides, x = 0, y = 0, z = 0) {
  return addMesh(parent, new THREE.CylinderGeometry(rt, rb, h, sides), material, x, y, z);
}

function cone(parent, material, r, h, sides, x = 0, y = 0, z = 0) {
  return addMesh(parent, new THREE.ConeGeometry(r, h, sides), material, x, y, z);
}

function disc(parent, material, radius, thickness = 0.025, x = 0, y = 0, z = 0) {
  return cylinder(parent, material, radius, radius, thickness, 32, x, y, z);
}

// GLTFLoader sanitizes Blender object names (spaces become underscores and
// periods disappear). Resolve the source spelling as well so authored motion
// survives import without renaming every mesh in the asset generator.
function authoredPart(root,name) {
  return root.getObjectByName(name)||root.getObjectByName(name.replace(/\s+/g,'_').replace(/\./g,''));
}

// Authored GLBs contain separate, named meshes at the scene root. Reparenting
// these cloned meshes gives a moving assembly a pivot without changing any
// source geometry or the original asset used by other entities.
function animatedPivot(root, names, x, y, z) {
  const parts = names.map(name => authoredPart(root,name));
  if (parts.some(part => !part || part.parent !== root)) return null;
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  root.add(pivot);
  for (const part of parts) {
    pivot.add(part);
    part.position.sub(pivot.position);
  }
  return pivot;
}

function emissiveParts(root, names) {
  return names.map(name => authoredPart(root,name)).filter(Boolean).map(mesh => {
    const material = Array.isArray(mesh.material) ? mesh.material.find(m => m.emissive) : mesh.material;
    return material?.emissive ? { material, intensity: material.emissiveIntensity } : null;
  }).filter(Boolean);
}

function factionMaterials(faction) {
  const aegis = faction === 'aegis';
  return {
    armor: mat(aegis ? 0x839ca1 : 0x956c61, { metalness: 0.43, roughness: 0.49 }),
    light: mat(aegis ? 0xb4d0d0 : 0xd99a7d, { metalness: 0.37, roughness: 0.45 }),
    dark: mat(aegis ? 0x1b333d : 0x3d2931, { metalness: 0.28 }),
    recess: mat(aegis ? 0x152a32 : 0x291f29, { metalness: 0.42 }),
    accent: mat(aegis ? 0x49d6ed : 0xff765e, { emissive: aegis ? 0x0e9cbb : 0xcc351f, emissiveIntensity: 1.85, metalness: 0.2 }),
    glass: mat(aegis ? 0x74edf0 : 0xffa579, { emissive: aegis ? 0x138b9b : 0xa64726, emissiveIntensity: 0.9, metalness: 0.55, roughness: 0.22 }),
  };
}

function makeUnit(defId, faction) {
  const g = new THREE.Group();
  const m = factionMaterials(faction);
  const infantry = /^(scout|rifle|rocket|engineer|medic|flamer)$/.test(defId);
  const flying = /^(orca|apache|dropship)$/.test(defId);
  if (infantry) {
    // Readable top-down silhouette: armored shoulders, helmet and a forward weapon.
    cylinder(g, m.dark, 0.16, 0.13, 0.06, 8, 0, 0.06, 0);
    box(g, m.armor, 0.19, 0.28, 0.17, 0, 0.28, 0);
    box(g, m.light, 0.25, 0.10, 0.13, 0, 0.38, 0);
    const helmet = cylinder(g, m.dark, 0.105, 0.12, 0.14, 8, 0, 0.52, 0);
    helmet.rotation.z = 0.08;
    // A wider luminous IFF bar keeps infantry readable at the default RTS
    // camera distance without adding a separate material or draw call.
    box(g, m.accent, 0.20, 0.055, 0.04, 0, 0.55, -0.105);
    g.userData.motionLegs = [];
    for (const x of [-0.075, 0.075]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.22, 0.035);
      box(leg, m.dark, 0.055, 0.22, 0.065, 0, -0.10, 0);
      g.add(leg);
      g.userData.motionLegs.push(leg);
    }
    box(g, m.recess, 0.05, 0.055, defId === 'rocket' ? 0.42 : 0.31, 0.12, 0.35, -0.18);
    if (defId === 'rocket') {
      cylinder(g, m.armor, 0.075, 0.075, 0.37, 8, 0.14, 0.43, -0.09).rotation.x = Math.PI / 2;
      cone(g, m.accent, 0.068, 0.12, 6, 0.14, 0.43, -0.33).rotation.x = -Math.PI / 2;
    }
    if (defId === 'medic' || defId === 'engineer') box(g, m.accent, 0.11, 0.025, 0.09, 0, 0.43, 0.085);
    if (defId === 'flamer') cylinder(g, m.accent, 0.06, 0.06, 0.16, 8, -0.12, 0.31, 0.07);
    return g;
  }
  if (flying) {
    const fuselage = box(g, m.armor, 0.31, 0.22, 0.85, 0, 0.18, 0);
    fuselage.rotation.x = -0.07;
    box(g, m.glass, 0.24, 0.12, 0.27, 0, 0.32, -0.23);
    box(g, m.light, 1.05, 0.07, 0.25, 0, 0.17, 0.03);
    box(g, m.dark, 0.66, 0.05, 0.16, 0, 0.23, 0.36);
    box(g, m.accent, 0.16, 0.05, 0.08, -0.47, 0.15, 0.025);
    box(g, m.accent, 0.16, 0.05, 0.08, 0.47, 0.15, 0.025);
    cylinder(g, m.recess, 0.20, 0.20, 0.035, 12, 0, 0.36, 0);
    const rotor = new THREE.Group();
    rotor.position.set(0, 0.39, 0);
    box(rotor, m.dark, 0.88, 0.018, 0.055);
    box(rotor, m.dark, 0.055, 0.018, 0.88);
    g.add(rotor);
    g.userData.motionRotor = rotor;
    for (const x of [-0.38, 0.38]) cylinder(g, m.dark, 0.09, 0.09, 0.20, 8, x, 0.10, 0.03);
    return g;
  }
  const large = /^(harvester|mcv|guardian)$/.test(defId);
  const size = large ? 1.2 : 1;
  g.scale.setScalar(size);
  // Treads, beveled hull and top turret give vehicles an unmistakable RTS silhouette.
  box(g, m.dark, 0.82, 0.19, 0.93, 0, 0.18, 0);
  g.userData.motionWheels = [];
  for (const x of [-0.36, 0.36]) {
    box(g, m.recess, 0.19, 0.23, 0.94, x, 0.16, 0);
    for (const z of [-0.31, 0, 0.31]) {
      const wheel = cylinder(g, m.light, 0.085, 0.085, 0.21, 10, x, 0.10, z);
      wheel.rotation.z = Math.PI / 2;
      g.userData.motionWheels.push(wheel);
    }
  }
  const hull = cylinder(g, m.armor, 0.43, 0.48, 0.17, 6, 0, 0.34, 0);
  hull.rotation.y = Math.PI / 6;
  // Put the faction color on the visible top deck: the nose stripe is easy to
  // lose in the oblique tactical view, while this one existing mesh reads as
  // a clear cyan / ember unit marker from above.
  box(g, m.accent, 0.34, 0.045, 0.11, 0, 0.45, -0.03);
  if (defId === 'harvester') {
    box(g, m.recess, 0.59, 0.19, 0.46, 0, 0.48, 0.06);
    for (const x of [-0.17, 0, 0.17]) cone(g, m.glass, 0.09, 0.29, 5, x, 0.65, 0.1);
    box(g, m.light, 0.64, 0.07, 0.12, 0, 0.33, -0.5);
  } else if (defId === 'mcv') {
    box(g, m.light, 0.42, 0.26, 0.44, 0, 0.55, 0.06);
    cylinder(g, m.accent, 0.10, 0.10, 0.55, 8, 0, 0.86, 0.12);
  } else {
    const turret = cylinder(g, m.light, 0.25, 0.30, 0.16, 8, 0, 0.51, -0.08);
    turret.rotation.y = Math.PI / 8;
    const length = defId === 'artillery' ? 0.75 : 0.53;
    cylinder(g, m.dark, 0.055, 0.075, length, 8, 0, 0.55, -0.25 - length / 2).rotation.x = Math.PI / 2;
    if (defId === 'artillery') box(g, m.accent, 0.26, 0.06, 0.16, 0, 0.61, 0.09);
    if (defId === 'guardian') for (const x of [-0.13, 0.13]) cylinder(g, m.dark, 0.045, 0.055, 0.65, 8, x, 0.58, -0.52).rotation.x = Math.PI / 2;
  }
  return g;
}

function makeBuilding(defId, faction, w, h) {
  const g = new THREE.Group();
  const m = factionMaterials(faction);
  const W = Math.max(0.7, w - 0.22), D = Math.max(0.7, h - 0.22);
  box(g, m.recess, W + 0.1, 0.14, D + 0.1, 0, 0.09, 0);
  box(g, m.armor, W * 0.86, 0.44, D * 0.86, 0, 0.36, 0);
  // Corner stanchions and lit fascia make each base legible at a distance.
  for (const x of [-W * 0.38, W * 0.38]) for (const z of [-D * 0.38, D * 0.38]) {
    box(g, m.dark, 0.16, 0.53, 0.16, x, 0.39, z);
    box(g, m.accent, 0.17, 0.05, 0.17, x, 0.68, z);
  }
  box(g, m.accent, W * 0.57, 0.045, 0.08, 0, 0.47, -D * 0.44);
  const roof = (aw = 0.72, ad = 0.72, y = 0.64) => box(g, m.light, W * aw, 0.15, D * ad, 0, y, 0);
  switch (defId) {
    case 'command':
      roof(0.67, 0.67, 0.69);
      box(g, m.dark, W * 0.48, 0.29, D * 0.43, 0, 0.87, 0.06);
      box(g, m.glass, W * 0.34, 0.10, D * 0.25, 0, 1.04, -0.11);
      for (const x of [-0.53, 0.53]) cylinder(g, m.accent, 0.075, 0.10, 0.65, 6, x, 1.06, 0.39);
      break;
    case 'power': case 'advancedPower':
      roof(0.7, 0.66, 0.62);
      for (const x of [-W * 0.22, W * 0.22]) {
        cylinder(g, m.dark, 0.26, 0.33, 0.68, 8, x, 0.98, 0);
        cylinder(g, m.glass, 0.17, 0.17, 0.37, 8, x, 1.15, 0);
        cylinder(g, m.light, 0.21, 0.21, 0.07, 8, x, 1.38, 0);
      }
      break;
    case 'refinery':
      roof(0.57, 0.65, 0.65);
      cylinder(g, m.dark, 0.36, 0.41, 0.57, 10, W * 0.20, 0.98, D * 0.03);
      cylinder(g, m.glass, 0.27, 0.27, 0.33, 10, W * 0.20, 1.02, D * 0.03);
      box(g, m.light, W * 0.33, 0.11, D * 0.27, -W * 0.22, 0.79, -D * 0.1);
      break;
    case 'factory':
      roof(0.84, 0.72, 0.73);
      box(g, m.recess, W * 0.42, 0.3, D * 0.4, 0, 0.85, -D * 0.12);
      box(g, m.accent, W * 0.3, 0.08, 0.08, 0, 0.83, -D * 0.42);
      for (const x of [-W * 0.25, W * 0.25]) box(g, m.light, 0.15, 0.33, D * 0.5, x, 0.87, 0);
      break;
    case 'radar':
      roof();
      cylinder(g, m.dark, 0.08, 0.17, 0.76, 8, 0, 1.03, 0);
      cylinder(g, m.accent, 0.47, 0.47, 0.035, 20, 0, 1.48, 0).rotation.x = 0.33;
      cylinder(g, m.light, 0.28, 0.28, 0.03, 16, 0, 1.51, 0).rotation.x = 0.33;
      break;
    case 'turret': case 'guardTower': case 'aaTower': case 'sam':
      cylinder(g, m.dark, 0.30, 0.37, 0.70, 8, 0, 0.88, 0);
      cylinder(g, m.light, 0.31, 0.33, 0.18, 8, 0, 1.33, 0);
      for (const x of defId === 'aaTower' || defId === 'sam' ? [-0.12, 0.12] : [0])
        cylinder(g, m.recess, 0.055, 0.08, 0.54, 8, x, 1.37, -0.31).rotation.x = Math.PI / 2;
      break;
    case 'obelisk': case 'superweapon': case 'warhead':
      roof(0.63, 0.63, 0.65);
      cylinder(g, m.dark, 0.25, 0.44, 1.14, 6, 0, 1.26, 0);
      cylinder(g, m.accent, 0.12, 0.21, 0.90, 6, 0, 1.45, 0);
      cone(g, m.glass, 0.29, 0.68, 5, 0, 2.11, 0);
      break;
    case 'helipad':
      roof(0.88, 0.88, 0.64);
      disc(g, m.dark, Math.min(W, D) * 0.37, 0.035, 0, 0.73, 0);
      disc(g, m.accent, Math.min(W, D) * 0.24, 0.012, 0, 0.76, 0);
      box(g, m.dark, 0.08, 0.025, 0.43, 0, 0.78, 0);
      break;
    case 'silo':
      for (const x of [-W * 0.23, W * 0.23]) cylinder(g, m.light, 0.27, 0.31, 0.72, 10, x, 0.91, 0);
      break;
    default:
      roof(0.68, 0.68, 0.65);
      box(g, m.dark, W * 0.5, 0.36, D * 0.46, 0, 0.89, 0);
      box(g, m.glass, W * 0.33, 0.08, D * 0.22, 0, 1.08, -D * 0.14);
      if (defId === 'tech') cylinder(g, m.accent, 0.12, 0.12, 0.52, 8, 0, 1.36, 0);
  }
  return g;
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.clientWidth || 800;
    this.height = canvas.clientHeight || 600;
    this.quality = 'ultra';
    this.reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.ruinCapacity=GRAPHICS_QUALITY[this.quality].ruinCapacity;
    this.ruinRubblePieces=GRAPHICS_QUALITY[this.quality].ruinRubblePieces;
    this.collapseCapacity=GRAPHICS_QUALITY[this.quality].collapseCapacity;
    this.environmentPropCapacity=GRAPHICS_QUALITY[this.quality].environmentPropCapacity;
    this.groundQualityUniform = { value: 2 };
    this.sandWindTimeUniform = {value:0};
    this.vegetationWindMotionUniform = {value:1};
    this.dpr = Math.min(window.devicePixelRatio || 1, GRAPHICS_QUALITY[this.quality].maxDpr);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.FogExp2(SKY, 0.007);
    // One camera-facing sky card adds a soft, theater-colored horizon behind
    // the map silhouette without adding terrain objects or obscuring fog.
    this.skyTexture = null;
    this.skyBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({map:null,color:0xffffff,depthWrite:false,fog:false,toneMapped:false}));
    this.skyBackdrop.renderOrder = -10;
    this.scene.add(this.skyBackdrop);
    this.clearSky = new THREE.Color(SKY);
    this.stormSky = new THREE.Color(0x342f49);
    this.stormLight = new THREE.Color(0xb9a9df);
    this.stormAmbientGround = new THREE.Color(0x28263c);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 220);
    this.camera.up.set(0, 1, 0);
    this.cameraDirection = new THREE.Vector3(1, 1.24, 1).normalize();
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmpVec = new THREE.Vector3();
    this.tmpObj = new THREE.Object3D();
    this.dustMoteTransform = new THREE.Object3D();
    this.dustMoteRollAxis = new THREE.Vector3(0, 0, 1);
    this.dustMoteRoll = new THREE.Quaternion();
    this.wheelAxis = new THREE.Vector3(0, 1, 0);
    this.tmpWheelQuat = new THREE.Quaternion();
    this.terrainGroup = new THREE.Group();
    this.entityGroup = new THREE.Group();
    this.effectGroup = new THREE.Group();
    this.orderGroup = new THREE.Group();
    this.scene.add(this.terrainGroup, this.entityGroup, this.orderGroup, this.effectGroup);
    // A single reusable, broken circle gives the selected weapon's actual
    // reach without adding a ring to every unit in a large army.
    const rangeSegments=[];
    for(let i=0;i<96;i++) {
      if(i%4===3) continue;
      const a=i*Math.PI*2/96,b=(i+1)*Math.PI*2/96;
      rangeSegments.push(Math.cos(a),0,Math.sin(a),Math.cos(b),0,Math.sin(b));
    }
    const rangeGeometry=new THREE.BufferGeometry();
    rangeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rangeSegments,3));
    this.rangeIndicator=new THREE.LineSegments(rangeGeometry,new THREE.LineBasicMaterial({
      color:0xc9f88c,transparent:true,opacity:0.62,depthWrite:false,depthTest:true,
      fog:false,toneMapped:false,
    }));
    this.rangeIndicator.visible=false;
    this.rangeIndicator.position.y=0.11;
    this.rangeIndicator.renderOrder=5;
    this.scene.add(this.rangeIndicator);
    // A selected tank exposes the combat bearing rule in the world itself.
    // Both arcs share one tiny line draw, and old replay versions omit it.
    const armorArcPositions=[],armorArcColors=[];
    for(const [start,color] of [[-Math.PI/3,new THREE.Color(0x75e8cf)],
      [2*Math.PI/3,new THREE.Color(0xffad6b)]]) {
      for(let i=0;i<18;i++) {
        const a=start+i*(2*Math.PI/3)/18,b=start+(i+1)*(2*Math.PI/3)/18;
        for(const [angle,radius] of [[a,0.80],[a,0.96],[b,0.96],
          [a,0.80],[b,0.96],[b,0.80]]) {
          armorArcPositions.push(Math.cos(angle)*radius,0,Math.sin(angle)*radius);
          armorArcColors.push(color.r,color.g,color.b);
        }
      }
    }
    const armorArcGeometry=new THREE.BufferGeometry();
    armorArcGeometry.setAttribute('position',new THREE.Float32BufferAttribute(armorArcPositions,3));
    armorArcGeometry.setAttribute('color',new THREE.Float32BufferAttribute(armorArcColors,3));
    this.armorFacingIndicator=new THREE.Mesh(armorArcGeometry,new THREE.MeshBasicMaterial({
      vertexColors:true,transparent:true,opacity:0.86,depthWrite:false,depthTest:true,side:THREE.DoubleSide,
      fog:false,toneMapped:false,
    }));
    this.armorFacingIndicator.visible=false;
    this.armorFacingIndicator.position.y=0.17;
    this.armorFacingIndicator.renderOrder=5;
    this.scene.add(this.armorFacingIndicator);
    // A lower raking key light puts longer, readable shadows across the
    // faceted ground and structures at tactical scale.
    this.sun = new THREE.DirectionalLight(0xffddb0, 3.25);
    this.sun.position.set(-21, 25, -15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(GRAPHICS_QUALITY[this.quality].shadowMapSize, GRAPHICS_QUALITY[this.quality].shadowMapSize);
    this.sun.shadow.camera.left = -31;
    this.sun.shadow.camera.right = 31;
    this.sun.shadow.camera.top = 31;
    this.sun.shadow.camera.bottom = -31;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 95;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.hemisphere = new THREE.HemisphereLight(0xb5dbdb, 0x18231e, 0.88);
    this.scene.add(this.hemisphere);
    this.rimLight = new THREE.DirectionalLight(0x61cde1, 1.28);
    this.rimLight.position.set(12, 13, 18);
    this.scene.add(this.rimLight);
    this.terrain = null;
    this.terrainCache = [];
    this.resourceCache = [];
    this.fogCache = [];
    this.entities = new Map();
    this.entitySyncLive = new Set();
    this.entitySyncSelected = new Set();
    this.entitySyncAcquiredTargets = new Set();
    this.vehicleBuckets = new Map();
    this.vehicleBucketPool = [];
    this.effects = new Map();
    this.scorches = new Map();
    this.maxScorches = 48;
    this.orderMarkers = new Map();
    this.fieldOrderMarker = null;
    this.campaignRouteMarker = null;
    this.fogTexture = null;
    this.bridgeVisuals = new Map();
    this.bridgeVisualState = '';
    // Last fully observed bridge state, keyed by the current terrain object so
    // hidden damage changes cannot leak through explored fog.
    this.bridgeKnownStates = new WeakMap();
    this.crystalMesh = null;
    this.crystalTiles = new Map();
    this.decorativeCrystalTiles = new Map();
    this.environmentPropInstances = new Map();
    this.environmentPropGroup = null;
    this.macroLandmarkPlacements = [];
    this.stormArrayGroup = null;
    this.stormArrayTileIndex = -1;
    this.sandFormationMesh = null;
    this.sandFormationInstances = new Map();
    this.crystalStride = 3;
    this.fogTimeUniform = {value:0};
    this.waterTimeUniform = {value:0};
    this.smokeTexture = null;
    // One reusable, soft ground puff per moving ground unit. The population is
    // bounded by the visible entity count and meshes are created lazily.
    this.dustGeometry = new THREE.SphereGeometry(0.22, 8, 5);
    this.dustMaterial = new THREE.MeshBasicMaterial({color:0xb5a88a,transparent:true,opacity:0,depthWrite:false,toneMapped:false});
    this.trackCapacity=GRAPHICS_QUALITY[this.quality].trackCapacity;
    this.trackCursor=0;
    this.trackStamps=Array.from({length:this.trackCapacity},()=>({born:-Infinity}));
    this.trackMesh=null;
    this.wreckVisuals=new Map();
    this.wreckGroup=null;
    this.ruinTimeUniform={value:0};
    this.ruinVisuals=new Map();
    this.ruinBatches=null;
    this.ruinGroup=null;
    this.ruinSignature='';
    this.collapseVisuals=new Map();
    this._makeVehicleTracks();
    this.groundPatchTexture = null;
    this.placement = null;
    this.relays = new Map();
    this.salvageDropVisual = null;
    this.salvageDropModelVersion = 0;
    this.stormVisual = null;
    this.stormLureVisual = null;
    this.stormglassBloomVisual = null;
    this.atmosphereTexture = this._makeAtmosphereTexture();
    this.atmosphere = addMesh(this.scene, new THREE.PlaneGeometry(180, 150),
      new THREE.MeshBasicMaterial({color:0x39535a,map:this.atmosphereTexture,transparent:true,opacity:0.54,depthWrite:false,side:THREE.DoubleSide}),
      0,-0.96,0,false);
    this.atmosphere.rotation.x=-Math.PI/2;
    this.atmosphere.renderOrder=-2;
    this.dustField = null;
    this.dustFieldData = null;
    this.sunBaseColor = this.sun.color.clone();
    this.sunBaseIntensity = this.sun.intensity;
    this.rimBaseColor = this.rimLight.color.clone();
    this.rimBaseIntensity = this.rimLight.intensity;
    this.ambientBaseSky = this.hemisphere.color.clone();
    this.ambientBaseGround = this.hemisphere.groundColor.clone();
    this.ambientBaseIntensity = this.hemisphere.intensity;
    this.assetModels = new Map();
    this.assetVersions = new Map();
    const loader = new GLTFLoader();
    const modelLoads=[];
    for (const [key,file] of Object.entries({
      command:'command-yard.glb', power:'power-plant.glb', advancedPower:'advanced-power.glb',
      refinery:'refinery.glb', barracks:'barracks.glb', factory:'factory.glb', serviceBay:'service-bay.glb',
      silo:'crystal-silo.glb',
      vesperCommand:'vesper-command-yard.glb', vesperPower:'vesper-power-plant.glb',
      vesperRefinery:'vesper-refinery.glb', vesperBarracks:'vesper-barracks.glb', vesperFactory:'vesper-factory.glb',
      vesperRadar:'vesper-radar-array.glb', vesperTech:'vesper-research-center.glb',
      radar:'radar-array.glb', turret:'defense-turret.glb', wall:'modular-wall.glb', obelisk:'signal-obelisk.glb',
      helipad:'helipad.glb', tech:'research-center.glb', guardTower:'aegis-watchtower.glb',
      aaTower:'skyshield-battery.glb', sam:'vesper-sam.glb',
      superweapon:'ion-spire.glb', warhead:'warhead-temple.glb',
      relay:'resonance-relay.glb',
      salvageDrop:'salvage-pod.glb',
      lightTank:'striker-tank.glb', apc:'apc.glb',
      harvester:'harvester.glb', vesperHarvester:'vesper-harvester.glb', crystal:'crystal-cluster.glb',
      scout:'scout.glb', scoutVesper:'vesper-scout.glb', rifle:'rifle-infantry.glb', rocket:'rocket-infantry.glb',
      engineer:'engineer.glb', medic:'medic.glb', flamer:'flamer.glb',
      mcv:'mcv.glb', stealthTank:'stealth-tank.glb', buggy:'recon-buggy.glb', vesperBuggy:'vesper-recon-buggy.glb',
      artillery:'siege-crawler.glb', orca:'gunship.glb', apache:'apache.glb', dropship:'dropship.glb',
      crashedDropship:'crashed-dropship.glb',
    })) {
      modelLoads.push(loader.loadAsync(`/assets/models/${file}`).then(gltf => {
        gltf.scene.updateMatrixWorld(true);
        compactAuthoredModel(gltf.scene,key);
        this.assetModels.set(key,gltf.scene);
        this.assetVersions.set(key,(this.assetVersions.get(key)||0)+1);
        if(key==='crystal'||key==='crashedDropship') this.terrain=null;
      }).catch(err=>console.warn(`3D asset ${file} unavailable; using procedural model.`,err)));
    }
    const environmentFiles={
      mast:'collapsed-comms-mast.glb',cargo:'industrial-cargo-stacks.glb',
      growthFan:'crystal-growth-fan.glb',growthSpire:'crystal-growth-spire.glb',
      basalt:'basalt-spires.glb',mesa:'basalt-mesa.glb',stormArray:'storm-array.glb',
      trackWreck:'shard-track-wreck.glb',
      passGate:'landmark-twin-pass-gate.glb',spillway:'landmark-delta-spillway.glb',
      oreHoist:'landmark-canyon-orehoist.glb',
    };
    const environmentLoad=Promise.allSettled(Object.entries(environmentFiles).map(async ([key,file])=>{
      const gltf=await loader.loadAsync(`/assets/models/${file}`);
      gltf.scene.updateMatrixWorld(true);
      return [key,gltf.scene];
    })).then(results=>{
      if(!this.renderer)return;
      for(let i=0;i<results.length;i++) {
        const result=results[i];
        if(result.status==='fulfilled') this.assetModels.set(...result.value);
        else console.warn(`3D environment asset ${Object.values(environmentFiles)[i]} unavailable.`,result.reason);
      }
      this.terrain=null;
    });
    // Defer the first visible frame until authored assets settle. A bounded
    // fallback keeps the game launchable if a slow connection never finishes.
    this.assetsReady=new Promise(resolve=>{
      const timeout=setTimeout(resolve,5000);
      Promise.allSettled([...modelLoads,environmentLoad]).then(()=>{
        clearTimeout(timeout);
        resolve();
      });
    });
    this.centerX = 32;
    this.centerY = 24;
    this.zoom = 1;
    this._unitBob = [];
    this.resize(this.width, this.height, this.dpr);
  }

  _makeAtmosphereTexture() {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');
    const haze=ctx.createRadialGradient(128,128,8,128,128,126);
    haze.addColorStop(0,'rgba(255,255,255,0.30)');
    haze.addColorStop(0.35,'rgba(255,255,255,0.21)');
    haze.addColorStop(0.68,'rgba(255,255,255,0.10)');
    haze.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=haze;ctx.fillRect(0,0,256,256);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }

  _makeTrackTexture() {
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=128;
    const ctx=canvas.getContext('2d');
    const edge=ctx.createLinearGradient(0,0,64,0);
    edge.addColorStop(0,'rgba(0,0,0,0)');edge.addColorStop(0.22,'rgba(255,255,255,0.37)');
    edge.addColorStop(0.5,'rgba(255,255,255,0.84)');edge.addColorStop(0.78,'rgba(255,255,255,0.37)');edge.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=edge;ctx.fillRect(0,0,64,128);
    // Broken cross bars suggest tire lugs while the soft longitudinal edges
    // keep the stamps from reading as hard-edged UI marks at strategic zoom.
    ctx.globalCompositeOperation='destination-out';
    for(let y=8;y<128;y+=13) {ctx.fillStyle=`rgba(0,0,0,${0.22+(y%3)*0.06})`;ctx.fillRect(11,y,42,3);}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
    return texture;
  }

  _makeVehicleTracks() {
    const geometry=new THREE.PlaneGeometry(1,1);
    geometry.setAttribute('aTrackBirth',new THREE.InstancedBufferAttribute(new Float32Array(this.trackCapacity),1));
    const material=new THREE.MeshBasicMaterial({color:0x655d4d,map:this.trackTexture||(this.trackTexture=this._makeTrackTexture()),
      transparent:true,opacity:0.58,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
    material.onBeforeCompile=shader=>{
      shader.uniforms.uTrackTime={value:0};
      this.trackTimeUniform=shader.uniforms.uTrackTime;
      shader.vertexShader=`attribute float aTrackBirth; varying float vTrackAge;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>','#include <begin_vertex>\n vTrackAge=max(0.0,uTrackTime-aTrackBirth);');
      shader.vertexShader=shader.vertexShader.replace('attribute float aTrackBirth; varying float vTrackAge;','attribute float aTrackBirth; varying float vTrackAge; uniform float uTrackTime;');
      shader.fragmentShader=`varying float vTrackAge; uniform float uTrackTime;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.a *= 1.0-smoothstep(18.0,34.0,vTrackAge);');
    };
    const mesh=new THREE.InstancedMesh(geometry,material,this.trackCapacity);
    mesh.count=this.trackCapacity;mesh.frustumCulled=false;mesh.renderOrder=1;
    const birthAttribute=geometry.getAttribute('aTrackBirth');
    for(let i=0;i<this.trackCapacity;i++) {
      this.tmpObj.position.set(0,-20,0);this.tmpObj.scale.set(0,0,0);this.tmpObj.updateMatrix();mesh.setMatrixAt(i,this.tmpObj.matrix);
      birthAttribute.setX(i,-10000);
    }
    mesh.instanceMatrix.needsUpdate=true;birthAttribute.needsUpdate=true;
    this.trackMesh=mesh;this.scene.add(mesh);
    this.trackDirty=false;
  }

  _clearVehicleTracks() {
    this.trackCursor=0;
    for(let i=0;i<this.trackCapacity;i++) {
      this.trackStamps[i].born=-Infinity;
      this.tmpObj.position.set(0,-20,0);this.tmpObj.scale.set(0,0,0);this.tmpObj.updateMatrix();this.trackMesh.setMatrixAt(i,this.tmpObj.matrix);
      this.trackMesh.geometry.getAttribute('aTrackBirth').setX(i,-10000);
    }
    this.trackDirty=true;
  }

  _stampVehicleTracks(x,z,dx,dz,time,game) {
    const tileX=Math.floor(x),tileZ=Math.floor(z);
    const length=game.width;
    if(tileX<0||tileZ<0||tileZ>=game.height||tileX>=length||this.terrainCache[tileZ*length+tileX]!=='sand') return;
    // Enemy tracks only begin while the vehicle is directly observed. Their
    // marks can then persist on already revealed ground without leaking fog.
    const fog=game.fog?.[tileZ]?.[tileX]??2;
    if(fog===0) return;
    const yaw=Math.atan2(-dx,-dz);
    const rearX=x-dx*0.25,rearZ=z-dz*0.25;
    // The plane starts in XY; yaw must be applied around world Y after it is
    // laid onto the ground. The two stamps offset along the path normal.
    this.tmpObj.rotation.order='YXZ';
    for(const side of [-1,1]) {
      const i=this.trackCursor++%this.trackCapacity;
      const stamp=this.trackStamps[i];stamp.born=time;
      this.tmpObj.position.set(rearX-dz*0.18*side,0.012,rearZ+dx*0.18*side);
      this.tmpObj.rotation.set(-Math.PI/2,yaw,0);
      this.tmpObj.scale.set(0.14,0.60,1);this.tmpObj.updateMatrix();
      this.trackMesh.setMatrixAt(i,this.tmpObj.matrix);
      this.trackMesh.geometry.getAttribute('aTrackBirth').setX(i,time);
    }
    this.tmpObj.rotation.order='XYZ';
    this.trackMesh.instanceMatrix.needsUpdate=true;
    this.trackMesh.geometry.getAttribute('aTrackBirth').needsUpdate=true;
    this.trackDirty=false;
  }

  _makeWreckBatch() {
    const group=new THREE.Group();
    const capacity=96;
    const parts=[
      {geometry:new THREE.BoxGeometry(0.72,0.20,0.92),material:mat(0xffffff,{roughness:0.94,metalness:0.16})},
      {geometry:new THREE.BoxGeometry(0.42,0.12,0.48),material:mat(0xffffff,{roughness:0.91,metalness:0.2})},
      {geometry:new THREE.BoxGeometry(0.13,0.13,0.78),material:mat(0xffffff,{roughness:0.98,metalness:0.1})},
      {geometry:new THREE.OctahedronGeometry(0.17,0),material:new THREE.MeshBasicMaterial({color:0xffdb84,transparent:true,opacity:0.96,depthTest:false,depthWrite:false,toneMapped:false})},
      {geometry:new THREE.RingGeometry(0.64,0.72,28),material:new THREE.MeshBasicMaterial({color:0xffbd55,transparent:true,opacity:0.86,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false})},
    ];
    this.wreckMeshes=parts.map(({geometry,material},part)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,capacity);
      mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=part>=3?7:4;mesh.userData.wreckPart=part;
      group.add(mesh);return mesh;
    });
    this.wreckCapacity=capacity;
    this.wreckGroup=group;
    this.terrainGroup.add(group);
  }

  _syncWrecks(game,time) {
    if(!Array.isArray(game.wrecks)||game.wrecks.length===0) {
      if(this.wreckMeshes&&this._wreckSignature!=='') for(const mesh of this.wreckMeshes) mesh.count=0;
      this.wreckVisuals.clear();this._wreckSignature='';return;
    }
    if(!this.wreckMeshes) this._makeWreckBatch();
    const visible=[];
    for(const wreck of game.wrecks) {
      if(!wreck||!Number.isFinite(wreck.x)||!Number.isFinite(wreck.y)) continue;
      const tx=Math.floor(wreck.x),tz=Math.floor(wreck.y);
      if(tx<0||tz<0||tz>=game.height||tx>=game.width||(game.fog?.[tz]?.[tx]??2)!==2) continue;
      if(Number.isFinite(wreck.expiresAt)&&time>=wreck.expiresAt) continue;
      visible.push(wreck);
      if(visible.length>=this.wreckCapacity) break;
    }
    const signature=visible.map(w=>`${w.id}:${w.x}:${w.y}:${w.value}:${w.faction}`).join('|');
    if(signature===this._wreckSignature) {
      this.wreckMeshes[4].material.opacity=0.72+0.23*(0.5+0.5*Math.sin(time*3.1));
      return;
    }
    this._wreckSignature=signature;
    const offsets=[
      [0,0.15,0], [0,0.30,-0.05], [-0.39,0.18,0], [0.13,0.62,-0.04], [0,0.075,0],
    ];
    const capacity=visible.length;
    for(let part=0;part<this.wreckMeshes.length;part++) {
      const mesh=this.wreckMeshes[part];mesh.count=capacity;
      for(let i=0;i<capacity;i++) {
        const wreck=visible[i];
        const seed=Number.parseInt(String(wreck.id).replace(/\D/g,''),10)||i+1;
        const yaw=hash(seed,3,55)*Math.PI*2;
        const valueScale=clamp(0.82+(Number(wreck.value)||0)/140,0.82,1.3);
        const [ox,oy,oz]=offsets[part];
        this.tmpObj.position.set(wreck.x+Math.cos(yaw)*ox-Math.sin(yaw)*oz,
          oy+(part===3?0.04*Math.sin(time*3.3+seed):0),wreck.y+Math.sin(yaw)*ox+Math.cos(yaw)*oz);
        this.tmpObj.rotation.set(part===4?-Math.PI/2:part===0?0.09:0, yaw+(part===1?0.36:0)+(part===0?0.18:0), part===0?-0.10:0);
        const s=valueScale*(0.9+hash(seed,4,57)*0.2);
        this.tmpObj.scale.set(part===0?s:part===1?s:part===2?1:s,
          part===3?0.82+(Number(wreck.value)||0)/300:part===0?s:part===1?s:part===4?1:0.82,
          part===3?0.82:part===0?s:part===1?s:part===2?s:1);
        this.tmpObj.updateMatrix();mesh.setMatrixAt(i,this.tmpObj.matrix);
        if(part<3) {
          const aegis=wreck.faction==='aegis';
          mesh.setColorAt(i,new THREE.Color(part===1?(aegis?0x667d75:0x8a5e50):
            part===2?0x242b29:(aegis?0x3d5650:0x5d423b)));
        }
      }
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
    this.wreckVisuals=new Map(visible.map(w=>[w.id,w]));
  }

  _makeBuildingRuinBatches() {
    const group=new THREE.Group();
    const capacity=this.ruinCapacity;
    const lifetimeAttribute=(geometry,capacity)=>geometry.setAttribute('aRuinExpiry',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity),1));
    const material=(color,opacity=1)=>{
      const m=mat(color,{transparent:true,opacity,depthWrite:false,roughness:0.98,metalness:0.06});
      m.customProgramCacheKey=()=>`building-ruin:${color}`;
      m.onBeforeCompile=shader=>{
        shader.uniforms.uRuinTime=this.ruinTimeUniform;
        shader.vertexShader=`attribute float aRuinExpiry; varying float vRuinTimeLeft; uniform float uRuinTime;\n${shader.vertexShader}`
          .replace('#include <begin_vertex>','#include <begin_vertex>\n vRuinTimeLeft=aRuinExpiry-uRuinTime;');
        shader.fragmentShader=`varying float vRuinTimeLeft;\n${shader.fragmentShader}`
          .replace('#include <color_fragment>','#include <color_fragment>\n diffuseColor.a *= smoothstep(0.0,24.0,vRuinTimeLeft);');
      };
      return m;
    };
    const make=(name,geometry,baseColor,capacity,opacity=1)=>{
      lifetimeAttribute(geometry,capacity);
      const mesh=new THREE.InstancedMesh(geometry,material(baseColor,opacity),capacity);
      mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=name==='foundation'?3:4;mesh.castShadow=false;mesh.receiveShadow=true;
      group.add(mesh);return mesh;
    };
    const batches={
      foundation:make('foundation',scorchedFootprintGeometry(),0xffffff,capacity,0.44),
      rubble:make('rubble',new THREE.DodecahedronGeometry(0.5,0),0xffffff,capacity*this.ruinRubblePieces),
      mast:make('mast',collapsedMastGeometry(),0xffffff,capacity),
      tank:make('tank',collapsedTankGeometry(),0xffffff,capacity),
      slab:make('slab',collapsedGantryGeometry(),0xffffff,capacity),
      mount:make('mount',new THREE.CylinderGeometry(0.34,0.40,0.53,8),0xffffff,capacity),
      wall:make('wall',collapsedWallGeometry(),0xffffff,capacity),
    };
    this.ruinBatches=batches;this.ruinGroup=group;this.terrainGroup.add(group);
  }

  _removeBuildingCollapse(id,visual) {
    this.effectGroup.remove(visual.group);
    this._disposeGroup(visual.group);
    this.collapseVisuals.delete(id);
  }

  _syncBuildingCollapses(events,simTime,game) {
    const current=new Set();
    if(this.collapseCapacity>0) {
      for(const event of events) {
        if(event?.type!=='buildingLost'||!Number.isFinite(event.time)||event.time>simTime||
          simTime-event.time<0||simTime-event.time>=BUILDING_COLLAPSE_DURATION||
          !Number.isFinite(event.x)||!Number.isFinite(event.y)) continue;
        // A collapse is only rendered while its tile is currently visible.
        // Exploring it later shows the durable ruin without replaying history.
        if((game.fog?.[Math.floor(event.y)]?.[Math.floor(event.x)]??0)!==2) continue;
        current.add(event.id);
      }
    }
    const ranked=events.filter(event=>current.has(event.id))
      .sort((a,b)=>b.time-a.time||String(b.id).localeCompare(String(a.id)))
      .slice(0,this.collapseCapacity);
    const active=new Set(ranked.map(event=>event.id));
    for(const [id,visual] of this.collapseVisuals) if(!active.has(id)) this._removeBuildingCollapse(id,visual);
    for(const event of ranked) {
      let visual=this.collapseVisuals.get(event.id);
      if(!visual) {
        const def=game.buildingDefs?.[event.defId];
        const w=clamp(def?.w||2,1,4),h=clamp(def?.h||2,1,4);
        const faction=event.owner==='player'?game.faction:game.enemyFaction;
        const object={id:event.id,owner:event.owner,defId:event.defId,faction,w,h,
          x:event.x-w/2,y:event.y-h/2};
        const model=this._authoredModel(object)||makeBuilding(event.defId,faction,w,h);
        this._addTeamMarks(model,object,true,game);
        const materials=[];
        model.traverse(part=>{
          if(!part.isMesh) return;
          for(const material of (Array.isArray(part.material)?part.material:[part.material])) {
            if(!materials.some(entry=>entry.material===material)) {
              const opacity=material.opacity??1;
              material.transparent=true;material.depthWrite=false;
              materials.push({material,opacity});
            }
          }
        });
        const group=new THREE.Group();
        group.position.set(event.x,0.02,event.y);
        group.add(model);
        group.traverse(part=>{if(part.isMesh)part.castShadow=false;});
        this.effectGroup.add(group);
        const seed=Number.parseInt(String(event.id).replace(/\D/g,''),10)||Math.floor(event.time*31+event.x*7+event.y*13);
        visual={group,model,born:event.time,materials,direction:hash(seed,1,87)>0.5?1:-1};
        this.collapseVisuals.set(event.id,visual);
      }
      const progress=clamp((simTime-visual.born)/BUILDING_COLLAPSE_DURATION,0,1);
      const eased=progress*progress*(3-2*progress);
      visual.group.rotation.set(visual.direction*eased*0.15,0,visual.direction*eased*0.74);
      visual.group.position.y=0.02+Math.sin(progress*Math.PI)*0.08-eased*0.08;
      visual.model.scale.y=1-eased*0.80;
      visual.model.position.y=0;
      const fade=1-smooth(clamp((progress-0.60)/0.40,0,1));
      for(const {material,opacity} of visual.materials) material.opacity=opacity*fade;
    }
  }

  _syncBuildingRuins(game,time) {
    const simTime=Number.isFinite(game.time)?game.time:time;
    this.ruinTimeUniform.value=simTime;
    const events=Array.isArray(game.events)?game.events:[];
    this._syncBuildingCollapses(events,simTime,game);
    // Rebuild from retained history instead of maintaining an append-only
    // visual cache. This makes save loads and replay seeks deterministic; a
    // loss older than the simulation's bounded event history cannot return.
    const visible=[];
    for(const event of events) {
      if(event?.type!=='buildingLost'||!Number.isFinite(event.time)||event.time>simTime||
        simTime-event.time>=BUILDING_RUIN_LIFETIME||!Number.isFinite(event.x)||!Number.isFinite(event.y)) continue;
      const x=Math.floor(event.x),z=Math.floor(event.y);
      if(game.fog?.[z]?.[x]!==2) continue;
      const def=game.buildingDefs?.[event.defId];
      const w=clamp(def?.w||2,1,4),h=clamp(def?.h||2,1,4);
      const family=BUILDING_RUIN_FAMILIES[event.defId]||'wall';
      visible.push({id:event.id,time:event.time,x:event.x,z:event.y,w,h,family,faction:event.owner==='player'?game.faction:game.enemyFaction,
        expires:event.time+BUILDING_RUIN_LIFETIME});
    }
    visible.sort((a,b)=>b.time-a.time);
    visible.length=Math.min(visible.length,this.ruinCapacity);
    const signature=visible.map(r=>`${r.id}:${r.time}:${r.x}:${r.z}:${r.w}:${r.h}:${r.family}:${r.faction}`).join('|');
    if(signature===this.ruinSignature) return;
    this.ruinSignature=signature;
    if(!visible.length) {
      if(this.ruinBatches) for(const mesh of Object.values(this.ruinBatches)) mesh.count=0;
      this.ruinVisuals.clear();return;
    }
    if(!this.ruinBatches) this._makeBuildingRuinBatches();
    const counts={foundation:0,rubble:0,mast:0,tank:0,slab:0,mount:0,wall:0};
    for(const ruin of visible) {
      const n=counts.foundation++;
      const seed=Number.parseInt(String(ruin.id).replace(/\D/g,''),10)||Math.floor(ruin.time*13)+1;
      const aegis=ruin.faction==='aegis';
      this.tmpObj.position.set(ruin.x,0.014,ruin.z);
      this.tmpObj.rotation.set(-Math.PI/2,hash(seed,1,71)*Math.PI*2,0);
      this.tmpObj.scale.set(ruin.w*1.04,ruin.h*0.94,1);this.tmpObj.updateMatrix();
      const foundation=this.ruinBatches.foundation;
      foundation.setMatrixAt(n,this.tmpObj.matrix);foundation.geometry.getAttribute('aRuinExpiry').setX(n,ruin.expires);
      foundation.setColorAt(n,new THREE.Color(aegis?0x736855:0x7b604b));
      for(let piece=0;piece<this.ruinRubblePieces;piece++) {
        const i=counts.rubble++;
        const rx=(hash(seed,piece,72)-0.5)*ruin.w*0.78,rz=(hash(seed,piece,73)-0.5)*ruin.h*0.78;
        this.tmpObj.position.set(ruin.x+rx,0.11+hash(seed,piece,74)*0.08,ruin.z+rz);
        this.tmpObj.rotation.set(hash(seed,piece,75)*0.5,hash(seed,piece,76)*Math.PI*2,hash(seed,piece,77)*0.46);
        const size=0.58+hash(seed,piece,78)*0.58;
        this.tmpObj.scale.set(size*(0.82+ruin.w*0.08),size*0.66,size*(0.68+ruin.h*0.09));this.tmpObj.updateMatrix();
        const rubble=this.ruinBatches.rubble;
        rubble.setMatrixAt(i,this.tmpObj.matrix);rubble.geometry.getAttribute('aRuinExpiry').setX(i,ruin.expires);
        rubble.setColorAt(i,new THREE.Color(aegis?0x798d82:0x987154).multiplyScalar(0.86+hash(seed,piece,79)*0.26));
      }
      const part=this.ruinBatches[ruin.family],slot=counts[ruin.family]++;
      let offsetX=0,offsetZ=0,angle=hash(seed,2,81)*0.22;
      if(ruin.family==='mast') {offsetZ=-ruin.h*0.10;angle=-0.10+(hash(seed,2,81)-0.5)*0.16;}
      else if(ruin.family==='tank') {offsetX=ruin.w*0.12;angle=(hash(seed,2,81)-0.5)*0.14;}
      else if(ruin.family==='slab') {angle=(hash(seed,2,81)-0.5)*0.14;}
      else if(ruin.family==='mount') {offsetZ=-0.12;angle=0.42;}
      else {angle=0.10+(hash(seed,2,81)-0.5)*0.18;}
      const y=ruin.family==='mast'?0.012:ruin.family==='tank'?0.015:ruin.family==='slab'?0.012:0.12;
      this.tmpObj.position.set(ruin.x+offsetX,y,ruin.z+offsetZ);
      this.tmpObj.rotation.set(ruin.family==='mount'?angle:0,hash(seed,3,82)*Math.PI*2,ruin.family==='mount'?0.18:angle);
      const width=ruin.family==='slab'?Math.min(ruin.w*0.90,1.20):ruin.family==='wall'?ruin.w*0.82:1;
      const depth=ruin.family==='slab'?Math.min(ruin.h*0.80,0.90):ruin.family==='wall'?0.26:1;
      this.tmpObj.scale.set(width,ruin.family==='mast'?1.18:ruin.family==='tank'?1.08:ruin.family==='slab'?1.18:ruin.family==='wall'?0.82:0.95,depth);
      this.tmpObj.updateMatrix();part.setMatrixAt(slot,this.tmpObj.matrix);
      part.geometry.getAttribute('aRuinExpiry').setX(slot,ruin.expires);
      part.setColorAt(slot,new THREE.Color(aegis?0x93b3a5:0xc08a60));
    }
    for(const [name,mesh] of Object.entries(this.ruinBatches)) {
      mesh.count=counts[name];mesh.instanceMatrix.needsUpdate=true;
      mesh.geometry.getAttribute('aRuinExpiry').needsUpdate=true;
      if(mesh.instanceColor) mesh.instanceColor.needsUpdate=true;
    }
    this.ruinVisuals=new Map(visible.map(r=>[r.id,r]));
  }

  _makeSkyTexture(style) {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
    const ctx=canvas.getContext('2d');
    const color=hex=>`#${hex.toString(16).padStart(6,'0')}`;
    const blend=(a,b,t)=>((Math.round(((a>>16)&255)*(1-t)+((b>>16)&255)*t)<<16)|
      (Math.round(((a>>8)&255)*(1-t)+((b>>8)&255)*t)<<8)|
      Math.round((a&255)*(1-t)+(b&255)*t));
    const gradient=ctx.createLinearGradient(0,0,0,256);
    gradient.addColorStop(0,color(style.sky));
    gradient.addColorStop(0.48,color(style.sky));
    gradient.addColorStop(0.79,color(blend(style.sky,style.horizon,0.48)));
    gradient.addColorStop(1,color(blend(style.horizon,style.haze,0.26)));
    ctx.fillStyle=gradient;ctx.fillRect(0,0,512,256);
    // A broad, restrained glow gives distant ridges a little atmospheric
    // separation while keeping the map and its visibility layer authoritative.
    const glow=ctx.createRadialGradient(344,222,2,344,222,205);
    glow.addColorStop(0,'rgba(255,244,218,0.18)');
    glow.addColorStop(0.3,'rgba(255,230,194,0.09)');
    glow.addColorStop(1,'rgba(255,224,188,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,512,256);
    // Thin, broken cloud banks sit at the horizon to separate the distant sky
    // from the playable shelf. They are baked into this single backdrop
    // texture, so they add atmospheric depth without another scene draw call.
    ctx.save();
    ctx.globalCompositeOperation='screen';
    for(const [x,y,rx,ry,alpha] of [[42,207,104,13,0.10],[176,190,126,11,0.075],[302,216,118,15,0.09],[465,194,96,12,0.07]]) {
      ctx.save();ctx.translate(x,y);ctx.scale(1,ry/rx);
      const cloud=ctx.createRadialGradient(0,0,rx*0.12,0,0,rx);
      cloud.addColorStop(0,`rgba(226,232,218,${alpha})`);
      cloud.addColorStop(0.52,`rgba(218,225,215,${alpha*0.55})`);
      cloud.addColorStop(1,'rgba(218,225,215,0)');
      ctx.fillStyle=cloud;ctx.fillRect(-rx,-rx,rx*2,rx*2);ctx.restore();
    }
    ctx.restore();
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    return texture;
  }

  resize(width, height, dpr = window.devicePixelRatio || 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = clamp(dpr || 1, 1, GRAPHICS_QUALITY[this.quality].maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.setView(this.centerX, this.centerY, this.zoom);
  }

  // Explicit opt-in quality setting: default Ultra preserves existing visuals.
  setGraphicsQuality(quality) {
    if (!Object.hasOwn(GRAPHICS_QUALITY, quality) || quality === this.quality) return false;
    this.quality = quality;
    this.groundQualityUniform.value = quality === 'eco' ? 0 : quality === 'balanced' ? 1 : 2;
    this.vegetationWindMotionUniform.value=quality==='eco'||(this.reducedMotionQuery?.matches??false)?0:1;
    const trackCapacity=GRAPHICS_QUALITY[quality].trackCapacity;
    if(trackCapacity!==this.trackCapacity) {
      this.scene.remove(this.trackMesh);this.trackMesh.geometry.dispose();this.trackMesh.material.dispose();
      this.trackCapacity=trackCapacity;this.trackCursor=0;
      this.trackStamps=Array.from({length:trackCapacity},()=>({born:-Infinity}));
      this._makeVehicleTracks();
    }
    const ruinCapacity=GRAPHICS_QUALITY[quality].ruinCapacity;
    const ruinRubblePieces=GRAPHICS_QUALITY[quality].ruinRubblePieces;
    const collapseCapacity=GRAPHICS_QUALITY[quality].collapseCapacity;
    if(collapseCapacity!==this.collapseCapacity) {
      this.collapseCapacity=collapseCapacity;
      for(const [id,visual] of [...this.collapseVisuals]) this._removeBuildingCollapse(id,visual);
    }
    if(ruinCapacity!==this.ruinCapacity||ruinRubblePieces!==this.ruinRubblePieces) {
      this.ruinCapacity=ruinCapacity;this.ruinRubblePieces=ruinRubblePieces;
      if(this.ruinGroup) {
        this.terrainGroup.remove(this.ruinGroup);this._disposeGroup(this.ruinGroup);
        this.ruinGroup=null;this.ruinBatches=null;this.ruinSignature='';this.ruinVisuals.clear();
      }
    }
    const environmentPropCapacity=GRAPHICS_QUALITY[quality].environmentPropCapacity;
    if(environmentPropCapacity!==this.environmentPropCapacity) {
      this.environmentPropCapacity=environmentPropCapacity;
      if(this.environmentPropGroup&&this.terrainGame) {
        this.terrainGroup.remove(this.environmentPropGroup);
        this._disposeGroup(this.environmentPropGroup);
        this.environmentPropInstances.clear();
        this.environmentPropGroup=null;
        this._addEnvironmentProps(this.terrainGame);
      }
    }
    if(this.dustFieldData?.game) this._buildDustField(this.dustFieldData.game);
    if(this.terrainGame?.mapId==='storm-basin') {
      if(this.stormArrayGroup) this.stormArrayGroup.visible=quality!=='eco'&&this.stormArrayGroup.userData.fogVisible;
      else if(quality!=='eco') this._addStormBasinLandmark(this.terrainGame);
    }
    if(this.sandFormationMesh&&this.terrainGame) {
      this.terrainGroup.remove(this.sandFormationMesh);
      this.sandFormationMesh.geometry.dispose();
      this.sandFormationMesh.material.dispose();
      this.sandFormationMesh=null;
      this.sandFormationInstances.clear();
      this._addSandFormations(this.terrainGame);
    }
    const shadowSize = GRAPHICS_QUALITY[quality].shadowMapSize;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.resize(this.width, this.height, window.devicePixelRatio || 1);
    return true;
  }

  setView(centerX, centerY, zoom = 1) {
    this.centerX = Number.isFinite(centerX) ? centerX : this.centerX;
    this.centerY = Number.isFinite(centerY) ? centerY : this.centerY;
    this.zoom = clamp(Number.isFinite(zoom) ? zoom : this.zoom, 0.3, 3.5);
    // At zoom 1 an axis-aligned tile projects to ~22.6 px horizontally and
    // ~14 px vertically at 1280x800; the full diamond is ~45 x 28 px.
    const spanY = this.height / (TILE_PIXELS * this.zoom);
    const spanX = spanY * this.width / this.height;
    this.camera.left = -spanX / 2;
    this.camera.right = spanX / 2;
    this.camera.top = spanY / 2;
    this.camera.bottom = -spanY / 2;
    const target = new THREE.Vector3(this.centerX, 0, this.centerY);
    this.camera.position.copy(target).addScaledVector(this.cameraDirection, 52);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.skyBackdrop.position.copy(this.camera.position).addScaledVector(this.cameraDirection,-150);
    this.skyBackdrop.quaternion.copy(this.camera.quaternion);
    this.skyBackdrop.scale.set((this.camera.right-this.camera.left)/2,(this.camera.top-this.camera.bottom)/2,1);
    this.atmosphere.position.set(this.centerX,-0.96,this.centerY);
    this.sun.position.set(this.centerX - 19, 34, this.centerY - 13);
    this.sun.target.position.set(this.centerX, 0, this.centerY);
    this.sun.target.updateMatrixWorld();
  }

  screenToWorld(px, py) {
    const p = new THREE.Vector2(px / this.width * 2 - 1, 1 - py / this.height * 2);
    this.raycaster.setFromCamera(p, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpVec);
    return hit ? { x: hit.x, y: hit.z } : { x: this.centerX, y: this.centerY };
  }

  worldToScreen(x, y, height = 0) {
    const p = new THREE.Vector3(x, height, y).project(this.camera);
    return { x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2 };
  }

  _disposeGroup(group) {
    group.traverse(o => {
      if (o.geometry && !o.userData.sharedAssetGeometry) o.geometry.dispose();
      if (o.material && !o.userData.sharedAssetMaterial) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    while (group.children.length) group.remove(group.children[0]);
  }

  _buildTerrain(game) {
    this._clearVehicleTracks();
    for(const [id,visual] of [...this.collapseVisuals]) this._removeBuildingCollapse(id,visual);
    this._disposeGroup(this.terrainGroup);
    this.crashSite=null;
    this.wreckMeshes=null;this.wreckGroup=null;this.wreckVisuals.clear();this._wreckSignature='';
    this.ruinBatches=null;this.ruinGroup=null;this.ruinVisuals.clear();this.ruinSignature='';
    this.fogTexture?.dispose();
    this.fogTexture=null;
    this.terrain = game.terrain;
    this.terrainGame = game;
    this.mapStyle = MAP_STYLES[game.mapId] || MAP_STYLES['shard-valley'];
    this.skyTexture?.dispose();
    this.skyTexture=this._makeSkyTexture(this.mapStyle);
    this.skyBackdrop.material.map=this.skyTexture;
    this.skyBackdrop.material.needsUpdate=true;
    this.clearSky.setHex(this.mapStyle.sky);
    this.scene.background.copy(this.clearSky);
    this.scene.fog.color.copy(this.clearSky);
    this.scene.fog.density=this.mapStyle.fogDensity;
    this.baseFogDensity=this.mapStyle.fogDensity;
    this.sun.color.setHex(this.mapStyle.sun);
    this.sun.intensity=this.mapStyle.sunIntensity;
    this.sunBaseColor.copy(this.sun.color);
    this.sunBaseIntensity=this.sun.intensity;
    this.rimLight.color.setHex(this.mapStyle.rim);
    this.rimLight.intensity=this.mapStyle.rimIntensity;
    this.rimBaseColor.copy(this.rimLight.color);
    this.rimBaseIntensity=this.rimLight.intensity;
    this.hemisphere.color.setHex(this.mapStyle.ambientSky);
    this.hemisphere.groundColor.setHex(this.mapStyle.ambientGround);
    this.hemisphere.intensity=this.mapStyle.ambientIntensity;
    this.ambientBaseSky.copy(this.hemisphere.color);
    this.ambientBaseGround.copy(this.hemisphere.groundColor);
    this.ambientBaseIntensity=this.hemisphere.intensity;
    this.atmosphere.material.color.setHex(this.mapStyle.mist);
    this.atmosphere.material.opacity=this.mapStyle.hazeOpacity;
    this.terrainCache = [];
    this.resourceCache = [];
    this.crystalTiles.clear();
    this.decorativeCrystalTiles.clear();
    this.environmentPropInstances.clear();
    this.environmentPropGroup=null;
    this.macroLandmarkPlacements=[];
    this.stormArrayGroup=null;
    this.stormArrayTileIndex=-1;
    this.sandFormationMesh=null;
    this.sandFormationInstances.clear();
    this.fogCache = [];
    const total = game.width * game.height;
    const shadowExtent=Math.max(31,Math.max(game.width,game.height)*0.67);
    this.sun.shadow.camera.left=-shadowExtent;
    this.sun.shadow.camera.right=shadowExtent;
    this.sun.shadow.camera.top=shadowExtent;
    this.sun.shadow.camera.bottom=-shadowExtent;
    this.sun.shadow.camera.updateProjectionMatrix();
    this._addMapFoundation(game);
    this._addSkylineLandmarks(game);
    // One draw call per material family. Per-instance colors carry tile variation.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // Shared subdivision lets the shader displace each tile from one world-space
    // field. Matching coordinates on neighboring boxes keep the relief seam-free.
    const sandGeo = new THREE.BoxGeometry(1,1,1,4,1,4);
    const rockGeo = new THREE.BoxGeometry(1,1,1,6,1,6);
    const kinds = ['sand', 'rock', 'water', 'crystal'];
    this.tileMeshes = {};
    this.groundReliefMaterials=[];
    for (const kind of kinds) {
      const count = kind==='rock'?0:game.terrain.flat().filter(t => (t?.type || 'sand') === kind).length;
      // Crystal deposits share the same continuous ground surface as sand.
      // Their color comes from feathered decals below the mesh clusters;
      // tinting each resource tile creates a conspicuous checkerboard edge.
      const isSand=kind==='sand'||kind==='crystal';
      const tileMat=isSand?sandMaterial(this.mapStyle,this.groundQualityUniform,this.sandWindTimeUniform):kind==='water'?waterMaterial(this.waterTimeUniform,game.mapId):rockMaterial();
      if(isSand)this.groundReliefMaterials.push(tileMat);
      const mesh = new THREE.InstancedMesh(kind==='rock'?rockGeo:kind==='sand'||kind==='crystal'?sandGeo.clone():geo, tileMat, Math.max(1, count));
      mesh.count = count;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.tileMeshes[kind] = mesh;
      this.terrainGroup.add(mesh);
    }
    const indices = Object.fromEntries(kinds.map(k => [k, 0]));
    const crystalCoords = [];
    const rockCoords = [];
    const brushCoords = [];
    for (let z = 0; z < game.height; z++) for (let x = 0; x < game.width; x++) {
      const t = game.terrain[z][x] || { type: 'sand', resource: 0 };
      const kind = kinds.includes(t.type) ? t.type : 'sand';
      const y = kind === 'rock' ? -0.20 : kind === 'water' ? -0.10 : (noise(x+0.5,z+0.5,10,37)-0.5)*0.045;
      if(kind!=='rock') {
        this.tmpObj.position.set(x + 0.5, -0.16 + y / 2, z + 0.5);
        this.tmpObj.scale.set(1.002, 0.32 + y, 1.002);
        this.tmpObj.rotation.set(0, 0, 0);
        this.tmpObj.updateMatrix();
        const mesh = this.tileMeshes[kind];
        const idx = indices[kind]++;
        mesh.setMatrixAt(idx, this.tmpObj.matrix);
        mesh.setColorAt(idx, tileColor(kind==='crystal'?'sand':kind,x,z,t.detail||0,this.mapStyle));
      }
      this.terrainCache[z * game.width + x] = kind;
      this.resourceCache[z * game.width + x] = t.resource || 0;
      // The crystal tile remains readable from above; sparse clusters keep
      // rich deposits from turning into an opaque wall of identical spikes.
      if (kind === 'crystal' && t.resource > 0 && hash(x,z,98) > 0.49 && hash(x,z,98) < 0.96) crystalCoords.push([x,z]);
      if (kind === 'rock' && hash(x,z,4) > 0.32) rockCoords.push([x,z]);
      if (kind === 'sand' && hash(x,z,8) > 0.82 && noise(x,z,8,72)>0.34) brushCoords.push([x,z]);
    }
    for (const mesh of Object.values(this.tileMeshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const rockField=rockFieldGeometry(game,this.mapStyle);
    const rockSurfaceMaterial=mat(0xffffff,{roughness:0.96,metalness:0.025,vertexColors:true,side:THREE.DoubleSide});
    rockSurfaceMaterial.customProgramCacheKey=()=> 'rock-field-strata-v1';
    rockSurfaceMaterial.onBeforeCompile=shader=>{
      shader.uniforms.uRockQuality=this.groundQualityUniform;
      shader.vertexShader=`varying vec2 vRockWorldXZ;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vRockWorldXZ=(modelMatrix*vec4(transformed,1.0)).xz;`
      );
      shader.fragmentShader=`varying vec2 vRockWorldXZ; uniform float uRockQuality;
        float rockHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float rockNoise(vec2 p){
          vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(rockHash(i),rockHash(i+vec2(1.0,0.0)),f.x),
                     mix(rockHash(i+vec2(0.0,1.0)),rockHash(i+vec2(1.0,1.0)),f.x),f.y);
        }
        ${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         if(uRockQuality>0.5){
           // Broad, warped mineral beds break up the old uniform rock caps.
           float bed=abs(sin(vRockWorldXZ.x*0.72+vRockWorldXZ.y*0.31+
             sin(vRockWorldXZ.x*0.17+vRockWorldXZ.y*0.09)*1.7));
           float bedLine=(1.0-smoothstep(0.035,0.15,bed))*smoothstep(-0.55,0.2,
             sin(vRockWorldXZ.x*1.31-vRockWorldXZ.y*0.84+rockNoise(vRockWorldXZ*0.42)*2.4));
           diffuseColor.rgb*=1.0-bedLine*0.13;
         }
         if(uRockQuality>1.5){
           // Finer broken seams and shallow mineral variation are Ultra-only.
           float fine=abs(sin(vRockWorldXZ.x*1.72-vRockWorldXZ.y*0.93+
             rockNoise(vRockWorldXZ*0.78)*2.6));
           float seam=1.0-smoothstep(0.025,0.105,fine);
           float mineral=rockNoise(vRockWorldXZ*1.35);
           diffuseColor.rgb*=1.0-seam*0.075;
           diffuseColor.rgb*=0.96+mineral*0.08;
         }`
      );
    };
    for(const [part,geometry] of Object.entries(rockField)) {
      if(!geometry.attributes.position?.count) { geometry.dispose();continue; }
      const surface=new THREE.Mesh(geometry,rockSurfaceMaterial);
      surface.name=`rock-field-${part}`;
      surface.castShadow=false;surface.receiveShadow=true;surface.frustumCulled=false;
      this.terrainGroup.add(surface);
    }
    // Deterministic terrain props are instanced to keep large maps inexpensive.
    const authoredCrystal=this.assetModels.get('crystal');
    const crystalPart=authoredCrystal?.getObjectByProperty('type','Mesh');
    const crystalMat=crystalPart?crystalPart.material.clone():mat(0x8ef5da, { emissive: 0x269f90, emissiveIntensity: 0.72, metalness: 0.15, roughness: 0.22 });
    // Preserve the authored dark-to-bright vertex facets. A strong uniform
    // emissive wash makes every shard read as the same pale silhouette.
    if(crystalMat.color) crystalMat.color.setHex(0xf3fffc);
    if(crystalMat.emissive) crystalMat.emissive.setHex(0x09777b);
    if('emissiveIntensity' in crystalMat) crystalMat.emissiveIntensity=0.58;
    if('roughness' in crystalMat) crystalMat.roughness=0.29;
    if('metalness' in crystalMat) crystalMat.metalness=0.1;
    // A restrained, deterministic tip glint catches the eye at gameplay zoom.
    // It is part of the existing instanced draw and advances through one
    // uniform, so it adds no meshes, per-frame allocations, or simulation state.
    this.crystalGlintTimeUniform={value:0};
    crystalMat.customProgramCacheKey=()=> 'crystal-tip-glint-v1';
    crystalMat.onBeforeCompile=shader=>{
      shader.uniforms.uCrystalGlintTime=this.crystalGlintTimeUniform;
      shader.vertexShader=`varying vec3 vCrystalWorld; varying float vCrystalHeight;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vCrystalWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;
         vCrystalHeight=position.y;`
      );
      shader.fragmentShader=`varying vec3 vCrystalWorld; varying float vCrystalHeight;
        uniform float uCrystalGlintTime;
        float crystalHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        ${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float tipMask=smoothstep(0.20,0.46,vCrystalHeight);
         float glintPulse=pow(max(0.0,sin(uCrystalGlintTime*1.55+crystalHash(floor(vCrystalWorld.xz))*6.283)),24.0);
         float glint=tipMask*glintPulse*0.62;
         diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.72,1.0,0.94),glint);`
      );
    };
    crystalMat.needsUpdate=true;
    const crystalGeo=crystalPart?crystalPart.geometry.clone().applyMatrix4(crystalPart.matrixWorld):new THREE.ConeGeometry(0.14, 0.58, 5);
    this.crystalStride=crystalPart?1:3;
    const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, Math.max(1, crystalCoords.length * this.crystalStride));
    let n = 0;
    for (const [x,z] of crystalCoords) for (let i = 0; i < this.crystalStride; i++) {
      if(i===0) this.crystalTiles.set(z*game.width+x,n);
      this.tmpObj.position.set(crystalPart?x+0.5:x + 0.25 + hash(x,z,22+i) * 0.5, crystalPart?0.01:0.23 + i * 0.06, crystalPart?z+0.5:z + 0.25 + hash(x,z,32+i) * 0.5);
      this.tmpObj.rotation.set(crystalPart?0:(hash(x,z,42+i)-0.5)*0.54, hash(x,z,52+i)*6.28, crystalPart?0:(hash(x,z,62+i)-0.5)*0.42);
      const s = (crystalPart?0.74:0.72) + hash(x,z,72+i) * (crystalPart?0.31:0.93);
      // Fallback shards vary their height and cant so deposits read as a
      // fractured mineral seam instead of a row of identical pickets.
      const shardHeight=crystalPart?1:(0.66+hash(x,z,202+i)*0.72);
      this.tmpObj.scale.set(s*(crystalPart?0.84+hash(x,z,212+i)*0.30:1), s * shardHeight * (0.8 + (game.terrain[z][x].resource || 0)/1200), s*(crystalPart?0.84+hash(x,z,222+i)*0.30:1));
      this.tmpObj.updateMatrix();
      crystals.setMatrixAt(n, this.tmpObj.matrix);
      const hue=0.49+hash(x,z,172+i)*0.06;
      crystals.setColorAt(n++,new THREE.Color().setHSL(hue,0.80+hash(x,z,182+i)*0.16,0.38+hash(x,z,192+i)*0.12));
    }
    crystals.count = n; crystals.castShadow = true; crystals.frustumCulled = false;
    crystals.instanceMatrix.needsUpdate = true;
    if(crystals.instanceColor) crystals.instanceColor.needsUpdate=true;
    this.terrainGroup.add(crystals);
    this.crystalMesh = crystals;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.35, 0), mat(0x68716b, { roughness: 1 }), Math.max(1, rockCoords.length*3));
    n = 0;
    for (const [x,z] of rockCoords) {
      const interior=Array.from({length:3},(_,dz)=>Array.from({length:3},(_,dx)=>game.terrain[z+dz-1]?.[x+dx-1]?.type==='rock').every(Boolean)).every(Boolean);
      for(let shard=0;shard<3;shard++) {
        const dominant=shard===0;
        const jitter=interior?0.52:0.16;
        const px=x+0.5-jitter/2+hash(x,z,6+shard)*jitter;
        const pz=z+0.5-jitter/2+hash(x,z,16+shard)*jitter;
        // Keep the landmark's nonpassable rock pad clear of loose boulders so
        // the authored foundation can sit flush without competing silhouettes.
        if(game.mapId==='storm-basin'&&Math.hypot(px-(STORM_BASIN_ARRAY_TILE.x+0.5),
          pz-(STORM_BASIN_ARRAY_TILE.z+0.5))<1.55) continue;
        this.tmpObj.position.set(px,dominant?0.22:0.15,pz);
        this.tmpObj.rotation.set((hash(x,z,26+shard)-0.5)*0.4,hash(x,z,36+shard)*6.28,(hash(x,z,46+shard)-0.5)*0.35);
        // Rock terrain is nonwalkable, so give its existing clusters enough
        // height and separation to read as a broken ridge at the default view.
        // The silhouettes stay low and stay inside their rock tiles.
        const scale=interior?(dominant?1.18:0.58+hash(x,z,56+shard)*0.30):0.50+hash(x,z,56+shard)*0.12;
        this.tmpObj.scale.set(scale*(0.8+hash(x,z,66+shard)*0.9),
          scale*(0.92+hash(x,z,76+shard)*1.05),scale*(0.75+hash(x,z,86+shard)*0.65));
        this.tmpObj.updateMatrix(); rocks.setMatrixAt(n,this.tmpObj.matrix);
        rocks.setColorAt(n++,new THREE.Color().setHSL((this.mapStyle===MAP_STYLES['canyon-ring']?0.07:this.mapStyle===MAP_STYLES['storm-basin']?0.69:this.mapStyle===MAP_STYLES['twin-passes']?0.59:0.48)+hash(x,z,96+shard)*0.035,0.16,0.36+hash(x,z,106+shard)*0.16));
      }
    }
    rocks.count=n; rocks.castShadow=true; rocks.frustumCulled=false; rocks.instanceMatrix.needsUpdate=true;
    if(rocks.instanceColor)rocks.instanceColor.needsUpdate=true;
    this.terrainGroup.add(rocks);
    const brushMaterial=addVegetationWind(mat(0x708772,{roughness:1}),
      this.sandWindTimeUniform,this.vegetationWindMotionUniform,0.025,'brush');
    const brush = new THREE.InstancedMesh(new THREE.ConeGeometry(0.105, 0.30, 4), brushMaterial, Math.max(1,brushCoords.length * 2));
    n=0;
    for (const [x,z] of brushCoords) {
      for(let blade=0;blade<2;blade++) {
        this.tmpObj.position.set(x+0.28+hash(x,z,81+blade)*0.44,0.105+hash(x,z,85+blade)*0.025,z+0.28+hash(x,z,82+blade)*0.44);
        this.tmpObj.rotation.set((hash(x,z,86+blade)-0.5)*0.18,hash(x,z,83+blade)*6.28,(hash(x,z,87+blade)-0.5)*0.18);
        const size=0.62+hash(x,z,84+blade)*0.74;
        this.tmpObj.scale.set(size,size,size);
        this.tmpObj.updateMatrix(); brush.setMatrixAt(n, this.tmpObj.matrix);
        brush.setColorAt(n++, new THREE.Color().setHSL(0.27+hash(x,z,88+blade)*0.055,0.16,0.40+hash(x,z,89+blade)*0.14));
      }
    }
    brush.material.color.setHex(this.mapStyle.vegetation);
    brush.count=n; brush.frustumCulled=false; brush.instanceMatrix.needsUpdate=true; this.terrainGroup.add(brush);
    // Saltbrush gives the open basin a few recognizable living silhouettes.
    // The low polygon tufts share one instanced draw and stay out of resource,
    // construction, and unit space so they add atmosphere without muddying play.
    const saltbrushParts=[];
    saltbrushParts.push({geometry:new THREE.ConeGeometry(0.075,0.62,5),position:[0,0.31,0]});
    for(let blade=0;blade<5;blade++) {
      const angle=blade*Math.PI*2/5;
      const tilt=0.28+(blade%2)*0.08;
      saltbrushParts.push({geometry:new THREE.ConeGeometry(0.052,0.43,4),
        position:[Math.sin(angle)*0.085,0.22,Math.cos(angle)*0.085],
        rotation:[Math.cos(angle)*tilt,0,-Math.sin(angle)*tilt]});
    }
    const saltbrushGeometry=joinedGeometry(saltbrushParts);
    const saltbrushes=[];
    for(let z=2;z<game.height-2;z++) for(let x=2;x<game.width-2;x++) {
      if(game.terrain[z][x]?.type!=='sand'||(game.terrain[z][x]?.resource||0)>0||hash(x,z,701)<0.91)continue;
      const px=x+0.5,pz=z+0.5;
      if((game.buildings||[]).some(b=>Math.hypot(px-(b.x+b.w/2),pz-(b.y+b.h/2))<2.6)||
         (game.units||[]).some(u=>u.hp>0&&!u.embarkedIn&&Math.hypot(px-u.x,pz-u.y)<1.9)||
         (game.relays||[]).some(r=>Math.hypot(px-r.x,pz-r.y)<2.6)||
         (game.bridges||[]).some(b=>px>=b.x-1.5&&px<=b.x+b.w+1.5&&pz>=b.y-1.5&&pz<=b.y+b.h+1.5))continue;
      saltbrushes.push({x:px,y:0.015,z:pz,ry:hash(x,z,702)*Math.PI*2,
        sx:0.72+hash(x,z,703)*0.48,sy:0.70+hash(x,z,704)*0.55,sz:0.72+hash(x,z,705)*0.48,
        tint:0.83+hash(x,z,706)*0.32});
    }
    saltbrushes.sort((a,b)=>hash(Math.round(b.x),Math.round(b.z),707)-hash(Math.round(a.x),Math.round(a.z),707));
    const saltbrushLimit=this.quality==='ultra'?54:this.quality==='balanced'?40:24;
    saltbrushes.length=Math.min(saltbrushes.length,saltbrushLimit);
    if(saltbrushes.length) {
      const saltbrushMaterial=addVegetationWind(mat(0xffffff,{roughness:0.94,metalness:0}),
        this.sandWindTimeUniform,this.vegetationWindMotionUniform,0.055,'saltbrush');
      const saltbrush=new THREE.InstancedMesh(saltbrushGeometry,saltbrushMaterial,saltbrushes.length);
      saltbrush.name='saltbrush-tufts';saltbrush.frustumCulled=false;saltbrush.castShadow=false;saltbrush.receiveShadow=true;saltbrush.raycast=()=>{};
      for(let i=0;i<saltbrushes.length;i++) {
        const p=saltbrushes[i];
        this.tmpObj.position.set(p.x,p.y,p.z);this.tmpObj.rotation.set(0,p.ry,0);this.tmpObj.scale.set(p.sx,p.sy,p.sz);this.tmpObj.updateMatrix();
        saltbrush.setMatrixAt(i,this.tmpObj.matrix);
        const hue=game.mapId==='storm-basin'?0.56:game.mapId==='canyon-ring'?0.09:0.27;
        saltbrush.setColorAt(i,new THREE.Color().setHSL(hue,0.25,0.49).multiplyScalar(p.tint));
      }
      saltbrush.instanceMatrix.needsUpdate=true;if(saltbrush.instanceColor)saltbrush.instanceColor.needsUpdate=true;
      this.terrainGroup.add(saltbrush);
    } else saltbrushGeometry.dispose();
    this._addGroundDetails(game,crystalCoords,rockCoords);
    this._addDeltaCrossing(game);
    this._addRidgeLandmarks(game);
    this._addCrashSite(game);
    this._addMacroLandmarks(game);
    this._addEnvironmentProps(game);
    this._addStormBasinLandmark(game);
    this._addSandFormations(game);
    this._buildDustField(game);
    // One linearly filtered field produces a continuous frontier while the
    // authoritative fog array still controls gameplay and entity visibility.
    this.fogTexture=new THREE.DataTexture(new Uint8Array(total),game.width,game.height,THREE.RedFormat,THREE.UnsignedByteType);
    this.fogTexture.minFilter=THREE.LinearFilter;
    this.fogTexture.magFilter=THREE.LinearFilter;
    this.fogTexture.generateMipmaps=false;
    this.fogTexture.unpackAlignment=1;
    const fog=new THREE.Mesh(new THREE.PlaneGeometry(game.width,game.height),
      fogMaterial(this.fogTimeUniform,this.fogTexture,game,this.groundQualityUniform,this.mapStyle));
    fog.position.set(game.width/2,0.52,game.height/2);
    fog.rotation.x=-Math.PI/2;
    fog.renderOrder=10;
    fog.frustumCulled=false;
    this.terrainGroup.add(fog);
    this._syncFog(game, true);
  }

  // A sparse layer of wind-stretched mineral dust adds depth to the otherwise
  // crisp orthographic battlefield while staying within one instanced draw.
  _buildDustField(game) {
    if (this.dustField) {
      this.scene.remove(this.dustField);
      this.dustField.geometry.dispose();
      this.dustField.material.dispose();
      this.dustField = null;
    }
    const count = Math.min(GRAPHICS_QUALITY[this.quality].dustMoteCapacity,
      Math.max(24, Math.round(game.width * game.height / 23)));
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: this.mapStyle.mist,
      map: this.atmosphereTexture,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const field = new THREE.InstancedMesh(geometry, material, count);
    field.count = count;
    field.frustumCulled = false;
    field.renderOrder = 1;
    field.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    const mote = new THREE.Object3D();
    const seedData = [];
    for (let i = 0; i < count; i++) {
      const x = hash(i, 3, 143) * game.width;
      const z = hash(i, 9, 147) * game.height;
      const y = 0.32 + hash(i, 17, 151) * 1.45;
      const seed = hash(i, 29, 167);
      seedData.push({x, y, z, drift: 0.025 + hash(i, 21, 159) * 0.055,
        phase: hash(i, 25, 163) * Math.PI * 2,
        width: 0.42 + seed * 0.50,
        height: 0.055 + hash(i, 31, 173) * 0.05,
        roll: (hash(i, 37, 179) - 0.5) * 0.22});
      const tint = 0.66 + hash(i, 41, 181) * 0.42;
      color.copy(material.color).multiplyScalar(tint);
      field.setColorAt(i, color);
      mote.position.set(x, y, z);
      mote.scale.set(seedData[i].width, seedData[i].height, 1);
      mote.updateMatrix();
      field.setMatrixAt(i, mote.matrix);
    }
    if (field.instanceColor) field.instanceColor.needsUpdate = true;
    this.dustField = field;
    this.dustFieldData = {game, seedData};
    this.scene.add(this.dustField);
  }

  _syncDustField(time) {
    if (!this.dustField || !this.dustFieldData) return;
    const {game, seedData} = this.dustFieldData;
    const cameraFacing = this.camera.quaternion;
    const mote = this.dustMoteTransform;
    const seconds = this.reducedMotionQuery?.matches ? 0 : time * 0.001;
    for (let i = 0; i < seedData.length; i++) {
      const p = seedData[i];
      const wind = seconds * 0.11 + p.phase;
      mote.position.set(
        (p.x + seconds * p.drift * 2.6 + Math.sin(wind) * p.drift * 5 + game.width) % game.width,
        p.y + Math.sin(seconds * 0.42 + p.phase) * 0.08,
        (p.z + seconds * p.drift * 1.15 + Math.cos(wind) * p.drift * 4 + game.height) % game.height);
      this.dustMoteRoll.setFromAxisAngle(this.dustMoteRollAxis, p.roll + Math.sin(wind) * 0.09);
      mote.quaternion.copy(cameraFacing).multiply(this.dustMoteRoll);
      mote.scale.set(p.width, p.height, 1);
      mote.updateMatrix();
      this.dustField.setMatrixAt(i, mote.matrix);
    }
    this.dustField.instanceMatrix.needsUpdate = true;
  }

  _addMapFoundation(game) {
    // The terrain tiles stay level for selection and pathing. Only the shelf
    // beyond their footprint has a chipped, irregular geological outline.
    const rim=[];
    for(let x=0;x<=game.width;x++)rim.push([x,-0.50-hash(x,0,269)*0.62]);
    for(let z=0;z<=game.height;z++)rim.push([game.width+0.50+hash(z,1,269)*0.62,z]);
    for(let x=game.width;x>=0;x--)rim.push([x,game.height+0.50+hash(x,2,269)*0.62]);
    for(let z=game.height;z>=0;z--)rim.push([-0.50-hash(z,3,269)*0.62,z]);
    const outline=new THREE.Shape();
    outline.moveTo(rim[0][0],rim[0][1]);
    for(let i=1;i<rim.length;i++)outline.lineTo(rim[i][0],rim[i][1]);
    outline.closePath();
    const foundation=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:0.55,bevelEnabled:false,curveSegments:1}),[
      mat(this.mapStyle.shelf,{roughness:0.96,metalness:0.02}),
      mat(0x25383a,{roughness:0.98,metalness:0.01}),
    ]);
    foundation.rotation.x=Math.PI/2;
    foundation.position.y=-0.22;
    foundation.receiveShadow=true;
    foundation.castShadow=false;
    this.terrainGroup.add(foundation);
    // Broken scree below the playable shelf softens the ruler-straight map
    // silhouette. Every fragment lies outside tile coordinates, so it cannot
    // cover a unit, resource, build pad, or selectable ground position.
    const fragments=[];
    for(let side=0;side<4;side++) {
      const length=side<2?game.width:game.height;
      for(let along=0;along<length;along++) {
        if(hash(along,side,273)<0.48)continue;
        const count=hash(along,side,274)>0.68?3:2;
        for(let piece=0;piece<count;piece++) {
          const offset=0.47+hash(along,side,275+piece)*0.79;
          const tangent=along+0.10+hash(along,side,279+piece)*0.88;
          const x=side===0?tangent:side===1?tangent:side===2?-offset:game.width+offset;
          const z=side===0?-offset:side===1?game.height+offset:tangent;
          const wide=(piece===0?0.70:0.35)+hash(along,side,283+piece)*0.44;
          const high=(piece===0?0.32:0.17)+hash(along,side,287+piece)*0.17;
          fragments.push({x,z,y:-0.36+high*0.22,wide,high,
            depth:wide*(0.58+hash(along,side,291+piece)*0.44),
            angle:hash(along,side,295+piece)*Math.PI*2,
            tint:hash(along,side,299+piece)});
        }
      }
    }
    const scree=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.75,0),
      mat(0xffffff,{roughness:0.98,metalness:0.015}),Math.max(1,fragments.length));
    const baseColor=new THREE.Color(this.mapStyle.shelf);
    const rockColor=new THREE.Color(this.mapStyle.rock);
    fragments.forEach((part,index)=>{
      this.tmpObj.position.set(part.x,part.y,part.z);
      this.tmpObj.rotation.set(0,part.angle,0);
      this.tmpObj.scale.set(part.wide,part.high,part.depth);
      this.tmpObj.updateMatrix();scree.setMatrixAt(index,this.tmpObj.matrix);
      scree.setColorAt(index,baseColor.clone().lerp(rockColor,0.28+part.tint*0.49).multiplyScalar(0.68+part.tint*0.29));
    });
    scree.count=fragments.length;
    scree.castShadow=false;scree.receiveShadow=false;scree.frustumCulled=false;
    scree.instanceMatrix.needsUpdate=true;
    if(scree.instanceColor)scree.instanceColor.needsUpdate=true;
    this.terrainGroup.add(scree);
  }

  _addSkylineLandmarks(game) {
    // Two map-specific silhouettes frame the playable shelf. All geometry is
    // static, shadowless, and outside tile coordinates, so it adds identity
    // without affecting gameplay or increasing per-frame work.
    const themes={
      'shard-valley': { rock:0x56665e, light:0x8ab9a4, accent:0x67d1b1 },
      'twin-passes': { rock:0x546879, light:0xa1b5c6, accent:0xd2e0e5 },
      'delta-crossing': { rock:0x45665f, light:0x789d87, accent:0x75c9b2 },
      'canyon-ring': { rock:0x775347, light:0xb7825f, accent:0xe3ae70 },
      'storm-basin': { rock:0x554d6d, light:0x8980a6, accent:0xc0b2ed },
    };
    const theme=themes[game.mapId];
    if(!theme)return;
    const stone=mat(theme.rock,{roughness:0.96,metalness:0.04});
    const lit=mat(theme.light,{roughness:0.82,metalness:0.12});
    const accent=mat(theme.accent,{roughness:0.48,metalness:0.3,emissive:theme.accent,emissiveIntensity:0.18});
    const locations=[[game.width*0.25,game.height+1.5],[game.width+2.35,game.height*0.30]];
    for(let i=0;i<locations.length;i++) {
      const [x,z]=locations[i],g=new THREE.Group();
      g.position.set(x,0,z);
      const add=(geo,material,px,py,pz,rx=0,ry=0,rz=0)=>{
        const mesh=addMesh(g,geo,material,px,py,pz,false);
        mesh.rotation.set(rx,ry,rz);mesh.receiveShadow=false;
        return mesh;
      };
      if(game.mapId==='shard-valley') {
        for(let j=0;j<3;j++) add(new THREE.ConeGeometry(0.62-j*0.07,3.0-j*0.52,5),j===1?lit:stone,
          (j-1)*0.62,1.35,((j%2)-0.5)*0.44,0,0,(j-1)*0.13);
        add(new THREE.ConeGeometry(0.16,1.0,5),accent,0,3.05,0,0,0,0.08);
      } else if(game.mapId==='twin-passes') {
        add(new THREE.DodecahedronGeometry(1.0,0),stone,-0.72,1.0,0,0.1,0.2,-0.08).scale.set(0.9,2.15,0.82);
        add(new THREE.DodecahedronGeometry(0.82,0),lit,0.58,0.78,0.12,-0.08,0.4,0.12).scale.set(0.82,1.75,0.86);
        add(new THREE.ConeGeometry(0.48,1.6,5),accent,-0.68,3.02,-0.04,0,0,-0.07);
      } else if(game.mapId==='delta-crossing') {
        add(new THREE.CylinderGeometry(0.12,0.22,3.8,6),stone,-0.68,1.9,0);
        add(new THREE.CylinderGeometry(0.12,0.22,3.1,6),lit,0.70,1.55,0.12);
        add(new THREE.BoxGeometry(2.15,0.16,0.18),stone,0,2.85,0.02,0,0,-0.04);
        add(new THREE.BoxGeometry(0.14,0.72,0.16),lit,0,3.25,0.02);
        add(new THREE.SphereGeometry(0.17,8,6),accent,0,3.72,0.02);
      } else if(game.mapId==='canyon-ring') {
        for(let j=0;j<3;j++) {
          const h=2.25+(j===1?0.8:0),px=(j-1)*0.72;
          add(new THREE.BoxGeometry(0.92,h,0.95),j===1?lit:stone,px,h/2,0,0,0,(j-1)*0.045);
          add(new THREE.BoxGeometry(1.03,0.10,1.04),j===1?accent:lit,px,h-0.22,0);
        }
      } else {
        add(new THREE.CylinderGeometry(0.72,0.82,0.62,8),stone,0,0.31,0);
        add(new THREE.CylinderGeometry(0.16,0.24,3.7,6),lit,0,2.35,0);
        add(new THREE.TorusGeometry(0.78,0.09,5,12),accent,0,3.45,0,Math.PI/2,0.25,0.28);
        add(new THREE.ConeGeometry(0.26,0.72,5),stone,0,4.42,0,0,0,0.08);
        add(new THREE.BoxGeometry(1.72,0.12,0.12),accent,0,2.92,0,0,0.4);
      }
      this.terrainGroup.add(g);
    }
  }

  _addDeltaCrossing(game) {
    if(game.mapId!=='delta-crossing')return;
    this._syncBridgeVisuals(game,true);

    // Read the river's real outline, including the crossing mouths. Each
    // exposed water edge gets a narrow translucent wash inside the water tile.
    // This remains decorative and never creates a bridge or blocking surface.
    const edges=[];
    const waterAt=(x,z)=>game.terrain[z]?.[x]?.type==='water';
    for(let z=0;z<game.height;z++) for(let x=0;x<game.width;x++) {
      if(!waterAt(x,z))continue;
      if(z>0&&!waterAt(x,z-1))edges.push({x:x+0.5,z:z+0.18,turn:0,seed:hash(x,z,811)});
      if(z<game.height-1&&!waterAt(x,z+1))edges.push({x:x+0.5,z:z+0.82,turn:Math.PI,seed:hash(x,z,812)});
      if(x>0&&!waterAt(x-1,z))edges.push({x:x+0.18,z:z+0.5,turn:Math.PI/2,seed:hash(x,z,813)});
      if(x<game.width-1&&!waterAt(x+1,z))edges.push({x:x+0.82,z:z+0.5,turn:-Math.PI/2,seed:hash(x,z,814)});
    }
    if(!edges.length)return;
    const geometry=new THREE.PlaneGeometry(1,0.34);
    geometry.rotateX(-Math.PI/2);
    const material=new THREE.MeshBasicMaterial({
      color:0x9ad7c9,transparent:true,opacity:0.55,depthWrite:false,
      side:THREE.DoubleSide,toneMapped:false,
    });
    material.customProgramCacheKey=()=> 'delta-shore-wash-v1';
    material.onBeforeCompile=shader=>{
      shader.uniforms.uShoreTime=this.waterTimeUniform;
      shader.vertexShader=`varying vec2 vShoreWorld; varying vec2 vShoreUV;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vShoreWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xz;
         vShoreUV=uv;`
      );
      shader.fragmentShader=`varying vec2 vShoreWorld; varying vec2 vShoreUV; uniform float uShoreTime;\n${shader.fragmentShader}`.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float edgeFade=smoothstep(0.0,0.18,vShoreUV.y)*(1.0-smoothstep(0.38,1.0,vShoreUV.y));
         float broken=0.52+0.48*sin(vShoreWorld.x*5.8+vShoreWorld.y*1.6-uShoreTime*1.35);
         float lace=smoothstep(0.34,0.78,broken);
         float glint=0.78+0.22*sin(vShoreWorld.x*1.4-vShoreWorld.y*2.2+uShoreTime*0.7);
         diffuseColor.a*=edgeFade*(0.38+0.62*lace)*glint;`
      );
    };
    const banks=new THREE.InstancedMesh(geometry,material,edges.length);
    for(let i=0;i<edges.length;i++) {
      const edge=edges[i];
      this.tmpObj.position.set(edge.x,-0.073,edge.z);
      this.tmpObj.rotation.set(0,edge.turn,0);
      this.tmpObj.scale.set(0.92+edge.seed*0.12,1,1);
      this.tmpObj.updateMatrix();banks.setMatrixAt(i,this.tmpObj.matrix);
    }
    banks.name='delta-animated-shore-wash';
    banks.frustumCulled=false;banks.raycast=()=>{};banks.instanceMatrix.needsUpdate=true;
    this.terrainGroup.add(banks);
  }

  _syncBridgeVisuals(game, force = false) {
    if(game.mapId!=='delta-crossing') return;
    const bridges=game.bridges||[];
    let knownStates=this.bridgeKnownStates.get(game.terrain);
    if(!knownStates) {
      knownStates=new Map();
      this.bridgeKnownStates.set(game.terrain,knownStates);
    }
    const visualBridges=bridges.map(bridge=>{
      let fullyVisible=true;
      for(let y=bridge.y;y<bridge.y+bridge.h&&fullyVisible;y++) for(let x=bridge.x;x<bridge.x+bridge.w;x++)
        if((game.fog?.[y]?.[x]??0)!==2){fullyVisible=false;break;}
      if(fullyVisible) knownStates.set(bridge.id,!!bridge.destroyed);
      const known=knownStates.has(bridge.id);
      return {...bridge,destroyed:knownStates.get(bridge.id),known};
    });
    const signature=visualBridges.map(b=>`${b.id}:${b.x}:${b.y}:${b.w}:${b.h}:${b.known?1:0}:${b.destroyed?1:0}`).join('|');
    if(force||signature!==this.bridgeVisualState) {
      for(const group of this.bridgeVisuals.values()) {
        this.terrainGroup.remove(group);
        group.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
      }
      this.bridgeVisuals.clear();
      this.bridgeVisualState=signature;
      for(const bridge of visualBridges) if(bridge.known)
        this.bridgeVisuals.set(bridge.id,this._makeBridgeVisual(bridge));
    }
    for(const bridge of visualBridges) {
      const group=this.bridgeVisuals.get(bridge.id);
      if(!group) continue;
      // Render remembered state through explored fog, but never instantiate a
      // new/current bridge state until every tile in its deck has been seen.
      let seen=false;
      if(bridge.known) for(let y=bridge.y;y<bridge.y+bridge.h&&!seen;y++) for(let x=bridge.x;x<bridge.x+bridge.w;x++)
        if((game.fog?.[y]?.[x]??0)>0){seen=true;break;}
      group.visible=seen;
    }
  }

  _makeBridgeVisual(bridge) {
    const group=new THREE.Group();
    const steel=mat(0x40575a,{metalness:0.55,roughness:0.52});
    const deck=mat(0x697b78,{metalness:0.32,roughness:0.79});
    const wear=mat(0x9caa9a,{metalness:0.18,roughness:0.92});
    const hazard=mat(0xe1ac52,{metalness:0.28,roughness:0.65});
    const lamp=new THREE.MeshStandardMaterial({color:0x99fff0,emissive:0x42d9c5,emissiveIntensity:1.3,roughness:0.3});
    const x0=bridge.x,x1=bridge.x+bridge.w,y0=bridge.y,y1=bridge.y+bridge.h,cx=bridge.x+bridge.w/2,cz=bridge.y+bridge.h/2;
    const add=(material,w,h,d,x,y,z,rz=0)=>{
      const m=addMesh(group,new THREE.BoxGeometry(w,h,d),material,x,y,z,false);m.rotation.z=rz;return m;
    };
    const wash=mat(0x426c68,{roughness:0.98,metalness:0.02});
    if(!bridge.destroyed) {
      // Box girders and plated deck read as a purpose-built military span.
      add(steel,bridge.w+0.18,0.24,bridge.h+0.14,cx,0.04,cz);
      add(deck,bridge.w-0.16,0.09,bridge.h-0.12,cx,0.18,cz);
      for(let row=0;row<8;row++) {
        const z=y0+0.25+row*0.5;
        add(row%3===0?wear:steel,bridge.w-0.28,0.018,0.035,cx,0.235,z);
      }
      for(const side of [-1,1]) {
        const railX=cx+side*(bridge.w/2-0.08);
        add(steel,0.13,0.20,bridge.h-0.12,railX,0.34,cz);
        for(let post=0;post<5;post++) add(wear,0.19,0.25,0.13,railX,0.34,y0+0.2+post*0.88);
        // Amber end caps warn of the abrupt bridge edges at strategic zoom.
        for(const end of [y0+0.13,y1-0.13]) add(hazard,0.15,0.06,0.18,railX,0.48,end);
      }
      for(const x of [x0+0.34,x1-0.34]) for(const z of [y0+0.22,y1-0.22]) {
        add(steel,0.32,0.55,0.32,x,-0.16,z);
        add(wear,0.34,0.07,0.34,x,0.01,z);
      }
      for(const z of [y0+0.28,y1-0.28]) for(const side of [-1,1]) {
        const beacon=add(lamp,0.10,0.045,0.10,cx+side*0.9,0.29,z);
        beacon.material=lamp;
      }
      add(hazard,0.045,0.012,bridge.h-0.45,cx-0.48,0.232,cz);
      add(hazard,0.045,0.012,bridge.h-0.45,cx+0.48,0.232,cz);
    } else {
      // The central water channel is exposed; only torn end sections, a bent
      // girder, and two collapsed supports remain at the approaches.
      for(const end of [y0+0.42,y1-0.42]) {
        const direction=end<cz?1:-1;
        add(steel,bridge.w+0.06,0.16,0.82,cx,0.01,end);
        for(let plank=0;plank<3;plank++) {
          const px=x0+0.34+plank*(bridge.w-0.68)/2;
          add(plank===1?wear:deck,0.64,0.07,0.62,px,0.14,end+direction*(0.10+0.07*(plank%2)),(plank-1)*0.18);
        }
        add(hazard,0.08,0.06,0.44,cx-0.82,0.19,end+direction*0.18,0.12);
        add(steel,0.12,0.13,1.12,cx+0.15,-0.08,end+direction*0.16,-0.34*direction);
        add(wash,0.45,0.035,0.45,cx,-0.35,end);
      }
      for(const side of [-1,1]) add(steel,0.16,0.12,0.82,cx+side*1.22,0.10,cz+(side*0.18),side*0.55);
    }
    this.terrainGroup.add(group);
    return group;
  }

  _addRidgeLandmarks(game) {
    // Basalt knolls frame revealed approaches around the map edge without
    // occupying build pads, relay sites, or the immediate space around units.
    const home=(game.buildings||[]).find(b=>b.owner==='player'&&b.defId==='command');
    const crystalTiles=[];
    for(let z=0;z<game.height;z++) for(let x=0;x<game.width;x++)
      if(game.terrain[z][x]?.type==='crystal')crystalTiles.push([x+0.5,z+0.5]);
    const candidates=[];
    for(let z=0;z<game.height;z++) for(let x=0;x<game.width;x++) {
      const edge=Math.min(x,z,game.width-1-x,game.height-1-z);
      const visibility=game.fog?.[z]?.[x]??2;
      // Anchor on a visible near-rim tile, but put the asset beyond the
      // playable grid so its rock silhouette can never obstruct pathing.
      if(edge>4||visibility!==2||game.terrain[z][x]?.type!=='sand')continue;
      const px=x+0.5,pz=z+0.5;
      const nearBuilding=(game.buildings||[]).some(b=>Math.hypot(px-(b.x+b.w/2),pz-(b.y+b.h/2))<4.0);
      const nearRelay=(game.relays||[]).some(r=>Math.hypot(px-r.x,pz-r.y)<4.0);
      const nearUnit=(game.units||[]).some(u=>Math.hypot(px-(u.x+0.5),pz-(u.y+0.5))<2.2);
      const nearCrystal=crystalTiles.some(([cx,cz])=>Math.hypot(px-cx,pz-cz)<2.2);
      if(nearBuilding||nearRelay||nearUnit||nearCrystal)continue;
      const homeDistance=home?Math.hypot(px-(home.x+home.w/2),pz-(home.y+home.h/2)):12;
      // Favor visible ground at the edge of the player's starting sight while
      // allowing a few outcrops farther along the perimeter for depth.
      const score=hash(x,z,227)+(visibility===2?0.85:0)+(homeDistance>=5&&homeDistance<=12?0.45:0);
      candidates.push({x,z,edge,score});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const picks=[];
    for(const candidate of candidates) {
      if(picks.length>=4)break;
      if(picks.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<3.8))continue;
      picks.push(candidate);
    }
    const rimPosition=(x,z,offset)=>{
      const distances=[x,game.width-1-x,z,game.height-1-z];
      const side=distances.indexOf(Math.min(...distances));
      if(side===0)return [-offset,z+0.5];
      if(side===1)return [game.width+offset,z+0.5];
      if(side===2)return [x+0.5,-offset];
      return [x+0.5,game.height+offset];
    };
    const authoredMesa=this.assetModels.get('mesa');
    if(authoredMesa) {
      for(const {x,z} of picks) {
        const clone=authoredMesa.clone(true);
        const [localX,localZ]=rimPosition(x,z,1.68);
        clone.position.set(localX,0.025,localZ);
        clone.rotation.y=hash(x,z,261)*Math.PI*2;
        const size=0.92+hash(x,z,262)*0.12;
        clone.scale.set(3*size,2*size,3*size);
        clone.traverse(obj=>{
          if(!obj.isMesh)return;
          obj.userData.sharedAssetGeometry=true;
          obj.userData.sharedAssetMaterial=true;
          // These are decorative skyline pieces; skipping their shadow work
          // keeps the extra silhouette from increasing shadow-map cost.
          obj.castShadow=false;
          obj.receiveShadow=false;
        });
        this.terrainGroup.add(clone);
      }
      return;
    }
    // Broad, layered dodecahedral slabs read as weathered mesas at game zoom.
    // One instanced batch keeps them cheap and avoids shadow-map work.
    const mesh=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.7,0),
      mat(0x788078,{roughness:0.98,metalness:0.015}),Math.max(1,picks.length*5));
    let index=0;
    for(const {x,z} of picks) {
      const [edgeX,edgeZ]=rimPosition(x,z,1.62);
      for(let fragment=0;fragment<5;fragment++) {
        const angle=hash(x,z,231+fragment)*Math.PI*2;
        const isCap=fragment===1;
        const radius=fragment===0||isCap?0:0.38+hash(x,z,234+fragment)*0.46;
        const height=isCap?0.32+hash(x,z,238+fragment)*0.12:fragment===0?0.57+hash(x,z,229)*0.18:0.30+hash(x,z,238+fragment)*0.18;
        const px=edgeX+Math.cos(angle)*radius;
        const pz=edgeZ+Math.sin(angle)*radius;
        this.tmpObj.position.set(px,isCap?0.49+hash(x,z,239)*0.08:height*0.45+0.07,pz);
        this.tmpObj.rotation.set((hash(x,z,241+fragment)-0.5)*0.13,hash(x,z,244+fragment)*Math.PI*2,(hash(x,z,247+fragment)-0.5)*0.13);
        const width=isCap?0.72+hash(x,z,228)*0.20:fragment===0?0.90+hash(x,z,228)*0.30:0.50+hash(x,z,250+fragment)*0.24;
        this.tmpObj.scale.set(width,height/1.4,width*(0.72+hash(x,z,230+fragment)*0.48));
        this.tmpObj.updateMatrix();mesh.setMatrixAt(index,this.tmpObj.matrix);
        mesh.setColorAt(index++,new THREE.Color().setHSL(0.39+hash(x,z,253+fragment)*0.04,0.08,0.39+hash(x,z,256+fragment)*0.13));
      }
    }
    mesh.count=index;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;
    mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    this.terrainGroup.add(mesh);
  }

  _addCrashSite(game) {
    const source=this.assetModels.get('crashedDropship');
    if(!source)return;
    const home=(game.buildings||[]).find(b=>b.owner==='player'&&b.defId==='command');
    const crystalAt=(x,z)=>{
      const tile=game.terrain[z]?.[x];
      return tile?.type==='crystal'||(tile?.resource||0)>0;
    };
    const candidate=[];
    // The full four-by-four sand pad keeps the wing and its debris clear of
    // cliffs, water, deposits, and the map edge. The wreck is scenery only;
    // it never reserves or changes a gameplay tile.
    for(let z=3;z<game.height-3;z++) for(let x=3;x<game.width-3;x++) {
      if(game.terrain[z][x]?.type!=='sand'||(game.fog?.[z]?.[x]??0)!==2)continue;
      let clear=true;
      for(let dz=-2;dz<=2&&clear;dz++)for(let dx=-2;dx<=2;dx++) {
        const tile=game.terrain[z+dz]?.[x+dx];
        if(!tile||tile.type!=='sand'||crystalAt(x+dx,z+dz)){clear=false;break;}
      }
      if(!clear)continue;
      const px=x+0.5,pz=z+0.5;
      const homeDistance=home?Math.hypot(px-(home.x+home.w/2),pz-(home.y+home.h/2)):10;
      if(homeDistance<6.0||homeDistance>16.0)continue;
      if((game.buildings||[]).some(b=>Math.hypot(px-(b.x+b.w/2),pz-(b.y+b.h/2))<5.5)||
         (game.units||[]).some(u=>u.hp>0&&!u.embarkedIn&&Math.hypot(px-u.x,pz-u.y)<4.6)||
         (game.relays||[]).some(r=>Math.hypot(px-r.x,pz-r.y)<5.0)||
         (game.bridges||[]).some(b=>px>=b.x-3&&px<=b.x+b.w+3&&pz>=b.y-3&&pz<=b.y+b.h+3))continue;
      // Favor sand beside an existing outcrop so the wreck feels lodged in
      // the landscape while keeping the model itself on a clear, flat pad.
      const besideRock=[[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dz])=>game.terrain[z+dz]?.[x+dx]?.type==='rock');
      const score=hash(x,z,541)+(besideRock?0.72:0)+Math.max(0,1-Math.abs(homeDistance-10)*0.08);
      candidate.push({x,z,score});
    }
    candidate.sort((a,b)=>b.score-a.score);
    const pick=candidate[0];
    if(!pick)return;
    const wreck=source.clone(true);
    wreck.name='crashed-dropship-landmark';
    wreck.position.set(pick.x+0.5,0.035,pick.z+0.5);
    wreck.rotation.y=hash(pick.x,pick.z,542)*Math.PI*2;
    wreck.scale.setScalar(1.0);
    wreck.traverse(part=>{
      if(!part.isMesh)return;
      part.userData.sharedAssetGeometry=true;
      part.userData.sharedAssetMaterial=true;
      part.castShadow=true;
      part.receiveShadow=true;
      part.frustumCulled=false;
    });
    this.terrainGroup.add(wreck);
    this.crashSite={mesh:wreck,x:pick.x+0.5,z:pick.z+0.5};
  }

  _syncCrashSite(game) {
    if(!this.crashSite)return;
    const {mesh,x,z}=this.crashSite;
    // The wreck is scenery, not an obstacle. Clear it if either side builds
    // on its visual footprint so production never disappears under the hull.
    mesh.visible=!(game.buildings||[]).some(b=>
      b.hp>0&&x+2.4>b.x&&x-2.4<b.x+b.w&&z+2.4>b.y&&z-2.4<b.y+b.h);
  }

  _addGroundDetails(game,crystalCoords,rockCoords) {
    const world=new THREE.Object3D();
    const addInstances=(geometry,material,transforms)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,transforms.length));
      transforms.forEach((t,i)=>{
        world.position.set(t.x,t.y,t.z);
        world.rotation.set(t.rx||0,t.ry||0,t.rz||0);
        world.scale.set(t.sx??1,t.sy??1,t.sz??1);
        world.updateMatrix(); mesh.setMatrixAt(i,world.matrix);
      });
      mesh.count=transforms.length;mesh.frustumCulled=false;mesh.instanceMatrix.needsUpdate=true;
      mesh.receiveShadow=true;this.terrainGroup.add(mesh);
      return mesh;
    };
    // This trail is part of Shard Valley's authored basin route. Alternate
    // maps already have distinct rock passes, causeways, or bridge approaches;
    // carrying the valley road into those layouts obscures their route identity.
    if(game.mapId==='shard-valley') {
      const route=new THREE.CatmullRomCurve3([
        new THREE.Vector3(5,0,40),new THREE.Vector3(11,0,38),new THREE.Vector3(18,0,34),
        new THREE.Vector3(25,0,29),new THREE.Vector3(31,0,24),new THREE.Vector3(39,0,20),
        new THREE.Vector3(47,0,16),new THREE.Vector3(55,0,10),
      ]);
      const roadGeometry=new THREE.BufferGeometry();
      const roadSteps=96,cross=[-1,-0.82,-0.60,-0.39,-0.27,0,0.27,0.39,0.60,0.82,1];
      const roadPositions=[],roadColors=[],roadUvs=[],roadIndices=[];
      const roadPalette=[new THREE.Color(0x78684f),new THREE.Color(0xa18b65),new THREE.Color(0x63553f)];
      const terrainTint=new THREE.Color(this.mapStyle.patch);
      let previousSection=-1;
      for(let i=0;i<=roadSteps;i++) {
        const t=i/roadSteps,p=route.getPoint(t);
        const before=route.getPoint(Math.max(0,t-0.002)),after=route.getPoint(Math.min(1,t+0.002));
        const dx=after.x-before.x,dz=after.z-before.z,len=Math.hypot(dx,dz)||1;
        const nx=dz/len,nz=-dx/len;
        const tx=Math.floor(p.x),tz=Math.floor(p.z);
        if(game.terrain[tz]?.[tx]?.type!=='sand') { previousSection=-1; continue; }
        const section=roadPositions.length/3/cross.length;
        const jitter=(hash(Math.round(p.x*10),Math.round(p.z*10),271)-0.5)*0.12;
        const halfWidth=0.86+jitter;
        for(let j=0;j<cross.length;j++) {
          const lateral=cross[j],grain=hash(Math.round(p.x*8)+j,Math.round(p.z*8),279);
          const x=p.x+nx*lateral*halfWidth,z=p.z+nz*lateral*halfWidth;
          roadPositions.push(x,0.022,z);
          roadUvs.push(t,(lateral+1)*0.5);
          let color;
          if(Math.abs(lateral)>0.82) color=terrainTint.clone().lerp(roadPalette[0],0.24+grain*0.10);
          else if(Math.abs(lateral)>0.27) color=roadPalette[1].clone();
          else color=roadPalette[2].clone().lerp(roadPalette[1],0.25+grain*0.20);
          const variation=0.91+grain*0.16;
          roadColors.push(color.r*variation,color.g*variation,color.b*variation);
          if(previousSection>=0&&j<cross.length-1) {
            const a=previousSection*cross.length+j,b=section*cross.length+j;
            roadIndices.push(a,b,a+1,a+1,b,b+1);
          }
        }
        previousSection=section;
      }
      roadGeometry.setAttribute('position',new THREE.Float32BufferAttribute(roadPositions,3));
      roadGeometry.setAttribute('color',new THREE.Float32BufferAttribute(roadColors,3));
      roadGeometry.setAttribute('aServiceRoadUv',new THREE.Float32BufferAttribute(roadUvs,2));
      roadGeometry.setIndex(roadIndices);
      roadGeometry.computeVertexNormals();
      const roadMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0.58,depthWrite:false,side:THREE.DoubleSide});
      roadMaterial.customProgramCacheKey=()=> 'shard-service-road-ruts-v1';
      roadMaterial.onBeforeCompile=shader=>{
        shader.vertexShader=`attribute vec2 aServiceRoadUv; varying vec2 vServiceRoadUv;\n${shader.vertexShader}`.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n vServiceRoadUv=aServiceRoadUv;`
        );
        shader.fragmentShader=`varying vec2 vServiceRoadUv;
          float roadHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float roadNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(roadHash(i),roadHash(i+vec2(1.0,0.0)),f.x),mix(roadHash(i+vec2(0.0,1.0)),roadHash(i+vec2(1.0,1.0)),f.x),f.y);}
          \n${shader.fragmentShader}`.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           // Paired, broken wheel grooves make the service road legible at
           // command zoom while preserving its dusty, naturally feathered edge.
           float rutNoise=0.62+0.38*roadNoise(vec2(vServiceRoadUv.x*24.0,vServiceRoadUv.y*36.0));
           float leftRut=1.0-smoothstep(0.018,0.066,abs(vServiceRoadUv.y-0.34));
           float rightRut=1.0-smoothstep(0.018,0.066,abs(vServiceRoadUv.y-0.66));
           float grain=roadNoise(vec2(vServiceRoadUv.x*180.0,vServiceRoadUv.y*27.0))-0.5;
           diffuseColor.rgb*=1.0-(leftRut+rightRut)*rutNoise*0.30+grain*0.045;`
        );
      };
      const roadMesh=new THREE.Mesh(roadGeometry,roadMaterial);
      roadMesh.frustumCulled=false;roadMesh.receiveShadow=true;this.terrainGroup.add(roadMesh);
    }
    if(!this.groundPatchTexture) {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
      const ctx=canvas.getContext('2d');
      const grad=ctx.createRadialGradient(64,64,3,64,64,63);
      grad.addColorStop(0,'rgba(255,255,255,0.72)');
      grad.addColorStop(0.34,'rgba(255,255,255,0.43)');
      grad.addColorStop(0.72,'rgba(255,255,255,0.12)');
      grad.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
      this.groundPatchTexture=new THREE.CanvasTexture(canvas);
    }
    const darkPatches=[],warmPatches=[];
    for(let z=2;z<game.height-2;z+=2) for(let x=2;x<game.width-2;x+=2) {
      if(game.terrain[z][x]?.type!=='sand'||hash(x,z,131)<0.77)continue;
      const target=hash(x,z,132)>0.48?darkPatches:warmPatches;
      target.push({x:x+hash(x,z,133)*2,y:0.024,z:z+hash(x,z,134)*2,rx:-Math.PI/2,
        ry:hash(x,z,135)*6.28,sx:3.2+hash(x,z,136)*4.8,sy:2.4+hash(x,z,137)*3.8,sz:1});
    }
    addInstances(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x38503d,map:this.groundPatchTexture,transparent:true,opacity:0.42,depthWrite:false,side:THREE.DoubleSide}),darkPatches);
    addInstances(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:this.mapStyle.patch,map:this.groundPatchTexture,transparent:true,opacity:0.40,depthWrite:false,side:THREE.DoubleSide}),warmPatches);
    const strata=[];
    for(const [x,z] of rockCoords) for(let layer=0;layer<3;layer++) {
      const interior=Array.from({length:3},(_,dz)=>Array.from({length:3},(_,dx)=>game.terrain[z+dz-1]?.[x+dx-1]?.type==='rock').every(Boolean)).every(Boolean);
      const r=hash(x,z,93+layer);
      // Boundary fragments stay compact inside their rock tile. Larger ledges
      // are reserved for rock with a complete 3x3 rock neighborhood.
      const jitter=interior?0.48:0.06;
      strata.push({x:x+0.5-jitter/2+hash(x,z,95)*jitter,y:0.29+layer*0.075,z:z+0.5-jitter/2+hash(x,z,96)*jitter,
        ry:r*6.28,sx:interior?0.48+hash(x,z,98)*0.42:0.24,sy:0.075,sz:interior?0.32+hash(x,z,99)*0.34:0.20});
    }
    addInstances(new THREE.DodecahedronGeometry(0.5,0),mat(0x92988a,{roughness:1}),strata);
    const fieldStones=[],debris=[];
    for(let z=1;z<game.height-1;z++) for(let x=1;x<game.width-1;x++) {
      if(game.terrain[z][x]?.type!=='sand') continue;
      const roll=hash(x,z,141);
      if(roll>0.91) fieldStones.push({x:x+0.23+hash(x,z,142)*0.54,y:0.085,z:z+0.23+hash(x,z,143)*0.54,
        rx:hash(x,z,144),ry:hash(x,z,145)*6.28,rz:hash(x,z,146)*0.3,
        sx:0.35+hash(x,z,147)*0.55,sy:0.22+hash(x,z,148)*0.42,sz:0.28+hash(x,z,149)*0.44});
      if(roll<0.009) debris.push({x:x+0.5,y:0.035,z:z+0.5,ry:hash(x,z,150)*6.28,
        sx:0.32+hash(x,z,151)*0.4,sy:0.06,sz:0.15+hash(x,z,152)*0.2});
    }
    addInstances(new THREE.DodecahedronGeometry(0.27,0),mat(0x78847d,{roughness:1}),fieldStones);
    addInstances(new THREE.BoxGeometry(1,1,1),mat(0x384d4e,{metalness:0.28,roughness:0.88}),debris);
    const craters=[];
    const ripples=[];
    for(let z=1;z<game.height-1;z++) for(let x=1;x<game.width-1;x++) {
      const kind=game.terrain[z][x]?.type;
      if(kind==='sand'&&hash(x,z,111)>0.992) craters.push({x:x+0.5,y:0.048,z:z+0.5,rx:-Math.PI/2,ry:hash(x,z,112)*6.28,sx:0.8+hash(x,z,113)*0.8,sy:0.7+hash(x,z,114)*0.5,sz:0.45});
      if(kind==='water'&&hash(x,z,115)>0.68) ripples.push({x:x+0.5,y:-0.077,z:z+0.5,rx:-Math.PI/2,sx:0.9,sy:0.45,sz:1});
    }
    addInstances(new THREE.TorusGeometry(0.32,0.045,4,14),mat(0x3d514a,{roughness:1}),craters);
    addInstances(new THREE.TorusGeometry(0.27,0.009,3,20),new THREE.MeshBasicMaterial({color:0x9bc0ad,transparent:true,opacity:0.24,depthWrite:false}),ripples);
    // Deposits have a soft mineral halo instead of a solid teal tile. A radial
    // atlas is repeated per resource tile so neighboring halos overlap into a
    // field-shaped stain while the mesh clusters remain readable at a glance.
    const glows=[];
    for(let z=0;z<game.height;z++) for(let x=0;x<game.width;x++) {
      if(game.terrain[z][x]?.type!=='crystal'||game.terrain[z][x]?.resource<=0)continue;
      const size=2.35+hash(x,z,318)*0.62;
      glows.push({x:x+0.5,y:0.047,z:z+0.5,rx:-Math.PI/2,
        sx:size,sy:size*0.84,sz:1});
      // Offset secondary stains break up perfect circles where resource tiles
      // meet while remaining in the same instanced draw.
      const angle=hash(x,z,319)*Math.PI*2;
      const offset=0.22+hash(x,z,320)*0.22;
      const bloom=1.05+hash(x,z,321)*0.56;
      glows.push({x:x+0.5+Math.cos(angle)*offset,y:0.048,z:z+0.5+Math.sin(angle)*offset,rx:-Math.PI/2,
        sx:bloom,sy:bloom*(0.68+hash(x,z,322)*0.48),sz:1});
    }
    this.crystalGlows=addInstances(new THREE.CircleGeometry(0.5,20),new THREE.MeshBasicMaterial({
      color:0x34b8a0,map:this.groundPatchTexture,transparent:true,opacity:0.25,
      depthWrite:false,side:THREE.DoubleSide,toneMapped:false}),glows);
  }

  _addMacroLandmarks(game) {
    const profile=MACRO_LANDMARKS[game.mapId];
    const source=profile&&this.assetModels.get(profile.key);
    if(!source)return;
    const {w,h,scale}=profile;
    const candidates=[];
    for(let z=2;z<game.height-h-2;z++)for(let x=2;x<game.width-w-2;x++) {
      let onRock=true;
      for(let dz=0;dz<h&&onRock;dz++)for(let dx=0;dx<w;dx++)
        if(game.terrain[z+dz]?.[x+dx]?.type!=='rock') {onRock=false;break;}
      if(!onRock)continue;
      const px=x+w/2,pz=z+h/2;
      if((game.buildings||[]).some(b=>b.hp>0&&Math.hypot(px-b.x-b.w/2,pz-b.y-b.h/2)<5)||
        (game.relays||[]).some(r=>Math.hypot(px-r.x,pz-r.y)<4)||
        (game.units||[]).some(u=>u.hp>0&&!u.embarkedIn&&Math.hypot(px-u.x,pz-u.y)<3)||
        (game.bridges||[]).some(b=>px>=b.x-2&&px<=b.x+b.w+2&&pz>=b.y-2&&pz<=b.y+b.h+2))continue;
      let byCrystal=false;
      for(let tz=z-2;tz<z+h+2&&!byCrystal;tz++)for(let tx=x-2;tx<x+w+2;tx++)
        if(game.terrain[tz]?.[tx]?.type==='crystal') {byCrystal=true;break;}
      if(!byCrystal)candidates.push({x,z,px,pz});
    }
    const targets=[[0.5,0.27],[0.5,0.73]];
    const placements=[];
    for(const [tx,tz] of targets) {
      const targetX=game.width*tx,targetZ=game.height*tz;
      const available=candidates.filter(candidate=>placements.every(other=>
        Math.hypot(candidate.px-other.px,candidate.pz-other.pz)>10));
      available.sort((a,b)=>{
        const score=c=>Math.hypot(c.px-targetX,c.pz-targetZ)+hash(c.x,c.z,game.seed||0)*0.35;
        return score(a)-score(b);
      });
      if(available[0]) placements.push({...available[0],w,h,refs:[],visible:false});
    }
    if(!placements.length)return;
    source.updateMatrixWorld(true);
    const group=new THREE.Group();
    group.name=`${game.mapId}-macro-landmarks`;
    source.traverse(part=>{
      if(!part.isMesh)return;
      const mesh=new THREE.InstancedMesh(part.geometry,part.material,placements.length);
      mesh.count=placements.length;
      mesh.name=`${game.mapId}-${part.name}`;
      mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=false;
      mesh.raycast=()=>{};
      mesh.userData.sharedAssetGeometry=true;mesh.userData.sharedAssetMaterial=true;
      placements.forEach((placement,index)=>{
        const position=new THREE.Vector3(placement.px,0.07,placement.pz);
        const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),
          hash(placement.x,placement.z,621)>0.5?Math.PI:0);
        const transform=new THREE.Matrix4().compose(position,rotation,new THREE.Vector3(scale,scale,scale));
        const matrix=transform.multiply(part.matrixWorld);
        placement.refs.push({mesh,index,matrix});
        mesh.setMatrixAt(index,HIDDEN_INSTANCE_MATRIX);
      });
      mesh.instanceMatrix.needsUpdate=true;
      group.add(mesh);
    });
    this.macroLandmarkPlacements=placements;
    this.terrainGroup.add(group);
  }

  _addEnvironmentProps(game) {
    const models=this.assetModels;
    if(!['mast','cargo','growthFan','growthSpire','basalt','trackWreck'].some(key=>models.has(key))) return;
    const farFromGameplay=(x,z,clearance)=>
      !(game.buildings||[]).some(b=>Math.hypot(x-(b.x+b.w/2),z-(b.y+b.h/2))<clearance)&&
      !(game.relays||[]).some(r=>Math.hypot(x-r.x,z-r.y)<clearance*0.75)&&
      !this.macroLandmarkPlacements.some(p=>Math.hypot(x-p.px,z-p.pz)<5);
    const rockAt=(x,z)=>game.terrain[z]?.[x]?.type==='rock';
    const candidates={mast:[],cargo:[],basalt:[],growthFan:[],growthSpire:[],trackWreck:[]};
    for(let z=2;z<game.height-2;z++) for(let x=2;x<game.width-2;x++) {
      const tile=game.terrain[z][x];
      if(tile.type==='rock'&&farFromGameplay(x+0.5,z+0.5,4.0)) {
        const score=hash(x,z,187);
        candidates.basalt.push({x,z,score});
        if(rockAt(x+1,z)&&rockAt(x,z+1)&&rockAt(x+1,z+1)) {
          candidates.mast.push({x,z,score:hash(x,z,188)});
          candidates.cargo.push({x,z,score:hash(x,z,189)});
          // A rare wreck sits wholly on blocked rock cells, clear of routes,
          // structures and relay sites. One per map keeps the focal silhouette
          // legible and avoids turning the field into a prop yard.
          if(game.mapId==='shard-valley'&&hash(x,z,194)>0.94)
            candidates.trackWreck.push({x,z,score:hash(x,z,195)});
        }
      }
      if(tile.type==='crystal'&&tile.resource>250&&hash(x,z,98)>=0.90&&farFromGameplay(x+0.5,z+0.5,2.2)) {
        const kind=hash(x,z,190)>0.48?'growthFan':'growthSpire';
        candidates[kind].push({x,z,score:hash(x,z,191)});
      }
    }
    const profileByMap={
      'shard-valley':['trackWreck','mast','cargo','basalt'],
      'twin-passes':['basalt','mast','cargo'],
      'delta-crossing':['growthFan','growthSpire'],
      'canyon-ring':['basalt','cargo','mast'],
      'storm-basin':['growthSpire','growthFan','basalt'],
    };
    const profile=profileByMap[game.mapId]||['basalt','mast','cargo'];
    for(const list of Object.values(candidates))list.sort((a,b)=>b.score-a.score);
    if(candidates.trackWreck.length>1)candidates.trackWreck.length=1;
    const placements=[],used=new Set(),clusterAnchors=[];
    const cellKey=c=>`${c.x},${c.z}`;
    const maxClusters=Math.max(1,Math.floor(this.environmentPropCapacity/3));
    for(let cluster=0;cluster<maxClusters&&placements.length<this.environmentPropCapacity;cluster++) {
      const anchorKey=profile.find(key=>models.has(key)&&candidates[key].some(c=>!used.has(`${key}:${cellKey(c)}`)));
      if(!anchorKey)break;
      let anchor=null;
      for(const c of candidates[anchorKey]) {
        if(used.has(`${anchorKey}:${cellKey(c)}`))continue;
        if(clusterAnchors.some(p=>Math.hypot(p.x-c.x,p.z-c.z)<6.2))continue;
        anchor=c;break;
      }
      if(!anchor)break;
      clusterAnchors.push(anchor);
      const clusterMembers=[];
      for(const key of profile) {
        if(anchorKey==='trackWreck'&&key!=='trackWreck')continue;
        if(!models.has(key)||placements.length+clusterMembers.length>=this.environmentPropCapacity)continue;
        const nearest=candidates[key].find(c=>{
          if(used.has(`${key}:${cellKey(c)}`))return false;
          const distance=Math.hypot(c.x-anchor.x,c.z-anchor.z);
          if(key===anchorKey?distance>0.01:distance<1.25||distance>3.8)return false;
          if(clusterMembers.some(p=>Math.hypot(p.x-c.x,p.z-c.z)<1.35))return false;
          return true;
        });
        if(!nearest)continue;
        used.add(`${key}:${cellKey(nearest)}`);
        clusterMembers.push({...nearest,key});
      }
      if(!clusterMembers.length)break;
      placements.push(...clusterMembers);
    }
    if(!placements.length)return;

    // Each authored asset family is instanced by source submesh: a landmark
    // cluster costs one draw per GLB mesh part, rather than one per placement.
    const group=new THREE.Group();
    for(const key of new Set(placements.map(p=>p.key))) {
      const family=placements.filter(p=>p.key===key);
      const root=models.get(key);
      root.updateMatrixWorld(true);
      const parts=[];
      root.traverse(obj=>{if(obj.isMesh)parts.push(obj);});
      for(const part of parts) {
        const mesh=new THREE.InstancedMesh(part.geometry,part.material,family.length);
        mesh.name=`${key}-environment-props`;
        mesh.count=family.length;mesh.frustumCulled=false;
        const crystalGrowth=key==='growthFan'||key==='growthSpire';
        mesh.castShadow=!crystalGrowth;mesh.receiveShadow=true;
        mesh.userData.sharedAssetGeometry=true;mesh.userData.sharedAssetMaterial=true;
        const references=[];
        for(let i=0;i<family.length;i++) {
          const placement=family[i];
          const x=placement.x+0.5,z=placement.z+0.5;
          const size=key==='mast'?0.87:key==='cargo'?0.82:key==='basalt'?0.78:key==='trackWreck'?0.57:0.62;
          const position=new THREE.Vector3(x,0.04,z);
          const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),hash(placement.x,placement.z,192)*Math.PI*2);
          const scale=new THREE.Vector3().setScalar(size*(0.84+hash(placement.x,placement.z,193)*0.3));
          const matrix=new THREE.Matrix4().compose(position,rotation,scale).multiply(part.matrixWorld);
          const index=placement.z*game.width+placement.x;
          const visible=(game.fog?.[placement.z]?.[placement.x]??0)>0;
          mesh.setMatrixAt(i,visible?matrix:HIDDEN_INSTANCE_MATRIX);
          if(!this.environmentPropInstances.has(index))this.environmentPropInstances.set(index,[]);
          references.push({mesh,index:i,matrix});
          this.environmentPropInstances.get(index).push(references[references.length-1]);
        }
        mesh.instanceMatrix.needsUpdate=true;
        group.add(mesh);
      }
    }
    this.environmentPropGroup=group;
    this.terrainGroup.add(group);
  }

  _addStormBasinLandmark(game) {
    if(game.mapId!=='storm-basin'||this.quality==='eco') return;
    const source=this.assetModels.get('stormArray');
    if(!source) return;
    const anchor=STORM_BASIN_ARRAY_TILE;
    const px=anchor.x+0.5,pz=anchor.z+0.5;
    if(game.terrain[anchor.z]?.[anchor.x]?.type!=='rock') return;
    // The full two-tile plinth stays on blocked rock cells. This fixed map
    // anchor makes the landmark stable across seeds and quality changes.
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++) {
      if(game.terrain[anchor.z+dz]?.[anchor.x+dx]?.type!=='rock') return;
    }
    if((game.relays||[]).some(r=>Math.hypot(px-r.x,pz-r.y)<4.3)) return;
    if((game.bridges||[]).some(b=>px>=b.x-1.1&&px<=b.x+b.w+1.1&&pz>=b.y-1.1&&pz<=b.y+b.h+1.1)) return;
    if((game.terrain||[]).some((row,z)=>row.some((tile,x)=>tile?.type==='crystal'&&
      Math.hypot(px-(x+0.5),pz-(z+0.5))<2.2))) return;
    if((game.buildings||[]).some(b=>px>=b.x-1.1&&px<=b.x+b.w+1.1&&pz>=b.y-1.1&&pz<=b.y+b.h+1.1)) return;
    const group=source.clone(true);
    group.name='storm-basin-fractured-weather-array';
    group.position.set(px,0.085,pz);
    group.rotation.y=-0.24;
    group.scale.setScalar(0.92);
    group.traverse(object=>{
      if(!object.isMesh) return;
      object.castShadow=false;
      object.receiveShadow=false;
      object.userData.sharedAssetGeometry=true;
      object.userData.sharedAssetMaterial=true;
    });
    const tileIndex=anchor.z*game.width+anchor.x;
    const fogVisible=(game.fog?.[anchor.z]?.[anchor.x]??0)>0;
    group.userData.fogVisible=fogVisible;
    group.visible=fogVisible;
    this.stormArrayTileIndex=tileIndex;
    this.stormArrayGroup=group;
    this.terrainGroup.add(group);
  }

  _addSandFormations(game) {
    // Low, shadowless sediment ridges add scale to open sand without changing
    // tile geometry, collision, pathing, or click targets. One instanced batch
    // keeps the dressing to a single draw call at every graphics tier.
    const cap=this.quality==='ultra'?24:this.quality==='balanced'?16:8;
    const nearGameplay=(x,z,radius)=>
      (game.buildings||[]).some(b=>Math.hypot(x-(b.x+b.w/2),z-(b.y+b.h/2))<radius+Math.max(b.w,b.h)*0.27)||
      (game.relays||[]).some(r=>Math.hypot(x-r.x,z-r.y)<radius+1.8)||
      (game.units||[]).some(u=>u.hp>0&&!u.embarkedIn&&Math.hypot(x-u.x,z-u.y)<radius+1.2)||
      (game.bridges||[]).some(b=>x>=b.x-2.2&&x<=b.x+b.w+2.2&&z>=b.y-2.2&&z<=b.y+b.h+2.2);
    const crystalNear=(x,z)=>{
      for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++) {
        const tile=game.terrain[Math.floor(z)+dz]?.[Math.floor(x)+dx];
        if(tile?.type==='crystal'&&Math.hypot(dx,dz)<2.4)return true;
      }
      return false;
    };
    // The Shard Valley service road is an authored ribbon through the basin.
    // Keep its full width and shoulders open so the track remains readable.
    const roadPoints=game.mapId==='shard-valley'?[
      [5,40],[11,38],[18,34],[25,29],[31,24],[39,20],[47,16],[55,10],
    ]:[];
    const nearRoad=(x,z)=>{
      for(let i=1;i<roadPoints.length;i++) {
        const [ax,az]=roadPoints[i-1],[bx,bz]=roadPoints[i];
        const dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
        if(Math.hypot(x-(ax+dx*t),z-(az+dz*t))<3.8)return true;
      }
      return false;
    };
    const candidates=[];
    for(let z=2;z<game.height-2;z++)for(let x=2;x<game.width-2;x++) {
      const tile=game.terrain[z]?.[x];
      if(tile?.type!=='sand'||(tile.resource||0)>0)continue;
      const px=x+0.5,pz=z+0.5;
      if(nearGameplay(px,pz,1.2)||crystalNear(px,pz)||nearRoad(px,pz))continue;
      candidates.push({x,z,score:hash(x,z,611)});
    }
    candidates.sort((a,b)=>b.score-a.score);
    const anchors=[];
    for(const candidate of candidates) {
      if(anchors.length>=cap)break;
      if(anchors.some(p=>Math.hypot(p.x-candidate.x,p.z-candidate.z)<3.6))continue;
      anchors.push(candidate);
    }
    if(!anchors.length)return;

    const geometry=new THREE.DodecahedronGeometry(0.64,0);
    // Instance colors tint the shared geometry directly; the geometry has no
    // per-vertex color attribute, so enabling vertexColors would black it out.
    const material=mat(0xffffff,{roughness:1,metalness:0,flatShading:true});
    const mesh=new THREE.InstancedMesh(geometry,material,anchors.length*3);
    mesh.name='sand-formations';
    mesh.count=anchors.length*3;
    mesh.frustumCulled=false;
    mesh.castShadow=false;
    mesh.receiveShadow=false;
    mesh.raycast=()=>{};
    let index=0;
    for(const anchor of anchors) {
      const x=anchor.x+0.5,z=anchor.z+0.5;
      const yaw=hash(anchor.x,anchor.z,612)*Math.PI;
      const base=tileColor('sand',anchor.x,anchor.z,game.terrain[anchor.z][anchor.x]?.detail||0,this.mapStyle)
        .lerp(new THREE.Color(this.mapStyle.patch),0.10);
      for(let piece=0;piece<3;piece++) {
        const primary=piece===0;
        const offset=primary?0:0.34+hash(anchor.x,anchor.z,613+piece)*0.16;
        const angle=primary?yaw:yaw+(piece===1?-0.82:0.94);
        const width=primary?0.82+hash(anchor.x,anchor.z,616)*0.24:0.48+hash(anchor.x,anchor.z,617+piece)*0.16;
        const depth=primary?0.54+hash(anchor.x,anchor.z,618)*0.16:0.34+hash(anchor.x,anchor.z,619+piece)*0.12;
        const height=primary?0.15+hash(anchor.x,anchor.z,620)*0.045:0.095+hash(anchor.x,anchor.z,621+piece)*0.035;
        const px=x+Math.cos(angle)*offset,pz=z+Math.sin(angle)*offset;
        this.tmpObj.position.set(px,height*(primary?0.36:0.25),pz);
        this.tmpObj.rotation.set((hash(anchor.x,anchor.z,622+piece)-0.5)*0.12,
          hash(anchor.x,anchor.z,625+piece)*Math.PI*2,(hash(anchor.x,anchor.z,628+piece)-0.5)*0.12);
        this.tmpObj.scale.set(width,height,depth);
        this.tmpObj.updateMatrix();
        const matrix=this.tmpObj.matrix.clone();
        const tileIndex=anchor.z*game.width+anchor.x;
        const isVisible=(game.fog?.[anchor.z]?.[anchor.x]??0)>0;
        mesh.setMatrixAt(index,isVisible?matrix:HIDDEN_INSTANCE_MATRIX);
        if(!this.sandFormationInstances.has(tileIndex))this.sandFormationInstances.set(tileIndex,[]);
        this.sandFormationInstances.get(tileIndex).push({mesh,index,matrix});
        const tint=0.96+hash(anchor.x,anchor.z,631+piece)*0.08;
        mesh.setColorAt(index++,base.clone().multiplyScalar(tint));
      }
    }
    mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    this.sandFormationMesh=mesh;
    this.terrainGroup.add(mesh);
  }

  _syncFog(game, force = false) {
    if (!this.fogTexture) return;
    const total=game.width*game.height;
    let changed=force||this.fogCache.length!==total;
    if(!changed) {
      for(let z=0;z<game.height&&!changed;z++) for(let x=0;x<game.width;x++) {
        const i=z*game.width+x;
        if(this.fogCache[i] !== (game.fog?.[z]?.[x] ?? 2)) {changed=true;break;}
      }
    }
    if(!changed) return;

    const fogPixels=this.fogTexture.image.data;
    for(let z=0;z<game.height;z++) for(let x=0;x<game.width;x++) {
      const f=game.fog?.[z]?.[x] ?? 2;
      const i=z*game.width+x;
      if(force||this.fogCache[i]!==f) {
        this.fogCache[i]=f;
        if(i===this.stormArrayTileIndex&&this.stormArrayGroup) {
          const visible=f>0;
          this.stormArrayGroup.userData.fogVisible=visible;
          this.stormArrayGroup.visible=visible&&this.quality!=='eco';
        }
        if(this.crystalTiles.has(i)) this._updateCrystalInstance(x,z,this.resourceCache[i],f,game.width);
        const special=this.decorativeCrystalTiles.get(i);
        if(special) special.visible=this.resourceCache[i]>0&&f>0;
        const propInstances=this.environmentPropInstances.get(i);
        const propVisible=(game.fog?.[z]?.[x]??0)>0;
        if(propInstances)for(const instance of propInstances) {
          instance.mesh.setMatrixAt(instance.index,propVisible?instance.matrix:HIDDEN_INSTANCE_MATRIX);
          instance.mesh.instanceMatrix.needsUpdate=true;
        }
        const sandInstances=this.sandFormationInstances.get(i);
        if(sandInstances)for(const instance of sandInstances) {
          instance.mesh.setMatrixAt(instance.index,propVisible?instance.matrix:HIDDEN_INSTANCE_MATRIX);
          instance.mesh.instanceMatrix.needsUpdate=true;
        }
      }
      fogPixels[i]=f===2?255:f===1?128:0;
    }
    for(const placement of this.macroLandmarkPlacements) {
      let visible=true;
      for(let dz=0;dz<placement.h&&visible;dz++)for(let dx=0;dx<placement.w;dx++)
        if((game.fog?.[placement.z+dz]?.[placement.x+dx]??0)===0) {visible=false;break;}
      if(visible===placement.visible&&!force)continue;
      placement.visible=visible;
      for(const {mesh,index,matrix} of placement.refs) {
        mesh.setMatrixAt(index,visible?matrix:HIDDEN_INSTANCE_MATRIX);
        mesh.instanceMatrix.needsUpdate=true;
      }
    }
    this.fogCache.length=total;
    this.fogTexture.needsUpdate=true;
  }

  _updateCrystalInstance(x,z,resource,visibility,width) {
    const base=this.crystalTiles.get(z*width+x);
    if(base===undefined||!this.crystalMesh) return;
    for(let j=0;j<this.crystalStride;j++) {
      const authored=this.crystalStride===1;
      this.tmpObj.position.set(authored?x+0.5:x+0.25+hash(x,z,22+j)*0.5,authored?0.01:0.23+j*0.06,authored?z+0.5:z+0.25+hash(x,z,32+j)*0.5);
      this.tmpObj.rotation.set(authored?0:(hash(x,z,42+j)-0.5)*0.54,hash(x,z,52+j)*6.28,authored?0:(hash(x,z,62+j)-0.5)*0.42);
      const s=resource>0&&visibility>0?((authored?0.74:0.72)+hash(x,z,72+j)*(authored?0.31:0.93))*(visibility===1?0.52:1):0.001;
      const shardHeight=authored?1:(0.66+hash(x,z,202+j)*0.72);
      this.tmpObj.scale.set(s*(authored?0.84+hash(x,z,212+j)*0.30:1),s*shardHeight*(0.8+resource/1200),s*(authored?0.84+hash(x,z,222+j)*0.30:1));
      this.tmpObj.updateMatrix(); this.crystalMesh.setMatrixAt(base+j,this.tmpObj.matrix);
    }
    this.crystalMesh.instanceMatrix.needsUpdate=true;
  }

  _syncTerrainChanges(game) {
    // Regrowth is rare. Rebuild only if a tile changes kind; harvest updates
    // only the affected crystal instances.
    for(let z=0;z<game.height;z++) for(let x=0;x<game.width;x++) {
      const i=z*game.width+x;
      const kind=game.terrain[z][x]?.type||'sand';
      // Intact bridges render over the shared ground material. Normalize their
      // tiles to sand for cache purposes; a destroyed bridge becomes water and
      // triggers the one necessary terrain rebuild.
      if(this.terrainCache[i] !== (kind==='bridge'?'sand':kind)) { this._buildTerrain(game); return; }
      const resource=game.terrain[z][x]?.resource||0;
      if(this.resourceCache[i]!==resource) {
        this.resourceCache[i]=resource;
        this._updateCrystalInstance(x,z,resource,this.fogCache[i]??2,game.width);
        const special=this.decorativeCrystalTiles.get(i);
        if(special) special.visible=resource>0&&(this.fogCache[i]??2)>0;
      }
    }
  }

  _syncFieldOrder(game,time) {
    const order=getCampaignFieldOrderView(game);
    const target=order?.status==='active'?order.target:null;
    // The order is known in the briefing, but a moving enemy is not tracked
    // through shroud. Its battlefield beacon appears only in current sight.
    const visible=target&&Number.isFinite(target.x)&&Number.isFinite(target.y)&&
      game.fog?.[Math.floor(target.y)]?.[Math.floor(target.x)]===2;
    if(!visible) {
      if(this.fieldOrderMarker)this.fieldOrderMarker.visible=false;
      return;
    }
    if(!this.fieldOrderMarker) {
      const gold=new THREE.MeshBasicMaterial({color:0xffd589,transparent:true,
        opacity:0.9,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
      const pale=new THREE.MeshBasicMaterial({color:0xfff2c0,transparent:true,
        opacity:0.62,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
      const marker=new THREE.Group();
      const outer=new THREE.Mesh(new THREE.RingGeometry(0.62,0.68,48),gold);
      outer.rotation.x=-Math.PI/2;outer.position.y=0.115;outer.renderOrder=6;
      marker.add(outer);
      const inner=new THREE.Mesh(new THREE.RingGeometry(0.47,0.49,48),pale);
      inner.rotation.x=-Math.PI/2;inner.position.y=0.12;inner.renderOrder=6;
      marker.add(inner);
      for(let i=0;i<4;i++) {
        const angle=i*Math.PI/2;
        const tick=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.018,0.035),gold);
        tick.position.set(Math.cos(angle)*0.76,0.12,Math.sin(angle)*0.76);
        tick.rotation.y=-angle;tick.renderOrder=7;marker.add(tick);
      }
      const beacon=new THREE.Mesh(new THREE.ConeGeometry(0.11,0.20,4),gold);
      beacon.rotation.x=Math.PI;beacon.position.y=1.04;beacon.renderOrder=7;
      marker.add(beacon);
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.013,0.62,6),pale);
      stem.position.y=0.64;stem.renderOrder=7;marker.add(stem);
      marker.userData={outer,beacon,gold,pale};
      this.orderGroup.add(marker);
      this.fieldOrderMarker=marker;
    }
    const marker=this.fieldOrderMarker;
    marker.visible=true;
    marker.position.set(target.x,0,target.y);
    const pulse=0.5+0.5*Math.sin(time*3.2);
    marker.userData.outer.scale.setScalar(1+0.10*pulse);
    marker.userData.beacon.position.y=1.01+0.08*pulse;
    marker.userData.gold.opacity=0.73+0.18*pulse;
  }

  _syncCampaignRouteMarker(game,time) {
    const state=game.mode==='campaign'?game.campaignState:null;
    let target=null,kind='';
    if(state?.ashesRouteRulesVersion>=51&&state.phase==='deploy-signal-shadow'&&
      game.campaignRoutePayoffId==='ghost-channel') {
      target=state.ghostShadowPoint;kind='ghost';
    } else if(state?.ashesRouteRulesVersion>=51&&state.phase==='recover-supply-cache'&&
      game.campaignRoutePayoffId==='iron-current'&&!state.routeCacheRecovered) {
      const wreck=(game.wrecks||[]).find(item=>item.id===state.routeCacheId);
      if(wreck) {target={x:wreck.x,y:wreck.y};kind='iron';}
    }
    const visible=target&&Number.isFinite(target.x)&&Number.isFinite(target.y)&&
      game.fog?.[Math.floor(target.y)]?.[Math.floor(target.x)]===2;
    if(!visible) {
      if(this.campaignRouteMarker)this.campaignRouteMarker.visible=false;
      return;
    }
    if(!this.campaignRouteMarker) {
      const group=new THREE.Group();
      const cyan=new THREE.MeshBasicMaterial({color:0x75f3f2,transparent:true,opacity:0.9,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
      const violet=new THREE.MeshBasicMaterial({color:0xa89aff,transparent:true,opacity:0.72,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
      const amber=new THREE.MeshBasicMaterial({color:0xffbf68,transparent:true,opacity:0.92,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
      const white=new THREE.MeshBasicMaterial({color:0xe7ffff,transparent:true,opacity:0.8,depthWrite:false,toneMapped:false});
      const ghostRing=new THREE.Mesh(new THREE.RingGeometry(2.12,2.20,56),cyan);
      ghostRing.rotation.x=-Math.PI/2;ghostRing.position.y=0.10;ghostRing.renderOrder=7;group.add(ghostRing);
      const ghostInner=new THREE.Mesh(new THREE.RingGeometry(0.17,0.21,24),violet);
      ghostInner.rotation.x=-Math.PI/2;ghostInner.position.y=0.12;ghostInner.renderOrder=8;group.add(ghostInner);
      const ghostSignal=new THREE.Mesh(new THREE.OctahedronGeometry(0.15,0),white);
      ghostSignal.position.y=0.54;ghostSignal.renderOrder=9;group.add(ghostSignal);
      const ghostRay=new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.022,0.58,6),violet);
      ghostRay.position.y=0.30;ghostRay.renderOrder=8;group.add(ghostRay);
      const ironRing=new THREE.Mesh(new THREE.RingGeometry(0.82,0.91,40),amber);
      ironRing.rotation.x=-Math.PI/2;ironRing.position.y=0.11;ironRing.renderOrder=7;group.add(ironRing);
      const ironCore=new THREE.Mesh(new THREE.OctahedronGeometry(0.13,0),amber);
      ironCore.position.y=0.35;ironCore.renderOrder=8;group.add(ironCore);
      group.userData={ghost:[ghostRing,ghostInner,ghostSignal,ghostRay],iron:[ironRing,ironCore],ghostRing,ghostInner,ghostSignal,ironRing,ironCore,cyan,violet,amber,white};
      this.orderGroup.add(group);this.campaignRouteMarker=group;
    }
    const marker=this.campaignRouteMarker,u=marker.userData;
    marker.visible=true;marker.position.set(target.x,0,target.y);
    const pulse=0.5+0.5*Math.sin(time*(kind==='ghost'?4.1:3.0));
    const ghost=kind==='ghost';
    u.ghost.forEach(mesh=>mesh.visible=ghost);u.iron.forEach(mesh=>mesh.visible=!ghost);
    if(ghost) {
      u.ghostRing.scale.setScalar(1+0.025*pulse);
      u.ghostInner.scale.setScalar(1+0.13*pulse);
      u.ghostSignal.position.y=0.49+0.16*pulse;
      u.cyan.opacity=0.52+0.26*pulse;u.violet.opacity=0.55+0.25*pulse;u.white.opacity=0.65+0.25*pulse;
    } else {
      u.ironRing.scale.setScalar(1+0.06*pulse);
      u.ironCore.position.y=0.29+0.07*pulse;
      u.amber.opacity=0.62+0.3*pulse;
    }
  }

  _disposePlacement() {
    if(!this.placement) return;
    const material=this.placement.userData.hologramMaterial;
    this.scene.remove(this.placement);
    this._disposeGroup(this.placement);
    material?.dispose();
    this.placement=null;
  }

  _syncPlacement(game,placeId,pointerWorld,time=0) {
    if(!placeId||!pointerWorld) {
      if(this.placement) this.placement.visible=false;
      return;
    }
    const def=game.buildingDefs?.[placeId];
    if(!def) {if(this.placement)this.placement.visible=false;return;}
    const x=Math.floor(pointerWorld.x),z=Math.floor(pointerWorld.y);
    const okay=game.canPlaceBuilding?.(placeId,x,z)?.ok??false;
    const vesperKey=game.faction==='vesper'&&({command:'vesperCommand',power:'vesperPower',
      refinery:'vesperRefinery',barracks:'vesperBarracks',factory:'vesperFactory',
      radar:'vesperRadar',tech:'vesperTech'}[placeId]);
    const assetVersion=this.assetVersions.get(vesperKey||placeId)||0;
    if(!this.placement||this.placement.userData.defId!==placeId||
      this.placement.userData.assetVersion!==assetVersion) {
      this._disposePlacement();
      const group=new THREE.Group();
      group.userData.defId=placeId;
      group.userData.assetVersion=assetVersion;
      const hologram=new THREE.MeshBasicMaterial({color:0x93f2d3,transparent:true,
        opacity:0.31,depthWrite:false,side:THREE.DoubleSide,fog:false,toneMapped:false});
      group.userData.hologramMaterial=hologram;
      const model=this._authoredModel({defId:placeId,faction:game.faction,w:def.w,h:def.h})||
        makeBuilding(placeId,game.faction,def.w,def.h);
      const oldMaterials=new Set();
      model.traverse(part=>{
        if(!part.isMesh) return;
        for(const material of Array.isArray(part.material)?part.material:[part.material]) oldMaterials.add(material);
        part.material=hologram;
        part.userData.sharedAssetMaterial=true;
        part.castShadow=false;
        part.receiveShadow=false;
        part.renderOrder=12;
      });
      oldMaterials.forEach(material=>material?.dispose());
      group.add(model);
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(def.w,def.h),
        new THREE.MeshBasicMaterial({color:0x93f2d3,transparent:true,opacity:0.21,
          depthWrite:false,depthTest:false,side:THREE.DoubleSide,fog:false,toneMapped:false}));
      floor.rotation.x=-Math.PI/2;
      floor.position.y=0.03;
      floor.renderOrder=11;
      group.add(floor);
      const box=new THREE.BoxGeometry(def.w-0.03,0.04,def.h-0.03);
      const edgeGeometry=new THREE.EdgesGeometry(box);
      box.dispose();
      const edgeMaterial=new THREE.LineBasicMaterial({color:0x9af6d9,transparent:true,
        opacity:0.94,depthTest:false,depthWrite:false,fog:false,toneMapped:false});
      const outline=new THREE.LineSegments(edgeGeometry,edgeMaterial);
      outline.position.y=0.055;
      outline.renderOrder=13;
      group.add(outline);
      const beaconPoints=[];
      for(const sideX of [-1,1])for(const sideZ of [-1,1]){
        const px=sideX*(def.w/2-0.08),pz=sideZ*(def.h/2-0.08);
        beaconPoints.push(px,0.08,pz,px,0.43,pz);
      }
      const beaconGeometry=new THREE.BufferGeometry();
      beaconGeometry.setAttribute('position',new THREE.Float32BufferAttribute(beaconPoints,3));
      const beacons=new THREE.LineSegments(beaconGeometry,edgeMaterial);
      beacons.userData.sharedAssetMaterial=true;
      beacons.renderOrder=13;
      group.add(beacons);
      group.userData.floor=floor;
      group.userData.outline=outline;
      group.userData.beacons=beacons;
      this.placement=group;
      this.scene.add(this.placement);
    }
    this.placement.visible=true;
    this.placement.position.set(x+def.w/2,0.02,z+def.h/2);
    const color=okay?0x9af6d9:0xff806f;
    this.placement.userData.hologramMaterial.color.setHex(color);
    this.placement.userData.hologramMaterial.opacity=0.28+0.05*Math.sin(time*3.8);
    this.placement.userData.floor.material.color.setHex(color);
    this.placement.userData.outline.material.color.setHex(color);
    this.placement.userData.outline.material.opacity=0.78+0.15*Math.sin(time*4.5);
  }

  _selectionRing(radius, faction, showFacing = false) {
    const color = faction === 'aegis' ? 0x70f0f4 : 0xff9c74;
    const ring = new THREE.Group();
    ring.rotation.x=-Math.PI/2;
    ring.position.y=0.08;
    ring.renderOrder=4;
    // The dark outer/inner lip preserves contrast over pale sand and bright
    // crystals; the narrower faction band remains clear of the gold rank ring.
    const outline = new THREE.Mesh(new THREE.RingGeometry(radius*0.78,radius,48),
      new THREE.MeshBasicMaterial({ color:0x07110f, transparent:true, opacity:0.88, side:THREE.DoubleSide, depthWrite:false }));
    const colorBand = new THREE.Mesh(new THREE.RingGeometry(radius*0.83,radius*0.96,48),
      new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.96, side:THREE.DoubleSide, depthWrite:false }));
    outline.renderOrder=4;
    colorBand.renderOrder=5;
    ring.userData.colorMaterial=colorBand.material;
    ring.add(outline,colorBand);
    if(showFacing) {
      // Unit models face local -Z. The ring's ground-plane rotation maps the
      // chevron's +Y tip to -Z, then the entity's yaw carries it with facing.
      const width=radius*0.82;
      const length=radius*0.66;
      const thickness=radius*0.20;
      const shape=new THREE.Shape();
      shape.moveTo(-width/2,0);
      shape.lineTo(-width/2+thickness,0);
      shape.lineTo(0,length-thickness);
      shape.lineTo(width/2-thickness,0);
      shape.lineTo(width/2,0);
      shape.lineTo(0,length);
      shape.closePath();
      const backing=new THREE.Mesh(new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({color:0x07110f,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
      backing.position.set(0,radius*0.18,0.18);
      backing.scale.setScalar(1.2);
      backing.renderOrder=6;
      const chevron=new THREE.Mesh(new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({color:faction==='aegis'?0xe9ff8a:0xffc0a7,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}));
      backing.material.depthTest=false;
      chevron.position.set(0,radius*0.18,0.184);
      chevron.renderOrder=7;
      ring.userData.facingChevron=chevron;
      ring.add(backing,chevron);
    }
    return ring;
  }

  _selectionBeacon(faction) {
    // A single selected unit can disappear behind a Relay crown or a crystal
    // cluster. Keep this small pointer in the screen plane above its hull;
    // the ground ring still carries heading and footprint information.
    const triangle=(halfWidth,top,bottom)=>{
      const shape=new THREE.Shape();
      shape.moveTo(-halfWidth,top);
      shape.lineTo(halfWidth,top);
      shape.lineTo(0,bottom);
      shape.closePath();
      return new THREE.ShapeGeometry(shape);
    };
    const beacon=new THREE.Group();
    const border=new THREE.Mesh(triangle(0.26,0.20,-0.24),
      new THREE.MeshBasicMaterial({color:0x07110f,side:THREE.DoubleSide,
        depthTest:false,depthWrite:false,toneMapped:false}));
    const face=new THREE.Mesh(triangle(0.17,0.13,-0.16),
      new THREE.MeshBasicMaterial({color:faction==='aegis'?0xe9ff8a:0xffc0a7,
        side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}));
    border.renderOrder=11;
    face.position.z=0.003;
    face.renderOrder=12;
    beacon.add(border,face);
    beacon.visible=false;
    return beacon;
  }

  _veterancyRing(radius) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.06, radius * 1.12, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd878, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.085;
    ring.renderOrder = 4;
    return ring;
  }

  _addTeamMarks(group,o,building,game) {
    const color=o.faction==='aegis'?0x47d9ef:0xff795e;
    const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.95,depthWrite:false,toneMapped:false});
    if(building) {
      const W=o.w-0.12,D=o.h-0.12;
      for(const z of [-D/2,D/2]) box(group,material,W,0.05,0.075,0,0.2,z);
      for(const x of [-W/2,W/2]) box(group,material,0.075,0.05,D,x,0.2,0);
      const signalTop={command:1.48,power:1.5,advancedPower:1.5,refinery:1.33,factory:1.17,radar:1.6,
        barracks:1.13,turret:0.94,helipad:0.83,silo:1.32,tech:1.55,
        superweapon:2.35,warhead:2.35,obelisk:2.35};
      const top=signalTop[o.defId]||1.15;
      box(group,material,Math.min(W*0.7,1.25),0.06,0.11,0,top,-Math.min(D*0.19,0.4));
      for(const x of [-Math.min(W*0.27,0.42),Math.min(W*0.27,0.42)])
        cylinder(group,material,0.075,0.09,0.14,8,x,top+0.09,-Math.min(D*0.19,0.4));
    } else if(!game.unitDefs?.[o.defId]?.flying) {
      const infantry=game.unitDefs?.[o.defId]?.armor==='infantry';
      // Keep the faction band outside the collision footprint: a 0.43 radius
      // sat beneath vehicle treads, so the team color disappeared at tactical
      // zoom. Ground vehicles use a broad perimeter and oversized hulls get
      // proportionally more clearance without adding per-unit draw calls.
      const radius=infantry?0.25:/^(harvester|mcv|guardian)$/.test(o.defId)?0.67:0.55;
      // Keep every visible ground unit legible against pale crystal beds and
      // the ion field, even when the player has not selected it. The dark lip
      // is slightly wider than the team band so neither faction's hue merges
      // into a bright terrain patch.
      const backing=new THREE.Mesh(new THREE.RingGeometry(radius*0.68,radius*1.17,28),
        new THREE.MeshBasicMaterial({color:0x08171c,transparent:true,opacity:0.91,
          depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
      backing.rotation.x=-Math.PI/2;backing.position.y=0.042;backing.renderOrder=2;
      group.add(backing);
      const marker=new THREE.Mesh(new THREE.RingGeometry(radius*0.78,radius,28),material);
      marker.rotation.x=-Math.PI/2;marker.position.y=0.052;marker.renderOrder=3;
      group.add(marker);
    }
  }

  _authoredModel(o) {
    if(o.defId==='guardian'&&o.faction==='aegis'&&!this.assetModels.has('guardian')&&!this.guardianRequested) {
      this.guardianRequested=true;
      new GLTFLoader().load('/assets/models/aegis-heavy-tank-game.glb',gltf=>{
        if(!this.renderer) return;
        gltf.scene.updateMatrixWorld(true);
        this.assetModels.set('guardian',gltf.scene);
        this.assetVersions.set('guardian',(this.assetVersions.get('guardian')||0)+1);
      },undefined,err=>console.warn('Guardian tank asset unavailable; using procedural model.',err));
    }
    const vesperStructure=o.faction==='vesper'&&({command:'vesperCommand',power:'vesperPower',
      refinery:'vesperRefinery',barracks:'vesperBarracks',factory:'vesperFactory',
      radar:'vesperRadar',tech:'vesperTech'}[o.defId]);
    const modelKey=o.defId==='guardian'&&o.faction!=='aegis'?'none':
      o.defId==='scout'&&o.faction==='vesper'?'scoutVesper':
      o.defId==='buggy'&&o.faction==='vesper'?'vesperBuggy':
      o.defId==='harvester'&&o.faction==='vesper'?'vesperHarvester':(vesperStructure||o.defId);
    const source=this.assetModels.get(modelKey);
    if(!source) return null;
    const visual=source.clone(true);
    // Blender structures use a roughly three-tile foundation; fit each one to
    // its actual simulation footprint so small defenses do not mask neighbors.
    if('w' in o){
      const sx=(o.w-0.08)/2.86,sz=(o.h-0.08)/2.86;
      visual.scale.set(sx,Math.sqrt(Math.min(sx,sz))*1.18,sz);
    }
    visual.traverse(obj=>{
      if(!obj.isMesh||obj.userData.rendererBatchSource) return;
      // GLTF geometry is immutable and shared across instances to keep unit-heavy
      // scenes light on allocations; only faction-tinted materials are per unit.
      obj.userData.sharedAssetGeometry=true;
      obj.material=(Array.isArray(obj.material)?obj.material:[obj.material]).map(original=>{
        const m=original.clone();
        if(m.name==='TeamAccent') {
          const aegis=o.faction==='aegis';
          m.color.setHex(aegis?0x56e8ff:0xff8367);
          if(m.emissive) m.emissive.setHex(aegis?0x27c8ec:0xe74e30);
          m.emissiveIntensity=2.25;
        } else if(m.color) {
          m.color.multiply(new THREE.Color(o.faction==='aegis'?0xb8e1e9:0xffc1a8));
        }
        return m;
      });
      if(obj.material.length===1) obj.material=obj.material[0];
      obj.castShadow=true; obj.receiveShadow=true;
    });
    const outer=new THREE.Group();
    outer.userData.authoredVisual=visual;
    outer.add(visual);
    return outer;
  }

  _prepareAnimation(group, o) {
    const visual=group.userData.authoredVisual||group.userData.proceduralVisual||group;
    const authored=!!group.userData.authoredVisual;
    group=visual;
    const animation = { phase: (Number.parseInt(String(o.id).replace(/\D/g, ''), 10) || 0) * 0.71 };
    if (!('w' in o)) {
      animation.motion = 0;
      animation.travel = 0;
      animation.baseY = visual.position.y;
      animation.wheels = [];
      animation.legs = visual.userData.motionLegs || [];
      animation.rotor = visual.userData.motionRotor || null;
      if (authored) {
        const wheelName = /^(mcv|buggy|apc)$/.test(o.defId)
          ? /^(?:Run-flat wheel|All-terrain tire|Wheel hub)(?:\.\d+)?$/
          : /^(?:Track road wheel|Track roller|Wheel hub)(?:\.\d+)?$/;
        visual.traverse(part => {
          const sourceName=part.name.replace(/_/g,' ').replace(/(\d{3})$/,'.$1');
          if (part.isMesh && wheelName.test(sourceName)) {
            animation.wheels.push({ part, rotation: part.quaternion.clone() });
          }
        });
      } else {
        for (const part of visual.userData.motionWheels || []) {
          animation.wheels.push({ part, rotation: part.quaternion.clone() });
        }
      }
      // Several compact GLBs join all wheel hubs into one mesh for draw-call
      // economy. Rotating that combined mesh would orbit every wheel around
      // one origin; only independent wheel nodes may spin.
      if (authored && animation.wheels.length < 2) animation.wheels.length = 0;
      animation.infantry = /^(scout|rifle|rocket|engineer|medic|flamer)$/.test(o.defId);
      if (animation.infantry) {
        // The authored rifle/rocket/engineer GLBs expose separate arm shells
        // with shoulder/elbow origins. Keep their source pose so procedural
        // gait and recoil can stay subtle and return cleanly to idle.
        animation.arms = ['L', 'R'].flatMap(side => ['upper', 'forearm'].map(segment => {
          const part = authoredPart(visual, `Arm.${side} ${segment}`);
          return part ? { part, side: side === 'L' ? -1 : 1, segment,
            pose: part.rotation.clone() } : null;
        })).filter(Boolean);
        animation.lastInfantryShotId = null;
        animation.infantryShotTime = -Infinity;
      }
      animation.flying = /^(orca|apache|dropship)$/.test(o.defId);
    }
    if (o.defId === 'command' && authored) {
      // The two faction Command Yards each keep their crane/signal arm as a
      // single named mesh, preserving the authored pivot at virtually no
      // draw-call cost.
      animation.commandGantry = authoredPart(group,
        o.faction === 'vesper' ? 'Vesper salvage signal arm' : 'Aegis construction jib');
      if (animation.commandGantry) animation.commandGantryBaseYaw = animation.commandGantry.rotation.y;
    }
    if (o.defId === 'radar') {
      animation.pivot = animatedPivot(group,
        ['Faceted radar dish', 'Dish inner face', 'Dish signal hub', 'Feed arm', 'Feed receiver'],
        0.18, 1.1, 0.42);
      animation.lights = emissiveParts(group, ['Dish signal hub', 'Radar screen', 'Radar screen.001', 'Radar screen.002']);
    } else if (o.defId === 'turret') {
      animation.pivot = animatedPivot(group,['Rotating gun assembly','Targeting optic'],0,0.98,0.05);
      animation.lights = emissiveParts(group,['Targeting optic']);
      animation.lights = emissiveParts(group, ['Targeting optic']);
      animation.aim = 0;
    } else if (o.defId === 'power') {
      animation.lights = emissiveParts(group,
        ['Glazed reactor core', 'Stack luminous vent', 'Stack luminous vent.001']);
      if (authored) animation.core = authoredPart(group,
        o.faction === 'vesper' ? 'Exposed ion crystal' : 'Glazed reactor core');
    } else if (o.defId === 'advancedPower') {
      animation.lights = emissiveParts(group,
        ['Fusion chamber', 'Core beacon', 'Pod indicator', 'Pod indicator.001', 'Pod indicator.002']);
    } else if (o.defId === 'factory') {
      animation.lights = emissiveParts(group,
        ['Gantry signal strip', 'Portal guide light', 'Portal guide light.001',
          'Roof skylight', 'Roof skylight.001', 'Roof skylight.002']);
      if (authored && o.faction === 'vesper') {
        animation.factoryRotor = authoredPart(group, 'Hot exhaust collar');
      } else if (authored) {
        animation.factoryGantry = authoredPart(group, 'Overhead gantry');
        animation.factoryDrums = ['Cooling drum', 'Cooling drum.001']
          .map(name => authoredPart(group, name)).filter(Boolean);
        if (animation.factoryGantry) animation.factoryGantryBaseX = animation.factoryGantry.position.x;
      }
    } else if (o.defId === 'refinery' && authored) {
      animation.refineryParts = o.faction === 'vesper'
        ? ['Crucible one', 'Crucible two'].map(name => authoredPart(group, name)).filter(Boolean)
        : [authoredPart(group, 'Vessel pressure band')].filter(Boolean);
    } else if (o.defId === 'serviceBay' && authored) {
      animation.gantry = authoredPart(group,'Gantry carriage');
      animation.leftArm = authoredPart(group,'Left repair arm');
      animation.rightArm = authoredPart(group,'Right repair arm');
      if (animation.gantry) animation.gantryBaseX = animation.gantry.position.x;
      if (animation.leftArm) animation.leftArmBase = animation.leftArm.quaternion.clone();
      if (animation.rightArm) animation.rightArmBase = animation.rightArm.quaternion.clone();
      if (animation.gantry) {
        const cue = new THREE.Group();
        const glow = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 5, 24),
          new THREE.MeshBasicMaterial({ color: 0x65f2ff, transparent: true, opacity: 0.85, depthWrite: false }));
        glow.rotation.x = Math.PI / 2;
        cue.add(glow);
        for (let i = 0; i < 3; i++) {
          const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0),
            new THREE.MeshBasicMaterial({ color: 0xb8fbff, transparent: true, opacity: 0.9, depthWrite: false }));
          spark.position.set(Math.cos(i * Math.PI * 2 / 3) * 0.13, 0.035, Math.sin(i * Math.PI * 2 / 3) * 0.13);
          cue.add(spark);
        }
        cue.position.y = 0.055;
        cue.visible = false;
        animation.gantry.add(cue);
        animation.serviceCue = cue;
        animation.serviceGlow = glow;
      }
      // The exporter combines static meshes by material, retaining these two
      // node names for the luminous rails and diagnostic display.
      animation.lights = emissiveParts(group,
        ['Rail luminous guide', 'Console status display']);
    } else if (o.defId === 'harvester') {
      animation.cargo = [authoredPart(group,'Loaded crystal shard')].filter(Boolean);
      animation.lights = emissiveParts(group,
        ['Loaded crystal shard']);
    } else if (o.defId === 'lightTank' && authored) {
      // The Striker GLB keeps the entire upper fighting compartment together
      // as one eight-material mesh, so its sights, armor and gun all turn as
      // one without paying for dozens of separate moving draw calls.
      animation.pivot = animatedPivot(group,['Rotating turret assembly'],0,0.60,-0.035);
      animation.aim = 0;
      animation.recoil = 0;
      animation.lastShotTime = -Infinity;
    } else if (o.defId === 'apache' && authored) {
      animation.pivot = animatedPivot(group,
        ['Apache main rotor blade', 'Apache main rotor blade.001',
          'Apache main rotor blade.002', 'Apache main rotor blade.003'], 0, 0.89, 0.12);
      animation.lights = emissiveParts(group, ['Tail warning lamp', 'Wingtip Vesper stripe',
        'Wingtip Vesper stripe.001']);
    } else if (o.defId === 'orca' && authored) {
      animation.pivot = animatedPivot(group,
        ['Main rotor blade', 'Main rotor blade.001'], 0, 0.74, 0.10);
      animation.lights = emissiveParts(group, ['Engine glow', 'Engine glow.001']);
    } else if (o.defId === 'dropship' && authored) {
      animation.frontFan = animatedPivot(group,
        ['Dropship lift fan blade.004','Dropship lift fan blade.005',
          'Dropship lift fan blade.006','Dropship lift fan blade.007'], .91,.865,-.49);
      animation.rearFan = animatedPivot(group,
        ['Dropship lift fan blade','Dropship lift fan blade.001',
          'Dropship lift fan blade.002','Dropship lift fan blade.003'], -.91,.865,.49);
      // A restrained pair of radial washes anchors the aircraft to its
      // insertion point. They sit at terrain height while the hull hovers.
      animation.rotorWash=[];
      for(const [x,z] of [[.91,-.49],[-.91,.49]]) {
        const wash=new THREE.Mesh(new THREE.CircleGeometry(.68,28),new THREE.MeshBasicMaterial({
          color:0x789c99,map:this.groundPatchTexture||null,transparent:true,opacity:0.16,
          depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
        wash.rotation.x=-Math.PI/2;wash.position.set(x,-.675,z);wash.renderOrder=1;
        group.add(wash);
        const ripple=new THREE.Mesh(new THREE.TorusGeometry(.62,.018,4,28),new THREE.MeshBasicMaterial({
          color:0x9dd6ce,transparent:true,opacity:0.17,depthWrite:false,toneMapped:false}));
        ripple.rotation.x=-Math.PI/2;ripple.position.set(x,-.666,z);ripple.renderOrder=1;
        group.add(ripple);
        animation.rotorWash.push({wash,ripple,phase:x<0?1.7:0});
      }
      animation.lights = emissiveParts(group, ['Navigation beacon','Navigation beacon.001']);
    } else if (o.defId === 'guardTower') {
      animation.pivot = animatedPivot(group,
        ['Watch head', 'Watch cannon', 'Watch cannon.001', 'Watch optic', 'Watch optic accent'],
        0, 1.62, -0.12);
      animation.aim = 0;
      animation.lights = emissiveParts(group, ['Watch optic', 'Watch optic accent']);
    } else if (o.defId === 'aaTower') {
      animation.pivot = animatedPivot(group,
        ['Armored rotating platform', 'Interceptor canister', 'Interceptor canister.001',
          'Interceptor canister.002', 'Skyshield radar optic'], 0, 0.57, 0.12);
      animation.aim = 0;
      animation.lights = emissiveParts(group, ['Skyshield radar optic']);
    } else if (o.defId === 'sam') {
      animation.pivot = animatedPivot(group,
        ['Launcher rotation ring', 'SAM missile rail', 'SAM missile rail.001',
          'Vesper missile', 'Vesper missile.001', 'Missile nose', 'Missile nose.001'], 0, 0.55, 0.15);
      animation.aim = 0;
      animation.lights = emissiveParts(group, ['Launcher status light', 'Launcher status light.001']);
    } else if (o.defId === 'helipad') {
      animation.lights = emissiveParts(group,
        ['Landing zone inner ring', 'Apron perimeter light', 'Apron perimeter light.001',
          'Apron perimeter light.002', 'Apron perimeter light.003', 'Landing beacon']);
    } else if (o.defId === 'tech') {
      animation.lights = emissiveParts(group,
        ['Quantum core', 'Sensor light band', 'Sensor light band.001', 'Sensor light band.002',
          'Entry guide light', 'Entry guide light.001']);
    } else if (o.defId === 'superweapon') {
      animation.lights = emissiveParts(group,
        ['Ion emitter core', 'Ion emitter crown', 'Coil energy channel', 'Coil energy channel.001',
          'Coil energy channel.002']);
    } else if (o.defId === 'warhead') {
      animation.lights = emissiveParts(group,
        ['Warhead access lid', 'Buttress warning light', 'Buttress warning light.001',
          'Buttress warning light.002', 'Buttress warning light.003']);
    }
    // Renderer-only muzzle sockets follow the actual animated weapon node.
    // These points are in the Three.js authored-model coordinate system
    // (Blender Z-up is converted to Three Y-up by glTF). They are empty nodes,
    // so they do not add geometry or draw calls.
    const muzzleSocket = new THREE.Object3D();
    if (o.defId === 'lightTank' && animation.pivot) {
      muzzleSocket.position.set(0, 0.055, -0.754);
      animation.pivot.add(muzzleSocket);
      animation.muzzleSocket = muzzleSocket;
    } else if (o.defId === 'turret' && animation.pivot) {
      muzzleSocket.position.set(0, 0.37, -1.125);
      animation.pivot.add(muzzleSocket);
      animation.muzzleSocket = muzzleSocket;
    } else if (o.defId === 'guardTower' && animation.pivot) {
      muzzleSocket.position.set(0, 0.21, -0.65);
      animation.pivot.add(muzzleSocket);
      animation.muzzleSocket = muzzleSocket;
    } else if (o.defId === 'sam' && animation.pivot) {
      muzzleSocket.position.set(0, 0.99, -0.11);
      animation.pivot.add(muzzleSocket);
      animation.muzzleSocket = muzzleSocket;
    } else if (o.defId === 'artillery') {
      muzzleSocket.position.set(0, 1.08, -1.647);
      group.add(muzzleSocket);
      animation.muzzleSocket = muzzleSocket;
    }
    return animation.motion !== undefined || animation.pivot || animation.lights || animation.cargo ||
      animation.gantry || animation.leftArm || animation.rightArm || animation.muzzleSocket ||
      animation.core || animation.factoryGantry || animation.factoryDrums || animation.factoryRotor ||
      animation.refineryParts || animation.commandGantry ? animation : null;
  }

  _weaponMuzzlePosition(sourceId, game, targetX, targetY) {
    if (!sourceId) return null;
    const object = [...(game.units || []), ...(game.buildings || [])].find(item => item.id === sourceId);
    if (!object || (object.owner === 'enemy' && typeof game.isVisible === 'function' && !game.isVisible(object))) return null;
    const state = this.entities.get(sourceId);
    if (!state) return null;
    const socket = state.animation?.muzzleSocket;
    if (socket) {
      state.group.updateMatrixWorld(true);
      return socket.getWorldPosition(new THREE.Vector3());
    }
    // Procedural and uninstrumented authored units use a small forward offset
    // along their visible firing line. If the source is not visible (fog),
    // the caller keeps the deterministic simulation center as its fallback.
    const centerX = state.building ? object.x + object.w / 2 : object.x;
    const centerZ = state.building ? object.y + object.h / 2 : object.y;
    const dx = targetX - centerX, dz = targetY - centerZ;
    const length = Math.hypot(dx, dz);
    const reach = state.building ? 0.34 : 0.24;
    return new THREE.Vector3(centerX + (length > 0.001 ? dx / length * reach : 0),
      state.group.position.y + (state.building ? 0.44 : object.flying ? 0.12 : 0.30),
      centerZ + (length > 0.001 ? dz / length * reach : 0));
  }

  _animateEntity(state, o, game, time) {
    const a = state.animation;
    if (!a) return;
    const built = !state.building || (o.progress ?? 1) >= 1;
    const powered = !state.building || o.powered !== false;
    const phase = time * 2.5 + a.phase;
    let lightLevel = 1;
    if (a.infantry && a.arms?.length) {
      let shot = null;
      for (let i = (game.effects?.length || 0) - 1; i >= 0; i--) {
        const effect = game.effects[i];
        if (effect.type === 'projectile' && effect.sourceId === o.id) { shot = effect; break; }
      }
      if (shot && shot.id !== a.lastInfantryShotId) {
        a.lastInfantryShotId = shot.id;
        a.infantryShotTime = time;
      }
      const recoil = Math.exp(-Math.max(0, time - a.infantryShotTime) * 18);
      const gait = Math.sin(a.travel + a.phase) * a.motion;
      for (const arm of a.arms) {
        const swing = gait * arm.side;
        const upperKick = arm.side > 0 ? -0.075 : -0.035;
        const forearmKick = arm.side > 0 ? 0.045 : 0.025;
        arm.part.rotation.x = arm.pose.x + swing * (arm.segment === 'upper' ? 0.10 : 0.065) + recoil *
          (arm.segment === 'upper' ? upperKick : forearmKick);
        arm.part.rotation.y = arm.pose.y + recoil * (arm.side * (arm.segment === 'upper' ? 0.018 : 0.012));
        arm.part.rotation.z = arm.pose.z + swing * 0.025;
      }
    }
    if (o.defId === 'command' && a.commandGantry) {
      const active = built && powered;
      const sweep = active ? 0.34 : built ? 0 : 0.68;
      const rate = active ? 0.42 : 1.25;
      a.commandGantry.rotation.y = a.commandGantryBaseYaw + Math.sin(time * rate + a.phase) * sweep;
    } else if (o.defId === 'radar') {
      if (a.pivot) a.pivot.rotation.y = built && powered ? time * 0.42 : 0;
      lightLevel = built && powered ? 0.84 + 0.24 * Math.sin(phase) : 0.14;
    } else if (o.defId === 'turret') {
      // Projectiles carry source and destination IDs; track a real shot while
      // it is visible, then resume a small sentry sweep.
      const shot = built && powered && game.effects?.find(fx =>
        fx.type === 'projectile' && fx.sourceId === o.id && Number.isFinite(fx.tx) && Number.isFinite(fx.ty));
      const target = shot
        ? Math.atan2(-(shot.tx - (o.x + o.w / 2)), -(shot.ty - (o.y + o.h / 2)))
        : Math.sin(time * 0.47 + phase * 0.1) * 0.34;
      const delta = Math.atan2(Math.sin(target - a.aim), Math.cos(target - a.aim));
      a.aim += delta * 0.12;
      if (a.pivot) a.pivot.rotation.y = built && powered ? a.aim : 0;
      lightLevel = built && powered ? shot ? 2.2 : 0.8 + 0.2 * Math.sin(phase) : 0.12;
    } else if (o.defId === 'power' || o.defId === 'advancedPower') {
      const operating = built && powered;
      lightLevel = operating ? 1.05 + 0.38 * Math.sin(phase) : 0.18;
      const elapsed = Math.min(0.1, Math.max(0, time - (a.lastMachineryTime ?? time)));
      if (a.core) a.core.rotation.y += (operating ? 0.38 : 0) * elapsed;
      a.lastMachineryTime = time;
    } else if (o.defId === 'factory') {
      const active = built && powered && (o.queue?.length || 0) > 0;
      lightLevel = active ? 0.85 + 0.65 * Math.pow(Math.max(0, Math.sin(time * 5.5)), 4) : 0.42;
      const elapsed = Math.min(0.1, Math.max(0, time - (a.lastFactoryTime ?? time)));
      if (a.factoryGantry) {
        const travel = active ? 0.17 : built && powered ? 0.035 : 0;
        const rate = active ? 1.65 : 0.32;
        a.factoryGantry.position.x = a.factoryGantryBaseX + Math.sin(time * rate + a.phase) * travel;
      }
      if (a.factoryDrums) for (let i=0;i<a.factoryDrums.length;i++) {
        a.factoryDrums[i].rotation.y += (active ? 0.7 : built && powered ? 0.16 : 0) * elapsed * (i ? -1 : 1);
      }
      if (a.factoryRotor) a.factoryRotor.rotation.y += (active ? 0.65 : built && powered ? 0.14 : 0) * elapsed;
      a.lastFactoryTime = time;
    } else if (o.defId === 'refinery') {
      const operating = built && powered;
      const elapsed = Math.min(0.1, Math.max(0, time - (a.lastRefineryTime ?? time)));
      for(let i=0;i<(a.refineryParts?.length||0);i++) {
        const direction = o.faction === 'vesper' && i === 1 ? -1 : 1;
        a.refineryParts[i].rotation.y += (operating ? 0.28 : 0) * elapsed * direction;
      }
      a.lastRefineryTime = time;
    } else if (o.defId === 'harvester') {
      const capacity = game.unitDefs?.harvester?.capacity || 1;
      const load = clamp((o.cargo || 0) / capacity, 0, 1);
      a.cargo?.forEach(shard => {
        shard.visible = load > 0.06;
        if (shard.visible) shard.scale.y = 0.28+load*0.72+0.04*Math.sin(phase);
      });
      lightLevel = 0.8 + 0.35 * Math.sin(phase);
    } else if (o.defId === 'lightTank' && a.pivot) {
      const shot = game.effects?.find(fx => fx.type === 'projectile' && fx.sourceId === o.id &&
        Number.isFinite(fx.tx) && Number.isFinite(fx.ty));
      if (shot) {
        a.targetAim = Math.atan2(-(shot.tx-o.x),-(shot.ty-o.y))-state.group.rotation.y;
        a.lastShotTime = time;
      }
      // Keep the last firing line briefly, then settle the turret forward.
      // Use the rendered projectile only; the aim cannot reveal a hidden
      // target from simulation state to a replay or multiplayer client.
      const target=time-a.lastShotTime<1.8?a.targetAim||0:0;
      const delta=Math.atan2(Math.sin(target-a.aim),Math.cos(target-a.aim));
      a.aim+=delta*(shot?0.25:0.06);
      a.pivot.rotation.y=a.aim;
      a.recoil+=(Number(Boolean(shot))-a.recoil)*0.25;
      a.pivot.position.z=-0.035+a.recoil*0.055;
    } else if (o.defId === 'orca' || o.defId === 'apache' || o.defId === 'dropship') {
      if (a.pivot) a.pivot.rotation.y = time * 12.5;
      if (a.rotor) a.rotor.rotation.y = time * 12.5;
      if (a.frontFan) a.frontFan.rotation.y = time * 13.5;
      if (a.rearFan) a.rearFan.rotation.y = -time * 13.5;
      if(o.defId==='dropship') for(const {wash,ripple,phase:offset} of a.rotorWash||[]) {
        const pulse=0.5+0.5*Math.sin(time*2.6+offset);
        wash.material.opacity=0.11+pulse*0.075;
        ripple.material.opacity=0.09+pulse*0.12;
        const spread=1+pulse*0.10;
        ripple.scale.set(spread,spread,spread);
      }
      lightLevel = 0.76 + 0.24 * Math.sin(phase);
    } else if (o.defId === 'guardTower' || o.defId === 'aaTower' || o.defId === 'sam') {
      const shot = built && powered && game.effects?.find(fx =>
        fx.type === 'projectile' && fx.sourceId === o.id && Number.isFinite(fx.tx) && Number.isFinite(fx.ty));
      const target = shot
        ? Math.atan2(-(shot.tx - (o.x + o.w / 2)), -(shot.ty - (o.y + o.h / 2)))
        : Math.sin(time * 0.47 + phase * 0.1) * 0.34;
      const delta = Math.atan2(Math.sin(target - a.aim), Math.cos(target - a.aim));
      a.aim += delta * 0.12;
      if (a.pivot) a.pivot.rotation.y = built && powered ? a.aim : 0;
      lightLevel = built && powered ? shot ? 2.1 : 0.72 + 0.2 * Math.sin(phase) : 0.12;
    } else if (o.defId === 'helipad' || o.defId === 'tech' || o.defId === 'superweapon' || o.defId === 'warhead') {
      lightLevel = built && powered ? 0.88 + 0.28 * Math.sin(phase) : 0.12;
    } else if (o.defId === 'serviceBay') {
      let servicing = false;
      if (built && powered && (game.credits?.[o.owner] ?? 0) > 0) {
        const units = game.units;
        for (let i = 0; i < units.length; i++) {
          const unit = units[i], def = game.unitDefs?.[unit.defId];
          if (unit.owner !== o.owner || unit.hp <= 0 || unit.embarkedIn || def?.flying ||
            !['light', 'heavy'].includes(def?.armor) || unit.hp >= unit.maxHp) continue;
          const dx = Math.max(o.x - unit.x, 0, unit.x - (o.x + o.w));
          const dz = Math.max(o.y - unit.y, 0, unit.y - (o.y + o.h));
          if (Math.hypot(dx, dz) <= 2.5) { servicing = true; break; }
        }
      }
      const work = servicing ? 1 : 0.28;
      const sweep = Math.sin(time * (servicing ? 1.8 : 0.55) + a.phase);
      if (a.gantry) a.gantry.position.x = a.gantryBaseX + sweep * (servicing ? 0.19 : 0.08);
      if (a.serviceCue) {
        a.serviceCue.visible = servicing;
        if (servicing) {
          a.serviceCue.rotation.y = time * 2.2;
          const pulse = 0.84 + 0.26 * Math.sin(time * 10 + a.phase);
          a.serviceCue.scale.setScalar(pulse);
          a.serviceGlow.material.opacity = 0.62 + 0.28 * Math.sin(time * 8 + a.phase);
        }
      }
      if (a.leftArmBase && a.leftArm) {
        a.leftArm.quaternion.copy(a.leftArmBase);
        a.leftArm.rotateZ(work * (0.035 + 0.08 * Math.sin(time * 2.7 + a.phase)));
      }
      if (a.rightArmBase && a.rightArm) {
        a.rightArm.quaternion.copy(a.rightArmBase);
        a.rightArm.rotateZ(-work * (0.035 + 0.08 * Math.sin(time * 2.7 + a.phase + 0.6)));
      }
      lightLevel = built && powered ? (servicing ? 1.05 + 0.28 * Math.sin(time * 6 + a.phase) : 0.58 + 0.1 * Math.sin(phase)) : 0.1;
    }
    for (const { material, intensity } of a.lights || []) material.emissiveIntensity = intensity * lightLevel;
  }

  _animateMotion(state, speed) {
    const a=state.animation;
    if (!a || a.motion === undefined) return;
    // Displacement is measured from successive render positions, so cap a
    // teleport or skipped frame before it can snap the suspension or gait.
    const distance=Math.min(speed,0.12);
    a.motion+=(clamp(distance*24,0,1)-a.motion)*0.22;
    if (distance>0.001 && distance<0.12) a.travel=(a.travel+distance*17)%(Math.PI*2);
    const visual=state.group.userData.authoredVisual||state.group.userData.proceduralVisual;
    if (!visual) return;
    const gait=Math.sin(a.travel+a.phase);
    if (a.infantry) {
      visual.position.y=a.baseY+a.motion*(0.012+0.023*Math.abs(gait));
      visual.rotation.z=a.motion*gait*0.043;
      visual.rotation.x=a.motion*Math.cos(a.travel+a.phase)*0.025;
      for(let i=0;i<a.legs.length;i++) a.legs[i].rotation.x=a.motion*gait*(i&1?-0.42:0.42);
    } else if (!a.flying) {
      visual.position.y=a.baseY+a.motion*(0.008+0.012*Math.abs(gait));
      visual.rotation.x=a.motion*gait*0.013;
      visual.rotation.z=a.motion*Math.cos(a.travel+a.phase)*0.012;
      if (distance>0.001 && distance<0.12) {
        a.wheelAngle=((a.wheelAngle||0)+distance*8)%(Math.PI*2);
        this.tmpWheelQuat.setFromAxisAngle(this.wheelAxis,a.wheelAngle);
        for(let i=0;i<a.wheels.length;i++) {
          const wheel=a.wheels[i];
          wheel.part.quaternion.copy(wheel.rotation).multiply(this.tmpWheelQuat);
        }
      }
    }
  }

  _removeEntity(id,state) {
    this.entityGroup.remove(state.group);
    if(state.dust) {this.effectGroup.remove(state.dust);state.dust.material.dispose();}
    state.group.traverse(obj=>{if(obj.geometry&&!obj.userData.sharedAssetGeometry)obj.geometry.dispose();if(obj.material)(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose());});
    this.entities.delete(id);
  }

  _syncUnitAbilityVisuals(state,o,game,time) {
    const animation=state.animation;
    if(!animation||state.building) return;
    const braced=o.defId==='guardian'&&o.faction==='aegis'&&(o.braceUntil||0)>game.time;
    const ghosting=o.defId==='stealthTank'&&o.faction==='vesper'&&(o.ghostRunUntil||0)>game.time;
    if(braced&&!animation.braceCue) {
      const cue=new THREE.Group();
      const material=new THREE.MeshBasicMaterial({color:0x7feaff,transparent:true,opacity:0.44,
        depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending});
      const outer=new THREE.Mesh(new THREE.TorusGeometry(0.78,0.025,5,36),material);
      outer.rotation.x=-Math.PI/2;outer.position.y=0.25;cue.add(outer);
      const inner=new THREE.Mesh(new THREE.TorusGeometry(0.64,0.014,4,32),material.clone());
      inner.rotation.x=-Math.PI/2;inner.position.y=0.53;cue.add(inner);
      state.group.add(cue);animation.braceCue=cue;
    }
    if(animation.braceCue) {
      animation.braceCue.visible=braced;
      if(braced) {
        const pulse=0.5+0.5*Math.sin(time*5.4+animation.phase);
        animation.braceCue.children[0].material.opacity=0.28+0.16*pulse;
        animation.braceCue.children[1].material.opacity=0.18+0.12*pulse;
      }
    }
    if(ghosting&&!animation.ghostRunCue) {
      const cue=new THREE.Group();
      const material=new THREE.MeshBasicMaterial({color:0xc29aff,transparent:true,opacity:0.53,
        depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
      for(const [radius,start] of [[0.72,0.18],[0.72,Math.PI+0.18]]) {
        const arc=new THREE.Mesh(new THREE.TorusGeometry(radius,0.027,5,22,Math.PI*0.66),material.clone());
        arc.rotation.x=-Math.PI/2;arc.rotation.y=start;arc.position.y=0.095;cue.add(arc);
      }
      state.group.add(cue);animation.ghostRunCue=cue;
      animation.ghostMaterials=[];
      (state.group.userData.authoredVisual||state.group.userData.proceduralVisual||state.group).traverse(object=>{
        if(!object.isMesh||object.userData.rendererBatchSource) return;
        for(const m of (Array.isArray(object.material)?object.material:[object.material]))
          animation.ghostMaterials.push({material:m,opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite});
      });
    }
    if(animation.ghostRunCue) {
      animation.ghostRunCue.visible=ghosting;
      if(ghosting) {
        const pulse=0.5+0.5*Math.sin(time*8.2+animation.phase);
        animation.ghostRunCue.children.forEach((arc,index)=>{
          arc.material.opacity=0.32+0.30*pulse;
        });
        animation.ghostRunCue.rotation.y=time*0.58+animation.phase*0.2;
        for(const entry of animation.ghostMaterials) {
          entry.material.transparent=true;
          entry.material.depthWrite=false;
          entry.material.opacity=entry.opacity*(0.60+0.09*pulse);
        }
      } else {
        for(const entry of animation.ghostMaterials||[]) {
          entry.material.transparent=entry.transparent;
          entry.material.depthWrite=entry.depthWrite;
          entry.material.opacity=entry.opacity;
        }
      }
    }
  }

  _makeRefineryTransfer(group, faction) {
    // A compact gantry signal that reads at the normal RTS zoom. All geometry
    // is created once per refinery and is disposed with its entity group.
    const aegis=faction==='aegis';
    const color=aegis?0x56e8ff:0xff9867;
    const glow=new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.64,depthWrite:false,toneMapped:false});
    const pale=new THREE.MeshBasicMaterial({color:aegis?0xc9ffff:0xffe2bd,transparent:true,opacity:0.95,depthWrite:false,toneMapped:false});
    const rig=new THREE.Group();
    rig.position.y=1.28;
    rig.visible=false;
    const track=new THREE.Mesh(new THREE.TorusGeometry(0.9,0.045,5,40),glow.clone());
    track.rotation.x=Math.PI/2;
    track.position.y=0.03;
    rig.add(track);
    const arcGeometry=new THREE.BufferGeometry();
    const arcPositions=new Float32Array(97*3);
    for(let i=0;i<=96;i++) {
      const angle=(i/96)*Math.PI*2;
      arcPositions[i*3]=Math.cos(angle)*0.9;
      arcPositions[i*3+1]=0.045;
      arcPositions[i*3+2]=Math.sin(angle)*0.9;
    }
    arcGeometry.setAttribute('position',new THREE.BufferAttribute(arcPositions,3));
    arcGeometry.setDrawRange(0,0);
    const arc=new THREE.Line(arcGeometry,new THREE.LineBasicMaterial({color:aegis?0xc9ffff:0xffe2bd,transparent:true,opacity:0.95,depthWrite:false,toneMapped:false}));
    arc.frustumCulled=false;
    rig.add(arc);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.25,1,8),glow);
    beam.position.y=1.05;
    beam.scale.y=2.1;
    rig.add(beam);
    const pulse=new THREE.Mesh(new THREE.OctahedronGeometry(0.20,0),pale);
    rig.add(pulse);
    const crown=new THREE.Mesh(new THREE.TorusGeometry(0.72,0.055,6,40),pale);
    crown.position.y=2.55;
    crown.rotation.x=Math.PI/2;
    rig.add(crown);
    const conduit=new THREE.Group();
    const conduitBase=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.13,1,8),new THREE.MeshBasicMaterial({color:0x10282c,transparent:true,opacity:0.94,depthWrite:false,toneMapped:false}));
    const conduitCore=new THREE.Mesh(new THREE.CylinderGeometry(0.052,0.052,1,7),glow.clone());
    conduit.add(conduitBase,conduitCore);
    const particleGeometry=new THREE.OctahedronGeometry(0.14,0);
    const particles=[];
    for(let i=0;i<3;i++) {
      const particle=new THREE.Mesh(particleGeometry,pale.clone());
      particles.push(particle);
      conduit.add(particle);
    }
    conduit.visible=false;
    rig.add(conduit);
    group.add(rig);
    return {rig,track,arc,beam,pulse,crown,conduit,conduitBase,conduitCore,particles,
      unitY:new THREE.Vector3(0,1,0),direction:new THREE.Vector3()};
  }

  _syncRefineryTransfer(state, refinery, game, time) {
    if(refinery.defId!=='refinery'||!refinery._unloadHarvesterId) {
      if(state.refineryTransfer) state.refineryTransfer.rig.visible=false;
      return;
    }
    const harvester=(game.units||[]).find(unit=>unit.id===refinery._unloadHarvesterId&&unit.defId==='harvester'&&unit.hp>0);
    const visible=harvester&& (harvester.owner!=='enemy'||game.isVisible(harvester));
    if(!visible) {
      if(state.refineryTransfer) state.refineryTransfer.rig.visible=false;
      return;
    }
    if(!state.refineryTransfer) state.refineryTransfer=this._makeRefineryTransfer(state.group,refinery.faction);
    const {rig,track,arc,beam,pulse,crown,conduit,conduitBase,conduitCore,particles,unitY,direction}=state.refineryTransfer;
    const progress=clamp(Number.isFinite(harvester._unloadProgress)?harvester._unloadProgress:0,0,1);
    const wave=0.5+0.5*Math.sin(time*9.5);
    rig.visible=true;
    track.material.opacity=0.50+progress*0.28+wave*0.12;
    arc.geometry.setDrawRange(0,Math.max(2,Math.ceil(progress*96)));
    arc.material.opacity=0.78+progress*0.2;
    beam.scale.y=1.55+progress*1.1;
    beam.position.y=beam.scale.y*0.5;
    beam.material.opacity=0.58+progress*0.34+wave*0.08;
    pulse.position.y=0.42+progress*1.72;
    pulse.scale.setScalar(0.92+progress*0.3+wave*0.12);
    pulse.rotation.set(time*0.7,time*1.1,time*0.45);
    pulse.material.opacity=0.86+progress*0.12;
    crown.rotation.y=time*0.55;
    crown.material.opacity=0.72+progress*0.2+wave*0.08;

    // The low, illuminated conduit connects the dock to the gantry. Enemy
    // traffic only gets a conduit when every sampled tile is currently visible.
    const targetX=harvester.x-(refinery.x+refinery.w/2);
    const targetZ=harvester.y-(refinery.y+refinery.h/2);
    let pathVisible=true;
    if(harvester.owner==='enemy') {
      const steps=Math.max(1,Math.ceil(Math.hypot(targetX,targetZ)*2));
      for(let i=0;i<=steps;i++) {
        const t=i/steps;
        const x=Math.floor(refinery.x+refinery.w/2+targetX*t);
        const z=Math.floor(refinery.y+refinery.h/2+targetZ*t);
        if((game.fog?.[z]?.[x]??0)!==2) {pathVisible=false;break;}
      }
    }
    conduit.visible=pathVisible;
    if(pathVisible) {
      direction.set(targetX,0.0,targetZ);
      const length=Math.max(0.1,direction.length());
      direction.normalize();
      conduit.position.set(targetX*0.5,0.28,targetZ*0.5);
      conduitBase.scale.y=length;
      conduitCore.scale.y=length;
      conduitBase.quaternion.setFromUnitVectors(unitY,direction);
      conduitCore.quaternion.copy(conduitBase.quaternion);
      conduitCore.material.opacity=0.55+progress*0.38+wave*0.07;
      for(let i=0;i<particles.length;i++) {
        const travel=(time*0.72+i/particles.length)%1;
        const along=(1-travel)*(0.68+progress*0.32);
        particles[i].position.set(targetX*along,0.12+0.08*Math.sin(time*7+i),targetZ*along);
        particles[i].material.opacity=0.8+0.18*Math.sin(time*5+i*2);
        particles[i].scale.setScalar(0.8+0.2*progress);
      }
    }
  }

  _makeDamageSmoke(group, o) {
    if(!this.smokeTexture) {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
      const context=canvas.getContext('2d');
      const gradient=context.createRadialGradient(32,32,3,32,32,31);
      gradient.addColorStop(0,'rgba(255,255,255,0.72)');
      gradient.addColorStop(0.42,'rgba(255,255,255,0.37)');
      gradient.addColorStop(1,'rgba(255,255,255,0)');
      context.fillStyle=gradient;context.fillRect(0,0,64,64);
      this.smokeTexture=new THREE.CanvasTexture(canvas);
    }
    const plume=new THREE.Group();
    const height=/^(obelisk|superweapon|warhead)$/.test(o.defId)?2.1:(('w' in o)?1.12:0.66);
    for(let i=0;i<3;i++) {
      const puff=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
        new THREE.MeshBasicMaterial({color:i===0?0x7e8170:0x394948,map:this.smokeTexture,
          transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
      puff.userData={smokeIndex:i,smokeHeight:height};
      puff.renderOrder=4;
      plume.add(puff);
    }
    group.add(plume);
    return plume;
  }

  _animateDamageSmoke(state, o, hp, time) {
    if(hp>=0.58) {
      if(state.smoke) state.smoke.visible=false;
      return;
    }
    if(!state.smoke) state.smoke=this._makeDamageSmoke(state.group,o);
    state.smoke.visible=true;
    const severity=clamp((0.58-hp)/0.48,0,1);
    for(const puff of state.smoke.children) {
      const i=puff.userData.smokeIndex;
      const drift=(time*0.22+i/3+o.x*0.037)%1;
      puff.position.set((i-1)*0.13+Math.sin(time*0.8+i)*0.16,
        puff.userData.smokeHeight+drift*0.78,
        (i-1)*0.1);
      puff.quaternion.copy(this.camera.quaternion);
      const size=0.30+drift*0.53+severity*0.12;
      puff.scale.set(size,size,1);
      puff.material.opacity=severity*(1-drift)*0.42;
    }
  }

  _syncDamageAppearance(state, o, hp, time) {
    const animation = state.damageReaction;
    if (!animation) return;
    const previousHp = animation.lastHp;
    if (Number.isFinite(previousHp) && hp < previousHp - 0.002) {
      animation.hitAt = time;
      // A compact expanding ring turns otherwise easy-to-miss chip damage into
      // a clear impact beat at command zoom. It is allocated only for entities
      // that have actually taken damage and is removed with the entity group.
      if (!animation.impactRing) {
        const radius = animation.radius;
        const material = new THREE.MeshBasicMaterial({ color: 0xffe0a2, transparent: true,
          opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
          blending: THREE.AdditiveBlending });
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.82, 32), material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.16;
        ring.scale.setScalar(radius / 0.68);
        ring.renderOrder = 7;
        ring.visible = false;
        state.group.add(ring);
        animation.impactRing = ring;
        animation.impactRingScale = radius / 0.68;
      }
      animation.impactRing.visible = true;
    }
    animation.lastHp = hp;

    // A short, renderer-only jolt makes incoming fire legible without changing
    // simulation position or allocating a transient effect for every hit.
    const hitAge = time - animation.hitAt;
    const hit = hitAge >= 0 && hitAge < 0.34 ? Math.exp(-hitAge * 11) : 0;
    state.group.position.y += hit * (state.building ? 0.018 : 0.042);
    if (animation.impactRing) {
      const ringLife = clamp(1 - hitAge / 0.34, 0, 1);
      animation.impactRing.visible = ringLife > 0;
      animation.impactRing.material.opacity = 0.82 * ringLife;
      animation.impactRing.scale.setScalar(animation.impactRingScale * (0.48 + (1 - ringLife) * 0.95));
    }

    // Damage remains visible between impacts as a restrained warm, sooty tint.
    // Every material is already per-instance for authored GLBs; keep its
    // original colors and restore from those values every frame.
    const wear = hp < 0.45 ? (0.45 - hp) / 0.45 * 0.20 : 0;
    const flash = hit * 0.38;
    if (wear < 0.002 && flash < 0.002 && animation.applied === 0) return;
    animation.applied = Math.max(wear, flash);
    const wearColor = animation.wearColor;
    const flashColor = animation.flashColor;
    for (const entry of animation.materials) {
      entry.material.color.copy(entry.color).lerp(wearColor, wear).lerp(flashColor, flash);
    }
  }

  _setCampaignShield(state, o, time) {
    if(!o.campaignShielded) {
      if(state.campaignShield) {
        state.group.remove(state.campaignShield);
        state.campaignShield.traverse(obj=>{
          obj.geometry?.dispose();
          if(obj.material) (Array.isArray(obj.material)?obj.material:[obj.material]).forEach(material=>material.dispose());
        });
        state.campaignShield=null;
      }
      return;
    }
    if(!state.campaignShield) {
      const shield=new THREE.Group();
      const color=o.faction==='aegis'?0x49d6ed:0xff795e;
      const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.29,depthWrite:false,toneMapped:false});
      const brightMaterial=new THREE.MeshBasicMaterial({color:o.faction==='aegis'?0xa7f7ff:0xffc0a9,
        transparent:true,opacity:0.56,depthWrite:false,toneMapped:false});
      const radiusX=Math.max(0.72,(o.w||1)*0.62), radiusZ=Math.max(0.72,(o.h||1)*0.62);
      const addLoop=(major,tube,matl,y,rotationY=0)=>{
        const loop=new THREE.Mesh(new THREE.TorusGeometry(major,tube,5,40),matl);
        loop.rotation.x=Math.PI/2; loop.rotation.z=rotationY;
        loop.scale.set(radiusX*(major<0.95?0.78:1),radiusZ*(major<0.95?0.78:1),1);
        loop.position.y=y; loop.userData.shieldLoop=true; shield.add(loop); return loop;
      };
      addLoop(1,0.026,material,0.11);
      addLoop(0.78,0.018,brightMaterial,1.65,Math.PI/4);
      for(const angle of [0,Math.PI/2]) {
        const hoop=new THREE.Mesh(new THREE.TorusGeometry(1,0.016,5,40),material);
        hoop.scale.set(radiusX,0.91,radiusZ);
        hoop.rotation.set(0,angle,0);
        hoop.userData.shieldHoop=true; hoop.userData.phase=angle;
        shield.add(hoop);
      }
      for(let i=0;i<4;i++) {
        const node=new THREE.Mesh(new THREE.IcosahedronGeometry(0.075,0),brightMaterial.clone());
        node.userData.shieldNode=i;
        shield.add(node);
      }
      shield.userData={baseRadiusX:radiusX,baseRadiusZ:radiusZ};
      state.group.add(shield); state.campaignShield=shield;
    }
    const shield=state.campaignShield, {baseRadiusX:rx,baseRadiusZ:rz}=shield.userData;
    const pulse=0.94+0.06*Math.sin(time*3.2);
    shield.visible=true;
    shield.children.forEach(obj=>{
      if(obj.userData.shieldLoop) {
        obj.material.opacity=obj.material.opacity>0.4?0.49+0.09*Math.sin(time*4.4):0.23+0.055*Math.sin(time*3.1);
        obj.scale.x=rx*(obj.geometry.parameters.radius<0.9?0.78:1)*pulse;
        obj.scale.y=rz*(obj.geometry.parameters.radius<0.9?0.78:1)*pulse;
      }
      if(obj.userData.shieldHoop) obj.rotation.y=(obj.userData.phase||0)+time*0.08;
      if(Number.isInteger(obj.userData.shieldNode)) {
        const i=obj.userData.shieldNode, angle=i*Math.PI/2+time*0.35;
        obj.position.set(Math.cos(angle)*rx,0.65+0.88*Math.sin(time*1.8+i*1.3),Math.sin(angle)*rz);
        obj.material.opacity=0.68+0.2*Math.sin(time*5+i*1.7);
      }
    });
  }

  _syncEntities(game,time) {
    const live = this.entitySyncLive;
    const selected = this.entitySyncSelected;
    const acquiredTargets = this.entitySyncAcquiredTargets;
    live.clear();
    selected.clear();
    acquiredTargets.clear();
    for (const id of game.selection || []) selected.add(id);
    // Mark only enemies currently engaged by our forces. Entity visibility is
    // still the final gate below, so a stale attack order cannot reveal fog.
    for(const unit of game.units||[]) {
      if(unit.owner==='player'&&unit.order?.type==='attack'&&unit.order.targetId)
        acquiredTargets.add(unit.order.targetId);
    }
    for(const fx of game.effects||[]) {
      if(fx.type==='projectile'&&fx.owner==='player'&&fx.targetId) acquiredTargets.add(fx.targetId);
    }
    // Keep adjacent vehicle hulls from visually merging at the broad RTS view.
    // A small spatial grid makes the local density check linear in unit count;
    // only the model is scaled, leaving selection/target rings and hit geometry alone.
    const vehicleBuckets=this.vehicleBuckets;
    const vehicleBucketPool=this.vehicleBucketPool;
    const vehicleBucketWidth=Math.ceil((game.width||64)/2);
    const vehicleBucketHeight=Math.ceil((game.height||48)/2);
    let vehicleBucketCount=0;
    vehicleBuckets.clear();
    for(const bucket of vehicleBucketPool) bucket.length=0;
    for(const unit of game.units||[]) {
      const def=game.unitDefs?.[unit.defId];
      if(unit.hp<=0||unit.embarkedIn||!def||def.flying||def.armor==='infantry'||
        (unit.owner==='enemy'&&!game.isVisible(unit))) continue;
      const key=Math.floor(unit.y/2)*vehicleBucketWidth+Math.floor(unit.x/2);
      let bucket=vehicleBuckets.get(key);
      if(!bucket) {
        bucket=vehicleBucketPool[vehicleBucketCount];
        if(!bucket) vehicleBucketPool[vehicleBucketCount]=bucket=[];
        vehicleBucketCount++;
        vehicleBuckets.set(key,bucket);
      }
      bucket.push(unit);
    }
    const buildingCount = game.buildings.length;
    const entityCount = buildingCount + game.units.length;
    // Selected unit health bars add a direct battlefield read without filling
    // every crowded formation with UI. Keep the work bounded even when a
    // control group contains hundreds of units.
    let selectedHealthBars = 0;
    const selectedHealthBarLimit = this.quality === 'eco' ? 12 : 24;
    for(let i=0;i<entityCount;i++) {
      const o=i<buildingCount?game.buildings[i]:game.units[i-buildingCount];
      if(o.hp <= 0 || o.embarkedIn || (o.owner==='enemy' && !game.isVisible(o))) continue;
      const building='w' in o;
      live.add(o.id);
      let state=this.entities.get(o.id);
      const assetKey=o.faction==='vesper'&&({command:'vesperCommand',power:'vesperPower',harvester:'vesperHarvester',buggy:'vesperBuggy',
        refinery:'vesperRefinery',barracks:'vesperBarracks',factory:'vesperFactory',
        radar:'vesperRadar',tech:'vesperTech'}[o.defId]);
      const assetVersion=this.assetVersions.get(assetKey||o.defId)||0;
      if(state && state.version!==assetVersion) {this._removeEntity(o.id,state);state=null;}
      if(!state) {
        let group=this._authoredModel(o)||(building?makeBuilding(o.defId,o.faction,o.w,o.h):makeUnit(o.defId,o.faction));
        if(!building&&!group.userData.authoredVisual) {
          const outer=new THREE.Group();
          outer.userData.proceduralVisual=group;
          outer.add(group);
          group=outer;
        }
        const unitVisual=building?null:(group.userData.authoredVisual||group.userData.proceduralVisual||null);
        const damageMaterials=[];
        const seenDamageMaterials=new Set();
        // Only shade the physical model. Team marks, selection rings and other
        // tactical overlays must retain their information colors during hits.
        (group.userData.authoredVisual||group.userData.proceduralVisual||group).traverse(obj=>{
          if(!obj.isMesh||obj.userData.rendererBatchSource) return;
          for(const material of (Array.isArray(obj.material)?obj.material:[obj.material])) {
            if(!material.color||seenDamageMaterials.has(material)) continue;
            seenDamageMaterials.add(material);
            damageMaterials.push({material,color:material.color.clone()});
          }
        });
        this._addTeamMarks(group,o,building,game);
        const radius=building?Math.max(o.w,o.h)*0.62:game.unitDefs?.[o.defId]?.flying?0.70:game.unitDefs?.[o.defId]?.armor==='infantry'?0.34:0.56;
        const ring=this._selectionRing(radius,o.faction,!building);
        group.add(ring);
        const targetRing=new THREE.Mesh(new THREE.RingGeometry(radius*1.17,radius*1.28,40),
          new THREE.MeshBasicMaterial({color:0xff785f,transparent:true,opacity:0.92,
            side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
        targetRing.rotation.x=-Math.PI/2;
        targetRing.position.y=0.095;
        targetRing.renderOrder=6;
        group.add(targetRing);
        const veteranRing=this._veterancyRing(radius);
        group.add(veteranRing);
        this.entityGroup.add(group);
        state={group,ring,targetRing,veteranRing,building,defId:o.defId,version:assetVersion,baseScale:group.scale.clone(),
          unitVisual,unitVisualBaseScale:unitVisual?.scale.clone(),
          damageReaction:{lastHp:clamp(o.hp/(o.maxHp||1),0,1),hitAt:-Infinity,applied:0,
            radius:building?Math.max(o.w,o.h)*0.62:game.unitDefs?.[o.defId]?.flying?0.70:game.unitDefs?.[o.defId]?.armor==='infantry'?0.34:0.56,
            materials:damageMaterials,wearColor:new THREE.Color(0x765449),
            flashColor:new THREE.Color(0xffc08b)},
          animation:this._prepareAnimation(group,o)};
        this.entities.set(o.id,state);
      }
      const flying=game.unitDefs?.[o.defId]?.flying;
      const infantry=game.unitDefs?.[o.defId]?.armor==='infantry';
      const prev=state.lastPosition;
      const dx=prev?o.x-prev.x:0,dz=prev?o.y-prev.z:0;
      const speed=Math.hypot(dx,dz);
      if(prev) {prev.x=o.x;prev.z=o.y;}
      else state.lastPosition={x:o.x,z:o.y};
      if(!building&&!flying&&!infantry&&speed>0.002) {
        state.trackDistance=(state.trackDistance||0)+speed;
        if(state.trackDistance>=0.42) {
          state.trackDistance%=0.42;
          this._stampVehicleTracks(o.x,o.y,dx/speed,dz/speed,time,game);
        }
      }
      if(!building&&!flying&&speed>0.002) {
        if(!state.dust) {
          state.dust=new THREE.Mesh(this.dustGeometry,this.dustMaterial.clone());
          state.dust.renderOrder=2;
          this.effectGroup.add(state.dust);
        }
        state.dust.material.color.setHex(o.owner==='player'&&game.mode==='campaign'&&game.campaignDoctrineId==='rapid'
          ?0x78cdd1:o.faction==='aegis'?0x9caaa6:0xb99c83);
        const fade=clamp(speed*24,0,1);
        state.dust.position.set(o.x-dx*3,0.055,o.y-dz*3);
        state.dust.scale.set(1+fade*0.6,0.28+fade*0.13,1+fade*0.6);
        state.dust.material.opacity=Math.max(state.dust.material.opacity,fade*0.20);
      }
      if(state.dust) {
        state.dust.material.opacity=Math.max(0,state.dust.material.opacity-0.012);
        state.dust.rotation.y=time*0.7+(Number.parseInt(String(o.id).replace(/\D/g,''),10)||0);
        state.dust.visible=state.dust.material.opacity>0.005;
      }
      state.group.position.set(building?o.x+o.w/2:o.x, flying?0.85+Math.sin(time*3+Number(o.id.slice(1)))*0.06:0.02, building?o.y+o.h/2:o.y);
      const hp=clamp(o.hp/(o.maxHp||1),0,1);
      this._syncDamageAppearance(state,o,hp,time);
      if(!building) state.group.rotation.y=-(o.facing || 0)-Math.PI/2;
      state.ring.visible=selected.has(o.id) || o.selected;
      if(!building&&state.ring.visible&&selected.size===1) {
        if(!state.selectionBeacon) {
          state.selectionBeacon=this._selectionBeacon(o.faction);
          state.group.add(state.selectionBeacon);
        }
        state.selectionBeacon.visible=true;
        state.selectionBeacon.position.set(0,infantry?1.35:flying?1.75:1.55,0);
        state.selectionBeacon.quaternion.copy(state.group.quaternion).invert().multiply(this.camera.quaternion);
      } else if(state.selectionBeacon) state.selectionBeacon.visible=false;
      state.targetRing.visible=o.owner==='enemy'&&acquiredTargets.has(o.id);
      if(state.targetRing.visible) {
        const targetPulse=0.5+0.5*Math.sin(time*7.5);
        state.targetRing.material.opacity=0.72+targetPulse*0.24;
        state.targetRing.scale.setScalar(0.96+targetPulse*0.08);
      } else state.targetRing.scale.setScalar(1);
      if(state.ring.visible) {
        // A small radial pulse makes selection readable over busy terrain
        // without adding another mesh or obscuring the veterancy marker.
        const selectionPulse=0.5+0.5*Math.sin(time*4.2);
        state.ring.scale.setScalar(0.985+selectionPulse*0.035);
        const doctrineColor=o.owner==='player'&&game.mode==='campaign'
          ?DOCTRINE_RING_COLORS[game.campaignDoctrineId]
          :null;
        state.ring.userData.colorMaterial.color.setHex(doctrineColor|| (o.faction==='aegis'?0x70f0f4:0xff9c74));
        state.ring.userData.colorMaterial.opacity=0.78+0.2*selectionPulse;
      } else state.ring.scale.setScalar(1);
      const veterancy=Number.isFinite(o.veterancy)?o.veterancy:0;
      state.veteranRing.visible=!building&&veterancy>0;
      if(state.veteranRing.visible) {
        const promotionVisible=game.replayVersion==null||game.replayVersion>=UNIT_PROMOTION_RULES_VERSION;
        state.veteranRing.material.color.setHex(o.promotion==='rangefinder'&&promotionVisible?0x84e9ff:
          o.promotion==='bulwark'&&promotionVisible?0xffb879:0xffd878);
        state.veteranRing.material.opacity=0.62+0.25*Math.sin(time*3.2+veterancy);
        state.veteranRing.scale.setScalar(1+Math.min(veterancy,3)*0.035);
      }
      this._animateDamageSmoke(state,o,hp,time);
      const progress=building?clamp(o.progress??1,0,1):1;
      const unitScale=building?1:o.defId==='guardian'?1.48:o.defId==='mcv'?1.16:game.unitDefs?.[o.defId]?.armor==='infantry'?1.45:game.unitDefs?.[o.defId]?.flying?1.24:1.31;
      // Keep ground silhouettes legible at the broad strategic view, then
      // return to their authored size as the player zooms into the fight.
      const strategicScale=!building&&!flying&&o.defId!=='mcv'
        ?1+0.12*clamp((1.25-this.zoom)/0.25,0,1):1;
      let nearbyVehicles=0;
      if(!building&&!flying&&!infantry) {
        const bx=Math.floor(o.x/2),by=Math.floor(o.y/2),reach=1.55*1.55;
        for(let yy=Math.max(0,by-1);yy<=Math.min(vehicleBucketHeight-1,by+1);yy++)
          for(let xx=Math.max(0,bx-1);xx<=Math.min(vehicleBucketWidth-1,bx+1);xx++) {
            const bucket=vehicleBuckets.get(yy*vehicleBucketWidth+xx);
            if(!bucket) continue;
            for(const other of bucket) {
              if(other.id===o.id) continue;
              const dx=o.x-other.x,dy=o.y-other.y;
              if(dx*dx+dy*dy<=reach) nearbyVehicles++;
            }
          }
      }
      const crowdScale=nearbyVehicles?1-Math.min(0.22,0.10+Math.max(0,nearbyVehicles-1)*0.06):1;
      // The local density pass above computes a renderer-only hull reduction
      // for overlapping vehicles. Apply it to the model at strategic zoom
      // while leaving tactical rings, collision footprints, and close-up size intact.
      const strategicView=clamp((1.25-this.zoom)/0.25,0,1);
      const crowdViewScale=1-(1-crowdScale)*strategicView;
      const displayScale=unitScale*strategicScale;
      state.group.scale.set(state.baseScale.x*displayScale,
        state.baseScale.y*displayScale*(0.16+progress*0.84),state.baseScale.z*displayScale);
      const showHealthBar=!building&&selected.has(o.id)&&selectedHealthBars<selectedHealthBarLimit;
      if(showHealthBar) {
        selectedHealthBars++;
        if(!state.healthBar) {
          const bar=new THREE.Group();
          const plate=new THREE.Mesh(new THREE.PlaneGeometry(0.78,0.105),new THREE.MeshBasicMaterial({
            color:0x172421,transparent:true,opacity:0.92,depthWrite:false,toneMapped:false,
            side:THREE.DoubleSide,
          }));
          const fillMaterial=new THREE.MeshBasicMaterial({
            color:0x90e6a2,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,
          });
          const fill=new THREE.Mesh(new THREE.PlaneGeometry(0.68,0.045),fillMaterial);
          fill.position.set(-0.015,0,0.003);
          bar.add(plate,fill);
          bar.position.set(0,1.48,0);
          bar.renderOrder=8;
          state.group.add(bar);
          state.healthBar={group:bar,fill,fillMaterial};
        }
        const {group:bar,fill,fillMaterial}=state.healthBar;
        bar.visible=true;
        bar.position.y=game.unitDefs?.[o.defId]?.armor==='infantry'?0.92:flying?0.56:0.86;
        // Counter the model's heading so the small plate stays legible from
        // the camera, while still depth-testing against nearby world geometry.
        bar.quaternion.copy(state.group.quaternion).invert().multiply(this.camera.quaternion);
        fill.scale.x=Math.max(0.025,hp);
        fill.position.x=-0.34+(0.68*hp)*0.5;
        fillMaterial.color.setHex(hp<0.30?0xff796b:hp<0.62?0xffcf70:0x90e6a2);
      } else if(state.healthBar) state.healthBar.group.visible=false;
      // Keep the tactical footprint fixed while giving infantry bodies a
      // little more height and width at the strategic camera scale.
      if(state.unitVisual&&state.unitVisualBaseScale)
        state.unitVisual.scale.copy(state.unitVisualBaseScale).multiplyScalar(crowdViewScale*(infantry?1.16:1));
      if(!building) this._animateMotion(state,speed);
      this._animateEntity(state,o,game,time);
      if(!building) this._syncUnitAbilityVisuals(state,o,game,time);
      if(building) this._syncRefineryTransfer(state,o,game,time);
      if(building) this._setCampaignShield(state,o,time);
      // Damage tint is expressed with a subtle red emergency light.
      if(o.hp/o.maxHp < 0.35) state.group.position.y+=Math.sin(time*6+o.x)*0.012;
    }
    for(const [id,state] of this.entities) if(!live.has(id)) this._removeEntity(id,state);
  }

  _syncRangeIndicator(game,time) {
    const selected=[...(game.selection||[])];
    if(selected.length!==1) {this.rangeIndicator.visible=false;this.armorFacingIndicator.visible=false;return;}
    const id=selected[0];
    const object=(game.units||[]).find(u=>u.id===id)||(game.buildings||[]).find(b=>b.id===id);
    const building=object&&'w' in object;
    const definition=building?game.buildingDefs?.[object.defId]:game.unitDefs?.[object?.defId];
    const range=building?definition?.weapon?.range:unitWeaponRange(object,definition?.weapon,game.replayVersion);
    if(!object||object.owner!=='player'||!Number.isFinite(range)||range<=0||
      object.hp<=0||object.embarkedIn||(building&&(object.progress<1||!object.powered))) {
      this.rangeIndicator.visible=false;
      this.armorFacingIndicator.visible=false;
      return;
    }
    this.rangeIndicator.visible=true;
    this.rangeIndicator.position.x=building?object.x+object.w/2:object.x;
    this.rangeIndicator.position.z=building?object.y+object.h/2:object.y;
    this.rangeIndicator.scale.set(range,1,range);
    this.rangeIndicator.material.opacity=0.56+0.08*(0.5+0.5*Math.sin(time*3.2));
    const directionalArmor=!building&&!definition.flying&&
      ['light','heavy'].includes(definition.armor)&&(game.replayVersion??12)>=12;
    this.armorFacingIndicator.visible=directionalArmor;
    if(directionalArmor) {
      this.armorFacingIndicator.position.x=object.x;
      this.armorFacingIndicator.position.z=object.y;
      this.armorFacingIndicator.rotation.y=-(Number.isFinite(object.facing)?object.facing:0);
      const scale=Math.max(1,(definition.radius||0.38)/0.38);
      this.armorFacingIndicator.scale.set(scale,1,scale);
    }
  }

  _makeEffect(fx) {
    const g=new THREE.Group();
    const ion=/^(ion|nuke)$/.test(fx.type);
    const explosive=/^(explosion|impact|ion|nuke|muzzle)$/.test(fx.type);
    if(fx.type==='breach') {
      // A Breach Window marks a persistent assault zone. A restrained filled
      // disk keeps the whole target area readable; segmented range rings make
      // its five-tile radius distinct from weapon explosions.
      const color=fx.owner==='enemy'?0xff9274:0x83edc1;
      const makeMark=(geometry,opacity,y,kind)=>{
        const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,
          depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
        mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.renderOrder=4;
        mesh.userData.breachPart=kind;mesh.userData.breachBaseOpacity=opacity;g.add(mesh);return mesh;
      };
      makeMark(new THREE.CircleGeometry(4.8,48),0.10,0.20,'field');
      makeMark(new THREE.RingGeometry(4.88,5.0,64),0.92,0.23,'outer');
      makeMark(new THREE.RingGeometry(3.94,4.02,48),0.48,0.235,'inner');
      const ticks=[];
      for(let i=0;i<16;i++) {
        const angle=i*Math.PI/8,r0=i%2===0?4.50:4.65,r1=4.82;
        ticks.push(Math.cos(angle)*r0,0.245,Math.sin(angle)*r0,
          Math.cos(angle)*r1,0.245,Math.sin(angle)*r1);
      }
      const marker=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({
        color:0xe5ffdc,transparent:true,opacity:0.78,depthWrite:false,toneMapped:false
      }));
      marker.geometry.setAttribute('position',new THREE.Float32BufferAttribute(ticks,3));
      marker.userData.breachPart='ticks';marker.userData.breachBaseOpacity=0.78;marker.renderOrder=5;g.add(marker);
      const beacon=new THREE.Mesh(new THREE.OctahedronGeometry(0.26,0),new THREE.MeshBasicMaterial({
        color:0xf6ffdc,transparent:true,opacity:0.9,depthWrite:false,toneMapped:false
      }));
      beacon.position.y=0.48;beacon.userData.breachPart='beacon';beacon.userData.breachBaseOpacity=0.9;g.add(beacon);
    } else if(fx.type==='interdict') {
      // One expanding ground pulse and a sparse spoke ring communicate the
      // short-lived 3.5-tile suppression footprint with four bounded draws.
      const color=fx.owner==='enemy'?0xffa071:0x70e8ef;
      const makePulse=(geometry,opacity,y,kind)=>{
        const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,
          depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
        mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.userData.interdictPart=kind;
        mesh.userData.interdictBaseOpacity=opacity;g.add(mesh);return mesh;
      };
      makePulse(new THREE.CircleGeometry(1,48),0.20,0.19,'field');
      makePulse(new THREE.RingGeometry(0.91,1.0,48),0.95,0.22,'wave');
      makePulse(new THREE.RingGeometry(0.62,0.68,48),0.72,0.225,'echo');
      const spokes=[];
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4;
        spokes.push(Math.cos(angle)*0.72,0.23,Math.sin(angle)*0.72,
          Math.cos(angle),0.23,Math.sin(angle));
      }
      const rays=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({
        color:0xdffeff,transparent:true,opacity:0.9,depthWrite:false,toneMapped:false
      }));
      rays.geometry.setAttribute('position',new THREE.Float32BufferAttribute(spokes,3));
      rays.userData.interdictPart='spokes';rays.userData.interdictBaseOpacity=0.9;g.add(rays);
    } else if(fx.type==='salvage') {
      // A compact burst of recovered metal, kept low over the wreck so it
      // reads at the usual RTS camera distance without obscuring the unit.
      const ring=addMesh(g,new THREE.RingGeometry(0.34,0.41,24),
        new THREE.MeshBasicMaterial({color:0xffb84d,transparent:true,opacity:0.9,depthWrite:false,toneMapped:false}),
        0,0.06,0,false);
      ring.rotation.x=-Math.PI/2; ring.userData.salvageRing=true;
      for(let i=0;i<5;i++) {
        const angle=i*Math.PI*2/5;
        const shard=addMesh(g,new THREE.OctahedronGeometry(i%2?0.105:0.13,0),
          new THREE.MeshBasicMaterial({color:i%2?0xffe5a0:0xffb84d,transparent:true,opacity:0.95,depthWrite:false,toneMapped:false}),
          Math.cos(angle)*0.32,0.22,Math.sin(angle)*0.32,false);
        shard.userData.salvageShard=true;
        shard.userData.angle=angle;
        shard.userData.phase=i*0.73;
      }
      const flash=new THREE.PointLight(0xffa63d,1.25,2.3);
      flash.position.y=0.38; flash.userData.salvageFlash=true; g.add(flash);
    } else if(fx.type==='wallCover') {
      // A compact ricochet mark stays on the wall face: one contact ring, a
      // bundled set of deflection streaks, and a small hot core. The short
      // effect has no scorch or light, so it stays readable without obscuring
      // nearby units or adding unbounded fragments during volleys.
      const color=fx.owner==='player'?0x71e8f0:0xffa47d;
      const ring=new THREE.Mesh(new THREE.RingGeometry(0.30,0.42,24),
        new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.84,depthWrite:false,
          side:THREE.DoubleSide,toneMapped:false}));
      ring.rotation.x=-Math.PI/2;ring.position.y=0.075;ring.userData.wallCoverRing=true;g.add(ring);
      const streaks=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({
        color:0xffedbd,transparent:true,opacity:0.96,depthWrite:false,toneMapped:false
      }));
      streaks.geometry.setAttribute('position',new THREE.Float32BufferAttribute([
        -0.12,0.23,0.02, -0.76,0.37,0.14,
         0.10,0.20,0.00,  0.72,0.42,-0.12,
        -0.04,0.25,-0.08,  0.20,0.58,-0.66,
         0.00,0.19,0.06, -0.18,0.48,0.68,
      ],3));
      streaks.userData.wallCoverStreaks=true;g.add(streaks);
      const core=new THREE.Mesh(new THREE.IcosahedronGeometry(0.19,0),
        new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.94,
          depthWrite:false,toneMapped:false}));
      core.position.y=0.31;core.userData.wallCoverCore=true;g.add(core);
      g.rotation.y=(hash(Math.floor(fx.x||0),Math.floor(fx.y||0),71)-0.5)*Math.PI;
    } else if(fx.type==='projectile') {
      // Give each weapon family a distinct silhouette so a mixed volley stays
      // legible at the normal command camera distance. Reuse the same three
      // meshes and one light per shot; only their proportions and tint change.
      const ion=fx.damageType==='ion';
      const explosive=fx.damageType==='explosive';
      const siegeShell=fx.sourceDefId==='artillery'||(fx.splash||0)>=1.2;
      const cannon=fx.damageType==='cannon';
      const flame=fx.damageType==='flame';
      const tint=ion?0xa9fff8:flame?0xffedaa:explosive?0xffb06e:cannon?0xffe0a0:0xf4fbff;
      const beam=siegeShell
        ?addMesh(g,new THREE.CylinderGeometry(0.075,0.16,0.48,8),new THREE.MeshBasicMaterial({color:0xffd18a,toneMapped:false}),0,0.3,0,false)
        :addMesh(g,new THREE.SphereGeometry(0.11,8,6),new THREE.MeshBasicMaterial({color:tint,toneMapped:false}),0,0.3,0,false);
      if(siegeShell) beam.rotation.x=Math.PI/2;
      beam.scale.set(flame?0.8:siegeShell?1.18:explosive?1.15:1,flame?0.72:explosive?0.9:1,ion?1.3:siegeShell?1.2:explosive?1.7:cannon?1.35:0.9);
      beam.material.depthWrite=false;
      const trail=addMesh(g,new THREE.CylinderGeometry(0.012,explosive?(siegeShell?0.14:0.09):flame?0.11:0.065,explosive?(siegeShell?1.05:0.78):flame?0.42:ion?0.62:0.48,7),new THREE.MeshBasicMaterial({color:ion?0x6bf5ed:flame?0xff723f:explosive?0xff7a45:cannon?0xffa64e:0xffd98c,transparent:true,opacity:0.76,depthWrite:false,toneMapped:false}),0,0.3,0.34,false);
      trail.rotation.x=Math.PI/2;
      trail.userData.projectileTrail=true;
      trail.scale.set(ion?0.9:flame?0.72:explosive?(siegeShell?1.38:1.16):cannon?0.94:0.62,1,1);
      const coreTrail=addMesh(g,new THREE.CylinderGeometry(0.008,flame?0.035:0.027,explosive?0.56:flame?0.32:0.45,6),new THREE.MeshBasicMaterial({color:ion?0xd8fffa:flame?0xffd26e:explosive?0xffd09a:cannon?0xfff0c8:0xffffff,transparent:true,opacity:0.9,depthWrite:false,toneMapped:false}),0,0.3,0.29,false);
      coreTrail.rotation.x=Math.PI/2;
      coreTrail.userData.projectileTrail=true;
      // A fine, growing wake connects the shot to its source while it is in
      // flight. The existing hot plume stays close to the projectile; this
      // longer cue makes crossing volleys and artillery arcs easier to follow
      // at command zoom. One fixed nine-point draw per shot keeps cost bounded.
      if(this.quality!=='eco') {
        const wakeGeometry=new THREE.BufferGeometry();
        wakeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(27),3));
        const wake=new THREE.Line(wakeGeometry,new THREE.LineBasicMaterial({
          color:tint,transparent:true,opacity:0.38,depthWrite:false,toneMapped:false
        }));
        wake.userData.projectileWake=true;
        wake.frustumCulled=false;
        g.userData.projectileWake=wake;
        g.add(wake);
      }
      const light=new THREE.PointLight(ion?0x6bf5ed:flame?0xff7445:explosive?0xff8245:cannon?0xffbd62:0xffd895,ion?1.8:explosive?2.1:flame?1.4:0.85,ion?2.7:explosive?3:1.9);
      light.position.y=0.3; g.add(light);
      g.userData.projectileArc=ion?0.3:flame?0.12:explosive?(siegeShell?1.65:0.82):cannon?0.48:0.2;
      g.userData.projectileStart={x:Number.isFinite(fx.launchX)?fx.launchX:(fx.x||0),z:Number.isFinite(fx.launchY)?fx.launchY:(fx.y||0)};
    } else if(fx.type==='ion'&&fx.source==='stormcall') {
      // Stormcall is a relay-discharge wave, not a conventional lightning
      // strike. Keep its corona low and let the rings travel outward.
      const color=fx.owner==='enemy'?0xff91c6:0x83fff0;
      const glow=new THREE.Mesh(new THREE.CircleGeometry(1,48),new THREE.MeshBasicMaterial({
        color,transparent:true,opacity:0.17,depthWrite:false,side:THREE.DoubleSide,
        blending:THREE.AdditiveBlending,toneMapped:false
      }));
      glow.rotation.x=-Math.PI/2;glow.position.y=0.055;glow.userData.stormcallGlow=true;g.add(glow);
      for(let i=0;i<3;i++) {
        const ring=new THREE.Mesh(new THREE.RingGeometry(0.90,1,48),new THREE.MeshBasicMaterial({
          color:i===0?0xd6fff9:color,transparent:true,opacity:0.9,depthWrite:false,
          side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false
        }));
        ring.rotation.x=-Math.PI/2;ring.position.y=0.075+i*0.004;
        ring.userData.stormcallRing=i;g.add(ring);
      }
      const corona=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({
        color,transparent:true,opacity:0.9,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false
      }));
      const bolts=[];
      for(let i=0;i<12;i++) {
        const angle=i*Math.PI/6,r0=0.30+(i%3)*0.07,r1=0.7+(i%4)*0.11;
        const x0=Math.cos(angle)*r0,z0=Math.sin(angle)*r0;
        const x1=Math.cos(angle+0.09)*((r0+r1)*0.55),z1=Math.sin(angle+0.09)*((r0+r1)*0.55);
        const x2=Math.cos(angle)*r1,z2=Math.sin(angle)*r1;
        bolts.push(x0,0.09,z0,x1,0.10,z1,x1,0.10,z1,x2,0.09,z2);
      }
      corona.geometry.setAttribute('position',new THREE.Float32BufferAttribute(bolts,3));
      corona.position.y=0.015;corona.userData.stormcallCorona=true;g.add(corona);
      const core=addMesh(g,new THREE.IcosahedronGeometry(0.33,1),new THREE.MeshBasicMaterial({
        color:0xeaffff,transparent:true,opacity:0.96,depthWrite:false,
        blending:THREE.AdditiveBlending,toneMapped:false
      }),0,0.31,0,false);
      core.userData.stormcallCore=true;
      const light=new THREE.PointLight(color,4.2,8);light.position.y=0.75;g.add(light);
      g.userData.stormcallVisual=true;
    } else if(explosive) {
      const color=ion?0x85ffed:fx.type==='muzzle'?0xffdd94:0xffa260;
      const core=addMesh(g,new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.85,depthWrite:false}),0,0.3,0,false);
      core.userData.core=true;
      const ring=addMesh(g,new THREE.RingGeometry(0.65,0.82,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.65,side:THREE.DoubleSide,depthWrite:false}),0,0.08,0,false);
      ring.rotation.x=-Math.PI/2; ring.userData.ring=true;
      // The broad colored ring carries the blast radius; higher tiers add a
      // thin, hot edge that makes the impact read cleanly against pale sand.
      // One mesh per burst (never per fragment), with lower intensity and no
      // extra edge on Eco to limit cost in crowded fights.
      if(this.quality!=='eco'&&fx.type!=='muzzle') {
        const shockStrength=this.quality==='ultra'?0.94:0.56;
        const shock=addMesh(g,new THREE.RingGeometry(0.91,0.98,32),new THREE.MeshBasicMaterial({
          color:ion?0xc7fff5:0xffd49b,transparent:true,opacity:shockStrength,side:THREE.DoubleSide,
          depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false
        }),0,0.09,0,false);
        shock.rotation.x=-Math.PI/2; shock.userData.shockRing=true; shock.userData.shockStrength=shockStrength;
        // A dark outer keyline separates the bright shock ring from both pale
        // sand and cyan crystal beds. Keep it narrow so the existing bright
        // inner edge remains the focal cue; this reuses the same single mesh.
        const dustWave=addMesh(g,new THREE.RingGeometry(0.85,1,32),new THREE.MeshBasicMaterial({
          color:0x263638,transparent:true,opacity:0.58,side:THREE.DoubleSide,
          depthWrite:false,toneMapped:false
        }),0,0.062,0,false);
        dustWave.rotation.x=-Math.PI/2; dustWave.userData.impactDustWave=true;
      }
      const haze=addMesh(g,new THREE.SphereGeometry(0.52,10,6),new THREE.MeshBasicMaterial({color:ion?0x466776:0x494139,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}),0,0.42,0,false);
      haze.userData.haze=true;
      const flashCore=addMesh(g,new THREE.SphereGeometry(0.36,10,7),
        new THREE.MeshBasicMaterial({color:ion?0xc8fff4:0xffe7ae,transparent:true,opacity:0.9,depthWrite:false,toneMapped:false}),
        0,0.36,0,false);
      flashCore.userData.flashCore=true;
      if(fx.type==='muzzle') {
        // A narrow, forward-facing plume makes the firing direction readable
        // when the projectile is too small to resolve at the command zoom.
        const plume=addMesh(g,new THREE.ConeGeometry(0.23,0.92,8,1,true),
          new THREE.MeshBasicMaterial({color:0xffc76b,transparent:true,opacity:0.88,depthWrite:false,
            blending:THREE.AdditiveBlending,toneMapped:false,side:THREE.DoubleSide}),
          0,0.28,-0.48,false);
        plume.rotation.x=-Math.PI/2;
        plume.userData.muzzlePlume=true;
      }
      if(fx.type!=='muzzle') for(let i=0;i<4;i++) {
        const puff=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({
          color:ion?0x426c70:0x36332f,map:this._effectSmokeMap(),transparent:true,opacity:0,
          depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
        puff.userData={burstSmoke:true,index:i}; puff.renderOrder=3; g.add(puff);
      }
      if(fx.type!=='muzzle') for(let i=0;i<6;i++) {
        const a=i*Math.PI/3;
        // Longer shards and a rising path keep the impact readable at tactical
        // zoom while reusing the same six meshes and existing effect lifetime.
        const spark=box(g,new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.78,depthWrite:false}),0.035,0.04,0.42,Math.cos(a)*0.62,0.27,Math.sin(a)*0.62);
        spark.rotation.y=a+Math.PI/2;spark.castShadow=false;spark.userData.spark=true;spark.userData.angle=a;
      }
      if(ion) {
        const shaft=addMesh(g,new THREE.CylinderGeometry(0.11,0.34,5.5,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.47,depthWrite:false}),0,2.8,0,false);
        shaft.userData.shaft=true;
      }
      const flash=new THREE.PointLight(color,ion?6:fx.type==='muzzle'?2.4:4.2,ion?9:4.5);
      flash.position.y=0.65;flash.userData.flash=true;g.add(flash);
    } else if(fx.type==='heal') {
      // A medic pulse needs a vertical read at command zoom: the ground ring
      // alone disappears beneath clustered infantry and crystal.
      const ring=addMesh(g,new THREE.RingGeometry(0.43,0.53,32),new THREE.MeshBasicMaterial({
        color:0x9af69e,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false,
        blending:THREE.AdditiveBlending,toneMapped:false
      }),0,0.095,0,false);
      ring.rotation.x=-Math.PI/2;ring.userData.healRing=true;
      const glyph=new THREE.Group();glyph.userData.healGlyph=true;g.add(glyph);
      const halo=addMesh(glyph,new THREE.RingGeometry(0.37,0.41,24),new THREE.MeshBasicMaterial({
        color:0x83eeb8,transparent:true,opacity:0.58,side:THREE.DoubleSide,depthWrite:false,
        depthTest:false,blending:THREE.AdditiveBlending,toneMapped:false
      }),0,0,0,false);
      halo.renderOrder=10;halo.userData.healPart=true;halo.userData.healBaseOpacity=0.58;
      for(const [width,height] of [[0.18,0.62],[0.62,0.18]]) {
        const backing=addMesh(glyph,new THREE.PlaneGeometry(width+0.09,height+0.09),new THREE.MeshBasicMaterial({
          color:0x173b2c,transparent:true,opacity:0.88,side:THREE.DoubleSide,depthWrite:false,
          depthTest:false,toneMapped:false
        }),0,0,0.006,false);
        backing.renderOrder=11;backing.userData.healPart=true;backing.userData.healBaseOpacity=0.88;
        const bar=addMesh(glyph,new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({
          color:0xaaffb3,transparent:true,opacity:0.96,side:THREE.DoubleSide,depthWrite:false,
          depthTest:false,toneMapped:false
        }),0,0,0.012,false);
        bar.renderOrder=12;bar.userData.healPart=true;bar.userData.healBaseOpacity=0.96;
      }
    } else {
      const color=0x66ffde;
      const ring=addMesh(g,new THREE.RingGeometry(0.45,0.52,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthWrite:false}),0,0.11,0,false);
      ring.rotation.x=-Math.PI/2; ring.userData.ring=true;
    }
    this.effectGroup.add(g);
    return g;
  }

  _syncEffects(game,time) {
    // Replay seeks and new matches can replace the simulation time while the
    // display clock is paused. Do not leave a lingering discharge in a frame
    // before its cast (or long after it) when that happens.
    if(Number.isFinite(game.time) && Number.isFinite(this.lastEffectGameTime) &&
      Math.abs(game.time-this.lastEffectGameTime)>0.8) {
      for(const [id,g] of this.effects) {
        // Replay seeks can revisit an existing effect ID at a different source
        // pose. Recompute its visual launch data from the sought frame.
        delete g.userData.visualProjectileOrigin;
        delete g.userData.visualMuzzleOrigin;
        if(g.userData.stormcallVisual) {
          this.effectGroup.remove(g);
          g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
          this.effects.delete(id);
        }
      }
    }
    if(Number.isFinite(game.time)) this.lastEffectGameTime=game.time;
    const live=new Set();
    const effectById=new Map((game.effects||[]).map(effect=>[effect.id,effect]));
    for(const fx of game.effects||[]) {
      live.add(fx.id);
      let g=this.effects.get(fx.id);
      if(!g) {
        g=this._makeEffect(fx); this.effects.set(fx.id,g);
        if(g.userData.stormcallVisual) {
          g.userData.stormcallStart=time;
          g.userData.stormcallUntil=time+1.05;
        }
      }
      if(Number.isFinite(fx.ttl)) {
        // Effect IDs can be reused by a restarted match or a short replay seek.
        // TTL only moves upward when the visual effect has effectively been
        // rewound or replaced, so refresh its cached launch origin then too.
        if(Number.isFinite(g.userData.lastObservedTtl)&&fx.ttl>g.userData.lastObservedTtl+1e-4) {
          delete g.userData.visualProjectileOrigin;
          delete g.userData.visualMuzzleOrigin;
        }
        g.userData.lastObservedTtl=fx.ttl;
      }
      let sourceId=fx.sourceId;
      let muzzleTarget={x:fx.x||0,y:fx.y||0};
      if(fx.type==='muzzle'&&!sourceId) {
        // _fireAt emits the projectile immediately before its muzzle effect.
        // Pair those adjacent visual events without changing simulation state.
        const numericId=Number(String(fx.id).replace(/^fx/,''));
        const projectile=Number.isFinite(numericId)?effectById.get(`fx${numericId-1}`):null;
        if(projectile?.type==='projectile'&&projectile.owner===fx.owner) {
          sourceId=projectile.sourceId;
          muzzleTarget={x:projectile.tx,y:projectile.ty};
        }
      }
      g.userData.weaponSourceId=sourceId||null;
      g.position.set(fx.x||0,0,fx.y||0);
      const inSight=typeof game.isVisible==='function'?game.isVisible(fx):true;
      g.visible=fx.owner==='player'||inSight;
      if(fx.type==='salvage') {
        const x=Math.floor(fx.x||0), y=Math.floor(fx.y||0);
        const visible=typeof game.isVisible==='function'
          ? game.isVisible(fx)
          : (game.fog?.[y]?.[x]??0)>0;
        g.visible=fx.owner==='player'||visible;
      }
      if(fx.type==='projectile'&&Number.isFinite(fx.tx)&&Number.isFinite(fx.ty)) {
        // Match the unit forward convention (local -Z aims at the target);
        // the trail meshes extend along local +Z behind the moving projectile.
        const start=g.userData.projectileStart;
        const flightLength=Math.hypot(fx.tx-start.x,fx.ty-start.z);
        const travelled=Math.hypot(fx.x-start.x,fx.y-start.z);
        const progress=clamp(travelled/Math.max(0.001,flightLength),0,1);
        g.userData.projectileProgress=progress;
        if(!g.userData.visualProjectileOrigin) {
          const muzzle=this._weaponMuzzlePosition(sourceId,game,fx.tx,fx.ty);
          const source=this.entities.get(fx.sourceId);
          g.userData.visualProjectileOrigin={
            offsetX:muzzle?muzzle.x-start.x:0,
            offsetZ:muzzle?muzzle.z-start.z:0,
            sourceHeight:muzzle?muzzle.y:(source?(source.building?0.5:source.group.position.y+0.12):0.42),
          };
        }
        const {offsetX,offsetZ,sourceHeight}=g.userData.visualProjectileOrigin;
        const visualX=(fx.x||0)+offsetX*(1-progress);
        const visualZ=(fx.y||0)+offsetZ*(1-progress);
        g.position.x=visualX;
        g.position.z=visualZ;
        g.rotation.y=projectileYaw(visualX,visualZ,fx.tx,fx.ty);
        const target=fx.targetId?this.entities.get(fx.targetId):null;
        const targetHeight=target?(target.building?0.32:target.group.position.y+0.08):0.12;
        const arc=Math.sin(progress*Math.PI)*g.userData.projectileArc;
        // Meshes sit 0.3 units above the effect origin, so offset the group to
        // place the projectile center on this shallow ballistic path.
        g.position.y=sourceHeight+(targetHeight-sourceHeight)*progress+arc-0.3;
        // Cancel the projectile's heading rotation for the world-space wake,
        // then update its source and tip in local coordinates. Its height
        // follows the same shallow ballistic arc as the visible projectile.
        const wake=g.userData.projectileWake;
        if(wake) {
          // A visible incoming projectile must not trace its line back to an
          // enemy firing from unrevealed ground.
          const sourceEntity=game.getEntity?.(fx.sourceId);
          wake.visible=fx.owner==='player'||!!(sourceEntity&&game.isVisible?.(sourceEntity));
          wake.rotation.y=-g.rotation.y;
          const positions=wake.geometry.attributes.position;
          const segments=8;
          for(let i=0;i<=segments;i++) {
            const t=progress*i/segments;
            const worldX=start.x+offsetX+(fx.tx-start.x-offsetX)*t;
            const worldZ=start.z+offsetZ+(fx.ty-start.z-offsetZ)*t;
            const worldY=sourceHeight+(targetHeight-sourceHeight)*t+
              Math.sin(t*Math.PI)*g.userData.projectileArc;
            positions.setXYZ(i,worldX-visualX,worldY-g.position.y,worldZ-visualZ);
          }
          positions.needsUpdate=true;
        }
      } else if(fx.type==='muzzle') {
        if(g.userData.visualMuzzleOrigin===undefined) {
          const muzzle=this._weaponMuzzlePosition(sourceId,game,muzzleTarget.x,muzzleTarget.y);
          g.userData.visualMuzzleOrigin=muzzle?{x:muzzle.x,y:muzzle.y-0.3,z:muzzle.z}:false;
        }
        const muzzle=g.userData.visualMuzzleOrigin;
        if(muzzle) g.position.set(muzzle.x,muzzle.y,muzzle.z);
        g.rotation.y=projectileYaw(g.position.x,g.position.z,muzzleTarget.x,muzzleTarget.y);
      }
      const life=g.userData.stormcallVisual
        ?clamp((g.userData.stormcallUntil-time)/(g.userData.stormcallUntil-g.userData.stormcallStart),0,1)
        :clamp((fx.ttl??0.5)/(fx.maxTtl||0.5),0,1);
      const r=fx.radius||0.4;
      g.scale.setScalar(g.userData.stormcallVisual||fx.type==='breach'||fx.type==='interdict'?1:fx.type==='projectile'?1:
        fx.type==='wallCover'?0.82:Math.max(0.15,r*(1.65-life*0.65)));
      if(g.userData.stormcallVisual) this._animateStormcallEffect(g,life,time);
      if(fx.type==='breach') {
        const pulse=0.86+0.14*(0.5+0.5*Math.sin(time*2.6));
        const fade=clamp(life*5.0,0,1);
        for(const object of g.children) if(object.userData.breachPart) {
          if(object.userData.breachPart==='outer')object.scale.set(pulse,1,pulse);
          if(object.userData.breachPart==='beacon') {
            object.position.y=0.46+0.08*(0.5+0.5*Math.sin(time*4.0));
            object.rotation.y=time*0.65;
          }
          object.material.opacity=object.userData.breachBaseOpacity*fade*(object.userData.breachPart==='field'?0.78+0.22*pulse:pulse);
        }
      } else if(fx.type==='interdict') {
        const progress=1-life;
        const envelope=clamp(progress/0.1,0,1)*clamp((1-progress)/0.25,0,1);
        const expansion=clamp(progress/0.68,0,1);
        const radius=r*(0.18+0.82*expansion);
        for(const object of g.children) if(object.userData.interdictPart) {
          const kind=object.userData.interdictPart;
          if(kind==='field')object.scale.setScalar(radius);
          else if(kind==='wave')object.scale.set(radius,1,radius);
          else if(kind==='echo')object.scale.set(radius*(0.34+0.54*expansion),1,radius*(0.34+0.54*expansion));
          else if(kind==='spokes')object.scale.set(radius,1,radius);
          object.material.opacity=object.userData.interdictBaseOpacity*envelope*(kind==='field'?0.18:1);
        }
      }
      g.traverse(o=>{
        if(o.isLine&&o.userData.projectileWake) o.material.opacity=(0.18+0.24*(g.userData.projectileProgress||0))*life;
        if(o.userData.flashCore) {
          const age=1-life;
          o.scale.setScalar(0.35+age*2.2);
          o.material.opacity=0.86*Math.max(0,1-age*1.9);
        }
        if(o.userData.muzzlePlume) {
          const age=1-life;
          o.scale.set(0.72+age*0.62,0.52+age*0.72,0.72+age*0.62);
          o.material.opacity=0.82*Math.max(0,1-age*2.2);
        }
        if(o.userData.shockRing) {
          const age=1-life;
          o.scale.setScalar(0.62+age*1.8);
          o.material.opacity=o.userData.shockStrength*Math.max(0,1-age*1.35)*life;
        }
        if(o.userData.impactDustWave) {
          const age=1-life;
          // Keep the charcoal edge just outside the brighter shock front at
          // every age instead of letting the early flash cover it entirely.
          o.scale.setScalar(0.64+age*1.95);
          o.material.opacity=0.58*Math.sin(Math.PI*Math.min(0.99,age))*life;
        }
        if(o.userData.wallCoverRing) {
          const age=1-life;
          o.scale.setScalar(0.76+age*0.72);
          o.material.opacity=0.84*life;
        }
        if(o.userData.wallCoverStreaks) o.material.opacity=0.96*life;
        if(o.userData.wallCoverCore) {
          const age=1-life;
          o.scale.setScalar(0.72+age*0.3);
          o.material.opacity=0.94*life;
        }
        if(o.userData.burstSmoke) {
          const age=1-life, i=o.userData.index;
          o.quaternion.copy(this.camera.quaternion);
          o.position.set(Math.sin(i*5.1)*age*0.52,0.22+age*(0.42+i*0.08),Math.cos(i*5.1)*age*0.52);
          const size=(0.22+age*0.78)*(0.82+(i%2)*0.22);
          o.scale.set(size,size,1);
          o.material.opacity=0.32*Math.sin(Math.PI*Math.min(0.99,age))*life;
        }
        if(o.userData.projectileTrail) o.material.opacity=(0.62+0.15*Math.sin(time*28))*life;
        if(o.userData.salvageRing) {
          const pulse=0.88+0.16*Math.sin(time*13);
          o.scale.setScalar(pulse*(0.72+0.28*(1-life)));
          o.material.opacity=0.75*life;
        }
        if(o.userData.salvageShard) {
          const angle=o.userData.angle+time*1.4;
          const rise=0.12+0.42*(1-life);
          const radius=0.22+0.32*(1-life);
          o.position.set(Math.cos(angle)*radius,rise+0.08*Math.sin(time*9+o.userData.phase),Math.sin(angle)*radius);
          o.rotation.set(time*1.7+o.userData.phase,time*2.1+o.userData.phase,time*1.3);
          o.material.opacity=0.92*life;
        }
        if(o.userData.healRing) {
          o.scale.setScalar(0.72+(1-life)*0.62);
          o.material.opacity=0.7*life;
        }
        if(o.userData.healGlyph) {
          o.quaternion.copy(this.camera.quaternion);
          o.position.y=1.1+(1-life)*0.56;
          o.scale.setScalar(0.88+(1-life)*0.26);
        }
        if(o.userData.healPart) o.material.opacity=o.userData.healBaseOpacity*life;
        if(o.material?.opacity!==undefined && o.userData.stormcallRing===undefined && !o.userData.stormcallGlow &&
          !o.userData.stormcallCorona && !o.userData.stormcallCore && !o.userData.projectileTrail &&
          !o.userData.salvageRing && !o.userData.salvageShard && !o.userData.flashCore &&
          !o.userData.burstSmoke && !o.userData.shockRing && !o.userData.impactDustWave &&
          !o.userData.muzzlePlume && !o.userData.wallCoverRing && !o.userData.healRing &&
          !o.userData.healPart && !o.userData.wallCoverStreaks && !o.userData.wallCoverCore &&
          !o.userData.breachPart && !o.userData.interdictPart) o.material.opacity=o.userData.haze?(1-life)*life*0.65:
          (o.userData.shaft?0.42:o.userData.ring?0.62:0.85)*life;
        if(o.userData.spark) {
          const age=1-life;
          const distance=0.22+age*0.82;
          o.position.set(Math.cos(o.userData.angle)*distance,0.18+age*0.58+Math.sin(age*Math.PI)*0.16,
            Math.sin(o.userData.angle)*distance);
          o.rotation.x=age*1.4;
          o.rotation.z=age*2.2;
        }
        if(o.userData.flash) o.intensity=(fx.type==='muzzle'?2.4:/^(ion|nuke)$/.test(fx.type)?6:4.2)*life*life;
        if(o.userData.salvageFlash) o.intensity=(0.8+0.45*Math.sin(time*15))*life;
      });
      if(fx.type==='radiation') g.rotation.y=time*0.4;
      if(g.visible&&/^(explosion|impact|ion|nuke)$/.test(fx.type)&&fx.source!=='stormcall'&&!this.scorches.has(fx.id)) this._addScorch(fx,time);
    }
    for(const [id,g] of this.effects) if(!live.has(id)) {
      if(g.userData.stormcallVisual&&time<g.userData.stormcallUntil) {
        const life=clamp((g.userData.stormcallUntil-time)/(g.userData.stormcallUntil-g.userData.stormcallStart),0,1);
        this._animateStormcallEffect(g,life,time);
        continue;
      }
      this.effectGroup.remove(g);
      g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
      this.effects.delete(id);
    }
    // A crowded firefight can contain dozens of projectiles and impacts at
    // once. Their visible geometry remains intact, but only the brightest
    // nearby flashes contribute forward-rendered point lights. This keeps
    // the lighting cost bounded while preserving the focal blast in a volley.
    const lightBudget=this.quality==='ultra'?10:this.quality==='balanced'?5:0;
    const lightCandidates=[];
    const viewReach=Math.hypot(this.camera.right-this.camera.left,
      this.camera.top-this.camera.bottom)*0.72+4;
    for(const effect of this.effects.values()) {
      for(const light of effect.children) {
        if(!light.isPointLight) continue;
        light.visible=false;
        if(!effect.visible||lightBudget===0||light.intensity<=0) continue;
        const distance=Math.hypot(effect.position.x-this.centerX,effect.position.z-this.centerY);
        if(distance>viewReach) continue;
        const priority=(light.intensity+(effect.userData.stormcallVisual?3:0))/(1+distance*0.12);
        lightCandidates.push({light,priority});
      }
    }
    lightCandidates.sort((a,b)=>b.priority-a.priority);
    for(let i=0;i<Math.min(lightBudget,lightCandidates.length);i++) lightCandidates[i].light.visible=true;
    for(const [id,stamp] of this.scorches) {
      const age=time-stamp.born;
      stamp.mesh.material.opacity=stamp.opacity*clamp(1-age/24,0,1);
      if(age>=24) {this.effectGroup.remove(stamp.mesh);stamp.mesh.geometry.dispose();stamp.mesh.material.dispose();this.scorches.delete(id);}
    }
  }

  _animateStormcallEffect(group,life,time) {
    const age=1-life;
    group.rotation.y=time*0.22;
    const light=group.children.find(child=>child.isPointLight);
    if(light) light.intensity=4.2*life*life;
    group.traverse(o=>{
      const index=o.userData.stormcallRing;
      if(index!==undefined) {
        const delay=index*0.13;
        const progress=clamp((age-delay)/(1-delay),0,1);
        o.scale.setScalar(0.12+progress*3.35);
        o.material.opacity=0.94*(1-progress*0.82)*clamp((age-delay)/0.045,0,1);
      }
      if(o.userData.stormcallGlow) {
        o.scale.setScalar(0.24+age*2.35);
        o.material.opacity=0.20*(1-age)*clamp(age/0.06,0,1);
      }
      if(o.userData.stormcallCorona) {
        o.scale.setScalar(1+0.20*Math.sin(time*42));
        o.material.opacity=0.94*life*(0.70+0.30*Math.sin(time*52));
      }
      if(o.userData.stormcallCore) {
        o.scale.setScalar(0.42+age*2.4);
        o.material.opacity=0.96*Math.max(0,1-age*1.4);
      }
    });
  }

  _effectSmokeMap() {
    if(this.smokeTexture) return this.smokeTexture;
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=64;
    const context=canvas.getContext('2d');
    const gradient=context.createRadialGradient(32,32,2,32,32,31);
    gradient.addColorStop(0,'rgba(255,255,255,0.68)');
    gradient.addColorStop(0.45,'rgba(255,255,255,0.34)');
    gradient.addColorStop(1,'rgba(255,255,255,0)');
    context.fillStyle=gradient; context.fillRect(0,0,64,64);
    this.smokeTexture=new THREE.CanvasTexture(canvas);
    return this.smokeTexture;
  }

  _addScorch(fx,time) {
    const id=fx.id, radius=clamp((fx.radius||0.55)*0.38,0.2,0.78);
    const mesh=new THREE.Mesh(new THREE.CircleGeometry(radius,18),new THREE.MeshBasicMaterial({
      color:/^(ion|nuke)$/.test(fx.type)?0x25413e:0x211d1a,transparent:true,opacity:0.34,
      depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
    mesh.rotation.x=-Math.PI/2; mesh.position.set(fx.x||0,0.018,fx.y||0); mesh.renderOrder=1;
    this.effectGroup.add(mesh); this.scorches.set(id,{mesh,born:time,opacity:0.34});
    if(this.scorches.size>this.maxScorches) {
      const oldest=this.scorches.entries().next().value;
      if(oldest) {this.effectGroup.remove(oldest[1].mesh);oldest[1].mesh.geometry.dispose();oldest[1].mesh.material.dispose();this.scorches.delete(oldest[0]);}
    }
  }

  _orderEndpoint(game, unit) {
    const order=unit.order;
    if(!order || order.type==='idle' || order.type==='rearm' || order.type==='harvest') return null;
    if(order.type==='attack' || order.type==='engineer' || order.type==='follow' || order.type==='board') {
      const targetId=order.type==='board'?order.carrierId:order.targetId;
      const target=game.getEntity?.(targetId) || [...(game.units||[]),...(game.buildings||[])].find(e=>e.id===targetId);
      if(!target || target.hp<=0 || (target.owner==='enemy' && typeof game.isVisible==='function' && !game.isVisible(target))) return null;
      return {x:target.x+(target.w||0)/2,y:target.y+(target.h||0)/2,type:order.type};
    }
    if(order.type==='patrol') return {x:order.leg===0?order.ax:order.bx,y:order.leg===0?order.ay:order.by,type:order.type};
    if(Number.isFinite(order.x)&&Number.isFinite(order.y)) return {x:order.x,y:order.y,type:order.type==='move'&&order.attackMove?'attackMove':order.type};
    return null;
  }

  _makeOrderMarker(type) {
    const color=type==='forceFire'||type==='attack'||type==='attackMove'?0xff8a67:
      type==='forceMove'?0xffd28d:type==='guard'?0xa7e9a7:type==='patrol'?0x8be9ff:0x8df4df;
    const group=new THREE.Group();
    const lineGeometry=new THREE.BufferGeometry();
    lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0],3));
    const line=new THREE.Line(lineGeometry,new THREE.LineDashedMaterial({color,transparent:true,opacity:0.68,dashSize:0.18,gapSize:0.12,depthTest:false,depthWrite:false}));
    line.renderOrder=12;
    group.add(line);
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.31,0.355,32),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.8,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;
    ring.renderOrder=12;
    group.add(ring);
    const core=new THREE.Mesh(new THREE.CircleGeometry(0.047,12),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.9,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
    core.rotation.x=-Math.PI/2;
    core.renderOrder=12;
    group.add(core);
    this.orderGroup.add(group);
    return {group,line,ring,core,type};
  }

  _syncOrders(game,time) {
    const live=new Set();
    const selected=new Set(game.selection||[]);
    // Cap the number of paths so a large control group remains readable.
    let shown=0;
    for(const unit of game.units||[]) {
      if(shown>=18) break;
      if(unit.owner!=='player' || unit.embarkedIn || !(selected.has(unit.id)||unit.selected)) continue;
      const endpoint=this._orderEndpoint(game,unit);
      if(!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) continue;
      shown++;
      live.add(unit.id);
      let marker=this.orderMarkers.get(unit.id);
      if(marker && marker.type!==endpoint.type) {
        this._removeOrderMarker(unit.id,marker);
        marker=null;
      }
      if(!marker) {
        marker=this._makeOrderMarker(endpoint.type);
        this.orderMarkers.set(unit.id,marker);
      }
      const p=marker.line.geometry.attributes.position;
      p.setXYZ(0,unit.x,0.15,unit.y);
      p.setXYZ(1,endpoint.x,0.15,endpoint.y);
      p.needsUpdate=true;
      marker.line.computeLineDistances();
      marker.ring.position.set(endpoint.x,0.57,endpoint.y);
      marker.core.position.set(endpoint.x,0.58,endpoint.y);
      const pulse=1+0.12*Math.sin(time*4+endpoint.x);
      marker.ring.scale.setScalar(pulse);
    }
    for(const [id,marker] of this.orderMarkers) if(!live.has(id)) this._removeOrderMarker(id,marker);
  }

  _removeOrderMarker(id,marker) {
    this.orderGroup.remove(marker.group);
    marker.group.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material)obj.material.dispose();});
    this.orderMarkers.delete(id);
  }

  _makeRelay() {
    const g=new THREE.Group();
    const energy=mat(0xffd990,{emissive:0xb77639,emissiveIntensity:1.45,metalness:0.19,roughness:0.22});
    const neutral=mat(0xd2a86a,{emissive:0x805326,emissiveIntensity:0.62,metalness:0.24,roughness:0.37});
    const signalMaterials=[];
    const authored=this.assetModels.get('relay');
    let capstone,capstoneMat;
    if(authored) {
      const model=authored.clone(true);
      model.traverse(obj=>{
        if(!obj.isMesh)return;
        obj.userData.sharedAssetGeometry=true;
        obj.castShadow=true;obj.receiveShadow=true;
        obj.material=(Array.isArray(obj.material)?obj.material:[obj.material]).map(source=>{
          const instance=source.clone();
          if(instance.name==='RelaySignal')signalMaterials.push(instance);
          return instance;
        });
        if(obj.material.length===1)obj.material=obj.material[0];
        if(obj.name==='Relay Core') {
          capstone=obj;
          capstoneMat=Array.isArray(obj.material)?obj.material[0]:obj.material;
        }
      });
      g.add(model);
    } else {
      // Keep the built-in fallback so the objective remains available if the
      // optional Blender asset fails to load.
      const dark=mat(0x172a31,{metalness:0.55,roughness:0.42});
      const alloy=mat(0x718386,{metalness:0.61,roughness:0.34});
      const steel=mat(0x344b50,{metalness:0.67,roughness:0.39});
      cylinder(g,dark,0.88,0.96,0.18,8,0,0.12,0);
      cylinder(g,alloy,0.68,0.79,0.13,8,0,0.27,0);
      cylinder(g,steel,0.47,0.61,0.17,8,0,0.40,0);
      for(let i=0;i<4;i++) {
        const a=i*Math.PI/2,x=Math.cos(a)*0.52,z=Math.sin(a)*0.52;
        box(g,alloy,0.19,0.76,0.20,x,0.78,z).rotation.y=-a;
        box(g,neutral,0.095,0.20,0.035,x,0.60,z).rotation.y=-a;
        const vane=box(g,steel,0.115,0.92,0.095,Math.cos(a)*0.46,1.42,Math.sin(a)*0.46);
        vane.rotation.z=(i%2===0?1:-1)*0.16;
        const vaneLight=box(g,energy,0.045,0.61,0.025,Math.cos(a)*0.46,1.46,Math.sin(a)*0.46,false);
        vaneLight.rotation.z=vane.rotation.z;
      }
      cylinder(g,dark,0.29,0.38,1.10,8,0,0.93,0);
      cylinder(g,alloy,0.34,0.34,0.11,8,0,1.43,0);
      cone(g,energy,0.19,0.48,7,0,1.79,0);
    }
    if(!capstone) {
      // Keep the signal crystal above the storm field and make its ownership
      // hue readable at ordinary gameplay zoom.
      capstoneMat=new THREE.MeshBasicMaterial({color:0xe1bd7b,transparent:true,opacity:1,depthWrite:false,toneMapped:false});
      capstone=addMesh(g,new THREE.OctahedronGeometry(0.33,0),capstoneMat,0,2.40,0,false);
      capstone.scale.set(1,1.55,1);
      signalMaterials.push(capstoneMat);
    }
    capstone.renderOrder=8;
    // A broken-looking three-part corona suggests a tuning instrument rather
    // than a generic power pylon; it stays static to keep animation cheap.
    const halo=addMesh(g,new THREE.TorusGeometry(0.78,0.035,5,40),energy,0,0.96,0,false);
    halo.rotation.x=Math.PI/2;
    const haloUpper=addMesh(g,new THREE.TorusGeometry(0.47,0.024,5,32),neutral,0,1.58,0,false);
    haloUpper.rotation.x=Math.PI/2;
    const capture=addMesh(g,new THREE.RingGeometry(1.84,1.91,56),new THREE.MeshBasicMaterial({color:0xa4b1ac,transparent:true,opacity:0.52,side:THREE.DoubleSide,depthWrite:false}),0,0.075,0,false);
    capture.rotation.x=-Math.PI/2;
    const progressSegments=[];
    const segmentCount=24;
    for(let i=0;i<segmentCount;i++) {
      const start=i*Math.PI*2/segmentCount+0.012;
      const length=Math.PI*2/segmentCount-0.024;
      const segment=addMesh(g,new THREE.RingGeometry(1.71,1.82,2,1,start,length),
        new THREE.MeshBasicMaterial({color:0x49d6ed,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}),0,0.09,0,false);
      segment.rotation.x=-Math.PI/2;
      segment.renderOrder=5;
      progressSegments.push(segment);
    }
    // The shallow shield cap appears only when the relay is owned and a storm
    // threatens it, making the gameplay shelter radius easy to understand.
    const shelter=addMesh(g,new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI*0.49),
      new THREE.MeshBasicMaterial({color:0x68dfff,transparent:true,opacity:0.12,wireframe:true,depthWrite:false}),0,0.08,0,false);
    shelter.scale.set(2.45,2.35,2.45);
    shelter.visible=false;
    // Trace the edge of the actual 2.3-tile healing radius, clear of the
    // relay plinth and capture meter so the triage state reads at command zoom.
    // It stays hidden for unrevealed relays and historical replay rules.
    const recovery=addMesh(g,new THREE.RingGeometry(2.13,2.21,56),
      new THREE.MeshBasicMaterial({color:0x9dffbf,transparent:true,opacity:0.68,
        depthWrite:false,side:THREE.DoubleSide,toneMapped:false}),0,0.115,0,false);
    recovery.rotation.x=-Math.PI/2;
    recovery.visible=false;
    recovery.renderOrder=6;
    // Overdrive gets a compact amber corona around the relay spine. The ring
    // and broken arcs are persistent meshes; animation only changes transforms
    // so a cluster of relays does not allocate geometry during updates.
    const overdrive=new THREE.Group();
    overdrive.position.y=1.49;
    const overdriveMat=new THREE.MeshBasicMaterial({color:0xff8a10,transparent:true,opacity:0.96,depthWrite:false,toneMapped:false,blending:THREE.NormalBlending});
    const overdriveRing=addMesh(overdrive,new THREE.TorusGeometry(0.75,0.055,5,40),overdriveMat,0,0,0,false);
    overdriveRing.rotation.x=Math.PI/2;
    for(let i=0;i<3;i++) {
      const start=i*Math.PI*2/3+0.18;
      const arc=addMesh(overdrive,new THREE.TorusGeometry(0.59,0.035,4,18,1.02),overdriveMat,0,0,0,false);
      arc.rotation.set(Math.PI/2,0,start);
    }
    const overdriveCore=addMesh(overdrive,new THREE.ConeGeometry(0.105,0.70,6),overdriveMat,0,0.46,0,false);
    overdriveCore.rotation.x=Math.PI;
    overdrive.visible=false;
    g.add(overdrive);
    // One segmented ground ring traces the v26 local reload field. It shares
    // the relay transform and stays clear of the inner capture meter.
    const fieldArcs=[];
    for(let i=0;i<12;i++) if(i%3!==2)
      fieldArcs.push({geometry:new THREE.RingGeometry(2.23,2.30,4,1,
        i*Math.PI/6+0.025,Math.PI/6-0.075)});
    const overdriveField=addMesh(g,joinedGeometry(fieldArcs),
      new THREE.MeshBasicMaterial({color:0xffaf54,transparent:true,opacity:0.55,
        depthWrite:false,side:THREE.DoubleSide,toneMapped:false}),0,0.115,0,false);
    overdriveField.rotation.x=-Math.PI/2;
    overdriveField.renderOrder=6;
    overdriveField.visible=false;
    const ring=addMesh(g,new THREE.TorusGeometry(0.42,0.027,5,36),energy,0,1.55,0,false);
    ring.rotation.x=0.28;
    const beacon=new THREE.PointLight(0xffd889,1.35,4.4);
    beacon.position.y=1.72;g.add(beacon);
    g.userData={energy,neutral,ring,halo,haloUpper,capture,progressSegments,shelter,recovery,beacon,capstone,capstoneMat,signalMaterials,overdrive,overdriveRing,overdriveCore,overdriveMat,overdriveField};
    this.scene.add(g);
    return g;
  }

  _syncRelays(game,time) {
    const live=new Set();
    for(const relay of game.relays||[]) {
      live.add(relay.id);
      let visual=this.relays.get(relay.id);
      if(!visual) {visual=this._makeRelay();this.relays.set(relay.id,visual);}
      const f=game.fog?.[Math.floor(relay.y)]?.[Math.floor(relay.x)]??2;
      const playerOwned=relay.owner==='player';
      // Explored cells retain the site's neutral silhouette, but never expose
      // changed enemy ownership, protocol, progress, or storm response.
      const liveState=playerOwned||f===2;
      visual.visible=f>0||playerOwned;
      visual.position.set(relay.x,0,relay.y);
      const owned=liveState&&(relay.owner==='player'||relay.owner==='enemy');
      const contested=liveState&&Boolean(relay.contested);
      const faction=owned?(relay.owner==='player'?game.faction:game.enemyFaction):null;
      const isVesper=faction==='vesper';
      const teamColor=owned?(isVesper?0xff725d:0x48d8ef):0xe1bd7b;
      const playerColor=game.faction==='vesper'?0xff725d:0x48d8ef;
      const opposingColor=game.enemyFaction==='vesper'?0xff725d:0x48d8ef;
      const {energy,neutral,ring,halo,haloUpper,capture,progressSegments,shelter,recovery,beacon,capstone,capstoneMat,signalMaterials,overdrive,overdriveRing,overdriveCore,overdriveField}=visual.userData;
      const dominion=game.relayDominion;
      const dominionVisualsAllowed=game.replayVersion==null||game.replayVersion>=39;
      const dominionOwner=dominionVisualsAllowed&&(dominion?.owner==='player'||dominion?.owner==='enemy')?dominion.owner:null;
      // Relay intelligence remains the final authority here: enemy control
      // only reaches this branch when the site is fully visible. The public
      // countdown never makes a hidden relay's ownership legible.
      const dominionSecure=Boolean(dominionOwner&&liveState&&relay.owner===dominionOwner&&!relay.contested);
      const dominionProgress=dominionSecure&&Number.isFinite(dominion?.required)&&dominion.required>0?
        clamp((Number.isFinite(dominion.elapsed)?dominion.elapsed:0)/dominion.required,0,1):0;
      const dominionColor=dominionOwner==='player'?playerColor:opposingColor;
      energy.color.setHex(teamColor);
      energy.emissive.setHex(teamColor);
      neutral.color.setHex(owned?teamColor:0xe1bd7b);
      neutral.emissive.setHex(owned?teamColor:0x805326);
      // A restrained pulse reuses the capture ring, existing coronas, crystal,
      // and point light. No new light or per-frame geometry is allocated.
      const dominionPulse=dominionSecure?0.5+0.5*Math.sin(time*(3+dominionProgress*1.6)+relay.x*.35):0;
      capture.material.color.setHex(dominionSecure?dominionColor:(owned?teamColor:0xa4b1ac));
      capture.material.opacity=dominionSecure?0.53+0.11*dominionProgress+0.08*dominionPulse:
        contested?0.56:owned?0.48:liveState?0.38+0.08*Math.sin(time*2.6):0.38;
      capture.scale.setScalar(dominionSecure?1.015+0.025*dominionProgress+0.012*dominionPulse:1);
      energy.emissiveIntensity=dominionSecure?1.45+0.55*dominionProgress+0.35*dominionPulse:1.45;
      const rawProgress=liveState&&Number.isFinite(relay.progress)?relay.progress:0;
      const signed=clamp(rawProgress,-1,1);
      const directionColor=signed<0?(game.enemyFaction==='vesper'?0xff725d:0x48d8ef):(game.faction==='vesper'?0xff725d:0x48d8ef);
      const lit=Math.ceil(Math.abs(signed)*progressSegments.length);
      for(let i=0;i<progressSegments.length;i++) {
        const mesh=progressSegments[i];
        const on=i<lit;
        mesh.visible=liveState&&(on||contested);
        mesh.material.color.setHex(contested?(i%2?opposingColor:playerColor):directionColor);
        mesh.material.opacity=contested?0.78:on?0.82:0;
      }
      const storm=game.storm;
      const stormPhase=storm?.phase;
      const stormNearby=storm&&stormPhase&&stormPhase!=='calm'&&Math.hypot(relay.x-storm.x,relay.y-storm.y)<=(storm.radius||5.5)+1.4;
      const overdriven=owned&&relay.protocol==='overdrive';
      capstone.visible=liveState;
      const landmarkColor=overdriven?0xff9815:teamColor;
      capstoneMat.color.setHex(landmarkColor);
      for(const signalMaterial of signalMaterials) {
        signalMaterial.color.setHex(landmarkColor);
        if(signalMaterial.emissive)signalMaterial.emissive.setHex(landmarkColor);
      }
      shelter.visible=owned&&!contested&&!overdriven&&Boolean(stormNearby);
      shelter.material.color.setHex(stormPhase==='surge'?0x87dfff:0xa9d9df);
      shelter.material.opacity=stormPhase==='surge'?0.19:0.10;
      recovery.visible=owned&&faction==='aegis'&&!contested&&!overdriven&&
        (game.replayVersion==null||game.replayVersion>=18)&&game.units.some(unit=>
          unit.owner===relay.owner&&unit.hp>0&&unit.hp<unit.maxHp&&!unit.embarkedIn&&
          game.unitDefs?.[unit.defId]?.armor==='infantry'&&
          Math.hypot(unit.x-relay.x,unit.y-relay.y)<=2.3);
      if(recovery.visible) {
        recovery.material.opacity=0.48+0.23*(0.5+0.5*Math.sin(time*4.4));
        recovery.scale.setScalar(0.96+0.06*(0.5+0.5*Math.sin(time*4.4)));
      }
      beacon.color.setHex(teamColor);
      beacon.intensity=dominionSecure?1.18+0.54*dominionProgress+0.26*dominionPulse:owned?1.18:0.65;
      ring.visible=liveState;
      halo.visible=liveState;
      haloUpper.visible=liveState;
      overdrive.visible=overdriven;
      overdriveField.visible=overdriven&&!contested&&
        (playerOwned||f===2)&&(game.replayVersion==null||game.replayVersion>=26);
      if(overdriveField.visible)
        overdriveField.material.opacity=0.47+0.13*(0.5+0.5*Math.sin(time*3.0+relay.x));
      if(liveState) {
        capstone.position.y=2.40+Math.sin(time*2.2+relay.x)*0.035;
        capstone.rotation.y=time*(overdriven?1.45:dominionSecure?0.48+0.52*dominionProgress:0.34);
        capstone.rotation.x=0.18+Math.sin(time*1.3+relay.y)*0.06;
        ring.rotation.set(0.28,time*(dominionSecure?0.68+0.72*dominionProgress:0.48),Math.sin(time*0.6)*0.08);
        halo.rotation.z=time*(dominionSecure?0.28+0.35*dominionProgress:0.20);
        haloUpper.rotation.z=-time*(dominionSecure?0.36+0.42*dominionProgress:0.27);
        const pulse=1+Math.sin(time*2.5+relay.x)*0.025;
        ring.scale.setScalar(pulse*(dominionSecure?1.04+0.07*dominionProgress+0.025*dominionPulse:1));
        halo.scale.setScalar(dominionSecure?1.06+0.10*dominionProgress+0.035*dominionPulse:1);
        haloUpper.scale.setScalar(dominionSecure?1.04+0.07*dominionProgress+0.025*dominionPulse:1);
      }
      if(overdriven) {
        overdrive.rotation.y=-time*1.1;
        overdriveRing.scale.setScalar(1+0.07*Math.sin(time*5+relay.x));
        overdriveCore.scale.set(1,0.9+0.18*Math.sin(time*6+relay.y),1);
      }
    }
    for(const [id,visual] of this.relays) if(!live.has(id)) {
      this.scene.remove(visual);
      visual.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
      this.relays.delete(id);
    }
  }

  _makeSalvageDropVisual() {
    const root=new THREE.Group();
    const pod=new THREE.Group();
    const authored=this.assetModels?.get('salvageDrop');
    if(authored) {
      const model=authored.clone(true);
      model.traverse(object=>{
        if(!object.isMesh)return;
        object.userData.sharedAssetGeometry=true;
        object.castShadow=true;object.receiveShadow=true;
        object.material=(Array.isArray(object.material)?object.material:[object.material]).map(source=>{
          const instance=source.clone();
          if(instance.emissive)instance.emissiveIntensity=Math.max(instance.emissiveIntensity||0,1.25);
          return instance;
        });
        if(object.material.length===1)object.material=object.material[0];
      });
      model.scale.setScalar(.92);
      pod.add(model);
    } else {
      // A compact low-poly fallback mirrors the authored capsule silhouette.
      const armor=mat(0x87958a,{metalness:.58,roughness:.38});
      const graphite=mat(0x17292b,{metalness:.48,roughness:.58});
      const signal=new THREE.MeshStandardMaterial({color:0xffa53d,emissive:0xc95710,emissiveIntensity:1.55,metalness:.2,roughness:.28});
      const cyan=new THREE.MeshStandardMaterial({color:0x60e8df,emissive:0x138b9b,emissiveIntensity:1.3,metalness:.2,roughness:.22});
      cylinder(pod,graphite,.73,.73,.16,10,0,.12,0);
      cylinder(pod,signal,.67,.67,.10,10,0,.25,0);
      cone(pod,armor,.70,.47,.94,8,0,.77,0);
      cylinder(pod,graphite,.49,.49,.13,10,0,1.28,0);
      cone(pod,signal,.34,.15,.30,8,0,1.48,0);
      cylinder(pod,cyan,.18,.18,.075,10,0,1.66,0);
      for(let i=0;i<4;i++) {
        const a=i*Math.PI/2+Math.PI/4,x=Math.cos(a)*.63,z=Math.sin(a)*.63;
        const fin=box(pod,graphite,.32,.23,.15,x,.43,z);fin.rotation.y=-a;
        const stripe=box(pod,cyan,.19,.045,.035,x,.46,z);stripe.rotation.y=-a;
      }
    }
    pod.position.y=.1;root.add(pod);
    // Fog is an intentional depth-test-disabled veil at render order 10. These
    // few objective-only meshes render after it so a public drop remains
    // legible without changing fog or revealing any scene objects around it.
    const ringMat=new THREE.MeshBasicMaterial({color:0xffbd62,transparent:true,opacity:.9,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    const ring=addMesh(root,new THREE.RingGeometry(1.12,1.20,48),ringMat,0,.045,0,false);
    ring.rotation.x=-Math.PI/2;ring.renderOrder=12;
    const contestMat=new THREE.MeshBasicMaterial({color:0xff806b,transparent:true,opacity:.96,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    const contestRing=addMesh(root,new THREE.RingGeometry(1.36,1.43,48),contestMat,0,.06,0,false);
    contestRing.rotation.x=-Math.PI/2;contestRing.renderOrder=13;contestRing.visible=false;
    const progressGeometry=new THREE.RingGeometry(1.24,1.33,64);
    progressGeometry.setDrawRange(0,0);
    const progressMat=new THREE.MeshBasicMaterial({color:0x67f4ba,transparent:true,opacity:1,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    const progress=addMesh(root,progressGeometry,progressMat,0,.055,0,false);
    progress.rotation.x=-Math.PI/2;progress.renderOrder=13;
    const markerMat=new THREE.MeshBasicMaterial({color:0xffb849,transparent:true,opacity:.34,depthTest:false,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,blending:THREE.AdditiveBlending});
    const marker=addMesh(root,new THREE.ConeGeometry(.31,2.25,8,1,true),markerMat,0,1.30,0,false);
    marker.renderOrder=12;
    const beaconMat=new THREE.MeshBasicMaterial({color:0xffd58a,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false});
    const beacon=addMesh(root,new THREE.OctahedronGeometry(.2,0),beaconMat,0,2.55,0,false);
    beacon.renderOrder=13;
    const beaconCoreMat=new THREE.MeshBasicMaterial({color:0xffefbd,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false});
    const beaconCore=addMesh(root,new THREE.OctahedronGeometry(.075,0),beaconCoreMat,0,2.55,0,false);
    beaconCore.renderOrder=14;
    const light=this.quality==='eco'?null:new THREE.PointLight(0xffb65a,this.quality==='ultra'?1.25:.72,4.2);
    if(light){light.position.set(0,1.4,0);root.add(light);}
    root.userData={pod,ring,contestRing,progress,marker,beacon,beaconCore,light,modelVersion:this.assetVersions?.get('salvageDrop')||0};
    this.scene.add(root);
    return root;
  }

  _disposeSalvageDropVisual() {
    const visual=this.salvageDropVisual;
    if(!visual)return;
    this.scene.remove(visual);
    visual.traverse(object=>{
      if(object.geometry&&!object.userData.sharedAssetGeometry)object.geometry.dispose();
      if(object.material)for(const material of (Array.isArray(object.material)?object.material:[object.material]))material.dispose();
    });
    this.salvageDropVisual=null;
  }

  _syncSalvageDrop(game,time) {
    const drop=game.salvageDrop;
    if(!drop||!['incoming','active','claimed','expired'].includes(drop.phase)||
      !Number.isFinite(drop.x)||!Number.isFinite(drop.y)) {
      this._disposeSalvageDropVisual();return;
    }
    const version=this.assetVersions?.get('salvageDrop')||0;
    if(this.salvageDropVisual&&this.salvageDropVisual.userData.modelVersion!==version) this._disposeSalvageDropVisual();
    if(!this.salvageDropVisual)this.salvageDropVisual=this._makeSalvageDropVisual();
    const visual=this.salvageDropVisual,{pod,ring,contestRing,progress,marker,beacon,beaconCore,light}=visual.userData;
    const simTime=Number.isFinite(game.time)?game.time:time;
    const terminal=drop.phase==='claimed'||drop.phase==='expired';
    const incoming=drop.phase==='incoming';
    const expired=drop.phase==='expired';
    visual.visible=true;
    visual.position.set(drop.x,0,drop.y);
    const remaining=Number.isFinite(drop.landsAt)?Math.max(0,drop.landsAt-simTime):0;
    pod.visible=!terminal;
    pod.position.y=incoming ? .12+clamp(remaining/8,0,1)*2.6 : .10;
    const owner=drop.captureOwner;
    const playerColor=game.faction==='vesper'?0xffd371:0x66e8d6;
    const enemyColor=0xff806b;
    const cueColor=owner==='player'?playerColor:owner==='enemy'?enemyColor:0xffbd62;
    ring.material.color.setHex(terminal?(expired?0x879392:playerColor):cueColor);
    ring.material.opacity=terminal ? .42 : incoming ? .36+.09*Math.sin(time*4) : .50;
    ring.scale.setScalar(incoming?1+.055*Math.sin(time*3.2):1);
    const contested=drop.phase==='active'&&drop.contested===true;
    contestRing.visible=contested;
    if(contested) {
      // Alternating side colors make the shared objective read as contested
      // while only exposing the public contested flag, never unit positions.
      contestRing.material.color.setHex(Math.floor(time*3.2)%2===0?playerColor:enemyColor);
      contestRing.material.opacity=.82+.16*(.5+.5*Math.sin(time*7));
    }
    marker.visible=incoming;
    marker.material.opacity=incoming ? .10+.05*(.5+.5*Math.sin(time*3.4)) : 0;
    marker.scale.y=incoming ? .92+.1*Math.sin(time*2.1) : 0;
    beacon.visible=incoming;
    beacon.material.color.setHex(0xffd58a);
    beacon.scale.setScalar(.82+.18*(.5+.5*Math.sin(time*4.8)));
    beaconCore.visible=incoming;
    beaconCore.material.color.setHex(0xfff0c8);
    beaconCore.scale.setScalar(.9+.12*Math.sin(time*4.8));
    progress.material.color.setHex(cueColor);
    const amount=drop.phase==='active'&&owner&&Number.isFinite(drop.captureProgress)?clamp(drop.captureProgress/5,0,1):0;
    progress.visible=amount>0;
    progress.geometry.setDrawRange(0,Math.ceil(amount*64)*6);
    if(light)light.intensity=terminal?0:.72+.22*(.5+.5*Math.sin(time*3));
  }

  _makeStormVisual() {
    const g=new THREE.Group();
    const violet=new THREE.MeshBasicMaterial({color:0xbc85f9,transparent:true,opacity:0.65,depthWrite:false,side:THREE.DoubleSide});
    const boundary=addMesh(g,new THREE.TorusGeometry(1,0.016,4,90),violet,0,0.15,0,false);
    boundary.rotation.x=-Math.PI/2;
    // The shroud is drawn at render order 10. Keep only the storm footprint
    // rings above it so players can read the incoming damage radius without
    // exposing concealed terrain, units, or buildings.
    boundary.renderOrder=11;
    // A cool outer corona separates the storm's footprint from its cloud and
    // terrain. Both rings are reused across phases and respect scene fog.
    const frontMaterial=new THREE.MeshBasicMaterial({
      color:0x8be7ff,transparent:true,opacity:0.28,depthWrite:false,side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending,
    });
    const front=addMesh(g,new THREE.TorusGeometry(1,0.016,5,90),frontMaterial,0,0.12,0,false);
    front.rotation.x=-Math.PI/2;
    front.renderOrder=11;
    const innerMaterial=new THREE.MeshBasicMaterial({
      color:0xc7a4ff,transparent:true,opacity:0.18,depthWrite:false,side:THREE.DoubleSide,
    });
    const innerFront=addMesh(g,new THREE.TorusGeometry(1,0.008,4,72),innerMaterial,0,0.10,0,false);
    innerFront.rotation.x=-Math.PI/2;
    innerFront.renderOrder=11;
    const field=addMesh(g,new THREE.CircleGeometry(1,64),new THREE.MeshBasicMaterial({color:0xaa6fdf,transparent:true,opacity:0.07,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}),0,0.035,0,false);
    field.rotation.x=-Math.PI/2;
    const cloud=addMesh(g,new THREE.SphereGeometry(1,12,7),new THREE.MeshBasicMaterial({color:0x51426c,transparent:true,opacity:0.17,depthWrite:false}),0,3.8,0,false);
    const cloudPuffs=[];
    const puffMaterial=new THREE.MeshBasicMaterial({color:0x5d506d,transparent:true,opacity:0.115,depthWrite:false,side:THREE.DoubleSide});
    for(let i=0;i<6;i++) {
      const puff=addMesh(g,new THREE.SphereGeometry(1,9,6),puffMaterial,0,0,0,false);
      cloudPuffs.push(puff);
    }
    const arcs=[];
    for(let i=0;i<11;i++) {
      const arc=addMesh(g,new THREE.CylinderGeometry(0.035,0.08,1,4),new THREE.MeshBasicMaterial({color:0xd8baff,transparent:true,opacity:0.7,depthWrite:false,toneMapped:false}),0,0,0,false);
      arcs.push(arc);
    }
    const light=new THREE.PointLight(0xb98cff,2.5,16);light.position.y=2;g.add(light);
    g.userData={boundary,front,innerFront,field,cloud,cloudPuffs,arcs,light};
    this.scene.add(g);this.stormVisual=g;
  }

  _syncStorm(game,time) {
    const storm=game.storm;
    const baseMood=storm?.phase==='surge'?0.24:storm?.phase==='warning'?0.11:storm?.phase==='recovery'?0.08:0;
    // A brief double flash sells the ion discharge across the battlefield. It
    // reuses scene lighting and stays out of the sand shader's fragment path.
    const beat=((time+(storm?.cycle||0)*2.7)%7.6+7.6)%7.6;
    const flashEnvelope=(center,width)=>{const x=clamp(1-Math.abs(beat-center)/width,0,1);return x*x*(3-2*x);};
    const qualityScale=this.quality==='ultra'?1:this.quality==='balanced'?0.65:0;
    const stormFlash=storm?.phase==='surge'?qualityScale*Math.max(flashEnvelope(0.18,0.12),flashEnvelope(0.43,0.17)*0.62):0;
    const mood=baseMood+stormFlash*0.14;
    this.scene.background.copy(this.clearSky).lerp(this.stormSky,mood);
    this.scene.fog.color.copy(this.clearSky).lerp(this.stormSky,mood);
    this.sun.color.copy(this.sunBaseColor).lerp(this.stormLight,mood*0.75+stormFlash*0.2);
    this.rimLight.color.copy(this.rimBaseColor).lerp(this.stormLight,mood*0.72+stormFlash*0.12);
    this.rimLight.intensity=this.rimBaseIntensity*(1+stormFlash*0.34);
    this.hemisphere.color.copy(this.ambientBaseSky).lerp(this.stormLight,mood*0.48+stormFlash*0.08);
    this.hemisphere.groundColor.copy(this.ambientBaseGround).lerp(this.stormAmbientGround,mood*0.34+stormFlash*0.06);
    this.hemisphere.intensity=this.ambientBaseIntensity*(1+stormFlash*0.12);
    // The surge briefly raises and cools the key light, making units, crystal,
    // and architecture catch the same distant ion strike without extra lights.
    this.sun.intensity=this.sunBaseIntensity*(1-mood*0.18+stormFlash*0.52);
    this.scene.fog.density=this.baseFogDensity*(1+mood*0.32);
    this.atmosphere.material.color.setHex(this.mapStyle.mist).lerp(this.stormSky,mood*0.48);
    if(!this.stormVisual) this._makeStormVisual();
    const g=this.stormVisual;
    if(!storm||storm.phase==='calm') {g.visible=false;return;}
    g.visible=true;
    g.position.set(storm.x,0,storm.y);
    const surge=storm.phase==='surge', warning=storm.phase==='warning';
    const radius=storm.radius||5.5;
    const {boundary,front,innerFront,field,cloud,cloudPuffs,arcs,light}=g.userData;
    boundary.scale.setScalar(radius);
    const reducedMotion=this.reducedMotionQuery?.matches??false;
    const frontPulse=reducedMotion?1:1+0.012*Math.sin(time*1.35);
    front.scale.setScalar(radius*1.09*frontPulse);
    innerFront.scale.setScalar(radius*0.91);
    front.visible=innerFront.visible=this.quality!=='eco';
    front.material.opacity=surge?0.36:warning?0.23:0.13;
    innerFront.material.opacity=surge?0.20:warning?0.11:0.07;
    field.scale.setScalar(radius);
    cloud.scale.set(radius*0.72,0.42,radius*0.72);
    boundary.material.color.setHex(surge?0xd191ff:warning?0xf8c577:0xbac9cd);
    field.material.color.copy(boundary.material.color);
    boundary.material.opacity=surge?0.65:0.38;
    field.material.opacity=surge?0.048:0.026;
    cloud.material.opacity=surge?0.18:0.09;
    for(let i=0;i<cloudPuffs.length;i++) {
      const puff=cloudPuffs[i], angle=i*Math.PI*2/cloudPuffs.length+time*0.018;
      const orbit=radius*(0.24+(i%3)*0.12);
      puff.position.set(Math.cos(angle)*orbit,1.62+(i%2)*0.32,Math.sin(angle)*orbit);
      puff.scale.set(radius*(0.22+(i%2)*0.055),0.22+(i%3)*0.06,radius*(0.20+(i%2)*0.045));
      puff.material.color.copy(boundary.material.color).multiplyScalar(0.52);
      puff.material.opacity=surge?0.10:0.055;
    }
    light.color.copy(boundary.material.color);light.intensity=surge?1.9+stormFlash*1.5:0.7;
    cloud.rotation.y=time*0.07;
    for(let i=0;i<arcs.length;i++) {
      const a=arcs[i];
      const angle=i*2.399+time*0.13;
      const r=radius*(0.18+hash(i,storm.cycle||0,51)*0.73);
      a.position.set(Math.cos(angle)*r,0.56+0.16*Math.sin(time*5+i),Math.sin(angle)*r);
      a.rotation.z=Math.sin(time*4+i*2.2)*0.35;
      a.scale.y=0.8+hash(i,storm.cycle||0,53)*1.5;
      a.material.opacity=surge&&Math.sin(time*9+i*3)>0.22?0.92:warning?0.22:0.04;
    }
  }

  // Stormcall is a temporary, localized signal. Reuse its small visual group
  // for the whole match so an active lure never allocates per-frame objects.
  _makeStormLureVisual() {
    const g=new THREE.Group();
    const field=new THREE.Mesh(new THREE.RingGeometry(2.05,2.19,48),new THREE.MeshBasicMaterial({
      color:0x65e8f0,transparent:true,opacity:0.28,side:THREE.DoubleSide,depthWrite:false,
      blending:THREE.AdditiveBlending,toneMapped:false
    }));
    field.rotation.x=-Math.PI/2;field.position.y=0.11;field.renderOrder=6;g.add(field);
    const base=new THREE.Mesh(new THREE.TorusGeometry(0.38,0.045,6,28),new THREE.MeshBasicMaterial({
      color:0x9cfcff,transparent:true,opacity:0.92,depthWrite:false,toneMapped:false
    }));
    base.rotation.x=Math.PI/2;base.position.y=0.16;g.add(base);
    const halo=new THREE.Mesh(new THREE.TorusGeometry(0.48,0.022,5,32),new THREE.MeshBasicMaterial({
      color:0x9cfcff,transparent:true,opacity:0.72,depthWrite:false,toneMapped:false
    }));
    halo.rotation.x=Math.PI/2;halo.position.y=2.62;g.add(halo);
    const beacon=new THREE.Mesh(new THREE.OctahedronGeometry(0.20,1),new THREE.MeshBasicMaterial({
      color:0xc8ffff,transparent:true,opacity:0.98,depthWrite:false,toneMapped:false
    }));
    beacon.position.y=3.55;g.add(beacon);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.075,2.55,8),new THREE.MeshBasicMaterial({
      color:0x5acbd8,transparent:true,opacity:0.62,depthWrite:false,toneMapped:false
    }));
    stem.position.y=2.20;g.add(stem);
    const light=new THREE.PointLight(0x73efff,1.6,6.0);light.position.y=3.25;g.add(light);
    g.userData={field,base,halo,beacon,stem,light};
    g.visible=false;this.scene.add(g);this.stormLureVisual=g;
    return g;
  }

  _syncStormLure(game,time) {
    const lure=game.storm?.lure;
    if(!this.stormLureVisual) this._makeStormLureVisual();
    const g=this.stormLureVisual;
    const phase=game.storm?.phase;
    const inPhase=phase==='warning'||phase==='surge';
    const inTime=!!lure&&Number.isFinite(lure.until)&&lure.until>game.time;
    if(!lure||!inPhase||!inTime||!Number.isFinite(lure.x)||!Number.isFinite(lure.y)) {
      g.visible=false;return;
    }
    const x=Math.floor(lure.x),y=Math.floor(lure.y);
    const fog=game.fog?.[y]?.[x]??0;
    // Friendly signals remain visible in explored cells. Enemy signals only
    // render in currently visible cells, so the marker cannot expose stale or
    // hidden enemy activity through the fog.
    const known=lure.owner==='player'?fog>0:fog===2;
    if(!known) {g.visible=false;return;}
    g.visible=true;g.position.set(lure.x,0,lure.y);
    const {field,base,halo,beacon,stem,light}=g.userData;
    const remaining=clamp(lure.until-game.time,0,12);
    const fade=clamp(remaining/1.4,0,1);
    const pulse=0.76+0.24*(0.5+0.5*Math.sin(time*5.8));
    const surge=phase==='surge';
    const color=surge?0xffc36f:0x67e8f2;
    field.material.color.setHex(color);
    field.material.opacity=(surge?0.34:0.24)*fade*(0.78+0.22*pulse);
    field.scale.setScalar(0.9+0.1*pulse+0.035*Math.sin(time*2.4));
    base.material.color.setHex(color);base.material.opacity=0.76*fade;
    base.rotation.z=time*0.45;
    halo.material.color.setHex(color);halo.material.opacity=0.58*fade*(0.76+0.24*pulse);
    halo.rotation.y=-time*0.32;
    halo.scale.setScalar(0.94+0.06*pulse);
    beacon.material.color.setHex(surge?0xffedca:0xd6ffff);
    beacon.material.opacity=fade;
    beacon.rotation.y=time*1.15;beacon.rotation.x=0.22*Math.sin(time*1.8);
    beacon.scale.setScalar((0.88+0.24*pulse)*fade);
    stem.material.color.setHex(color);stem.material.opacity=0.66*fade;
    light.color.setHex(color);light.intensity=(surge?2.1:1.5)*fade*pulse;
  }

  _makeStormglassBloomVisual() {
    const group = new THREE.Group();
    const material = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true,
      opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide });
    // Like the public salvage beacon, these meshes sit above unexplored shroud
    // without exposing terrain or units. The full ring reads over the ion cloud.
    const field = new THREE.Mesh(new THREE.RingGeometry(0.57, 1, 64), material(0x43d7ff, 0.22));
    field.rotation.x = -Math.PI / 2;
    field.position.y = 0.075;
    field.renderOrder = 12;
    group.add(field);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64, 1, 0.05, Math.PI * 1.55),
      material(0xb8f6ff, 0.82));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.105;
    rim.renderOrder = 13;
    group.add(rim);
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 1), material(0xb7f8ff, 1));
    beacon.position.y = 2.8;
    beacon.renderOrder = 14;
    group.add(beacon);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.065, 2.3, 8),
      material(0x83daf8, 0.38));
    stem.position.y = 1.54;
    stem.renderOrder = 13;
    group.add(stem);
    const light = new THREE.PointLight(0x8bdeff, 0.8, 5);
    light.position.y = 2;
    group.add(light);
    group.userData = { field, rim, beacon, stem, light };
    group.visible = false;
    this.scene.add(group);
    this.stormglassBloomVisual = group;
    return group;
  }

  _syncStormglassBloom(game, time) {
    const bloom = game.storm?.bloom;
    if (!this.stormglassBloomVisual) this._makeStormglassBloomVisual();
    const group = this.stormglassBloomVisual;
    if (!bloom || bloom.until <= game.time || !Number.isFinite(bloom.x) ||
      !Number.isFinite(bloom.y) || !Number.isFinite(bloom.radius)) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(bloom.x, 0, bloom.y);
    const { field, rim, beacon, stem, light } = group.userData;
    const radius = Math.max(1, Math.min(6, bloom.radius));
    const fade = clamp((bloom.until - game.time) / 5, 0, 1);
    const pulse = 0.78 + 0.22 * Math.sin(time * 3.2);
    field.scale.setScalar(radius);
    field.material.opacity = 0.19 * fade * (0.9 + 0.1 * pulse);
    rim.scale.setScalar(radius);
    rim.rotation.z = time * 0.16;
    rim.material.opacity = 0.76 * fade * pulse;
    beacon.rotation.y = time * 0.64;
    beacon.position.y = 2.75 + 0.16 * Math.sin(time * 2.7);
    beacon.material.opacity = 0.96 * fade;
    stem.material.opacity = 0.52 * fade;
    light.intensity = (this.quality === 'eco' ? 0 : 0.72) * fade * pulse;
  }

  _syncGroundFlatZones(game,centerX,centerY) {
    if(!this.groundReliefMaterials?.length)return;
    const zones=(game.buildings||[]).filter(building=>building.hp>0)
      .map(building=>({
        x:building.x+building.w/2,z:building.y+building.h/2,
        hx:building.w/2+0.35,hz:building.h/2+0.35,
      }))
      .sort((a,b)=>Math.hypot(a.x-centerX,a.z-centerY)-Math.hypot(b.x-centerX,b.z-centerY))
      .slice(0,GROUND_FLAT_ZONE_CAPACITY);
    const signature=zones.map(zone=>`${zone.x},${zone.z},${zone.hx},${zone.hz}`).join('|');
    for(const material of this.groundReliefMaterials) {
      const state=material.userData.groundFlatZoneState;
      if(state.signature===signature)continue;
      state.signature=signature;
      for(let i=0;i<GROUND_FLAT_ZONE_CAPACITY;i++) {
        const zone=zones[i];
        if(zone)state.vectors[i].set(zone.x,zone.z,zone.hx,zone.hz);
        else state.vectors[i].set(0,0,0,0);
      }
      state.countUniform.value=zones.length;
    }
  }

  render(game,{centerX=this.centerX,centerY=this.centerY,zoom=this.zoom,time=0,placeId=null,pointerWorld=null,selectionRect=null}={}) {
    if(!game) return;
    this.fogTimeUniform.value=time;
    this._syncSandWind(time);
    if(this.crystalGlintTimeUniform) this.crystalGlintTimeUniform.value=time;
    this.waterTimeUniform.value=time;
    this.setView(centerX,centerY,zoom);
    if(this.terrain!==game.terrain) this._buildTerrain(game);
    else this._syncTerrainChanges(game);
    this._syncGroundFlatZones(game,centerX,centerY);
    this._syncCrashSite(game);
    this._syncFog(game);
    this._syncBridgeVisuals(game);
    this._syncEntities(game,time);
    if(this.trackDirty) {
      this.trackMesh.instanceMatrix.needsUpdate=true;
      this.trackMesh.geometry.getAttribute('aTrackBirth').needsUpdate=true;
      this.trackDirty=false;
    }
    this._lastRenderTime=time;
    this._syncWrecks(game,time);
    this._syncBuildingRuins(game,time);
    if(this.trackTimeUniform) this.trackTimeUniform.value=time;
    this._syncRangeIndicator(game,time);
    this._syncOrders(game,time);
    this._syncFieldOrder(game,time);
    this._syncCampaignRouteMarker(game,time);
    this._syncEffects(game,time);
    this._syncRelays(game,time);
    this._syncSalvageDrop(game,time);
    this._syncStorm(game,time);
    this._syncStormLure(game,time);
    this._syncStormglassBloom(game,time);
    this._syncDustField(time);
    if(this.crystalMesh?.material?.emissive) this.crystalMesh.material.emissiveIntensity=0.58+0.12*Math.sin(time*2.2);
    if(this.crystalGlows?.material) this.crystalGlows.material.opacity=0.18+0.025*Math.sin(time*2.2);
    this._syncPlacement(game,placeId,pointerWorld,time);
    // Drag bounds stay in the transparent 2D overlay for crisp CSS-pixel lines.
    void selectionRect;
    this.renderer.render(this.scene,this.camera);
  }

  _syncSandWind(time) {
    if(!this.sandWindTimeUniform) return;
    // Wind is presentation-only. Freeze it under reduced-motion preferences
    // and keep the phase small to avoid discontinuities in long sessions.
    const reducedMotion=this.reducedMotionQuery?.matches??false;
    this.sandWindTimeUniform.value=reducedMotion?0:(time%600000)*0.001;
    if(this.vegetationWindMotionUniform)
      this.vegetationWindMotionUniform.value=this.quality==='eco'||reducedMotion?0:1;
  }

  dispose() {
    this._disposeGroup(this.terrainGroup);
    this.fogTexture?.dispose();
    this.fogTexture=null;
    this._disposeGroup(this.entityGroup);
    this._disposeGroup(this.orderGroup);
    this._disposeGroup(this.effectGroup);
    this.collapseVisuals.clear();
    this.scene.remove(this.rangeIndicator);
    this.rangeIndicator.geometry.dispose();
    this.rangeIndicator.material.dispose();
    this.scene.remove(this.armorFacingIndicator);
    this.armorFacingIndicator.geometry.dispose();
    this.armorFacingIndicator.material.dispose();
    for(const visual of this.relays.values()) {this.scene.remove(visual);visual.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});}
    this.relays.clear();
    this._disposeSalvageDropVisual();
    if(this.stormVisual) {this.scene.remove(this.stormVisual);this.stormVisual.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});this.stormVisual=null;}
    if(this.stormLureVisual) {this.scene.remove(this.stormLureVisual);this.stormLureVisual.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});this.stormLureVisual=null;}
    if(this.stormglassBloomVisual) {this.scene.remove(this.stormglassBloomVisual);this.stormglassBloomVisual.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});this.stormglassBloomVisual=null;}
    this._disposePlacement();
    this.entities.clear(); this.effects.clear();
    this.orderMarkers.clear();
    this.groundPatchTexture?.dispose();
    this.trackTexture?.dispose();
    this.smokeTexture?.dispose();
    this.skyTexture?.dispose();
    this.scene.remove(this.skyBackdrop);
    this.skyBackdrop.geometry.dispose();
    this.skyBackdrop.material.dispose();
    if (this.dustField) {
      this.scene.remove(this.dustField);
      this.dustField.geometry.dispose();
      this.dustField.material.dispose();
      this.dustField = null;
      this.dustFieldData = null;
    }
    this.dustGeometry.dispose();
    this.dustMaterial.dispose();
    this.scene.remove(this.atmosphere);
    this.atmosphere.geometry.dispose();
    this.atmosphere.material.dispose();
    this.atmosphereTexture.dispose();
    for(const source of new Set(this.assetModels.values())) source.traverse(o=>{
      if(o.geometry)o.geometry.dispose();
      if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());
    });
    this.assetModels.clear();
    this.renderer.dispose();
  }
}
