import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const modelUrl=new URL('../public/assets/models/rifle-infantry.glb',import.meta.url);
const portraitUrl=new URL('../public/assets/portraits/rifle.png',import.meta.url);

function readGlbJson(buffer) {
  assert.equal(buffer.toString('ascii',0,4),'glTF','asset should be a binary glTF');
  assert.equal(buffer.readUInt32LE(4),2,'asset should use glTF 2.0');
  const jsonLength=buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16),0x4e4f534a,'first GLB chunk should be JSON');
  return JSON.parse(buffer.toString('utf8',20,20+jsonLength));
}

test('rifle infantry keeps animated joints while adding a readable optic and comms silhouette',async()=>{
  const bytes=await readFile(modelUrl);
  const glb=readGlbJson(bytes);
  const names=new Set(glb.nodes.map(node=>node.name));
  for(const joint of ['Arm.L upper','Arm.R upper','Arm.L forearm','Arm.R forearm']) {
    assert.ok(names.has(joint),`animated joint ${joint} must remain an independent node`);
  }
  for(const detail of ['Helmet comms pad','Rifle optic housing','Rifle optic lens','Rifle foregrip']) {
    assert.ok(names.has(detail),`tactical detail ${detail} should be present in the exported GLB`);
  }
  assert.equal(glb.materials.length,6,'new details reuse the established six-material batch set');
  assert.ok(glb.meshes.length<=40,'asset stays within its mesh budget before renderer batching');
  assert.ok(bytes.byteLength<=225_000,'asset stays below its transfer-size budget');
});

test('rifle portrait is regenerated as a transparent 384px tactical icon',async()=>{
  const png=await readFile(portraitUrl);
  assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a','portrait should be PNG');
  assert.equal(png.readUInt32BE(16),384,'portrait width');
  assert.equal(png.readUInt32BE(20),384,'portrait height');
  assert.equal(png.readUInt8(25),6,'portrait should preserve RGBA transparency');
});
