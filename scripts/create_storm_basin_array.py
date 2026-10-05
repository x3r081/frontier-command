"""Build the Storm Basin's fractured ion weather array as a compact GLB.

Run with Blender 5.x in background mode. The exported model has no textures and
is consolidated to a handful of static meshes for low draw-call cost.
"""

import bpy
import math
from mathutils import Matrix, Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "models" / "storm-array.glb"


def material(name, color, metal=0.0, rough=0.7, emission=None, strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def cube(name, location, dimensions, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Broken machined edge", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        obj.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return obj


def cylinder(name, location, radius, depth, mat, vertices=8, radius_top=None):
    if radius_top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius_top,
                                        depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def beam(name, start, end, width, mat):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cube(name, (a + b) / 2, (width, width, delta.length), mat, width * 0.11)
    obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
    return obj


def build():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    palette = {
        "basalt": material("Storm basalt ceramic", (0.15, 0.14, 0.23), .28, .78),
        "alloy": material("Pale ion-weathered alloy", (0.43, 0.46, 0.58), .62, .43),
        "dark": material("Recessed graphite", (0.035, 0.043, 0.075), .42, .62),
        "ion": material("Ion glass", (0.30, 0.72, 0.95), .34, .24,
                        (0.11, 0.56, 1.0), 2.0),
        "violet": material("Storm charge", (0.67, 0.47, 1.0), .24, .25,
                           (0.35, 0.12, 1.0), 1.5),
    }
    # A low, fractured socket reads as an old industrial anchor fused into the
    # exposed rock. The alternating octagonal lips avoid a featureless disk.
    cylinder("Octagonal rock socket", (0, .19, 0), 1.08, .34, palette["basalt"], 8, .88)
    cylinder("Inset armored collar", (0, .39, 0), .77, .18, palette["alloy"], 8, .71)
    cylinder("Dark service well", (0, .50, 0), .52, .12, palette["dark"], 8, .44)
    for angle in range(0, 360, 60):
        r = math.radians(angle)
        x, z = math.cos(r) * .76, math.sin(r) * .76
        pad = cube("Collar locking lug", (x, .43, z), (.29, .16, .31), palette["alloy"], .035)
        pad.rotation_euler[1] = -r

    # The split, leaning mast is the primary silhouette: three armored forks
    # break around a narrow luminous core like a lightning-struck tuning fork.
    cylinder("Lower mast boot", (0, .86, 0), .36, .64, palette["dark"], 7, .25)
    core = cylinder("Tapered fractured mast", (0, 2.02, 0), .28, 2.12, palette["alloy"], 6, .13)
    core.rotation_euler[2] = math.radians(-5)
    cylinder("Inset ion spine", (0, 2.10, .245), .072, 1.76, palette["ion"], 6, .046)
    for side, yaw in [(-1, -18), (1, 16)]:
        start = (side * .16, 1.18, 0)
        end = (side * .76, 3.65, side * .12)
        beam("Forked lightning rail", start, end, .20, palette["basalt"])
        beam("Rail inner conductor", (start[0] * 1.01, 1.25, .11),
             (end[0] * .91, 3.38, end[2] + .11), .055, palette["violet"])
        shoulder = cube("Fork shoulder armor", (side * .43, 2.41, .08), (.32, .65, .34), palette["alloy"], .045)
        shoulder.rotation_euler[2] = math.radians(yaw)
    # A short rear fork makes the crown legible from the oblique camera and
    # leaves a visible triangular aperture through its center.
    beam("Rear tuning fork", (0, 1.47, -.13), (0, 3.92, -.74), .18, palette["dark"])
    beam("Rear fork conductor", (0, 2.0, -.21), (0, 3.66, -.64), .045, palette["ion"])
    cylinder("Crown ion node", (0, 3.85, 0), .22, .26, palette["violet"], 6)
    cylinder("Broken crown cap", (0, 4.17, 0), .31, .13, palette["alloy"], 6, .15)

    # Three angled grounding spurs are splayed around the base, kept inside a
    # compact footprint and visually separate from passable ground around it.
    for angle in [28, 148, 268]:
        r = math.radians(angle)
        end = (math.cos(r) * 1.0, .17, math.sin(r) * 1.0)
        beam("Grounding spur", (0, .66, 0), end, .17, palette["basalt"])
        x, z = math.cos(r) * .78, math.sin(r) * .78
        cube("Spur ion marker", (x, .22, z), (.18, .045, .12), palette["ion"], .012)

    # A few non-emissive strike plates give the silhouette an irregular edge.
    shard = cylinder("Fractured vane A", (-.88, 1.02, .17), .22, .72, palette["alloy"], 5, .04)
    shard.rotation_euler[2] = math.radians(18)
    shard.rotation_euler[0] = math.radians(24)
    shard = cylinder("Fractured vane B", (.85, .81, -.20), .17, .58, palette["basalt"], 5, .025)
    shard.rotation_euler[2] = math.radians(-23)
    shard.rotation_euler[0] = math.radians(-28)

    # Geometry above is authored in the game's Y-up convention. Rotate it into
    # Blender's Z-up coordinates before glTF applies its standard Y-up export.
    y_up_to_blender = Matrix.Rotation(math.pi / 2, 4, 'X')
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.matrix_world = y_up_to_blender @ obj.matrix_world

    # Blender's default cube has its origin at center; translate the entire
    # asset up just enough that its lowest spur sits on ground level.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.location.z += 0.07

    # Bake modifiers and merge static parts by material: five mesh draws.
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    groups = {}
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            groups.setdefault(obj.data.materials[0].name, []).append(obj)
    for objects in groups.values():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=True)
    print(f"EXPORTED {OUT} ({OUT.stat().st_size} bytes)")


build()
