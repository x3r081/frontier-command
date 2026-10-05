#!/usr/bin/env python3
"""Render a static 16:9 Frontier Command title image from the shipped GLBs.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create-title-hero.py
"""

import math
import os
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "public", "assets", "models")
OUTPUT = os.path.join(ROOT, "public", "assets", "title-hero-cinematic-v2.webp")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def mat(name, color, metallic=0.0, roughness=0.8, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


def make_sediment_material():
    material = bpy.data.materials.new("World-space alluvial sediment")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.96
    tex = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.34
    noise.inputs["Detail"].default_value = 3.0
    noise.inputs["Roughness"].default_value = 0.67
    links.new(tex.outputs["Object"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    ramp.color_ramp.elements[0].position = 0.22
    ramp.color_ramp.elements[0].color = (0.22, 0.28, 0.25, 1)
    mid = ramp.color_ramp.elements.new(0.49)
    mid.color = (0.39, 0.41, 0.32, 1)
    high = ramp.color_ramp.elements.new(0.78)
    high.color = (0.50, 0.43, 0.31, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    # Leave the left third legible under title copy while preserving ground
    # texture; the falloff finishes before the command-yard focal group.
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tex.outputs["Object"], separate.inputs["Vector"])
    x_ramp = nodes.new("ShaderNodeValToRGB")
    x_ramp.color_ramp.elements[0].position = -25.0
    x_ramp.color_ramp.elements[0].color = (0.16, 0.22, 0.22, 1)
    x_ramp.color_ramp.elements[1].position = 0.0
    x_ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    links.new(separate.outputs["X"], x_ramp.inputs["Fac"])
    color_mix = nodes.new("ShaderNodeMixRGB")
    color_mix.blend_type = "MULTIPLY"
    color_mix.inputs["Fac"].default_value = 1.0
    links.new(ramp.outputs["Color"], color_mix.inputs["Color1"])
    links.new(x_ramp.outputs["Color"], color_mix.inputs["Color2"])
    links.new(color_mix.outputs["Color"], bsdf.inputs["Base Color"])
    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 3.8
    fine.inputs["Detail"].default_value = 2.0
    fine.inputs["Roughness"].default_value = 0.65
    links.new(tex.outputs["Object"], fine.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.11
    bump.inputs["Distance"].default_value = 0.045
    links.new(fine.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return material


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name, location, power, size, color, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, target)
    return obj


def import_model(name, location, target_width, yaw=0.0):
    path = os.path.join(MODELS, name + ".glb")
    bpy.ops.import_scene.gltf(filepath=path)
    imported = list(bpy.context.selected_objects)
    root = bpy.data.objects.new(name + " composition", None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        obj.parent = root
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(corner) for obj in imported
               if obj.type == "MESH" for corner in obj.bound_box]
    low = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    high = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    dimensions = high - low
    scale = target_width / max(dimensions.x, dimensions.y)
    root.scale = (scale, scale, scale)
    root.rotation_euler.z = yaw
    root.location = location
    bpy.context.view_layer.update()
    # Imported GLBs have a small ground-origin offset; place their lowest point
    # flush with the diorama after applying the composition scale and yaw.
    corners = [obj.matrix_world @ Vector(corner) for obj in imported
               if obj.type == "MESH" for corner in obj.bound_box]
    min_z = min(v.z for v in corners)
    root.location.z -= min_z
    return root


def add_cube(name, location, scale, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new("Soft-cut edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj


def add_ribbon(name, points, width, material):
    verts, faces = [], []
    for i, (x, y, z) in enumerate(points):
        before = Vector(points[max(0, i - 1)][:2])
        after = Vector(points[min(len(points) - 1, i + 1)][:2])
        tangent = (after - before).normalized()
        side = Vector((-tangent.y, tangent.x)) * (width * 0.5)
        verts.extend([(x + side.x, y + side.y, z), (x - side.x, y - side.y, z)])
    for i in range(len(points) - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    road = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(road)
    return road


def add_terrain(material):
    # Broad, low-relief alluvial terrain with flat-shaded facets; its horizon
    # continues behind the composition instead of ending as a tabletop slab.
    nx, ny, step = 54, 70, 1.0
    x0, y0 = -27.0, -19.0
    verts, faces = [], []
    for j in range(ny + 1):
        y = y0 + j * step
        for i in range(nx + 1):
            x = x0 + i * step
            broad = (math.sin(x * 0.105 + y * 0.035) * 0.38 +
                     math.sin(y * 0.16 - x * 0.035) * 0.28 +
                     math.sin(x * 0.035 + y * 0.08) * 0.30)
            # Keep the active base pads calm and level while relief rises around
            # them into shallow wind-cut swales at either edge of the seam.
            pad_mask = min(1.0, max(0.0, (abs(x - 6.5) - 4.0) / 4.0))
            z = -0.02 + broad * pad_mask
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            b, c, d = a + 1, a + nx + 1, a + nx + 2
            if (i + j) % 2:
                faces.extend([(a, b, c), (b, d, c)])
            else:
                faces.extend([(a, b, d), (a, d, c)])
    mesh = bpy.data.meshes.new("Faceted alluvial field")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(material)
    ground = bpy.data.objects.new("Continuous alluvial battlefield", mesh)
    bpy.context.collection.objects.link(ground)
    for poly in mesh.polygons:
        poly.use_smooth = False
    return ground


def add_mesa(name, cx, cy, rx, ry, height, seed, materials):
    segments = 14
    verts, faces = [], []
    # Broad shoulders create layered mesa silhouettes instead of a sheer wall.
    ring_scales = (1.0, 1.08, 0.91, 0.72)
    levels = (0.0, height * 0.18, height * 0.70, height)
    noise = []
    for i in range(segments):
        angle = math.tau * i / segments
        wobble = 1.0 + 0.065 * math.sin(i * 2.71 + seed) + 0.035 * math.cos(i * 4.13 - seed)
        crest = 0.14 * height * math.sin(i * 2.37 + seed) + 0.055 * height * math.cos(i * 3.11)
        noise.append((wobble, crest))
    for ring, (scale, level) in enumerate(zip(ring_scales, levels)):
        for i in range(segments):
            angle = math.tau * i / segments
            wobble, crest = noise[i]
            z = level + (crest if ring == 3 else crest * ring * 0.07)
            verts.append((cx + math.cos(angle) * rx * scale * wobble,
                          cy + math.sin(angle) * ry * scale * wobble, z))
    for ring in range(3):
        for i in range(segments):
            a = ring * segments + i
            b = ring * segments + (i + 1) % segments
            c = (ring + 1) * segments + i
            d = (ring + 1) * segments + (i + 1) % segments
            faces.extend([(a, b, c), (b, d, c)])
    top_center = len(verts)
    verts.append((cx, cy, height * 0.91))
    for i in range(segments):
        faces.append((top_center, 3 * segments + i, 3 * segments + (i + 1) % segments))
    mesh = bpy.data.meshes.new(name + " faceted strata")
    mesh.from_pydata(verts, [], faces)
    for material in materials:
        mesh.materials.append(material)
    mesa = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(mesa)
    for poly in mesh.polygons:
        # Warm mineral cuts alternate with cool shadow faces to echo the
        # battlefield's basalt palette and give the skyline readable planes.
        index = int((poly.index * 7 + seed * 3) % 13)
        poly.material_index = 1 if index < 7 else 0 if index < 11 else 2
    return mesa


def add_backdrop():
    mesh = bpy.data.meshes.new("Theater sky sweep")
    mesh.from_pydata([(-90, 60, -20), (90, 60, -20), (90, 60, 120), (-90, 60, 120)],
                     [], [(0, 1, 2, 3)])
    sky = bpy.data.objects.new("Layered storm dawn", mesh)
    bpy.context.collection.objects.link(sky)
    material = bpy.data.materials.new("Deep teal to ion dawn")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.2
    tex = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tex.outputs["Generated"], separate.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.018, 0.045, 0.072, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.22, 0.30, 0.35, 1)
    mid = ramp.color_ramp.elements.new(0.62)
    mid.color = (0.42, 0.22, 0.12, 1)
    links.new(separate.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    mesh.materials.append(material)
    return sky


def add_ion_seam(points, material):
    add_ribbon("Luminous crystal fracture", [(x, y, 0.055) for x, y in points], 0.18, material)
    curve = bpy.data.curves.new("Ion fracture core", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.035
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, (x, y) in zip(spline.points, points):
        point.co = (x, y, 0.095, 1)
    obj = bpy.data.objects.new("Ion fracture light", curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)


def add_island(materials):
    # A layered, chipped basalt edge gives the scene the cutaway silhouette
    # used by the isometric game view, while keeping a large quiet copy area.
    outline = [(-12.8, -7.7), (-11.2, -10.1), (-7.0, -10.7), (-3.8, -9.9),
               (-0.2, -10.9), (3.5, -10.2), (8.1, -10.5), (12.1, -8.2),
               (12.8, -4.8), (11.8, -1.8), (12.4, 2.2), (10.6, 6.8),
               (7.2, 9.5), (2.9, 10.1), (-1.4, 9.2), (-5.6, 10.1),
               (-9.8, 8.0), (-12.5, 4.8), (-11.8, 1.4), (-13.0, -2.4)]
    n = len(outline)
    verts = [(x, y, z) for z in (-0.58, 0.0) for x, y in outline]
    faces = [tuple(range(n, 2*n)), tuple(reversed(range(n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n+j, n+i))
    mesh = bpy.data.meshes.new("Chipped diorama rim")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(materials["sand"])
    mesh.materials.append(materials["edge"])
    mesh.polygons[0].material_index = 0
    island = bpy.data.objects.new("Layered alluvial island", mesh)
    bpy.context.collection.objects.link(island)
    bevel = island.modifiers.new("Broken strata highlights", "BEVEL")
    bevel.width = 0.16
    bevel.segments = 1
    island.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")

    # A bent alluvial track gives the vehicles a readable route into the base;
    # its smooth ribbon echoes the game's world-space sediment forms.
    points = [(1.2, -8.7, 0.018), (3.0, -7.6, 0.018), (4.3, -6.4, 0.018),
              (4.6, -5.0, 0.018), (3.9, -3.5, 0.018), (3.8, -1.4, 0.018),
              (4.4, 0.4, 0.018), (5.1, 1.6, 0.018)]
    add_ribbon("Silted approach ribbon", points, 1.4, materials["shelf"])


def main():
    clear_scene()
    ground = make_sediment_material()
    add_terrain(ground)
    mesa_dark = mat("Basalt shadow strata", (0.055, 0.092, 0.102), metallic=0.05, roughness=0.94)
    mesa_mid = mat("Blue slate strata", (0.12, 0.19, 0.19), metallic=0.04, roughness=0.9)
    mesa_warm = mat("Rust lit strata", (0.29, 0.17, 0.105), roughness=0.94)
    mesas = [mesa_dark, mesa_mid, mesa_warm]
    # Layered mesas establish a broad game-world horizon. Their bases overlap
    # behind one another, while their warm upper faces catch the dawn key.
    add_mesa("Copy-side distant mesa", -25, 30, 5.0, 5.6, 4.2, 7, mesas)
    add_mesa("North shelf mesa", -13.5, 33, 5.4, 6.0, 5.2, 13, mesas)
    add_mesa("Central escarpment", -0.8, 35, 5.5, 6.2, 4.4, 23, mesas)
    add_mesa("Ion ridge mesa", 13.4, 31, 5.6, 6.4, 5.8, 31, mesas)
    add_mesa("Eastern crown mesa", 26, 28.0, 4.8, 6.0, 4.8, 39, mesas)
    add_backdrop()

    track = mat("Pale mineral convoy track", (0.30, 0.235, 0.15), roughness=0.98)
    add_ribbon("Convoy road through the basin", [
        (-5.0, -13.0, 0.025), (-3.5, -10.0, 0.025), (-1.0, -7.6, 0.025),
        (2.2, -5.6, 0.025), (5.2, -3.0, 0.025), (7.5, 0.2, 0.025),
        (10.1, 3.0, 0.025), (13.4, 5.7, 0.025), (17.4, 7.0, 0.025),
    ], 1.8, track)
    import_model("command-yard", (9.1, 5.0, 0), 5.6, yaw=-0.25)
    import_model("aegis-heavy-tank-game", (8.3, -1.1, 0), 3.8, yaw=0.18)
    import_model("striker-tank", (4.8, -4.3, 0), 3.0, yaw=-0.5)
    import_model("recon-buggy", (2.0, -8.1, 0), 2.7, yaw=-0.4)
    import_model("stealth-tank", (14.1, -2.8, 0), 3.0, yaw=2.8)
    import_model("vesper-recon-buggy", (13.0, 0.7, 0), 2.3, yaw=2.2)
    import_model("flamer", (6.6, -1.8, 0), 1.0, yaw=-0.1)
    import_model("rocket-infantry", (11.5, -0.4, 0), 1.0, yaw=2.7)
    import_model("scout", (3.4, -2.3, 0), 0.88, yaw=-0.55)
    import_model("vesper-scout", (16.1, 2.0, 0), 0.9, yaw=2.7)

    # The crystal fracture cuts through the active frontline and climbs toward
    # the command yard. A few separated clusters preserve a readable seam.
    ion = mat("Ion seam core", (0.025, 0.42, 0.56), roughness=0.3,
              emission=(0.03, 0.56, 0.8), strength=4.0)
    seam = [(-2.4, -12.0), (0.2, -9.1), (2.0, -6.2), (4.0, -3.4),
            (6.8, -0.6), (8.7, 2.1), (11.2, 4.6), (14.4, 6.7)]
    add_ion_seam(seam, ion)
    for cx, cy, width, yaw in [
        (-0.2, -9.6, 2.5, 0.3), (3.0, -5.4, 2.5, 2.1), (6.5, -1.2, 2.8, 1.2),
        (10.2, 3.6, 2.6, 2.1), (14.0, 7.0, 2.8, 0.1), (17.0, 9.1, 2.2, 1.3),
    ]:
        import_model("crystal-cluster", (cx, cy, 0), width, yaw=yaw)
    import_model("basalt-spires", (19.4, -8.5, 0), 6.7, yaw=0.3)
    import_model("collapsed-comms-mast", (-2.4, 6.2, 0), 3.2, yaw=0.3)

    # Distant convoys and muzzle-flash colored light punctuate the broad vista
    # without adding legible UI-like marks or obscuring the title-safe left.
    import_model("apc", (-3.0, 4.5, 0), 2.7, yaw=0.7)
    import_model("vesper-recon-buggy", (17.6, 1.3, 0), 2.0, yaw=2.4)

    world = bpy.data.worlds.new("Deep frontier atmosphere")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.12, 0.17, 0.20, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.58
    bpy.context.scene.world = world

    target = (4.2, 1.0, 1.0)
    add_area("Warm stormbreak key", (-11, -9, 25), 3900, 17, (1.0, 0.68, 0.40), target)
    add_area("Cool crystal fill", (17, -1, 18), 2900, 12, (0.22, 0.66, 0.82), (8, 1, 0))
    add_area("Ion ridge rim", (5, 16, 22), 3900, 13, (0.38, 0.79, 0.86), (8, 5, 2))
    add_area("Copy-side low fill", (-17, -2, 12), 180, 16, (0.15, 0.32, 0.35), (-8, 0, 0))

    camera_data = bpy.data.cameras.new("TitleHeroCamera")
    camera = bpy.data.objects.new("TitleHeroCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.8, -31.0, 20.0)
    aim(camera, (3.8, 4.6, 2.8))
    camera_data.type = "PERSP"
    camera_data.lens = 35
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 96
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.quality = 92
    scene.render.filepath = OUTPUT
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.camera.data.lens = 50
    scene.world.color = (0.045, 0.055, 0.075)
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = OUTPUT
    bpy.ops.render.render(write_still=True)
    print("TITLE_HERO", OUTPUT, os.path.getsize(OUTPUT))


if __name__ == "__main__":
    main()
