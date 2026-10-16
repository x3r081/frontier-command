import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

function readGlbJson(buffer) {
  assert.equal(buffer.toString('ascii',0,4),'glTF');
  assert.equal(buffer.readUInt32LE(4),2);
  const jsonLength=buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16),0x4e4f534a);
  return JSON.parse(buffer.toString('utf8',20,20+jsonLength));
}

for (const [id,file,materials,previousBytes,previousTriangles] of [
  ['rifle','rifle-infantry',6,209240,3732],
  ['rocket','rocket-infantry',7,194104,3384],
]) {
  test(`${id} uses a complete independently animated infantry skin within its previous asset budget`,async()=>{
    const bytes=await readFile(new URL(`../public/assets/models/${file}.glb`,import.meta.url));
    const glb=readGlbJson(bytes);
    const boneNames=['FC_Root','FC_Pelvis','FC_Spine',...['L','R'].flatMap(side=>
      [`FC_Thigh_${side}`,`FC_Shin_${side}`,`FC_Foot_${side}`,`FC_UpperArm_${side}`,`FC_Forearm_${side}`]),'FC_Weapon'];
    assert.equal(glb.skins.length,1);
    const joints=new Set(glb.skins[0].joints.map(index=>glb.nodes[index].name));
    assert.deepEqual(joints,new Set(boneNames));
    assert.equal(glb.nodes.filter(node=>node.mesh!=null).length,1);
    assert.equal(glb.meshes.length,1);
    assert.equal(glb.meshes[0].primitives.length,materials);
    assert.equal(glb.materials.length,materials);
    assert.ok(glb.materials.some(material=>material.name==='TeamAccent'));
    let triangles=0;
    for(const primitive of glb.meshes[0].primitives){
      assert.ok(primitive.attributes.JOINTS_0!=null&&primitive.attributes.WEIGHTS_0!=null);
      triangles+=glb.accessors[primitive.indices].count/3;
    }
    assert.ok(triangles<previousTriangles);
    assert.ok(bytes.byteLength<previousBytes);
    assert.equal(glb.images?.length||0,0,'the skin needs no external textures');
  });

  test(`${id} portrait remains a transparent 384px tactical icon`,async()=>{
    const png=await readFile(new URL(`../public/assets/portraits/${id}.png`,import.meta.url));
    assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),384);
    assert.equal(png.readUInt32BE(20),384);
    assert.equal(png.readUInt8(25),6);
  });
}
