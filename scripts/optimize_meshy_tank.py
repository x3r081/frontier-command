"""Prepare the Meshy heavy tank for the RTS camera and compress its texture.

Run with Blender in background. The original Meshy GLB stays untouched.
"""

import bpy
from pathlib import Path

root=Path(__file__).resolve().parent.parent
source=root/'public/assets/models/aegis-heavy-tank-meshy.glb'
output=root/'public/assets/models/aegis-heavy-tank-game.glb'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))

meshes=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
for obj in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Meshy generated front=-Y and centered Z. The game kit has front=+Y
    # in Blender, which exports as forward=-Z in Three.js, with feet at Z=0.
    lowest=min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.x=-v.co.x
        v.co.y=-v.co.y
        v.co.z-=lowest

for image in bpy.data.images:
    if image.type=='IMAGE' and image.size[0]>1024:
        image.scale(1024,1024)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',
    export_image_format='JPEG',export_image_quality=83,
    use_selection=True,export_apply=True)
print('OUTPUT',output,output.stat().st_size)
