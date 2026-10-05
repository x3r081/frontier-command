"""Render cinematic campaign briefing tableaux from the game's authored GLBs.

Run from the repository root with Blender 5.x:
  blender -b -t 8 --python scripts/render-campaign-art.py
"""
import bpy
import math
import os
import random
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODEL_DIR = os.path.join(ROOT, 'public', 'assets', 'models')
OUT_DIR = os.path.join(ROOT, 'public', 'assets')
W, H = 1024, 1536

SCENES = [
    {
        'file': 'campaign-crystal-front.webp', 'seed': 10,
        'floor': (0.20, 0.24, 0.18, 1), 'sky': (0.10, 0.16, 0.17, 1),
        'accent': (0.12, 0.72, 0.62, 1), 'sun': (1.0, 0.68, 0.34, 1),
        'models': [('refinery', 1.35, 3.5, 1.32, 0.0), ('harvester', -0.35, -0.85, 1.55, -0.20),
                   ('crystal-cluster', 1.45, 1.05, 1.12, 0.20), ('crystal-cluster', -1.7, 1.5, 0.96, -0.4),
                   ('crystal-cluster', 2.35, -1.5, 0.9, 0.65)],
        'rocks': 20, 'mesas': 'shard', 'motif': 'economy',
    },
    {
        'file': 'campaign-signal-vault.webp', 'seed': 20,
        'floor': (0.045, 0.10, 0.13, 1), 'sky': (0.025, 0.055, 0.095, 1),
        'accent': (0.20, 0.75, 0.86, 1), 'sun': (0.28, 0.57, 0.86, 1),
        'models': [('radar-array', 1.4, 3.2, 1.26, 0.0), ('stealth-tank', -0.55, -0.45, 1.42, -0.30),
                   ('scout', 1.65, -2.3, 1.0, 0.18)],
        'rocks': 17, 'mesas': 'twin', 'motif': 'infiltration',
    },
    {
        'file': 'campaign-relay-storm.webp', 'seed': 30,
        'floor': (0.12, 0.13, 0.17, 1), 'sky': (0.055, 0.065, 0.12, 1),
        'accent': (0.43, 0.28, 0.90, 1), 'sun': (0.57, 0.44, 1.0, 1),
        'models': [('resonance-relay', 1.15, 2.7, 1.35, 0.0), ('striker-tank', -0.7, -1.25, 1.35, -0.25),
                   ('rifle-infantry', 1.6, -1.7, 1.55, -0.08), ('storm-array', 1.0, 5.2, 0.88, 0.1)],
        'rocks': 14, 'mesas': 'storm', 'motif': 'storm',
    },
    {
        'file': 'campaign-extraction.webp', 'seed': 40,
        'floor': (0.20, 0.17, 0.12, 1), 'sky': (0.11, 0.17, 0.18, 1),
        'accent': (0.88, 0.58, 0.26, 1), 'sun': (1.0, 0.72, 0.42, 1),
        'models': [('crashed-dropship', 0.3, 3.0, 1.14, -0.12), ('engineer', -0.5, -0.25, 1.42, 0.0),
                   ('rifle-infantry', 0.65, -1.75, 1.3, -0.10), ('rifle-infantry', -1.1, -2.1, 1.22, 0.16)],
        'rocks': 18, 'mesas': 'shard', 'motif': 'extraction',
    },
    {
        'file': 'campaign-airlift.webp', 'seed': 50,
        'floor': (0.11, 0.23, 0.25, 1), 'sky': (0.09, 0.22, 0.27, 1),
        'accent': (0.27, 0.82, 0.91, 1), 'sun': (0.72, 0.84, 0.85, 1),
        'models': [('dropship', 0.1, 1.25, 2.25, 0.04), ('apache', 2.25, 3.2, 3.4, 0.15),
                   ('engineer', -0.65, -1.45, 1.4, 0.0), ('rifle-infantry', 0.5, -2.0, 1.3, -0.05)],
        'rocks': 8, 'mesas': 'delta', 'motif': 'water',
    },
]


def principled(name, color, roughness=0.85, metallic=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = color
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = color
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    if emission:
        bs.inputs['Emission Color'].default_value = emission
        bs.inputs['Emission Strength'].default_value = strength
    return m


def add_area(name, location, target, color, power, size):
    light = bpy.data.lights.new(name, 'AREA')
    light.energy = power
    light.shape = 'DISK'
    light.size = size
    light.color = color
    obj = bpy.data.objects.new(name, light)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for d in list(datablocks):
            if d.users == 0:
                datablocks.remove(d)


def import_model(name, x, y, scale, yaw):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODEL_DIR, name + '.glb'))
    imported = [o for o in bpy.context.scene.objects if o not in before]
    root = bpy.data.objects.new('stage_' + name, None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        obj.parent = root
    root.location = (x, y, 0)
    root.rotation_euler[2] = yaw
    root.scale = (scale, scale, scale)
    return root


def add_mesascape(kind, mat, rng):
    profiles = {
        'shard': [(x, 12.5, h, w) for x, h, w in [(-8, 3.1, 2.7), (-5.8, 3.7, 2.4), (-3.2, 2.8, 2.0), (6.0, 3.5, 2.6), (8.3, 3.8, 2.8)]],
        'twin': [(-8, 12.2, 3.8, 3.2), (-5.3, 13.2, 3.2, 2.5), (6.4, 13, 4.0, 3), (9, 11.6, 3.3, 2.5)],
        'storm': [(-8, 12.5, 3.5, 2.8), (-5.6, 13.4, 4.2, 3.0), (6.5, 13.1, 4.0, 3.0), (9.1, 12.0, 3.4, 2.1)],
        'delta': [(-8, 13, 3.1, 2.5), (-5.0, 13, 3.7, 2.4), (7.0, 13.2, 4.0, 3.2), (9.3, 12, 3.2, 2.4)],
    }
    for i, (x, y, h, w) in enumerate(profiles[kind]):
        bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=w, radius2=0.08, depth=h, location=(x, y, h * 0.5 - 0.2))
        o = bpy.context.object
        o.name = 'distant_terrain'
        o.scale.x = 0.65 + (i % 3) * 0.22
        o.scale.y = 0.74 + (i % 2) * 0.22
        o.rotation_euler[2] = i * 0.83
        o.data.materials.append(mat)


def add_crystal(x, y, size, material, rng):
    # A restrained cluster built from faceted tapered prisms that echo the GLB ore.
    for j, (dx, dy, scale) in enumerate([(-0.25, 0.0, 0.70), (0.12, -0.06, 1.0), (0.38, 0.08, 0.66)]):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.30 * size * scale,
            radius2=0.015 * size, depth=1.25 * size * scale,
            location=(x + dx * size, y + dy * size, 0.59 * size * scale))
        crystal = bpy.context.object
        crystal.name = 'field_crystal'
        crystal.rotation_euler[1] = (-0.13 + j * 0.12)
        crystal.rotation_euler[0] = (j - 1) * 0.05
        crystal.data.materials.append(material)


def add_storm_arc(mat, seed):
    rng = random.Random(seed)
    points = []
    for i in range(14):
        x = 0.4 + (i / 13) * 2.1 + rng.uniform(-0.25, 0.25)
        y = 5.2 + rng.uniform(-0.45, 0.45)
        z = 7.5 - i * 0.42 + rng.uniform(-0.22, 0.22)
        points.append((x, y, z))
    curve = bpy.data.curves.new('ion arc', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.045
    curve.bevel_resolution = 3
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    arc = bpy.data.objects.new('ion arc', curve)
    bpy.context.collection.objects.link(arc)
    arc.data.materials.append(mat)


def setup(scene):
    clear_scene()
    random.seed(scene['seed'])
    rng = random.Random(scene['seed'])
    ground = principled('matte mineral ground', scene['floor'], 0.95)
    mesa = principled('distant basalt', tuple(v * 0.60 for v in scene['floor'][:3]) + (1,), 0.96)
    crystal = principled('resonance crystal', scene['accent'], 0.22, 0.08, scene['accent'], 0.36)
    glow = principled('ion light', scene['accent'], 0.2, 0.1, scene['accent'], 5.0)

    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.18))
    plane = bpy.context.object
    plane.name = 'continuous terrain'
    plane.data.materials.append(ground)
    add_mesascape(scene['mesas'], mesa, rng)

    if scene['motif'] == 'economy':
        for pos in [(-2.5, 0.5, 0.85), (-2.1, 1.45, 0.7), (0.45, 2.6, 0.62), (2.6, -1.2, 0.58)]:
            import_model('crystal-cluster', pos[0], pos[1], pos[2], rng.uniform(-0.5, 0.5))
    elif scene['motif'] == 'infiltration':
        # Narrow illuminated survey lanes lead the eye toward the radar mast.
        for x in [-3.0, -2.5, 3.4, 3.9]:
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 1.2, -0.09))
            line = bpy.context.object
            line.name = 'survey marker'
            line.dimensions = (0.035, 11.5, 0.025)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            line.data.materials.append(glow)
    elif scene['motif'] == 'storm':
        for pos in [(-2.3, 1.4, 0.84), (-1.45, 3.1, 0.72), (3.0, -0.7, 0.7)]:
            import_model('crystal-cluster', pos[0], pos[1], pos[2], rng.uniform(-0.5, 0.5))
        add_storm_arc(glow, scene['seed'])
        # Storm crown: layered discs around the active array, kept away from text area.
        for radius, bevel in [(1.10, 0.035), (1.52, 0.018)]:
            bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=bevel, major_segments=64,
                minor_segments=8, location=(1.25, 5.3, 5.25), rotation=(0.1, 0.25, 0.15))
            ring = bpy.context.object
            ring.name = 'ion corona'
            ring.data.materials.append(glow)
    elif scene['motif'] == 'water':
        water = principled('cold channel', (0.055, 0.24, 0.29, 1), 0.24, 0.25)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 4.4, -0.10))
        channel = bpy.context.object
        channel.name = 'flood channel'
        channel.dimensions = (25, 5.2, 0.22)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        channel.data.materials.append(water)
        for x in [-7, -5.8, 6.4, 7.2]:
            bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=1.5, radius2=0.15, depth=3.6,
                location=(x, 4.1, 1.65))
            island = bpy.context.object
            island.name = 'channel island'
            island.scale.y = 1.3
            island.data.materials.append(mesa)
        for x in [-3.0, -1.8, 5.8]:
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 2.4, 0.02))
            ripple = bpy.context.object
            ripple.name = 'channel current'
            ripple.dimensions = (1.8, 0.035, 0.025)
            ripple.data.materials.append(glow)

    for i in range(scene['rocks']):
        x = rng.uniform(-8.4, 8.4)
        y = rng.uniform(-4.4, 7.7)
        if x < -3.2 and y < 3.6:
            continue  # retain the type-and-briefing text-safe left third
        radius = rng.uniform(0.12, 0.48)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius, location=(x, y, radius * 0.46 - 0.08))
        rock = bpy.context.object
        rock.name = 'scattered scree'
        rock.scale = (rng.uniform(0.7, 1.7), rng.uniform(0.7, 1.5), rng.uniform(0.55, 1.2))
        rock.rotation_euler[2] = rng.random() * math.tau
        rock.data.materials.append(mesa if i % 4 else ground)

    for model, x, y, s, yaw in scene['models']:
        import_model(model, x, y, s, yaw)

    if scene['motif'] in ('extraction', 'water'):
        # Soft landing pool lights make the extraction point readable without UI text.
        add_area('landing beacon', (3.4, -0.2, 3.1), (2.2, -1.8, 0), scene['sun'][:3], 1300, 3.0)

    world = bpy.data.worlds.new('theater atmosphere')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = scene['sky']
    bg.inputs['Strength'].default_value = 0.35

    # Large soft key, cool rim, and low front bounce create the game's carved, low-poly look.
    add_area('warm key', (-5, -7, 12), (1, 1, 0), scene['sun'][:3], 2100, 7.0)
    add_area('cool rim', (7, 6, 9), (2, 0, 0.5), scene['accent'][:3], 1650, 5.0)
    add_area('camera fill', (1, -10, 5), (1, 0, 0.8), (0.68, 0.83, 1.0), 600, 8.0)

    data = bpy.data.cameras.new('briefing camera')
    camera = bpy.data.objects.new('briefing camera', data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0.25, -15.5, 7.8)
    target = Vector((0.25, 1.55, 1.15))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = 11.4
    bpy.context.scene.camera = camera

    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x = W
    sc.render.resolution_y = H
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = 0.15
    sc.view_settings.gamma = 1.0
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.filepath = os.path.join(OUT_DIR, scene['file'].replace('.webp', '.png'))
    sc.render.resolution_percentage = 100
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = 8
    sc.world.color = scene['sky'][:3]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    selected = os.environ.get('CAMPAIGN_ART_ONLY')
    scenes = [item for item in SCENES if item['file'].removesuffix('.webp') == selected] if selected else SCENES
    if selected and not scenes:
        raise SystemExit(f'Unknown CAMPAIGN_ART_ONLY scene: {selected}')
    for scene in scenes:
        print('Rendering', scene['file'], flush=True)
        setup(scene)
        bpy.ops.render.render(write_still=True)
        print('Rendered', scene['file'], flush=True)


if __name__ == '__main__':
    main()
