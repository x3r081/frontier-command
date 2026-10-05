"""Create a hand-authored low-poly crash-site landmark for the battlefield.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/create_crashed_dropship.py
"""
import bpy
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "models" / "crashed-dropship.glb"


def material(name, color, metal=0.0, rough=0.65, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def bevel(obj, amount=0.035):
    mod = obj.modifiers.new("Scuffed armor edges", "BEVEL")
    mod.width = amount
    mod.segments = 1
    obj.modifiers.new("Weighted armor normals", "WEIGHTED_NORMAL")
    return obj


def cube(name, loc, size, mat, bevel_size=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel_size:
        bevel(obj, bevel_size)
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=10, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                         location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def beam(name, start, end, width, depth, mat):
    from mathutils import Vector
    a, b = Vector(start), Vector(end)
    obj = cube(name, (a + b) * 0.5, (width, depth, (b - a).length), mat)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = (b - a).to_track_quat("Z", "Y")
    return obj


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)

    armor = material("Dust worn pale alloy", (0.39, 0.49, 0.48), .52, .48)
    edge = material("Bright torn metal", (.72, .76, .66), .67, .37)
    shadow = material("Burnt graphite", (.045, .075, .078), .46, .72)
    rust = material("Oxidized copper", (.42, .20, .10), .43, .73)
    glass = material("Cracked cockpit glass", (.075, .31, .35), .53, .2, (.015, .11, .13), .32)
    signal = material("Fading signal lamp", (.11, .79, .73), .2, .24, (.03, .48, .39), 1.35)
    hazard = material("Old safety amber", (.83, .42, .095), .18, .57)

    # The broken hull is laid on its starboard side. Its skew and the torn nose
    # make the silhouette read as a wreck at the tactical camera's distance.
    cube("Crashed transport keel", (0, .10, .37), (1.08, 3.45, .58), shadow, .12,
         rotation=(0.035, 0, -.10))
    cube("Bent lower hull plating", (.01, .06, .63), (1.15, 2.50, .40), armor, .10,
         rotation=(.025, .02, -.10))
    cube("Raised aft fuselage", (-.04, .87, .94), (.92, 1.05, .77), armor, .12,
         rotation=(.06, .03, -.12))
    # Cockpit brow and surviving angled windshield.
    cube("Armored cockpit brow", (-.01, -1.20, .91), (.91, .66, .32), edge, .09,
         rotation=(.12, .03, -.12))
    cube("Tinted cockpit glazing", (.0, -1.50, .79), (.68, .30, .31), glass, .055,
         rotation=(.26, .02, -.12))
    for x in (-.25, .25):
        cube("Cockpit frame mullion", (x, -1.515, .80), (.045, .32, .34), shadow, .012,
             rotation=(.26, .02, -.12))

    # One intact lifting wing and one sheared wing with its exposed spar.
    cube("Port wing root", (-.82, -.36, .69), (1.20, .52, .20), armor, .055,
         rotation=(0, .025, -.05))
    cube("Port wing broken tip", (-1.65, -.12, .53), (.86, .43, .17), edge, .045,
         rotation=(.08, -.08, .25))
    cube("Starboard torn wing root", (.81, -.39, .62), (.82, .49, .18), armor, .045,
         rotation=(.05, .04, -.13))
    beam("Exposed wing spar", (1.0, -.46, .60), (1.82, -.82, .48), .085, .09, rust)
    for i in range(4):
        x = 1.22 + i * .18
        cube("Jagged wing ribs", (x, -.63 + i * .035, .55), (.055, .31, .075), edge, .012,
             rotation=(0, 0, -.34))

    # Two compact lift pods survive at different angles; their dark mouths and
    # chipped rings add strong dark/light breaks against the hull.
    for side, y, tilt in ((-1, .05, .12), (1, .37, -.22)):
        x = side * 1.12
        pod = cylinder("Broken lift nacelle", (x, y, .72), .34, .72, shadow, 10,
                       rotation=(math.pi / 2 + tilt, 0, 0))
        cylinder("Nacelle armored lip", (x, y - .36, .72), .29, .12, edge, 10,
                 rotation=(math.pi / 2 + tilt, 0, 0))
        cylinder("Nacelle dark turbine", (x, y - .43, .72), .205, .035, rust, 8,
                 rotation=(math.pi / 2 + tilt, 0, 0))
        for blade in range(5):
            angle = math.tau * blade / 5
            cube("Turbine fan blade", (x + math.cos(angle) * .095, y - .455,
                 .72 + math.sin(angle) * .095), (.16, .025, .038), shadow, .008,
                 rotation=(0, angle, 0))

    # The tail has sheared away, leaving a canted fin and a torn spar.
    cube("Collapsed tail fin", (-.15, 1.56, .90), (.17, .54, .60), armor, .045,
         rotation=(.10, .18, -.24))
    beam("Snapped tail spar", (-.16, 1.55, .66), (.49, 2.12, .27), .105, .10, edge)
    cube("Detached tail fragment", (.70, 2.04, .17), (.58, .19, .12), shadow, .02,
         rotation=(.04, .1, .34))

    # Open side panels expose the rib cage and spent power cell.
    cube("Ruptured equipment bay", (-.58, .48, .65), (.12, .90, .48), shadow, .025,
         rotation=(.10, 0, -.13))
    for i in range(5):
        yy = .08 + i * .17
        beam("Exposed hull ribs", (-.55, yy, .48), (-.62, yy + .09, .90), .055, .055,
             edge if i % 2 else rust)
    cylinder("Cracked power cell", (-.67, .50, .58), .16, .44, hazard, 8,
             rotation=(0, math.pi / 2, .13))
    cylinder("Faint reactor indicator", (-.91, .50, .58), .075, .025, signal, 8,
             rotation=(0, math.pi / 2, 0))
    # Surface panels, maintenance hatches, and a few amber warning blocks.
    for i, y in enumerate((-.47, .17, .82, 1.13)):
        cube("Dorsal access plate", (.18, y, 1.255 if y < .7 else 1.32),
             (.32, .26, .045), edge if i % 2 == 0 else armor, .018,
             rotation=(.015, .0, -.1))
    for x in (-.42, .42):
        cube("Hazard stripe plate", (x, -.88, .90), (.12, .26, .055), hazard, .012,
             rotation=(0, 0, -.12))
    for x, y in ((-.70, -1.33), (.68, -.96), (-.77, 1.05), (.78, 1.37)):
        cylinder("Broken running light", (x, y, .61), .075, .09, signal, 6)

    # Scattered shards stay tight to the wreck so the prop has a grounded edge.
    for i, (x, y, angle) in enumerate(((-1.55, -.93, .3), (1.56, .65, -.4),
                                       (-.94, 1.82, .5), (.96, -1.58, -.6))):
        cube("Hull debris shard", (x, y, .08), (.43, .16, .13), rust if i % 2 else armor,
             .018, rotation=(0, 0, angle))

    # Bake edge modifiers and join by material: the landmark stays at seven
    # mesh draws instead of one draw for every authored plate and rib.
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    materials = list(bpy.data.materials)
    for material_block in materials:
        members = [obj for obj in bpy.context.scene.objects
                   if obj.type == "MESH" and len(obj.data.materials) == 1
                   and obj.data.materials[0] == material_block]
        if len(members) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        bpy.ops.object.join()
        members[0].name = "Wreck " + material_block.name

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB",
                              use_selection=True, export_apply=True)
    print("EXPORTED", OUT)


if __name__ == "__main__":
    main()
