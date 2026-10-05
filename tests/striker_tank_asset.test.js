import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const modelUrl=new URL('../public/assets/models/striker-tank.glb',import.meta.url);
const portraitUrl=new URL('../public/assets/portraits/lightTank.png',import.meta.url);

function readGlbJson(buffer) {
  assert.equal(buffer.toString('ascii',0,4),'glTF','asset should be binary glTF');
  assert.equal(buffer.readUInt32LE(4),2,'asset should use glTF 2.0');
  const jsonLength=buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16),0x4e4f534a,'first GLB chunk should be JSON');
  return JSON.parse(buffer.toString('utf8',20,20+jsonLength));
}

test('Striker keeps one aimable turret and its broad Aegis armor panels inside the tread span',async()=>{
  const bytes=await readFile(modelUrl);
  const glb=readGlbJson(bytes);
  const turret=glb.nodes.find(node=>node.name==='Rotating turret assembly');
  assert.ok(turret,'all turret armor and the cannon must retain the animated pivot node');
  assert.equal(glb.nodes.length,9,'static consolidation keeps the original node count');
  assert.equal(glb.materials.length,9,'the silhouette pass reuses the original material set');
  assert.equal(glb.meshes.length,9);
  assert.ok(glb.meshes.reduce((sum,mesh)=>sum+mesh.primitives.length,0)<=16,
    'the turret update must not raise the exported primitive budget');
  assert.ok(bytes.byteLength<=462_016,'the asset remains at or below its previous transfer size');

  const accentIndex=glb.materials.findIndex(material=>material.name==='TeamAccent');
  const accent=glb.meshes[turret.mesh].primitives.find(primitive=>primitive.material===accentIndex);
  assert.ok(accent,'the turret should have a faction-color face');
  const bounds=glb.accessors[accent.attributes.POSITION];
  assert.ok(bounds.max[0]>=0.34,'the broad sponson panels should reach a tactical-scale silhouette width');
  assert.ok(bounds.max[0]<0.37,'the panels remain within the existing tracked hull width');

  const treadNode=glb.nodes.find(node=>node.name==='Continuous tank tread');
  assert.ok(treadNode,'the original paired track assembly should remain present');
});

test('Striker portrait remains a transparent 384px tactical icon',async()=>{
  const png=await readFile(portraitUrl);
  assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a','portrait should be PNG');
  assert.equal(png.readUInt32BE(16),384);
  assert.equal(png.readUInt32BE(20),384);
  assert.equal(png.readUInt8(25),6,'portrait should retain its transparent RGBA format');
});
