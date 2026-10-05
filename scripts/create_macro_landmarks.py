"""Generate a compact three-piece battlefield landmark kit with Blender 5.x.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/create_macro_landmarks.py

Each GLB is static, texture-free, grounded at the local origin, and consolidated
to three material meshes so the renderer can instance the landmarks cheaply.
Dimensions are authored in game tiles (1 Blender unit = 1 battlefield tile).
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "models"
OUT.mkdir(parents=True, exist_ok=True)


def reset():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def material(name, color, metal=0.0, rough=0.72, emission=None, strength=0.0):
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
        mod = obj.modifiers.new("Worn hard edges", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=8, rotation=(0, 0, 0), radius_top=None):
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


def wedge(name, center, footprint, height, mat, seed=0):
    """A broad, intentionally faceted rock tooth with a skewed summit."""
    x, y, z = center
    sx, sy = footprint
    points = [
        (-.50, -.46), (.36, -.50), (.53, -.10), (.43, .44),
        (-.28, .51), (-.53, .13),
    ]
    angle = seed * 1.71
    ca, sa = math.cos(angle), math.sin(angle)
    lower = [(x + px*sx, y + py*sy, z) for px, py in points]
    upper = []
    for i, (px, py) in enumerate(points):
        scale = (0.61 if i in (0, 3) else 0.74) * (1 + 0.035 * math.sin(seed*4 + i*2.1))
        rx, ry = px*sx*scale, py*sy*scale
        upper.append((x + rx*ca - ry*sa + (seed % 2)*.10,
                      y + rx*sa + ry*ca - .06,
                      z + height*(0.90 + .10*math.sin(seed + i*1.7))))
    verts = lower + upper
    faces = [tuple(reversed(range(6))), tuple(range(6, 12))]
    faces += [(i, (i+1) % 6, (i+1) % 6 + 6, i+6) for i in range(6)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def join_by_material(filename):
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Keep ground contact explicit after export. A tilted broken part can
    # otherwise leave a small negative extent and sink the cluster in-game.
    bpy.context.view_layer.update()
    min_z = min((obj.matrix_world @ vertex.co).z
                for obj in bpy.context.scene.objects if obj.type == "MESH"
                for vertex in obj.data.vertices)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.location.z -= min_z
    bpy.context.view_layer.update()
    groups = {}
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            if len(obj.data.materials) != 1:
                raise RuntimeError(f"{obj.name} must have exactly one material")
            groups.setdefault(obj.data.materials[0].name, []).append(obj)
    for objects in groups.values():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        bpy.context.object.name = f"{filename.removesuffix('.glb')} | {objects[0].data.materials[0].name}"
    bpy.ops.object.select_all(action="SELECT")
    path = OUT / filename
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_apply=True)
    print(f"EXPORTED {path} {path.stat().st_size} bytes, {len(groups)} mesh/material groups")


def twin_pass_gate():
    reset()
    stone = material("Pass shale", (.29, .35, .37), .04, .93)
    dark = material("Shadowed gate steel", (.075, .12, .135), .48, .58)
    amber = material("Warm hazard enamel", (.91, .43, .105), .24, .58,
                     (.34, .075, .006), .32)
    # Restrained shale shoulders frame a deliberately wide, unobstructed route.
    # They remain inside the same 4.18 x 1.81 tile footprint as the first pass.
    wedge("West pass shoulder", (-1.48, .02, 0), (1.08, 1.56), 2.22, stone, 1)
    wedge("East pass shoulder", (1.47, .015, 0), (1.12, 1.52), 2.05, stone, 4)
    wedge("Broken upper shoulder", (-1.34, .18, 1.72), (.98, 1.18), 1.12, stone, 2)
    # A dark, squared industrial frame separates the gate silhouette from the
    # surrounding rock field even when viewed at the game's 1x command zoom.
    for x in (-1.23, 1.23):
        cube("Gate upright", (x, -.43, 1.28), (.34, .35, 2.48), dark, .035,
             rotation=(0, 0, -.035 if x < 0 else .035))
        cube("Amber upright face", (x, -.625, 1.52), (.20, .045, .77), amber, .012,
             rotation=(0, 0, -.035 if x < 0 else .035))
        cube("Gate crown cap", (x, -.43, 2.57), (.53, .54, .22), amber, .022)
        # Top-facing inset plates read clearly from the steep tactical camera.
        cube("Top service plate", (x, -.43, 2.696), (.36, .36, .035), dark, .008)
    # Two heavy lintel arms leave a visible central fracture but still read as
    # one high arch at strategic scale. Their amber tips carry the warm cue.
    cube("West lintel arm", (-.73, -.43, 2.48), (1.04, .42, .31), dark, .03,
         rotation=(0, 0, -.035))
    cube("East lintel arm", (.73, -.43, 2.48), (1.04, .42, .31), dark, .03,
         rotation=(0, 0, .035))
    cube("West lintel hazard tip", (-.23, -.655, 2.48), (.22, .055, .24), amber, .01)
    cube("East lintel hazard tip", (.23, -.655, 2.48), (.22, .055, .24), amber, .01)
    # A thin broken tie behind the opening and two foot plates add depth without
    # filling the arch or widening the ground footprint.
    beam("Rear snapped tie", (-1.10, .32, 2.13), (-.28, .32, 2.46), .11, .13, dark)
    for x in (-1.23, 1.23):
        cube("Gate footing", (x, -.32, .16), (.75, .82, .30), dark, .04)
        cube("Footing enamel", (x, -.742, .19), (.34, .06, .12), amber, .01)
    join_by_material("landmark-twin-pass-gate.glb")


def delta_spillway():
    reset()
    concrete = material("Floodworn concrete", (.33, .43, .42), .12, .86)
    dark = material("Sluice interior", (.075, .16, .18), .32, .67)
    rust = material("Oxidized warning alloy", (.72, .35, .14), .42, .62)
    # Long, low sill with two separated banks preserves the strong channel void.
    cube("North spillway footing", (0, -1.04, .17), (3.72, .92, .34), concrete, .09)
    cube("South spillway footing", (0, 1.02, .17), (3.72, .86, .34), concrete, .09)
    for x in (-1.36, 1.36):
        cube("Gatehouse pier", (x, -.71, .78), (.62, .72, 1.36), concrete, .075,
             rotation=(0, 0, (1 if x < 0 else -1)*.045))
        cube("Pier dark recess", (x, -.31, .78), (.36, .08, .73), dark, .018)
        cube("Pier cap", (x, -.71, 1.53), (.82, .88, .19), rust, .035)
        cylinder("Gate wheel housing", (x, -.16, 1.15), .24, .16, dark, 8,
                 rotation=(math.pi/2, 0, 0))
    # Snapped gate panels and a sheared cross-beam tell a clear flood-damage story.
    cube("Raised floodgate panel", (-.74, -.57, .80), (.78, .18, 1.05), dark, .035,
         rotation=(0, -.08, -.12))
    cube("Fallen floodgate panel", (.73, -.20, .31), (.90, .20, .49), rust, .035,
         rotation=(0, .19, .29))
    beam("Broken spillway crossbeam", (-1.30, -.59, 1.63), (.47, -.56, 1.90), .20, .23,
         rust, .025)
    beam("Bent downstream brace", (1.08, -.51, .54), (1.67, -.02, .30), .12, .15,
         concrete, .01)
    # Short deck fragments sit at the ends, leaving a visible through-channel from above.
    for x, y, angle in [(-1.54, 1.18, .05), (1.51, 1.16, -.14), (-1.39, -1.39, .1)]:
        cube("Loose sluice deck plate", (x, y, .42), (.78, .35, .11), rust, .02,
             rotation=(0, angle, .03))
    join_by_material("landmark-delta-spillway.glb")


def canyon_ore_hoist():
    reset()
    armor = material("Quarry graphite", (.19, .25, .26), .51, .62)
    worn = material("Dusty hoist steel", (.56, .48, .34), .58, .53)
    signal = material("Amber hazard enamel", (.87, .43, .12), .22, .55,
                      (.48, .12, .015), .45)
    # A tall, asymmetric A-frame and tilted cable wheel give a strong industrial skyline.
    for x, ztop in [(-1.08, 3.18), (1.02, 2.78)]:
        beam("Hoist tower leg", (x, .08, .24), (x*.78, -.02, ztop), .27, .34, armor, .025)
        cube("Leg anchor shoe", (x, .08, .22), (.73, .83, .34), worn, .045)
    beam("Asymmetric crown beam", (-.87, -.02, 3.08), (1.01, -.02, 2.72), .26, .38,
         worn, .025)
    beam("Rear tower tie", (-.89, .36, 2.80), (.91, .36, 2.48), .13, .18, armor)
    # Vertical wheel plane faces the oblique camera; its broad ring remains legible at RTS zoom.
    wheel_rot = (math.pi/2, 0, 0)
    cylinder("Hoist wheel dark core", (-.28, -.26, 2.12), .81, .34, armor, 10, wheel_rot)
    cylinder("Hoist wheel outer rim", (-.28, -.47, 2.12), .68, .19, worn, 10, wheel_rot,
             radius_top=.62)
    cylinder("Hoist wheel hub", (-.28, -.59, 2.12), .22, .12, signal, 8, wheel_rot)
    for i in range(6):
        angle = math.tau*i/6
        x0, z0 = -.28, 2.12
        beam("Hoist wheel spoke", (x0, -.57, z0),
             (x0 + math.cos(angle)*.57, -.57, z0 + math.sin(angle)*.57),
             .095, .10, armor)
    # A dangling hook, ore skip, and broad skid make the lower silhouette read as abandoned machinery.
    beam("Slack hoist cable", (.45, -.10, 2.68), (.52, -.11, .78), .045, .045, armor)
    beam("Ore skip bail", (.15, -.11, .83), (.85, -.11, .83), .075, .075, worn)
    cube("Ore skip hopper", (.50, -.10, .54), (.80, .71, .54), armor, .055,
         rotation=(0, .06, .02))
    cube("Skip hazard face", (.50, -.475, .60), (.43, .045, .13), signal, .012)
    cube("Hoist base skid", (0, .12, .16), (3.65, 1.14, .30), armor, .07)
    cube("Service deck", (-.28, -.22, .39), (2.26, .77, .16), worn, .035)
    for x in (-1.48, 1.46):
        cube("Safety bumper", (x, -.12, .31), (.20, .84, .23), signal, .025)
    join_by_material("landmark-canyon-orehoist.glb")


BUILDERS = {
    "twin-pass-gate": twin_pass_gate,
    "delta-spillway": delta_spillway,
    "canyon-orehoist": canyon_ore_hoist,
}
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
requested = args[0] if args else "all"
if requested == "all":
    for build in BUILDERS.values():
        build()
elif requested in BUILDERS:
    BUILDERS[requested]()
else:
    raise SystemExit(f"Unknown asset '{requested}'. Choose all or: {', '.join(BUILDERS)}")
