"""Inspect and preview the optional Meshy tank asset in Blender."""

import bpy
import sys
from mathutils import Vector
from pathlib import Path

root = Path(__file__).resolve().parent.parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
filename=args[0] if args else 'aegis-heavy-tank-meshy.glb'
source = root / 'public/assets/models' / filename
out = Path('/tmp') / filename.replace('.glb','-preview.png')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('MESH_COUNT', len(meshes))
print('TRIANGLES', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes))
print('MATERIALS', sorted({m.name for o in meshes for m in o.data.materials if m}))
print('IMAGES', [(im.name, im.size[:]) for im in bpy.data.images])

points = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (lo + hi) / 2
extent = hi - lo
print('BOUNDS_MIN', tuple(round(v, 4) for v in lo))
print('BOUNDS_MAX', tuple(round(v, 4) for v in hi))
print('EXTENT', tuple(round(v, 4) for v in extent))

def aim(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()

size = max(extent)
bpy.ops.object.camera_add(location=center + Vector((size*1.5,-size*1.7,size*1.15)))
camera = bpy.context.object
aim(camera,center)
camera.data.type='ORTHO'
camera.data.ortho_scale=size*1.65
bpy.context.scene.camera=camera

world=bpy.context.scene.world
world.color=(0.12,0.14,0.17)
for loc,energy,color in [((size,-size,size*2),1300,(1,0.91,0.78)),((-size,size,size),900,(0.46,0.82,1))]:
    bpy.ops.object.light_add(type='AREA', location=center+Vector(loc))
    light=bpy.context.object
    light.data.energy=energy
    light.data.shape='DISK'
    light.data.size=size*2
    light.data.color=color
    aim(light,center)

scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=900
scene.render.resolution_y=650
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(out)
scene.render.film_transparent=True
bpy.ops.render.render(write_still=True)
print('PREVIEW',out)
