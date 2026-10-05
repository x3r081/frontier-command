"""Author a compact tracked siege-engine wreck for Shard Valley.

Run with Blender 5.x in background mode:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/create_track_wreck.py

The mesh is static and texture-free, with material groups kept small for
instanced use in the terrain renderer. Dimensions are authored in game tiles.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "models" / "shard-track-wreck.glb"


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def material(name, color, metal=0.0, rough=0.78, emission=None, strength=0.0):
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


def cube(name, loc, dims, mat, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Sheared armor edge", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=9, rotation=(0, 0, 0), radius_top=None):
    if radius_top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                            location=loc, rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius_top,
                                        depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def beam(name, start, end, width, depth, mat, bevel=0.0):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cube(name, (a + b) * 0.5, (width, depth, delta.length), mat, bevel)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    return obj


def join_by_material():
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.update()
    min_z = min((obj.matrix_world @ vertex.co).z
                for obj in bpy.context.scene.objects if obj.type == "MESH"
                for vertex in obj.data.vertices)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.location.z -= min_z
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
    bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True,
                              export_apply=True)
    print(f"EXPORTED {OUT} ({OUT.stat().st_size} bytes, {len(groups)} material groups)")


def build():
    reset()
    track = material("Soot-dark track armor", (.075, .095, .10), .40, .83)
    hull = material("Dust-scoured field armor", (.34, .31, .23), .53, .72)
    exposed = material("Scorched inner frame", (.16, .13, .10), .38, .89)
    signal = material("Dying amber reactor glass", (.96, .29, .055), .16, .3,
                      (.9, .105, .008), .65)

    # Twin low caterpillar pods and exposed road wheels establish a ground
    # vehicle silhouette distinct from the existing airborne dropship wreck.
    for side in (-1, 1):
        x = side * .93
        cube("Broken track pod", (x, 0, .39), (.53, 1.92, .72), track, .12,
             rotation=(0, 0, side * -.035))
        for i, y in enumerate((-.65, -.20, .27, .68)):
            wheel = cylinder("Road wheel", (x + side * .275, y, .36), .205, .08,
                             exposed, 10, rotation=(0, math.pi / 2, 0))
            if i in (0, 3):
                cylinder("Drive hub", (x + side * .325, y, .36), .085, .025,
                         hull, 8, rotation=(0, math.pi / 2, 0))
        # A short run of raised cleats catches light along the outside edge.
        for y in (-.72, -.24, .24, .72):
            cube("Track grouser", (x + side * .275, y, .69), (.055, .25, .09),
                 hull, .018, rotation=(0, 0, side * .04))

    # The hull has a caved-in nose and an open rear deck. Raised armor is
    # irregularly angled, with a narrow orange reactor vent as the focal cue.
    cube("Main hull belly", (0, .02, .66), (1.52, 1.64, .48), exposed, .11,
         rotation=(0, 0, -.025))
    cube("Forward glacis", (-.04, -.50, .91), (1.50, .64, .36), hull, .09,
         rotation=(0, .08, -.045))
    cube("Raised rear armor", (.04, .62, .98), (1.12, .54, .31), hull, .07,
         rotation=(.02, -.11, .035))
    cube("Broken turret ring", (.02, .01, 1.05), (.84, .77, .19), track, .065,
         rotation=(0, .02, .06))
    cube("Buckled turret plate", (-.12, .13, 1.20), (.78, .65, .23), hull, .07,
         rotation=(.06, -.10, -.09))
    cube("Reactor vent recess", (-.13, -.018, 1.325), (.42, .33, .035), exposed, .025,
         rotation=(.06, -.10, -.09))
    for x in (-.24, -.13, -.02):
        cube("Reactor vent slat", (x, -.018, 1.35), (.045, .26, .035), signal, .008,
             rotation=(.06, -.10, -.09))

    # The cannon is snapped at the mantlet: a bent remnant points down and a
    # severed barrel section rests on the ground beside the vehicle.
    cube("Gun mantlet", (.02, -.46, 1.18), (.44, .34, .31), exposed, .07,
         rotation=(.14, .06, .035))
    beam("Snapped gun stump", (.05, -.60, 1.20), (.34, -1.04, .99), .16, .17,
         hull, .025)
    beam("Severed barrel on ground", (1.02, -.15, .16), (1.45, -.92, .13), .13, .13,
         exposed, .018)
    cylinder("Barrel break collar", (1.46, -.93, .13), .09, .16, hull, 8,
             rotation=(math.pi / 2, 0, -.49))
    # A torn side plate exposes the rear framework and gives the profile a
    # jagged break without adding a tall vertical shape.
    beam("Ripped side fender", (.77, .22, .92), (1.23, .42, .48), .18, .16,
         hull, .022)
    for x, y, angle in [(-.50, .91, .24), (.52, -.87, -.18), (-.67, -.38, .12)]:
        plate = cube("Scattered armor shard", (x, y, .11), (.42, .25, .12), hull, .025)
        plate.rotation_euler[1] = angle

    join_by_material()


if __name__ == "__main__":
    build()
