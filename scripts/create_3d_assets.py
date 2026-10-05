"""Generate the hand-authored low-poly battlefield kit with Blender 5.x.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/create_3d_assets.py
The exported GLBs are intentionally small and need no external textures.
"""

import bpy
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "models"
OUT.mkdir(parents=True, exist_ok=True)
LOW_POLY_BEVEL = False


def clean():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def material(name, color, metal=0.0, rough=0.65, emit=None, strength=1.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def palette():
    return {
        "armor": material("Ceramic armor", (0.55, 0.65, 0.63), .42, .39),
        "edge": material("Bright alloy", (0.78, 0.85, 0.77), .57, .31),
        "dark": material("Graphite structure", (0.075, 0.15, 0.18), .34, .61),
        "rubber": material("Tread rubber", (0.045, 0.075, 0.08), .12, .84),
        "glass": material("Aqua glass", (0.16, 0.62, 0.69), .56, .15, (0.02, .25, .29), .42),
        "accent": material("TeamAccent", (0.06, .84, .95), .30, .28, (0.03, .42, .54), 1.4),
        "glow": material("Crystal glow", (.34, 1, .85), .12, .16, (.12, .68, .54), 1.2),
        "recess": material("Deep machinery recess", (.025, .055, .068), .25, .74),
        "steel": material("Blue gunmetal", (.20, .31, .34), .66, .42),
        "copper": material("Reactor copper", (.62, .39, .20), .68, .34),
        "warning": material("Safety ochre", (.95, .61, .18), .25, .51),
    }


def cube(name, loc, scale, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Machined edges", "BEVEL")
        mod.width = bevel
        mod.segments = 1 if LOW_POLY_BEVEL else 2
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def cylinder(name, loc, radius, depth, mat, verts=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def cone(name, loc, radius1, radius2, depth, mat, verts=7, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius1, radius2=radius2, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def faceted_prism(name, lower, upper, z_low, z_high, mat):
    """A hard-edged armor shell with an inset upper outline, viewed from above."""
    count = len(lower)
    vertices = [(x, y, z_low) for x, y in lower] + [(x, y, z_high) for x, y in upper]
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count) for i in range(count)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def export(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / (name + ".glb")),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    print("EXPORTED", name)


def consolidate_static_meshes(preserved=(), join_groups=()):
    """Bake bevels and combine like materials to keep game draw calls low.

    Named moving pieces are kept as independent glTF nodes for the renderer.
    Assets with animated parts pass their node names in `preserved`.
    """
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Assemble coordinated moving parts around a shared world-space pivot.
    # Setting each origin before joining preserves the intended mesh placement
    # while making one exported node rotate around the vehicle's turret ring.
    for group_name, members, pivot in join_groups:
        members = [obj for obj in members if obj and obj.name in bpy.context.scene.objects]
        if not members:
            continue
        bpy.context.scene.cursor.location = pivot
        for obj in members:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        bpy.ops.object.join()
        members[0].name = group_name
        preserved = (*preserved, group_name)
    groups = {}
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and obj.name not in preserved:
            key = obj.data.materials[0].name if obj.data.materials else "untextured"
            groups.setdefault(key, []).append(obj)
    for objects in groups.values():
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()


def command_yard():
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    # Landmark buildings use their own darker, more saturated finish.
    m["armor"] = material("Command Yard midnight ceramic", (.20, .31, .35), .50, .36)
    m["edge"] = material("Command Yard pale alloy", (.76, .72, .59), .58, .30)
    m["dark"] = material("Command Yard deep navy", (.035, .075, .095), .42, .54)
    m["steel"] = material("Command Yard blue steel", (.12, .25, .30), .65, .37)
    m["accent"] = material("Command Yard team cyan", (.025, .52, .84), .34, .24, (.01, .18, .55), 1.1)
    m["warning"] = material("Command Yard safety amber", (1.0, .49, .08), .22, .45)
    cube("Foundation platform", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .06)
    cube("Chamfered superstructure", (0, 0, .49), (2.47, 2.39, .55), m["armor"], .11)
    cube("Forward command deck", (0, .52, .82), (1.86, 1.12, .27), m["edge"], .07)
    cube("Recessed glass control room", (0, .48, 1.12), (1.34, .68, .43), m["glass"], .05)
    cube("Control room roof", (0, .49, 1.38), (1.51, .86, .13), m["dark"], .05)
    cube("Rear operations block", (0, -.58, .90), (1.34, 1.10, .42), m["dark"], .06)
    for x in [-1.14, 1.14]:
        for y in [-1.12, 1.12]:
            cube("Armored corner pylon", (x, y, .59), (.24, .24, .83), m["edge"], .04)
            cube("Pylon signal cap", (x, y, 1.06), (.27, .27, .07), m["accent"], .02)
    for x in [-.71, .71]:
        cube("Forward fascia light", (x, 1.18, .62), (.47, .055, .075), m["accent"], .01)
    cylinder("Command mast", (0, -.65, 1.52), .075, .72, m["edge"], 10)
    cylinder("Beacon lens", (0, -.65, 1.92), .13, .10, m["accent"], 12)
    for x in [-.82, .82]:
        cube("Service ramp", (x, 1.31, .20), (.41, .46, .19), m["dark"], .035)
    # A layered command bridge and exposed defensive buttresses distinguish it
    # from the other square industrial buildings at game camera distance.
    for x in [-.98, .98]:
        cube("Side buttress spine", (x, .08, .67), (.26, 1.48, .27), m["steel"], .045)
        cube("Buttress cap armor", (x, .08, .83), (.32, 1.25, .075), m["edge"], .025)
        for y in [-.51, .0, .51]:
            cube("Buttress inset vent", (x + (.142 if x > 0 else -.142), y, .56),
                 (.018, .28, .13), m["recess"], .006)
    cube("Bridge lower shadow", (0, .63, .91), (1.57, .18, .15), m["recess"], .025)
    for x in [-.55, -.27, 0, .27, .55]:
        cube("Bridge window mullion", (x, .84, 1.13), (.035, .055, .32), m["steel"], .008)
    cube("Command roof raised keel", (0, .49, 1.49), (.30, .84, .12), m["edge"], .035)
    for x in [-.62, .62]:
        cube("Roof shoulder plate", (x, .49, 1.42), (.25, .79, .09), m["steel"], .025)
        cube("Ramp hazard strip", (x*1.32, 1.56, .305), (.25, .035, .02), m["warning"], .005)
    # A suspended armored brow gives the forward command bridge a readable
    # landmark silhouette from the isometric game camera. The canted supports
    # and inset cyan glazing add depth without expanding the original footprint.
    for side in [-1, 1]:
        support = cube("Bridge brow canted support", (side*.70, .56, 1.47),
                       (.12, .57, .27), m["edge"], .025)
        support.rotation_euler[1] = side * math.radians(13)
        cube("Brow support inset", (side*.68, .56, 1.475),
             (.035, .38, .12), m["accent"], .008)
    cube("Raised bridge armored brow", (0, .59, 1.61), (1.72, .69, .105), m["steel"], .035)
    cube("Bridge brow leading edge", (0, .955, 1.59), (1.57, .055, .07), m["edge"], .015)
    for x in [-.51, -.255, 0, .255, .51]:
        cube("Bridge brow cyan glazing", (x, .67, 1.67), (.19, .32, .018), m["glass"], .008)
    for x in [-.78, .78]:
        cube("Brow warning marker", (x, .59, 1.67), (.08, .18, .025), m["warning"], .006)
    # A broad antenna yoke gives the command centre a unique upper silhouette.
    cube("Antenna yoke", (0, -.65, 1.70), (.62, .08, .075), m["steel"], .022)
    for x in [-.30, .30]:
        cylinder("Yoke receiver", (x, -.65, 1.78), .075, .16, m["accent"], 8)
    cube("Telemetry crown plinth", (0, -.67, 1.49), (.78, .48, .15), m["dark"], .035)
    cube("Telemetry crown armor", (0, -.67, 1.59), (.64, .34, .09), m["edge"], .025)
    for x in [-.23, .23]:
        cube("Telemetry fork", (x, -.67, 1.72), (.08, .08, .27), m["steel"], .018)
        cylinder("Telemetry receiver", (x, -.67, 1.88), .07, .07, m["accent"], 8)
    for x in [-.48, .48]:
        cube("Roof service hatch", (x, -.30, 1.47), (.26, .31, .07), m["dark"], .018)
        cube("Hatch status lamp", (x, -.30, 1.515), (.13, .045, .018), m["warning"], .004)
    for x in [-1.34, 1.34]:
        cube("Perimeter rail", (x, 0, .35), (.065, 1.81, .17), m["edge"], .018)
    for y in [-1.34, 1.34]:
        cube("Perimeter rail", (0, y, .35), (2.05, .065, .17), m["edge"], .018)
    # Broad access panels break up the otherwise uninterrupted lower hull.
    # Their inset service covers and visible fasteners remain readable from
    # the campaign camera without changing the yard's footprint or height.
    for side in [-1, 1]:
        cube("Side armored access panel", (side*1.247, -.48, .51), (.035, .58, .34), m["steel"], .018)
        cube("Side access recess", (side*1.27, -.48, .51), (.018, .37, .19), m["recess"], .008)
        for y in [-.69, -.27]:
            cylinder("Side access fastener", (side*1.284, y, .51), .027, .018, m["edge"], 8, (0, math.pi/2, 0))
        # Louver blocks cast a clear shadow at the shallow isometric angle.
        for z in [.435, .49, .545, .60]:
            cube("Side intake louver", (side*1.286, -.48, z), (.018, .28, .018), m["edge"], .004)
    # Front-facing armored shutters and stair treads make the command bridge
    # feel connected to the service apron instead of floating above it.
    cube("Command entry shadow", (0, 1.205, .49), (.72, .035, .34), m["recess"], .02)
    cube("Command entry door", (0, 1.23, .48), (.43, .035, .25), m["steel"], .015)
    for x in [-.145, 0, .145]:
        cube("Entry door rib", (x, 1.253, .48), (.025, .012, .20), m["edge"], .004)
    for z in [.17, .24, .31]:
        cube("Command approach tread", (0, 1.40, z), (.72, .18, .045), m["steel"], .012)
    # Short roof radiator banks give the rear operations block a distinct
    # industrial surface and introduce restrained warm warning markers.
    for x in [-.48, .48]:
        cube("Roof radiator bed", (x, -.28, 1.467), (.43, .38, .055), m["recess"], .012)
        for y in [-.40, -.32, -.24, -.16]:
            cube("Roof radiator fin", (x, y, 1.51), (.34, .028, .035), m["steel"], .006)
        cube("Radiator caution tab", (x, -.045, 1.485), (.11, .025, .035), m["warning"], .005)
    # A tall twin-post tower and rotating jib make the Aegis yard read as a
    # construction headquarters at battlefield zoom. Keep the jib as one
    # named moving node with only two materials so the renderer adds at most
    # two draw calls while preserving a distinct illuminated trolley.
    for x in [-.17, .17]:
        cube("Aegis gantry tower post", (x, -.75, 1.93), (.085, .10, .96), m["edge"], .015)
        cube("Aegis tower foot", (x, -.75, 1.48), (.18, .18, .12), m["steel"], .02)
    cube("Aegis tower crown", (0, -.75, 2.39), (.47, .28, .11), m["dark"], .025)
    crane_parts = []
    for name, loc, size, mat in [
        ("Aegis crane boom", (0, -.75, 2.48), (1.88, .13, .13), m["steel"]),
        ("Aegis boom top rail", (0, -.75, 2.56), (1.70, .045, .035), m["steel"]),
        ("Aegis trolley housing", (.48, -.75, 2.39), (.30, .24, .18), m["dark"]),
        ("Aegis trolley lamp", (.48, -.75, 2.30), (.13, .12, .035), m["accent"]),
        ("Aegis crane counterweight", (-.70, -.75, 2.37), (.34, .26, .27), m["steel"]),
        ("Aegis hook cable", (.48, -.75, 2.19), (.035, .035, .24), m["dark"]),
    ]:
        crane_parts.append(cube(name, loc, size, mat, .012))
    crane_parts.append(cone("Aegis crane hook", (.48, -.75, 2.04), .09, .025, .18, m["steel"], 6))
    consolidate_static_meshes(
        preserved=("Aegis construction jib",),
        join_groups=(("Aegis construction jib", crane_parts, (0, -.75, 2.43)),),
    )
    export("command-yard")
    LOW_POLY_BEVEL = previous_bevel


def tank():
    clean(); m = palette()
    turret_parts = []
    def turret_cube(*args, **kwargs):
        obj = cube(*args, **kwargs); turret_parts.append(obj); return obj
    def turret_cylinder(*args, **kwargs):
        obj = cylinder(*args, **kwargs); turret_parts.append(obj); return obj
    def turret_faceted_prism(*args, **kwargs):
        obj = faceted_prism(*args, **kwargs); turret_parts.append(obj); return obj
    for x in [-.37, .37]:
        cube("Continuous tank tread", (x, 0, .15), (.19, .90, .28), m["rubber"], .07)
        for y in [-.30, 0, .30]:
            cylinder("Wheel hub", (x + (.101 if x > 0 else -.101), y, .15), .085, .025, m["edge"], 10, (0, math.pi/2, 0))
        for y in [-.31, -.12, .07, .26]:
            cube("Tread cleat", (x, y, .285), (.215, .058, .029), m["dark"], .009)
    cube("Sloped heavy hull", (0, 0, .32), (.64, .85, .26), m["armor"], .13)
    # Layered wedge glacis and bright split markings read clearly at small
    # gameplay scale while staying inside the original hull envelope.
    cube("Forward glacis plate", (0, .31, .39), (.57, .24, .12), m["edge"], .07)
    cube("Glacis center armor", (0, .40, .405), (.30, .12, .105), m["steel"], .035)
    for x in [-.20, .20]:
        cube("Glacis team chevron", (x, .407, .444), (.13, .018, .018), m["accent"], .006)
    turret_cube("Turret bustle", (0, -.12, .52), (.52, .45, .18), m["dark"], .08)
    turret_cylinder("Rotating turret", (0, .035, .60), .29, .21, m["edge"], 8)
    # A broad, faceted command wedge gives the Striker a recognizable crown.
    turret_faceted_prism("Angular command turret",
        [(-.26, -.23), (.26, -.23), (.30, .12), (.20, .28), (-.20, .28), (-.30, .12)],
        [(-.20, -.19), (.20, -.19), (.235, .09), (.15, .225), (-.15, .225), (-.235, .09)],
        .67, .81, m["armor"])
    turret_cube("Turret crown ridge", (0, -.005, .824), (.075, .34, .028), m["edge"], .012)
    turret_cube("Turret command stripe", (0, -.195, .783), (.28, .035, .025), m["accent"], .008)
    # Heavy mantlet and stepped barrel shroud create a thicker, more forceful
    # front profile without extending the existing muzzle reach.
    turret_cube("Cannon armored mantlet", (0, .245, .655), (.27, .16, .17), m["steel"], .045)
    turret_cube("Mantlet team panel", (0, .292, .685), (.22, .045, .085), m["accent"], .018)
    turret_cylinder("Main cannon barrel", (0, .42, .655), .067, .46, m["dark"], 10, (math.pi/2, 0, 0))
    turret_cylinder("Barrel reinforcing sleeve", (0, .49, .655), .088, .16, m["edge"], 10, (math.pi/2, 0, 0))
    turret_cylinder("Muzzle brake", (0, .75, .655), .09, .07, m["edge"], 10, (math.pi/2, 0, 0))
    for x in [-.18, .18]:
        turret_cube("Side navigation light", (x, .32, .515), (.08, .095, .045), m["accent"], .012)
    turret_cylinder("Optical sensor", (.17, -.05, .825), .065, .07, m["glass"], 10)
    # Keep turret and barrel names for renderer animation; peripheral details
    # are separate meshes and remain fixed to the hull.
    for x in [-.37, .37]:
        side = 1 if x > 0 else -1
        cube("Track upper armor skirt", (x, -.03, .34), (.235, .75, .085), m["steel"], .024)
        cube("Track skirt edge", (x + side*.121, -.03, .36), (.025, .67, .045), m["edge"], .008)
        for y in [-.39, -.29, -.19, -.09, .01, .11, .21, .31, .41]:
            cube("Tread tooth", (x, y, .275), (.225, .041, .042), m["rubber"], .008)
        for y in [-.34, -.12, .10, .32]:
            cylinder("Road wheel steel rim", (x + side*.113, y, .15), .061, .03,
                     m["steel"], 10, (0, math.pi/2, 0))
        cube("Hull shoulder armor", (x*.75, -.10, .47), (.24, .57, .055), m["edge"], .02)
        cube("Rear cooling grille", (x*.75, -.40, .48), (.14, .14, .035), m["recess"], .008)
        for yy in [-.44, -.40, -.36]:
            cube("Cooling grille vane", (x*.75, yy, .502), (.13, .012, .012), m["steel"], .004)
    cube("Glacis central ridge", (0, .35, .48), (.075, .23, .045), m["steel"], .012)
    cube("Engine rear armor", (0, -.39, .47), (.48, .17, .075), m["steel"], .025)
    # Broad, outward-swept cheek sponsons widen the turret into a distinctive
    # armored crown. Their side-facing cyan panels stay inside the track span,
    # read as an Aegis faction block from gameplay zoom, and rotate with the
    # existing single turret assembly.
    for side in [-1, 1]:
        x = side * .26
        turret_cube("Turret cheek sponson", (x, .09, .68), (.16, .38, .17), m["steel"], .045)
        turret_cube("Turret cheek faction panel", (side*.333, .09, .70), (.022, .24, .075), m["accent"], .009)
        turret_cube("Cannon recoil rail", (x*.40, .45, .67), (.025, .34, .032), m["edge"], .006)
    turret_cylinder("Turret command hatch", (-.10, -.09, .815), .085, .025, m["steel"], 10)
    turret_cylinder("Hatch lock", (-.10, -.09, .832), .025, .012, m["warning"], 8)
    turret_cylinder("Muzzle inner bore", (0, .789, .655), .039, .008, m["recess"], 10, (math.pi/2, 0, 0))
    turret_cube("Sensor guard", (.17, -.05, .875), (.18, .13, .025), m["edge"], .01)
    # Paired armored rangefinder pods give the Striker a distinctive crown at
    # command zoom. Their cyan apertures face forward and sit within the
    # existing turret envelope, so the unit keeps its footprint and pivot.
    for x in [-.205, .205]:
        turret_cube("Rangefinder pod housing", (x, -.035, .836), (.105, .15, .075), m["steel"], .018)
        turret_cube("Rangefinder cyan aperture", (x, .044, .84), (.064, .018, .037), m["accent"], .008)
        turret_cube("Rangefinder brow", (x, .049, .865), (.078, .026, .014), m["edge"], .004)
    # Two contrasting panels break up the long track skirts and make the
    # vehicle's forward half easy to read against sand and dark wreckage.
    for side in [-1, 1]:
        cube("Track skirt accent panel", (side*.466, .24, .371), (.018, .22, .052), m["accent"], .008)
        cube("Track skirt warning tab", (side*.466, .12, .371), (.018, .055, .052), m["warning"], .006)
    # Small amber position lamps and dark inset ports help separate the hull
    # shoulders from the track armor in a crowded opening battle.
    for x in [-.285, .285]:
        cube("Shoulder position lamp", (x, .24, .505), (.045, .07, .035), m["warning"], .01)
        cube("Side armor port", (x*1.04, -.24, .47), (.022, .11, .06), m["recess"], .006)
    consolidate_static_meshes(
        preserved=("Rotating turret assembly",),
        join_groups=(("Rotating turret assembly", turret_parts, (0, .035, .60)),),
    )
    export("striker-tank")


def apc():
    """Broad, unarmed six-wheel troop carrier with a clearly readable rear ramp."""
    clean(); m = palette()
    # A low, broad hull gives the carrier a different silhouette from the narrow
    # tracked striker while staying within the same tactical footprint.
    cube("Carrier armored belly", (0, 0, .29), (.88, .94, .26), m["dark"], .09)
    cube("Broad personnel hull", (0, -.015, .55), (.96, .91, .43), m["armor"], .12)
    cube("Sloped forward cab", (0, .40, .66), (.88, .39, .38), m["edge"], .10)
    cube("Wide armored windshield", (0, .603, .70), (.63, .035, .19), m["glass"], .025)
    for x in [-.23, 0, .23]:
        cube("Windshield divider", (x, .626, .70), (.025, .014, .20), m["steel"], .006)
    # Raised, slab-sided troop compartment; the roof is deliberately bare of a cannon.
    cube("Troop compartment roof", (0, -.12, .825), (.84, .56, .10), m["steel"], .065)
    cube("Roof escape hatch", (0, -.04, .89), (.31, .27, .045), m["edge"], .035)
    for x in [-.34, .34]:
        cube("Side armor belt", (x, -.10, .57), (.16, .59, .36), m["steel"], .045)
        cube("Side team stripe", (x + (.083 if x > 0 else -.083), -.07, .68), (.018, .37, .055), m["accent"], .008)
        # Small protected observation windows identify the passenger bay.
        for y in [-.29, -.04, .21]:
            cube("Troop vision block", (x + (.087 if x > 0 else -.087), y, .59),
                 (.018, .13, .085), m["glass"], .012)
        cube("Wheel arch guard", (x*1.10, 0, .34), (.12, .79, .17), m["armor"], .06)
        for y in [-.32, 0, .32]:
            cylinder("All-terrain tire", (x*1.20, y, .245), .155, .105, m["rubber"], 12, (0, math.pi/2, 0))
            cylinder("Machined wheel hub", (x*1.20 + (.056 if x > 0 else -.056), y, .245),
                     .082, .018, m["edge"], 10, (0, math.pi/2, 0))
            cylinder("Hub inset", (x*1.20 + (.067 if x > 0 else -.067), y, .245),
                     .035, .020, m["steel"], 8, (0, math.pi/2, 0))
    # Double rear doors and lowered loading ramp are the defining transport cues.
    cube("Rear door surround", (0, -.478, .54), (.70, .07, .48), m["dark"], .025)
    for x in [-.17, .17]:
        door_name = "Left troop door" if x < 0 else "Right troop door"
        cube(door_name, (x, -.523, .56), (.32, .035, .39), m["armor"], .025)
        cube("Door reinforcing rib", (x, -.545, .56), (.025, .014, .30), m["edge"], .006)
        cube("Door latch", (x + (.11 if x < 0 else -.11), -.55, .56), (.025, .018, .11), m["steel"], .006)
    ramp = cube("Fold-down loading ramp", (0, -.66, .255), (.63, .34, .09), m["steel"], .025)
    for x in [-.21, -.07, .07, .21]:
        cube("Ramp grip rib", (x, -.67, .303), (.025, .24, .018), m["edge"], .006)
    cube("Rear running light bar", (0, -.555, .81), (.48, .025, .045), m["accent"], .01)
    for x in [-.34, .34]:
        cube("Forward marker lamp", (x, .605, .49), (.105, .045, .055), m["accent"], .012)
        cube("Front bumper block", (x, .59, .34), (.20, .12, .12), m["dark"], .025)
    cube("Nose armor ridge", (0, .57, .89), (.17, .11, .06), m["edge"], .018)
    consolidate_static_meshes(("Left troop door", "Right troop door", ramp.name))
    export("apc")


def harvester(vesper=False):
    global LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    if vesper:
        # Vesper's extractor is an angular, violet-black crawler built around
        # an exposed crystal separator instead of Aegis's enclosed hopper.
        m["armor"] = material("Vesper extractor violet armor", (.25, .12, .36), .48, .34)
        m["edge"] = material("Vesper extractor pale alloy", (.73, .58, .84), .62, .28)
        m["dark"] = material("Vesper extractor graphite", (.035, .025, .075), .40, .58)
        m["steel"] = material("Vesper extractor blue steel", (.16, .12, .27), .66, .36)
        m["glass"] = material("Vesper extractor magenta glass", (.67, .18, .67), .5, .16, (.35, .02, .35), .65)
        m["accent"] = material("TeamAccent", (.83, .12, .95), .3, .24, (.44, .02, .60), 1.6)
        m["glow"] = material("Vesper crystal glow", (.92, .32, 1.0), .15, .15, (.54, .04, .75), 1.7)
        m["copper"] = material("Vesper separator bronze", (.85, .38, .62), .68, .30)
        m["warning"] = material("Vesper hazard gold", (.98, .69, .24), .24, .45)
    for x in [-.46, .46]:
        side = 1 if x > 0 else -1
        cube("Industrial track", (x, -.015, .16), (.22, 1.13, .31), m["rubber"], .065)
        for y in [-.43, -.15, .15, .43]:
            cylinder("Track drive hub", (x + side*.119, y, .17), .083, .025,
                     m["steel"], 10, (0, math.pi/2, 0))
        for y in [-.49, -.35, -.21, -.07, .07, .21, .35, .49]:
            cube("Industrial tread cleat", (x, y, .323), (.245, .065, .035), m["dark"], .008)
        cube("Track shoulder guard", (x, -.02, .37), (.24, .85, .10), m["edge"], .025)
        for y in [-.35, -.06, .23]:
            cube("Guard joint", (x + side*.124, y, .39), (.015, .025, .06), m["recess"], .003)
    cube("Armored truck chassis", (0, 0, .34), (.75, 1.03, .27), m["steel"], .065)
    faceted_prism("Tapered cargo hopper", [(-.38,-.55),(.38,-.55),(.38,.07),(-.38,.07)],
                  [(-.34,-.51),(.34,-.51),(.34,.04),(-.34,.04)], .48, .80, m["armor"])
    cube("Deep hopper cavity", (0, -.24, .804), (.56, .41, .018), m["recess"], .005)
    for x in [-.35, .35]:
        cube("Hopper side lip", (x, -.24, .825), (.085, .62, .07), m["edge"], .015)
        cube("Hopper load rail", (x, -.24, .87), (.028, .51, .025), m["steel"], .008)
    for y in [-.51, .03]:
        cube("Hopper end lip", (0, y, .825), (.69, .07, .07), m["edge"], .012)
    for x, y, h in [(-.20,-.31,.24),(.01,-.30,.31),(.22,-.18,.22),(-.04,-.11,.18)]:
        cone("Loaded crystal shard", (x, y, .83+h/2), .075, .008, h, m["glow"], 6)
    cube("Hopper aft transfer pipe", (0, -.51, .66), (.16, .14, .11), m["steel"], .02)
    if vesper:
        # Raised twin separator drums, a split feed throat, and a rear signal
        # mast give this faction's harvester its own recognizable silhouette.
        for x in [-.20, .20]:
            cylinder("Vesper separator drum", (x, -.30, 1.02), .115, .31, m["dark"], 8, (0, math.pi/2, 0))
            cylinder("Vesper separator end ring", (x + (.17 if x > 0 else -.17), -.30, 1.02), .125, .025, m["accent"], 8, (0, math.pi/2, 0))
        cube("Vesper split feed bridge", (0, -.30, .99), (.16, .48, .12), m["edge"], .025)
        cylinder("Vesper signal mast", (0, -.56, 1.04), .025, .42, m["edge"], 8)
        cylinder("Vesper signal beacon", (0, -.56, 1.27), .075, .08, m["accent"], 8)
    faceted_prism("Elevated forward cab", [(-.32,.12),(.32,.12),(.32,.56),(-.32,.56)],
                  [(-.27,.16),(.27,.16),(.25,.49),(-.25,.49)], .49, .88, m["edge"])
    cube("Panoramic cab windscreen", (0, .518, .72), (.48, .045, .18), m["glass"], .012)
    for x in [-.28, .28]:
        cube("Cab side glass", (x, .36, .74), (.023, .24, .13), m["glass"], .005)
    cube("Cab roof equipment", (0, .29, .92), (.30, .21, .055), m["dark"], .01)
    # The open mouth, cutting drum and transfer conveyor read as a machine
    # harvesting into the visible rear bin, not a truck carrying crystals.
    cube("Intake throat", (0, .62, .23), (.65, .25, .17), m["recess"], .02)
    cube("Intake upper shroud", (0, .63, .37), (.79, .29, .09), m["armor"], .025)
    # The open cutter is the harvester's defining front silhouette. A deep
    # shadowed mouth, bright drum ends, and ochre teeth stay legible in the
    # small tactical portrait and against the pale Aegis ceramic.
    for x in [-.37, .37]:
        cube("Intake cheek", (x, .69, .26), (.09, .34, .24), m["edge"], .018)
    cylinder("Cutting drum", (0, .79, .19), .12, .69, m["dark"], 12, (0, math.pi/2, 0))
    for side in [-1, 1]:
        cylinder("Cutter end hub", (side*.365, .79, .19), .105, .035, m["copper"], 10, (0, math.pi/2, 0))
        cylinder("Cutter bearing cap", (side*.39, .79, .19), .052, .025, m["edge"], 10, (0, math.pi/2, 0))
    for x in [-.29,-.17,-.05,.07,.19,.31]:
        cone("Drum cutting tooth", (x, .87, .19), .044, .006, .065,
             m["warning"], 5, (math.pi/2, 0, 0))
    # A visible inclined belt returns cut crystal from the drum into the bin.
    # Side rails and cross-cleats make the transfer path readable from above.
    belt = cube("Inclined crystal conveyor", (0, .31, .55), (.30, .78, .065), m["dark"], .012)
    belt.rotation_euler[0] = math.radians(-17)
    for x in [-.17, .17]:
        rail = cube("Conveyor side rail", (x, .31, .57), (.035, .79, .075), m["steel"], .009)
        rail.rotation_euler[0] = math.radians(-17)
    for y, z in [(.57,.48),(.43,.52),(.29,.56),(.15,.60),(.01,.64),(-.13,.68)]:
        cleat = cube("Conveyor cleat", (0, y, z), (.29, .026, .025), m["edge"], .005)
    for x in [-.27, .27]:
        cube("Running light", (x, .55, .51), (.10, .035, .05), m["accent"], .009)
    # Service markings and exposed hydraulic hardware break up the
    # broad track guards without adding to the vehicle footprint.
    for side in [-1, 1]:
        cube("Faction flank stripe", (side*.571, -.02, .39), (.018, .43, .035), m["accent"], .006)
        for y in [-.36, .31]:
            cylinder("Hydraulic pivot", (side*.50, y, .46), .065, .045, m["copper"], 10, (0, math.pi/2, 0))
        cube("Track hazard tab", (side*.49, .46, .40), (.035, .14, .025), m["warning"], .004)
    consolidate_static_meshes()
    export("vesper-harvester" if vesper else "harvester")
    LOW_POLY_BEVEL = False


def vesper_harvester():
    harvester(vesper=True)


def power_plant():
    clean(); m = palette()
    # Compact reactor hall with two unmistakable cooling stacks and a lit core.
    cube("Reactor foundation", (0, 0, .13), (2.78, 2.78, .26), m["dark"], .07)
    cube("Reactor containment hall", (0, -.10, .56), (2.02, 1.76, .64), m["armor"], .12)
    cube("Hall roof armor", (0, -.10, .91), (2.18, 1.90, .13), m["edge"], .045)
    cube("Glazed reactor core", (0, .10, 1.25), (.76, .70, .58), m["glass"], .06)
    cube("Core crown", (0, .10, 1.57), (.94, .84, .10), m["dark"], .04)
    # The raised, caged core gives the power plant a clear landmark silhouette
    # and keeps its cyan reactor light readable above the cooling stacks.
    for x in [-.39, .39]:
        for y in [-.26, .46]:
            cube("Core armored corner", (x, y, 1.27), (.075, .075, .72), m["steel"], .018)
            cube("Core corner beacon", (x, y, 1.62), (.11, .11, .045), m["warning"], .012)
    for z in [1.00, 1.48]:
        cube("Core containment crossbar", (0, .10, z), (.88, .045, .055), m["edge"], .012)
    for x in [-.76, .76]:
        # Stacks sit at the rear, keeping the forward service face legible.
        cylinder("Reactor exhaust stack", (x, -.79, 1.05), .34, .72, m["dark"], 10)
        cylinder("Stack armored collar", (x, -.79, 1.42), .39, .10, m["edge"], 10)
        cylinder("Stack luminous vent", (x, -.79, 1.48), .25, .035, m["accent"], 10)
        cube("Stack hazard stripe", (x, -.423, .78), (.26, .035, .10), m["accent"], .015)
    for x in [-.76, .76]:
        cube("Front status light", (x, .80, .60), (.34, .055, .075), m["accent"], .015)
    cube("Reactor access door", (0, .79, .40), (.48, .055, .42), m["dark"], .025)
    # Twin reactors, piping, and an exposed luminous core make the function
    # unmistakable in silhouette and at portrait scale.
    for x in [-.76, .76]:
        cylinder("Stack intake base", (x, -.79, .71), .43, .12, m["steel"], 10)
        for z in [.89, 1.14]:
            cylinder("Stack reinforcing band", (x, -.79, z), .36, .045, m["edge"], 10)
        cylinder("Stack dark exhaust throat", (x, -.79, 1.507), .19, .025, m["recess"], 10)
        cylinder("Stack beacon", (x, -.79, 1.54), .075, .05, m["warning"], 8)
        cube("Stack vertical cooling channel", (x, -.415, 1.08), (.19, .026, .33), m["recess"], .008)
        for z in [.96, 1.05, 1.14, 1.23]:
            cube("Cooling channel vane", (x, -.398, z), (.18, .012, .015), m["steel"], .003)
        # Pipes wrap forward from each exhaust stack into the central core.
        cylinder("Reactor transfer pipe", (x*.63, -.32, 1.02), .055, .58,
                 m["copper"], 8, (0, math.pi/2, 0))
        cube("Front reinforced corner", (x*1.22, .72, .48), (.20, .14, .55), m["steel"], .027)
        cube("Front diagnostic panel", (x*.98, .895, .55), (.28, .025, .22), m["recess"], .008)
        for z in [.50, .57, .64]:
            cube("Diagnostic light", (x*.98, .913, z), (.17, .008, .018), m["accent"], .003)
    for x in [-.50, 0, .50]:
        cube("Reactor roof armor spine", (x, .25, .997), (.12, .73, .06), m["steel"], .015)
    cube("Core lower emission band", (0, .10, .95), (.83, .77, .055), m["accent"], .012)
    cube("Core front optic", (0, .462, 1.25), (.55, .027, .34), m["glow"], .018)
    for x in [-.28, .28]:
        cube("Core cage rail", (x, .47, 1.15), (.045, .035, .41), m["edge"], .008)
    cube("Door hazard threshold", (0, .835, .18), (.67, .09, .04), m["warning"], .008)
    consolidate_static_meshes()
    export("power-plant")


def refinery():
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    cube("Refinery slab", (0, 0, .12), (2.86, 2.86, .24), m["dark"], .06)
    cube("Processing hall", (-.30, -.48, .49), (1.60, 1.50, .50), m["armor"], .09)
    cube("Processing hall roof", (-.30, -.48, .77), (1.72, 1.60, .09), m["edge"], .03)
    # Paired settling tanks, with contrasting rims and glowing level windows.
    for x, y, radius, height in [(.64, .40, .43, .92), (.68, -.58, .36, .70)]:
        cylinder("Ore settling vessel", (x, y, .24 + height/2), radius, height, m["dark"], 12)
        cylinder("Vessel top plate", (x, y, .26 + height), radius*1.09, .095, m["edge"], 12)
        cylinder("Vessel status cap", (x, y, .32 + height), radius*.55, .035, m["accent"], 10)
        cube("Tank level window", (x, y + radius*.94, .40 + height*.34), (radius*.56, .045, .18), m["glass"], .025)
    # Raised ore conveyor leads into the processing hall from the front apron.
    cube("Conveyor spine", (-.42, .72, .51), (.42, 1.05, .18), m["dark"], .05)
    cube("Conveyor belt", (-.42, .72, .61), (.30, 1.04, .035), m["accent"], .012)
    for x in [-.69, -.15]:
        cube("Conveyor support", (x, .70, .30), (.08, .85, .38), m["edge"], .02)
    cylinder("Pressure pipe", (-.62, -.38, .92), .075, .88, m["edge"], 8, (math.pi/2, 0, 0))
    cube("Front loading bay", (-.30, .28, .38), (.72, .055, .30), m["dark"], .025)
    # Offset processing hall, two tank heights, and a striped conveyor give
    # the refinery a process-flow silhouette distinct from the power plant.
    for x, y, radius, height in [(.64, .40, .43, .92), (.68, -.58, .36, .70)]:
        for z in [.28, .53]:
            cylinder("Vessel pressure band", (x, y, z), radius*1.025, .045, m["steel"], 12)
        cylinder("Vessel hatch", (x, y, .35 + height), radius*.29, .055, m["recess"], 10)
        for dx in [-.18, .18]:
            cube("Vessel side ladder rail", (x + dx, y + radius*1.015, .64),
                 (.023, .024, .57), m["edge"], .005)
        for z in [.42, .55, .68, .81]:
            cube("Vessel ladder rung", (x, y + radius*1.035, z), (.38, .024, .022), m["warning"], .004)
    for x in [-.96, -.52, -.08]:
        cube("Roof machine plinth", (x, -.60, .86), (.24, .48, .14), m["steel"], .025)
        cube("Roof extraction vent", (x, -.60, .94), (.18, .33, .025), m["recess"], .008)
    for y in [.42, .60, .78, .96]:
        cube("Conveyor cross roller", (-.42, y, .64), (.35, .038, .025), m["steel"], .006)
    cube("Conveyor head hood", (-.42, 1.24, .62), (.53, .17, .18), m["edge"], .035)
    cube("Loading bay guide", (-.30, .315, .24), (.87, .08, .09), m["warning"], .015)
    for x in [-.98, .36]:
        cylinder("Pressure manifold riser", (x, -.79, .97), .066, .39, m["copper"], 8)
        cylinder("Manifold valve wheel", (x, -.79, 1.19), .11, .04, m["steel"], 8)
    cube("Hall front vent", (-.75, .30, .58), (.39, .025, .15), m["recess"], .012)
    for z in [.53, .58, .63]:
        cube("Hall front vent slat", (-.75, .322, z), (.36, .01, .012), m["edge"], .003)
    # A guarded manifold ties both vessels into the processing hall, making
    # the refinery read as a working plant rather than a pair of tanks.
    for y in [-.36, .29]:
        cylinder("Manifold cross pipe", (.88, y, 1.03), .047, .48, m["copper"], 8, (0, math.pi/2, 0))
        for x in [.70, 1.00]:
            cylinder("Manifold union", (x, y, 1.03), .072, .055, m["steel"], 8, (0, math.pi/2, 0))
    for x in [.66, 1.08]:
        cylinder("Manifold return riser", (x, -.035, .91), .046, .26, m["edge"], 8, (math.pi/2, 0, 0))
    # Segmented armored clamps and brace feet add believable load-bearing
    # structure around the settling vessels while staying inside their outline.
    for x, y, radius, height in [(.64, .40, .43, .92), (.68, -.58, .36, .70)]:
        for z in [.36, .80]:
            cylinder("Vessel reinforced collar", (x, y, z), radius*1.08, .055, m["copper"], 12)
        for side in [-1, 1]:
            cube("Vessel saddle support", (x + side*radius*.80, y, .34), (.10, .20, .24), m["steel"], .018)
        # A broad inspection plate adds an unmistakable focal detail to each
        # vessel without increasing its diameter.
        cube("Vessel inspection plate", (x, y + radius*1.01, .77), (.22, .035, .22), m["recess"], .012)
        cube("Vessel inspection light", (x, y + radius*1.04, .77), (.12, .018, .055), m["glass"], .008)
    consolidate_static_meshes()
    export("refinery")
    LOW_POLY_BEVEL = previous_bevel


def barracks():
    clean(); m = palette()
    cube("Barracks foundation", (0, 0, .12), (2.78, 2.78, .24), m["dark"], .06)
    cube("Troop quarters", (0, -.12, .48), (2.18, 1.84, .48), m["armor"], .10)
    cube("Armored parapet", (0, -.12, .76), (2.32, 1.97, .12), m["dark"], .045)
    # Give the quarters a legible armored facade instead of a single flat box.
    # Shallow pilasters, sill plates, and a recessed two-leaf door hold up at
    # normal battlefield zoom while keeping the original footprint.
    for x in [-.98, -.48, .48, .98]:
        cube("Facade armor rib", (x, .79, .47), (.10, .10, .50), m["edge"], .025)
    cube("Entry recess", (0, .83, .39), (.62, .08, .48), m["recess"], .025)
    cube("Entry blast door", (0, .885, .36), (.43, .045, .37), m["steel"], .018)
    cube("Door center seam", (0, .912, .36), (.018, .012, .31), m["dark"], .004)
    cube("Entry lintel", (0, .89, .66), (.76, .13, .085), m["accent"], .025)
    cube("Entry canopy", (0, 1.01, .70), (1.04, .43, .09), m["dark"], .035)
    cube("Entry canopy light", (0, 1.03, .755), (.68, .22, .025), m["glow"], .008)
    # A short stair and landing establish the door as the building's front.
    cube("Entry landing", (0, 1.18, .22), (.88, .40, .10), m["steel"], .025)
    for y, z in [(1.34, .13), (1.48, .07)]:
        cube("Entry step", (0, y, z), (.70, .16, .08), m["edge"], .018)
    for x in [-.76, -.38, .38, .76]:
        cube("Barracks armored window", (x, .818, .51), (.22, .055, .16), m["dark"], .025)
        cube("Barracks window glass", (x, .851, .51), (.145, .025, .085), m["glass"], .012)
        cube("Window brow", (x, .85, .63), (.29, .10, .045), m["edge"], .012)
        cube("Window sill", (x, .85, .405), (.27, .09, .045), m["steel"], .012)
    # Side ventilation, rooftop comms and faction-readable signal panels.
    for y in [-.59, -.18, .23]:
        cube("Vent housing", (1.11, y, .48), (.07, .32, .24), m["steel"], .018)
        for z in [.415, .465, .515, .565]:
            cube("Side ventilation grille", (1.153, y, z), (.018, .22, .018), m["dark"])
    for x in [-.83, .83]:
        cube("Rear service module", (x, -.24, .90), (.46, .62, .18), m["steel"], .035)
        cube("Service hatch", (x, -.24, 1.005), (.27, .34, .035), m["edge"], .012)
        for y in [-.34, -.24, -.14]:
            cube("Service hatch vent", (x, y, 1.028), (.17, .025, .014), m["dark"])
    # Raised training/command booth with armored glazing breaks up the broad
    # roof plane and gives this high-traffic structure a distinct silhouette.
    cube("Barracks rooftop command plinth", (0, -.10, .91), (1.12, .82, .14), m["steel"], .035)
    cube("Rooftop command booth", (0, -.12, 1.13), (.77, .59, .34), m["armor"], .05)
    cube("Rooftop booth front glass", (0, .187, 1.13), (.52, .035, .17), m["glass"], .018)
    for x in [-.285, .285]:
        cube("Booth frame", (x, .205, 1.13), (.045, .05, .25), m["edge"], .01)
    cube("Rooftop booth roof", (0, -.12, 1.33), (.91, .72, .09), m["dark"], .03)
    cube("Barracks signal panel", (0, -.12, 1.39), (.50, .10, .025), m["edge"], .008)
    for x in [-.16, 0, .16]:
        cube("Signal bar", (x, -.12, 1.41), (.065, .024, .018), m["accent"], .006)
    # Twin aerials and amber approach beacons read as a staffed training hub.
    for x in [-.48, .48]:
        cylinder("Barracks antenna", (x, -.68, 1.12), .026, .48, m["edge"], 8)
        cylinder("Antenna beacon", (x, -.68, 1.38), .052, .07, m["warning"], 8)
    for x in [-.85, .85]:
        cube("Corner marker", (x, .93, .32), (.20, .08, .10), m["accent"], .018)
        cube("Approach light", (x, 1.06, .23), (.10, .08, .06), m["warning"], .012)
    consolidate_static_meshes()
    export("barracks")


def factory():
    clean(); m = palette()
    m["armor"] = material("War Factory graphite armor", (.25, .32, .32), .48, .40)
    m["edge"] = material("War Factory warm alloy", (.78, .62, .38), .55, .32)
    m["dark"] = material("War Factory deep graphite", (.045, .068, .074), .42, .58)
    m["steel"] = material("War Factory blue steel", (.13, .23, .26), .64, .39)
    m["accent"] = material("War Factory team cyan", (.015, .52, .84), .34, .24, (.01, .18, .55), 1.1)
    m["warning"] = material("War Factory safety amber", (1.0, .48, .07), .22, .46)
    cube("Factory foundation", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .06)
    cube("Assembly hall", (0, -.27, .58), (2.35, 1.96, .68), m["armor"], .10)
    # Tall sawtooth roof and contrasting roof ribs make the industrial silhouette
    # read clearly from the game's high camera angle.
    for x in [-.72, 0, .72]:
        cube("Roof spine", (x, -.27, .99), (.12, 1.92, .13), m["edge"], .035)
        cube("Roof skylight", (x, -.27, 1.065), (.055, 1.52, .035), m["glass"], .012)
    cube("Vehicle service portal", (0, .733, .49), (1.14, .075, .54), m["dark"], .035)
    cube("Portal armored header", (0, .78, .81), (1.42, .12, .12), m["edge"], .035)
    for x in [-.51, .51]:
        cube("Portal guide light", (x, .79, .49), (.055, .035, .40), m["accent"], .014)
        cube("Side workshop wing", (x*1.80, -.05, .43), (.42, 1.20, .45), m["dark"], .055)
        cube("Wing armor panel", (x*1.80, .57, .49), (.30, .06, .26), m["edge"], .025)
    # Crane beam and hoist hint at active assembly without adding fine geometry.
    cube("Overhead gantry", (0, -.35, .91), (1.52, .13, .12), m["dark"], .025)
    cube("Gantry signal strip", (0, -.275, .91), (.74, .025, .045), m["accent"], .01)
    for x in [-.58, .58]:
        cube("Front hazard plate", (x, .94, .30), (.30, .07, .075), m["accent"], .012)
    # Twin extraction stacks lift the roofline above the assembly hall.
    for x, y, height in [(-.93, -.80, .54), (.93, -.80, .70)]:
        cube("Exhaust stack foot", (x, y, 1.00), (.34, .37, .16), m["dark"], .035)
        cylinder("Cooling drum", (x, y, 1.25 + height*.15), .20, height*.30, m["steel"], 10)
        cylinder("Stack warning collar", (x, y, 1.26 + height*.29), .23, .055, m["warning"], 10)
        cylinder("Exhaust hood", (x, y, 1.29 + height*.42), .24, .10, m["dark"], 10)
        cylinder("Exhaust opening", (x, y, 1.345 + height*.42), .14, .014, m["recess"], 10)
    # Reinforced portal jambs and a striped threshold frame the vehicle bay.
    for x in [-.67, .67]:
        cube("Portal armored jamb", (x, .77, .48), (.12, .16, .66), m["steel"], .025)
        cube("Jamb safety marker", (x, .862, .47), (.055, .018, .39), m["warning"], .008)
    cube("Portal threshold", (0, .87, .205), (1.42, .20, .075), m["steel"], .018)
    for x in [-.48, -.24, 0, .24, .48]:
        dash = cube("Threshold hazard dash", (x, .89, .247), (.12, .08, .012), m["warning"], .003)
        dash.rotation_euler[2] = math.radians(-28)
    # Recessed roof plates and cooling grilles break up the large surfaces.
    for x in [-.98, -.50, .50, .98]:
        cube("Roof access panel", (x, -.27, .953), (.22, .44, .045), m["steel"], .014)
        cube("Access panel inset", (x, -.27, .979), (.12, .30, .012), m["dark"], .005)
    for x in [-1.02, 1.02]:
        for y in [-.68, -.36, -.04]:
            cube("Side cooling grille", (x, y, .57), (.035, .20, .15), m["dark"], .008)
            for z in [.52, .57, .62]:
                cube("Grille slat", (x*1.018, y, z), (.012, .16, .012), m["edge"], .003)
    # An elevated bridge crane is the factory's production landmark: a strong
    # roofline, visible hanging tooling, and a lit assembly carriage at tactics zoom.
    for x in [-.94, .94]:
        cube("Crane tower foot", (x, -.18, 1.07), (.30, .48, .20), m["dark"], .025)
        cube("Crane tower", (x, -.18, 1.40), (.17, .22, .67), m["steel"], .018)
        cube("Crane tower signal", (x, -.302, 1.40), (.055, .025, .47), m["accent"], .006)
        cube("Crane shoulder", (x, -.18, 1.74), (.32, .34, .10), m["edge"], .018)
    cube("Overhead crane bridge", (0, -.18, 1.76), (2.08, .30, .15), m["steel"], .025)
    cube("Crane bridge luminous rail", (0, -.345, 1.76), (1.54, .028, .055), m["accent"], .008)
    cube("Crane trolley", (.23, -.12, 1.61), (.43, .38, .17), m["dark"], .018)
    cube("Trolley status lens", (.23, -.326, 1.62), (.19, .025, .06), m["warning"], .006)
    for x in [.10, .36]:
        cylinder("Suspended tool cable", (x, -.12, 1.40), .025, .32, m["edge"], 8)
    cube("Vehicle lift spreader", (.23, -.12, 1.22), (.55, .20, .10), m["warning"], .014)
    # Front apron rails and repeated floor rollers show where chassis enter the bay.
    for x in [-.47, -.24, 0, .24, .47]:
        cylinder("Assembly conveyor roller", (x, .98, .29), .035, .13, m["edge"], 8, (0, math.pi/2, 0))
    for x in [-.60, .60]:
        cube("Bay threshold rail", (x, 1.00, .27), (.075, .35, .055), m["accent"], .008)
    # Keep the animated crane/drums and named emissive parts as their own
    # glTF nodes; consolidate the rest by material to limit per-instance draws.
    consolidate_static_meshes(preserved=(
        "Overhead gantry", "Cooling drum", "Cooling drum.001",
        "Gantry signal strip", "Portal guide light", "Portal guide light.001",
        "Roof skylight", "Roof skylight.001", "Roof skylight.002",
    ))
    export("factory")


def vesper_palette():
    m = palette()
    m["armor"] = material("Vesper reclaimed basalt armor", (.25, .22, .32), .50, .48)
    m["edge"] = material("Vesper scavenged alloy", (.68, .61, .74), .64, .34)
    m["dark"] = material("Vesper carbon frame", (.035, .028, .052), .52, .62)
    m["steel"] = material("Vesper violet steel", (.29, .20, .43), .58, .39)
    m["accent"] = material("Vesper signal violet", (.62, .22, 1.0), .18, .22, (.50, .09, 1.0), 2.7)
    m["glass"] = material("Vesper ion glass", (.34, .19, .57), .42, .18, (.26, .055, .78), 1.2)
    m["warning"] = material("Vesper heat warning", (.94, .32, .16), .26, .44)
    m["recess"] = material("Vesper shadow recess", (.012, .009, .024), .32, .78)
    return m


def vesper_command_yard():
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper command skid", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .035)
    # Offset, overlapping salvage plates create a low angular footprint with a
    # single unmistakable signal crown, distinct from the Aegis command bridge.
    faceted_prism("Vesper left salvage shell",
        [(-1.22,-1.05),(-.15,-1.25),(.02,-.88),(-.12,.91),(-.48,1.16),(-1.22,.84)],
        [(-1.03,-.91),(-.18,-1.08),(-.10,-.76),(-.22,.77),(-.56,.98),(-1.04,.73)], .25,.78,m["armor"])
    faceted_prism("Vesper right salvage shell",
        [(.12,-1.18),(1.18,-.95),(1.22,.86),(.62,1.18),(.18,.78)],
        [(.23,-.98),(1.02,-.79),(1.06,.69),(.62,.95),(.29,.65)], .25,.69,m["steel"])
    cube("Command core socket", (0, -.12, .78), (.94, 1.18, .82), m["dark"], .035)
    faceted_prism("Faceted signal crown", [(-.56,-.64),(.38,-.64),(.62,-.25),(.40,.52),(-.48,.62),(-.68,.18)],
        [(-.38,-.49),(.27,-.49),(.43,-.20),(.28,.36),(-.34,.44),(-.48,.12)], 1.05,1.72,m["armor"])
    cube("Violet command window", (0, .245, 1.37), (.48, .035, .38), m["glass"], .015)
    cube("Signal blade", (0, -.12, 1.79), (.08, .08, .38), m["accent"], .012)
    for x in [-.82,.82]:
        cube("Salvage brace", (x, -.02, .54), (.14, 1.45, .19), m["edge"], .012)
        cube("Beacon inset", (x, .78, .39), (.22, .055, .09), m["accent"], .008)
    for x in [-.41,.41]:
        cube("Crown armor fin", (x, -.12, 1.00), (.16,.88,.25), m["steel"], .02)
        cube("Crown inset armor", (x, -.15, 1.16), (.10,.43,.045), m["edge"], .008)
    # Operations hatch, paired louver banks and a visible service run break up
    # the broad salvage shells at card scale.
    cube("Command access recess", (.48, -.72, .48), (.045,.47,.34), m["recess"], .008)
    cube("Command access door", (.51, -.72, .48), (.045,.34,.24), m["steel"], .008)
    for z in [.40,.46,.52,.58]:
        cube("Command door rib", (.54,-.72,z), (.018,.26,.018), m["edge"], .003)
    for y in [-.52,-.31,-.10,.11]:
        cube("Command intake slot", (1.12,y,.58), (.035,.11,.20), m["recess"], .004)
        cube("Command intake blade", (1.145,y,.58), (.02,.085,.035), m["edge"], .003)
    for x in [-.88,-.60,.60,.88]:
        cube("Command roof service plate", (x,-.28,.82), (.20,.32,.055), m["steel"], .008)
        cube("Command plate status light", (x,-.28,.855), (.07,.12,.018), m["accent"], .004)
    cube("Command signal mast base", (0,-.75,1.72), (.32,.28,.12), m["dark"], .012)
    cylinder("Command signal mast", (0,-.75,1.91), .035,.32,m["edge"],8)
    cylinder("Command mast beacon", (0,-.75,2.09), .075,.09,m["accent"],8)
    # A raised, offset salvage gantry gives the yard a strong command silhouette
    # at battlefield zoom and breaks the symmetry of the Aegis bridge.
    gantry_parts = []
    gantry_parts.append(cube("Gantry heel", (.82,-.55,.83), (.30,.34,.14), m["dark"], .018))
    gantry_parts.append(faceted_prism("Signal gantry shoulder",
        [(.68,-.73),(.97,-.73),(1.04,-.38),(.87,-.20),(.68,-.34)],
        [(.73,-.66),(.92,-.66),(.97,-.41),(.86,-.30),(.73,-.40)], .88,1.52,m["steel"]))
    gantry_parts.append(cube("Signal gantry crossbar", (.84,-.52,1.53), (.72,.12,.11), m["steel"], .012))
    # Large luminous signal blade remains legible when the building is small.
    gantry_parts.append(cube("Gantry signal blade", (1.13,-.52,1.72), (.075,.09,.48), m["accent"], .01))
    gantry_parts.append(cube("Gantry violet window", (.86,-.424,1.28), (.18,.025,.24), m["steel"], .008))
    for x in [-1.13,1.13]:
        for y in [-.96,.92]:
            cube("Skid corner marker", (x,y,.28), (.22,.20,.08), m["warning"], .008)
    for y in [-.78,-.48,-.18]:
        cube("Side radiator tooth", (1.13,y,.48), (.08,.17,.13), m["edge"], .01)
    consolidate_static_meshes(
        preserved=("Vesper salvage signal arm",),
        join_groups=(("Vesper salvage signal arm", gantry_parts, (.82,-.55,.83)),),
    ); export("vesper-command-yard")
    LOW_POLY_BEVEL = previous_bevel


def vesper_refinery():
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper refinery skid", (0,0,.13), (2.86,2.86,.26), m["dark"], .035)
    # Two squat, faceted ore crucibles and an exposed transfer spine read as a
    # rougher, field-reclaimed process line than the shared cylindrical plant.
    faceted_prism("Crucible one", [(-1.05,-.82),(-.25,-.94),(.02,-.48),(-.10,.36),(-.78,.50),(-1.10,.08)],
        [(-.91,-.67),(-.32,-.75),(-.14,-.43),(-.22,.24),(-.72,.35),(-.94,.02)], .25,1.05,m["armor"])
    faceted_prism("Crucible two", [(.28,-.67),(1.08,-.76),(1.16,.06),(.82,.43),(.30,.32)],
        [(.40,-.52),(.93,-.59),(1.00,.00),(.78,.26),(.42,.20)], .25,.91,m["steel"])
    for x,y,z,r in [(-.55,-.10,1.08,.35),(.70,-.16,.94,.29)]:
        cylinder("Crucible armored rim", (x,y,z), r, .10, m["edge"], 8)
        cylinder("Crucible dark opening", (x,y,z+.055), r*.69, .018, m["recess"], 8)
        cube("Violet process gauge", (x,y+.38,z-.22), (.20,.035,.13), m["accent"], .008)
    # A raised angular separator sits between the vessels and gives the plant
    # a clear third mass with a serviceable machinery face.
    faceted_prism("Separator housing", [(-.18,-.66),(.22,-.66),(.35,-.42),(.32,.18),(-.26,.18),(-.34,-.35)],
        [(-.12,-.56),(.17,-.56),(.24,-.37),(.22,.08),(-.18,.08),(-.24,-.32)], .30,1.18,m["steel"])
    cube("Separator access panel", (-.01,-.69,.68), (.27,.035,.36), m["dark"], .008)
    for z in [.57,.66,.75,.84]:
        cube("Separator status strip", (-.01,-.715,z), (.17,.018,.035), m["accent"], .003)
    for x in [-.13,.13]:
        cylinder("Separator exhaust", (x,-.05,1.21), .045,.30,m["edge"],8)
        cylinder("Separator exhaust cap", (x,-.05,1.37), .07,.04,m["warning"],8)
    cube("Ore transfer channel", (-.02,.61,.58), (1.70,.38,.20), m["dark"], .025)
    cube("Ion transfer strip", (-.02,.61,.695), (1.35,.09,.025), m["accent"], .008)
    for x in [-.72,-.35,.02,.39,.76]:
        cube("Channel armor tooth", (x,.61,.73), (.08,.46,.08), m["steel"], .01)
    for x in [-.78,.68]:
        cylinder("Exposed return pipe", (x,-.36,.80), .055,.78,m["edge"],8,(math.pi/2,0,0))
        cylinder("Pipe coupling", (x,-.77,.80), .085,.08,m["warning"],8,(math.pi/2,0,0))
    # A diagonal manifold visibly links the crucibles to the transfer line.
    for x in [-.50,.62]:
        cylinder("Process riser", (x,-.59,.88), .045,.47,m["warning"],8)
        cylinder("Process valve", (x,-.59,1.13), .095,.045,m["edge"],8)
        cube("Valve signal tab", (x,-.65,1.14), (.12,.035,.035), m["accent"], .004)
    for z in [.51,.63,.75]:
        cylinder("Manifold cross run", (.02,-.84,z), .035,1.48,m["edge"],8,(0,math.pi/2,0))
        for x in [-.66,-.22,.22,.66]:
            cylinder("Manifold union", (x,-.84,z), .060,.055,m["steel"],8,(0,math.pi/2,0))
    # Faceted braces, ladders and a small operator panel make each vessel
    # read as serviceable machinery instead of a pair of featureless blocks.
    for x,y,z in [(-.55,-.1,1.08),(.70,-.16,.94)]:
        for dx in [-.20,.20]:
            cube("Crucible ladder rail", (x+dx,y-.39,.65), (.028,.035,.56), m["edge"], .004)
        for zz in [.43,.55,.67,.79]:
            cube("Crucible ladder rung", (x,y-.415,zz), (.42,.035,.026), m["warning"], .004)
        cube("Crucible service hatch", (x,y-.43,.92), (.22,.035,.18), m["recess"], .006)
        cube("Crucible hatch lamp", (x,y-.455,.92), (.09,.018,.045), m["accent"], .004)
    cube("Refinery operator cabinet", (-.87,.49,.48), (.42,.34,.39), m["steel"], .018)
    cube("Operator console face", (-.87,.315,.50), (.28,.025,.23), m["recess"], .006)
    for x in [-.96,-.87,-.78]:
        cube("Console indicator", (x,.296,.55), (.035,.018,.045), m["accent"], .003)
    for x in [-1.10,-.84,-.58]:
        cube("Refinery roof extractor", (x,.49,.80), (.16,.25,.18), m["dark"], .012)
        cube("Extractor cap", (x,.49,.90), (.19,.27,.045), m["edge"], .008)
        cube("Extractor grille", (x,.49,.93), (.12,.16,.018), m["recess"], .004)
    cube("Front loading recess", (.02,-1.05,.39), (.86,.045,.25), m["recess"], .01)
    cube("Loading signal", (.02,-1.08,.51), (.56,.025,.045), m["accent"], .006)
    consolidate_static_meshes(); export("vesper-refinery")
    LOW_POLY_BEVEL = previous_bevel


def vesper_factory():
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper factory skid", (0,0,.13), (2.86,2.86,.26), m["dark"], .035)
    faceted_prism("Asymmetric assembly hall", [(-1.20,-.90),(.62,-1.12),(1.18,-.60),(1.13,.72),(.72,1.02),(-1.19,.87)],
        [(-1.02,-.73),(.54,-.91),(.98,-.48),(.95,.55),(.62,.80),(-1.00,.69)], .25,1.18,m["armor"])
    # The offset open gantry and angled shoulder stacks give this factory a
    # salvage-yard silhouette instead of the Aegis enclosed assembly shed.
    for x in [-.72,.72]:
        cube("Gantry leg", (x,-.78,.70), (.18,.20,.94), m["steel"], .018)
        cube("Gantry violet rail", (x,-.895,.67), (.045,.022,.55), m["accent"], .006)
    cube("Open fabrication gantry", (0,-.77,1.13), (1.72,.22,.17), m["edge"], .02)
    cube("Suspended tool carriage", (.18,-.60,.94), (.33,.28,.20), m["dark"], .018)
    cube("Carriage signal", (.18,-.44,.94), (.19,.025,.055), m["accent"], .006)
    cube("Vehicle bay recess", (-.12,-1.02,.51), (1.24,.035,.70), m["recess"], .01)
    for x in [-.82,.58]:
        cube("Bay jamb", (x,-1.045,.51), (.13,.07,.82), m["edge"], .01)
        cube("Bay guide light", (x,-1.09,.51), (.035,.025,.58), m["accent"], .004)
    cube("Bay lintel", (-.12,-1.05,.95), (1.50,.10,.12), m["steel"], .012)
    for x,y,z in [(-.92,-.68,1.40),(.88,-.61,1.57)]:
        cube("Angled exhaust housing", (x,y,z), (.38,.42,.48), m["steel"], .025)
        cylinder("Hot exhaust collar", (x,y,z+.25), .19,.06,m["warning"],8)
        cylinder("Exhaust mouth", (x,y,z+.29), .12,.025,m["recess"],8)
    for x in [-.84,-.50,.50,.84]:
        cube("Roof scavenged plate", (x,-.20,1.215), (.20,.58,.055), m["edge"], .01)
    cube("Loading shutter", (.36,-1.065,.42), (.42,.035,.48), m["steel"], .008)
    for x in [-.38,-.23,-.08,.07]:
        cube("Shutter rib", (x+.54,-1.09,.42), (.025,.018,.43), m["edge"], .003)
    for x in [-.72,.36]:
        cube("Bay door track", (x,-1.04,.49), (.07,.08,.62), m["edge"], .008)
        cube("Track violet guide", (x,-1.095,.49), (.025,.018,.42), m["accent"], .003)
    for x in [-.92,-.56,.56,.92]:
        cube("Factory roof armor panel", (x,-.05,1.22), (.22,.51,.065), m["steel"], .008)
        cube("Panel inset", (x,-.05,1.26), (.12,.31,.018), m["dark"], .004)
        cube("Panel status lamp", (x,-.05,1.275), (.06,.09,.018), m["accent"], .003)
    for y in [-.55,-.20,.15,.50]:
        cube("Factory side vent recess", (1.01,y,.66), (.04,.22,.23), m["recess"], .005)
        for z in [.59,.66,.73]:
            cube("Factory vent louver", (1.04,y,z), (.025,.17,.025), m["edge"], .003)
    # External coolant lines and service couplings trace the hall's silhouette.
    for x in [-.98,.98]:
        cylinder("Factory coolant riser", (x,-.38,.79), .045,.78,m["edge"],8)
        cylinder("Coolant elbow", (x,-.77,.41), .06,.32,m["steel"],8,(math.pi/2,0,0))
        for z in [.52,.84,1.12]:
            cylinder("Coolant clamp", (x,-.38,z), .066,.045,m["warning"],8)
    cube("Fabrication crane rail", (0,.25,1.30), (1.48,.09,.08), m["dark"], .01)
    for x in [-.58,.58]:
        cube("Crane rail cap", (x,.25,1.35), (.15,.18,.05), m["accent"], .006)
    cube("Factory service door", (-.91,-.93,.51), (.22,.05,.38), m["recess"], .006)
    cube("Service door panel", (-.91,-.965,.51), (.16,.025,.29), m["steel"], .005)
    cube("Door access lamp", (-.83,-.982,.56), (.035,.015,.08), m["accent"], .003)
    # Vesper's gantry is visibly salvaged: offset legs, a broken crown and a
    # hanging ion cutter make it read as a field-built vehicle works.
    for x, lean in [(-.96, -.08), (.72, .06)]:
        leg = cube("Salvage crane stanchion", (x, -.84, 1.42), (.20, .23, .75), m["steel"], .014)
        leg.rotation_euler[1] = lean
        cube("Crane stanchion violet seam", (x, -.966, 1.42), (.055, .025, .54), m["accent"], .005)
        cube("Stanchion anchor plate", (x, -.80, 1.06), (.34, .36, .12), m["edge"], .012)
    cube("Salvage crane broken crossbeam", (-.10, -.83, 1.82), (1.92, .28, .16), m["edge"], .018)
    cube("Crossbeam violet channel", (-.10, -.986, 1.82), (1.40, .025, .045), m["accent"], .006)
    # Open gap and irregular cap plates distinguish the beam from Aegis's clean bridge.
    cube("Crane splice collar", (-.62, -.83, 1.82), (.26, .34, .22), m["dark"], .012)
    cube("Crane end warning cap", (.82, -.83, 1.82), (.18, .34, .21), m["warning"], .012)
    cube("Scavenged tool carriage", (-.22, -.78, 1.64), (.40, .36, .18), m["dark"], .014)
    cube("Carriage ion lens", (-.22, -.975, 1.65), (.18, .026, .07), m["accent"], .005)
    for x in [-.31, -.13]:
        cylinder("Cutter suspension", (x, -.78, 1.40), .022, .31, m["edge"], 8)
    cone("Ion cutting head", (-.22, -.78, 1.20), .15, .07, .16, m["warning"], 6)
    # Exposed roller bed and paired rails sell the open loading bay as a working line.
    for x in [-.48, -.24, 0, .24, .48]:
        cylinder("Vesper conveyor roller", (x, -1.12, .30), .035, .12, m["edge"], 8, (0, math.pi/2, 0))
    for x in [-.62, .50]:
        cube("Salvage loading rail", (x, -1.12, .27), (.065, .40, .06), m["accent"], .006)
    consolidate_static_meshes(); export("vesper-factory")
    LOW_POLY_BEVEL = previous_bevel


def vesper_power_plant():
    """Field-built ion reactor with a split basalt shell and exposed power spine."""
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper reactor skid", (0,0,.13), (2.82,2.82,.26), m["dark"], .035)
    # Two irregular containment masses deliberately leave the charged core
    # exposed, giving this plant a broken, scavenged silhouette.
    faceted_prism("Left containment shell",
        [(-1.20,-.92),(-.18,-1.10),(-.03,-.48),(-.20,.82),(-.74,1.08),(-1.20,.70)],
        [(-1.02,-.75),(-.32,-.91),(-.20,-.43),(-.34,.65),(-.76,.87),(-1.02,.57)], .25,.91,m["armor"])
    faceted_prism("Right containment shell",
        [(.20,-1.08),(1.13,-.83),(1.19,.67),(.67,1.08),(.22,.72)],
        [(.34,-.89),(.97,-.68),(1.02,.54),(.66,.86),(.35,.58)], .25,.83,m["steel"])
    # Raised ion spine and angular braces are the landmark read at gameplay zoom.
    cube("Reactor core socket", (0,-.02,.85), (.62,.70,.40), m["recess"], .025)
    faceted_prism("Exposed ion crystal", [(-.34,-.22),(.20,-.28),(.37,.08),(.22,.48),(-.25,.43),(-.40,.10)],
        [(-.23,-.13),(.15,-.18),(.26,.08),(.14,.38),(-.17,.34),(-.29,.10)], .98,1.77,m["glass"])
    cube("Ion spine luminous face", (0,.227,1.34), (.28,.025,.50), m["accent"], .008)
    for x in [-.42,.42]:
        brace = cube("Containment fork", (x,-.02,1.14), (.11,.15,.85), m["edge"], .012)
        brace.rotation_euler[1] = math.radians(-x*18)
        cube("Fork warning cap", (x*1.06,-.02,1.55), (.15,.19,.075), m["warning"], .01)
    # Twin low exhaust drums sit behind the core; unlike the Aegis plant they
    # are canted outward and vent laterally through violet grilles.
    for side in [-1,1]:
        x = side*.84
        drum = cylinder("Slag exhaust drum", (x,-.68,.74), .34,.72,m["dark"],8)
        drum.rotation_euler[1] = side*math.radians(9)
        cylinder("Drum armored lip", (x,-.68,1.13), .38,.10,m["edge"],8)
        cylinder("Violet exhaust aperture", (x,-.68,1.19), .24,.025,m["accent"],8)
        cube("Lateral heat grille", (side*1.17,-.28,.72), (.035,.48,.33), m["recess"], .006)
        for z in [.60,.69,.78,.87]:
            cube("Heat grille vane", (side*1.195,-.28,z), (.02,.37,.025), m["warning"], .004)
        cylinder("Ion feed conduit", (side*.57,-.43,.99), .055,.62,m["warning"],8,(0,math.pi/2,0))
    cube("Front service recess", (0,.91,.42), (.58,.035,.35), m["recess"], .008)
    cube("Front power bus", (0,.94,.53), (.39,.025,.045), m["accent"], .005)
    for x in [-.87,.87]:
        cube("Skid signal marker", (x,.98,.28), (.21,.09,.08), m["warning"], .008)
    consolidate_static_meshes(); export("vesper-power-plant")
    LOW_POLY_BEVEL = previous_bevel


def vesper_barracks():
    """Low salvage troop bunker with offset dugout pods and signal mast."""
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper barracks skid", (0,0,.12), (2.82,2.82,.24), m["dark"], .035)
    faceted_prism("Main dugout armor", [(-1.18,-.86),(.30,-1.04),(1.08,-.66),(1.14,.64),(.62,1.00),(-1.18,.82)],
        [(-1.01,-.69),(.22,-.84),(.90,-.51),(.96,.49),(.56,.79),(-1.00,.64)], .24,.78,m["armor"])
    # Offset sleeping pods create an unmistakably different outline from the
    # rectangular shared barracks while retaining readable troop entrances.
    for x,y,z,w in [(-.70,-.12,.84,.48),(.02,-.26,.91,.52),(.69,-.12,.80,.46)]:
        cube("Raised sleeping pod", (x,y,z), (w,.68,.33), m["steel"], .035)
        cube("Pod armored roof", (x,y,z+.19), (w+.09,.73,.07), m["edge"], .018)
        cube("Pod violet vent", (x,y-.36,z), (w*.62,.025,.11), m["accent"], .006)
    # A broad, low entry is cut into the forward face, flanked by salvaged armor.
    cube("Dugout entry shadow", (0,.86,.42), (.66,.05,.42), m["recess"], .01)
    cube("Armored entry door", (0,.894,.39), (.40,.025,.31), m["dark"], .006)
    for x in [-.22,.22]:
        cube("Door edge signal", (x,.915,.40), (.025,.012,.27), m["accent"], .003)
    cube("Entry lintel armor", (0,.87,.68), (.88,.15,.12), m["edge"], .018)
    for x in [-.92,.92]:
        brace = cube("Splayed bunker buttress", (x,.58,.48), (.28,.54,.48), m["steel"], .02)
        brace.rotation_euler[1] = math.radians(-x*14)
        cube("Buttress beacon", (x,.88,.56), (.17,.035,.055), m["warning"], .006)
    # Rear-facing comms mast and oversized violet pennant provide a faction cue.
    cube("Signal mast footing", (-.86,-.65,.89), (.30,.32,.17), m["dark"], .018)
    cylinder("Signal mast", (-.86,-.65,1.27), .035,.72,m["edge"],8)
    cube("Vesper signal pennant", (-.67,-.65,1.52), (.40,.06,.22), m["accent"], .008)
    cylinder("Mast beacon", (-.86,-.65,1.68), .08,.08,m["warning"],8)
    # Side bunk ventilation and visible utility canisters add small-scale detail.
    for side in [-1,1]:
        for y in [-.47,-.17,.13]:
            cube("Bunk intake", (side*1.03,y,.48), (.035,.18,.13), m["recess"], .004)
            cube("Intake blade", (side*1.055,y,.48), (.018,.12,.018), m["edge"], .003)
        cylinder("Field oxygen canister", (side*.94,-.72,.48), .11,.37,m["warning"],8)
    cube("Barracks roof signal", (0,-.33,1.13), (.62,.16,.06), m["accent"], .008)
    consolidate_static_meshes(); export("vesper-barracks")
    LOW_POLY_BEVEL = previous_bevel


def vesper_radar_array():
    """Salvage signal station with a forked mast and offset dish crown."""
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper radar skid", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .035)
    faceted_prism("Asymmetric radar bunker",
        [(-1.18,-.82),(.18,-1.05),(1.10,-.55),(1.02,.74),(.44,1.04),(-1.12,.72)],
        [(-1.01,-.64),(.12,-.83),(.91,-.42),(.83,.57),(.39,.82),(-.98,.56)], .24,.72,m["armor"])
    cube("Bunker roof salvage plate", (-.05,-.04,.77), (1.76,1.43,.12), m["steel"], .025)
    # The mast's wide fork and canted twin receivers create a recognizable
    # silhouette distinct from the single-dish Aegis radar.
    cylinder("Signal mast socket", (.28,-.40,.88), .24,.18,m["edge"],8)
    cylinder("Signal mast", (.28,-.40,1.41), .075,1.00,m["dark"],8)
    for side in [-1,1]:
        brace = cube("Forked receiver arm", (.28+side*.42,-.40,1.77), (.075,.075,.72), m["edge"], .01)
        brace.rotation_euler[1] = side * math.radians(31)
        cylinder("Receiver dish rim", (.28+side*.58,-.40,2.05), .35,.11,m["steel"],8,(math.radians(22),0,side*math.radians(18)))
        cylinder("Receiver dish face", (.28+side*.58,-.40,2.115), .25,.025,m["dark"],8,(math.radians(22),0,side*math.radians(18)))
        cylinder("Violet receiver core", (.28+side*.58,-.40,2.17), .10,.07,m["accent"],8)
    cube("Telemetry crossbar", (.28,-.40,1.62), (1.08,.09,.09), m["edge"], .012)
    for x in [-.68,-.34,0,.34]:
        cube("Bunker violet status slit", (x,.70,.49), (.18,.035,.08), m["accent"], .006)
    for side in [-1,1]:
        cube("Side heat recess", (side*1.02,-.12,.48), (.035,.56,.25), m["recess"], .005)
        for y in [-.30,-.12,.06]:
            cube("Salvage heat vane", (side*1.045,y,.48), (.025,.06,.17), m["edge"], .004)
    cube("Forward equipment access", (0,1.02,.39), (.56,.045,.27), m["recess"], .008)
    cube("Amber service marker", (.40,1.05,.39), (.10,.025,.18), m["warning"], .004)
    consolidate_static_meshes(); export("vesper-radar-array")
    LOW_POLY_BEVEL = previous_bevel


def vesper_research_center():
    """Compact salvage laboratory wrapped around a suspended violet core."""
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = vesper_palette()
    cube("Vesper laboratory skid", (0,0,.12), (2.86,2.86,.24), m["dark"], .035)
    faceted_prism("Main research shell",
        [(-1.18,-.91),(.54,-1.08),(1.17,-.57),(1.12,.77),(.40,1.03),(-1.16,.76)],
        [(-1.00,-.72),(.48,-.87),(.96,-.43),(.93,.59),(.36,.82),(-.98,.59)], .24,.78,m["armor"])
    # Raised, offset observation bay contrasts with the industrial bunker mass.
    cube("Lab roof beam", (-.18,-.10,.84), (1.98,1.56,.13), m["dark"], .025)
    cube("Observation chamber frame", (-.18,.02,1.06), (1.30,.86,.34), m["edge"], .025)
    cube("Violet observation glazing", (-.18,.02,1.08), (1.20,.77,.25), m["glass"], .018)
    for x in [-.48,-.18,.12]:
        cube("Forward lab window", (x,.456,1.08), (.24,.035,.22), m["glass"], .008)
        cube("Window mullion", (x+.13,.48,1.08), (.025,.018,.24), m["edge"], .003)
    cube("Armored canopy", (-.18,.02,1.29), (1.55,1.02,.11), m["steel"], .025)
    # Angled braces and a tall offset core give the roof a laboratory profile.
    for side in [-1,1]:
        brace = cube("Observation bay brace", (-.18+side*.66,.02,1.00), (.12,.92,.25), m["edge"], .015)
        brace.rotation_euler[1] = side*math.radians(14)
    cylinder("Quantum core base", (.64,-.55,.97), .35,.28,m["dark"],8)
    cylinder("Core containment collar", (.64,-.55,1.15), .38,.10,m["edge"],8)
    cylinder("Suspended violet core", (.64,-.55,1.43), .22,.50,m["accent"],8)
    cylinder("Core crown", (.64,-.55,1.72), .13,.09,m["warning"],8)
    for side in [-1,1]:
        cube("Lab side armor rib", (side*1.07,-.18,.56), (.12,.86,.24), m["steel"], .014)
        for y in [-.42,-.18,.06]:
            cube("Cooling vent recess", (side*1.14,y,.47), (.025,.14,.12), m["recess"], .003)
            cube("Cooling vent blade", (side*1.16,y,.47), (.02,.09,.025), m["edge"], .003)
    cube("Recessed lab entrance", (-.24,.85,.42), (.62,.045,.34), m["recess"], .008)
    cube("Entry armored door", (-.24,.88,.40), (.40,.025,.28), m["dark"], .005)
    for x in [-.50,.02]:
        cube("Entry signal strip", (x,.90,.42), (.035,.02,.27), m["accent"], .004)
    cube("Amber access indicator", (.22,.91,.46), (.08,.025,.07), m["warning"], .004)
    for x in [-.72,-.42,.42,.72]:
        cube("Roof instrument plate", (x,-.76,.88), (.20,.26,.055), m["steel"], .008)
        cube("Instrument signal lamp", (x,-.76,.916), (.07,.10,.018), m["accent"], .003)
    consolidate_static_meshes(); export("vesper-research-center")
    LOW_POLY_BEVEL = previous_bevel


def advanced_power():
    clean(); m = palette()
    cube("Advanced reactor foundation", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .07)
    # Three insulated core lobes surround a raised, luminous fusion chamber.
    for x, y, radius, height in [(-.67, -.48, .43, .86), (.67, -.48, .43, .86), (0, .53, .40, .72)]:
        cylinder("Reactor containment pod", (x, y, .25 + height/2), radius, height, m["armor"], 10)
        cylinder("Pod crown", (x, y, .28 + height), radius*1.05, .10, m["edge"], 10)
        cylinder("Pod indicator", (x, y, .34 + height), radius*.48, .035, m["accent"], 10)
    cylinder("Fusion core plinth", (0, -.10, .55), .49, .56, m["dark"], 8)
    cylinder("Fusion chamber", (0, -.10, 1.00), .38, .42, m["glass"], 8)
    cylinder("Containment halo", (0, -.10, 1.23), .52, .085, m["edge"], 8)
    cylinder("Core beacon", (0, -.10, 1.48), .13, .38, m["accent"], 8)
    for x in [-.82, .82]:
        cube("Power conduit", (x, -.15, .48), (.12, 1.34, .18), m["edge"], .035)
    cube("Front control console", (0, .90, .38), (.75, .08, .24), m["dark"], .03)
    cube("Console status bar", (0, .95, .48), (.46, .025, .045), m["accent"], .01)
    export("advanced-power")


def radar_array():
    clean(); m = palette()
    cube("Radar base platform", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .06)
    cube("Signal operations bunker", (0, -.35, .43), (1.82, 1.38, .38), m["armor"], .09)
    cube("Bunker roof", (0, -.35, .66), (1.96, 1.50, .10), m["edge"], .035)
    for x in [-.57, 0, .57]:
        cube("Radar screen", (x, .36, .52), (.30, .045, .12), m["glass"], .018)
    # Off-center mast and broad, faceted dish produce a strong radar silhouette.
    cylinder("Antenna mast", (.18, -.42, 1.10), .075, .92, m["dark"], 8)
    cylinder("Mast collar", (.18, -.42, .82), .17, .10, m["accent"], 8)
    dish = cylinder("Faceted radar dish", (.18, -.42, 1.63), .67, .15, m["edge"], 12, (math.radians(28), 0, math.radians(-16)))
    # A contrasting shallow center cone and feed arm make the dish readable at a glance.
    cylinder("Dish inner face", (.18, -.42, 1.71), .48, .045, m["dark"], 12, (math.radians(28), 0, math.radians(-16)))
    cylinder("Dish signal hub", (.18, -.42, 1.80), .16, .08, m["accent"], 10)
    cube("Feed arm", (.18, -.42, 1.87), (.07, .07, .38), m["edge"], .015)
    cylinder("Feed receiver", (.18, -.42, 2.05), .11, .10, m["glass"], 10)
    for x in [-.78, .78]:
        cube("Bunker perimeter beacon", (x, .43, .47), (.16, .16, .12), m["accent"], .025)
    export("radar-array")


def defense_turret():
    global LOW_POLY_BEVEL
    previous_bevel = LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    m["armor"] = material("Sentinel ceramic", (.47,.60,.61), .43,.40)
    m["edge"] = material("Sentinel pale alloy", (.78,.85,.79), .55,.32)
    m["dark"] = material("Sentinel graphite", (.045,.085,.105), .38,.64)
    m["steel"] = material("Sentinel blue steel", (.16,.29,.34), .63,.37)
    m["accent"] = material("TeamAccent", (.035,.68,.84), .30,.25,(.01,.28,.48),1.35)
    # A broad, low profile firing deck gives the emplacement a recognizable
    # four-shouldered silhouette while staying inside its original tile pad.
    cube("Turret emplacement", (0,0,.13), (2.84,2.84,.26), m["dark"], .055)
    cube("Reinforced firing deck", (0,0,.30), (2.30,2.30,.14), m["steel"], .045)
    for x in [-.91,.91]:
        for y in [-.91,.91]:
            block=cube("Angled armor buttress", (x,y,.43), (.48,.48,.26), m["armor"], .055)
            block.rotation_euler[2]=math.copysign(math.radians(10),x*y)
            cube("Buttress signal inset", (x*.94,y*.94,.575), (.19,.19,.035), m["accent"], .012)
    # The stationary armored cup is deliberately separate from the gun pack:
    # the head slews as one compact mesh, preserving authored aiming in combat.
    cylinder("Bearing race", (0,-.05,.47), .91,.19,m["dark"],12)
    cylinder("Machined traverse ring", (0,-.05,.575), .82,.09,m["edge"],12)
    cylinder("Lower casemate", (0,-.05,.73), .74,.30,m["armor"],10)
    faceted_prism("Fixed upper glacis", [(-.70,-.56),(.70,-.56),(.78,-.18),(.70,.55),(-.70,.55),(-.78,-.18)],
        [(-.56,-.46),(.56,-.46),(.65,-.14),(.58,.43),(-.58,.43),(-.65,-.14)], .78,.91,m["steel"])
    for side in [-1,1]:
        cube("Casemate cheek plate", (side*.75,-.03,.69), (.095,.70,.18), m["edge"], .022)
        for y in [-.31,-.09,.13]:
            cube("Casemate vent recess", (side*.802,y,.70), (.025,.12,.085), m["dark"], .008)
        cube("Cheek warning bar", (side*.806,.35,.78), (.026,.22,.045), m["warning"], .007)
    # Pack all traverse hardware, armor and barrels around one Blender origin.
    # The mesh remains multi-material, but costs one draw per material and one
    # animated node instead of a dozen tiny object draws.
    head=[]
    def head_cube(*args, **kwargs):
        obj=cube(*args, **kwargs); head.append(obj); return obj
    def head_cylinder(*args, **kwargs):
        obj=cylinder(*args, **kwargs); head.append(obj); return obj
    def head_prism(*args, **kwargs):
        obj=faceted_prism(*args, **kwargs); head.append(obj); return obj
    head_cylinder("Rotating gun mount", (0,-.05,.98), .49,.19,m["dark"],12)
    head_cylinder("Traverse crown", (0,-.05,1.085), .44,.065,m["edge"],12)
    head_prism("Sentinel rotating head",
        [(-.48,-.43),(.48,-.43),(.57,-.22),(.56,.28),(.36,.53),(-.36,.53),(-.56,.28),(-.57,-.22)],
        [(-.39,-.35),(.39,-.35),(.47,-.16),(.46,.24),(.30,.43),(-.30,.43),(-.46,.24),(-.47,-.16)],
        1.10,1.40,m["armor"])
    head_cube("Turret crown keel", (0,-.015,1.43), (.13,.65,.055), m["edge"], .015)
    head_cube("Turret nose armor", (0,.40,1.26), (.76,.18,.25), m["steel"], .055)
    for x in [-.34,.34]:
        head_cube("Autocannon breech", (x,.20,1.34), (.25,.43,.25), m["dark"], .045)
        head_cylinder("Autocannon barrel", (x,.68,1.35), .086,.72,m["edge"],10,(math.pi/2,0,0))
        head_cylinder("Thermal sleeve", (x,.58,1.35), .118,.22,m["steel"],10,(math.pi/2,0,0))
        head_cylinder("Muzzle collar", (x,1.02,1.35), .13,.105,m["accent"],10,(math.pi/2,0,0))
        head_cylinder("Muzzle bore", (x,1.075,1.35), .068,.014,m["recess"],10,(math.pi/2,0,0))
        for y in [.48,.57,.66]:
            head_cube("Barrel cooling fin", (x+(.12 if x>0 else -.12),y,1.35), (.045,.035,.11), m["edge"], .006)
    head_cube("Targeting optic housing", (0,.12,1.53), (.32,.22,.13), m["dark"], .035)
    targeting_optic=head_cube("Targeting optic", (0,.24,1.54), (.21,.035,.075), m["glass"], .012)
    # Keep the lens as its own named node so the renderer can pulse it with the
    # sentry's active/idle state while it follows the traversing gun assembly.
    head.remove(targeting_optic)
    for x in [-.43,.43]:
        head_cube("Head shoulder applique", (x,-.08,1.24), (.15,.47,.13), m["edge"], .025)
        head_cube("Shoulder team light", (x,.17,1.26), (.10,.075,.05), m["accent"], .01)
    head_cylinder("Commander hatch", (-.22,-.24,1.42), .10,.055,m["steel"],10)
    head_cylinder("Hatch signal", (-.22,-.24,1.454), .035,.018,m["warning"],8)
    head_cube("Rangefinder antenna", (.24,-.25,1.51), (.035,.31,.03), m["edge"], .006)
    consolidate_static_meshes(
        preserved=("Rotating gun assembly","Targeting optic"),
        join_groups=(("Rotating gun assembly",head,(0,-.05,.98)),),
    )
    export("defense-turret")
    LOW_POLY_BEVEL=previous_bevel


def modular_wall():
    clean(); m = palette()
    # A single tile-width barricade module: broad foundation, sloped blast
    # panel, armored end posts, and exposed couplers that read as connectable.
    cube("Wall foundation shoe", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .07)
    cube("Reinforced wall core", (0, 0, .64), (2.52, .78, .82), m["steel"], .09)
    cube("Blast face armor", (0, -.43, .67), (2.30, .16, .63), m["armor"], .075)
    cube("Upper parapet rail", (0, 0, 1.12), (2.68, .92, .16), m["edge"], .055)
    cube("Continuous team signal", (0, -.525, .83), (1.38, .035, .075), m["accent"], .018)
    # Recessed face bays and raised ribs make the wall legible at RTS scale.
    for x in [-.72, 0, .72]:
        cube("Inset blast panel", (x, -.526, .57), (.47, .028, .28), m["dark"], .035)
        cube("Panel face", (x, -.546, .57), (.36, .018, .19), m["steel"], .022)
        cube("Parapet merlon", (x, 0, 1.25), (.34, .98, .15), m["armor"], .035)
        cube("Rear reinforcement rib", (x, .435, .66), (.085, .08, .69), m["edge"], .018)
    for x in [-1.19, 1.19]:
        cube("Interlocking end post", (x, 0, .68), (.25, 1.00, .98), m["armor"], .065)
        cube("Post cap", (x, 0, 1.20), (.34, 1.08, .13), m["edge"], .035)
        # Dark sockets remain visible on each end when modules meet.
        cylinder("Wall coupler socket", (x, 0, .32), .105, .09, m["recess"], 8, (math.pi/2, 0, 0))
        cylinder("Wall coupler pin", (x, -.055, .32), .055, .035, m["accent"], 8, (math.pi/2, 0, 0))
    for x in [-.92, .92]:
        cube("Warning chevron", (x, -.548, .96), (.17, .024, .11), m["warning"], .018)
    consolidate_static_meshes()
    export("modular-wall")


def signal_obelisk():
    clean(); m = palette()
    cube("Obelisk foundation", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .06)
    cube("Raised pylon dais", (0, 0, .31), (1.72, 1.72, .18), m["edge"], .055)
    cylinder("Obelisk socket", (0, -.10, .52), .59, .30, m["dark"], 8)
    # Tall tapered crystal-metal monolith with three bright transmitting ribs.
    cone("Signal monolith", (0, -.10, 1.30), .58, .20, 1.46, m["armor"], 6)
    cone("Obelisk crown", (0, -.10, 2.10), .22, .025, .30, m["edge"], 6)
    for angle in [0, 2*math.pi/3, 4*math.pi/3]:
        x = math.cos(angle)*.34
        y = -.10 + math.sin(angle)*.34
        rib = cube("Transmitter spine", (x, y, 1.31), (.095, .095, 1.35), m["accent"], .02)
        rib.rotation_euler[2] = angle
    cylinder("Signal corona", (0, -.10, 1.87), .39, .08, m["accent"], 6)
    cylinder("Beacon lens", (0, -.10, 2.17), .10, .11, m["glass"], 8)
    for x in [-.57, .57]:
        cube("Dais corner light", (x, .58, .43), (.16, .16, .06), m["accent"], .02)
    export("signal-obelisk")


def infantry_body(m, variant="rifle"):
    """Shared compact soldier anatomy; the kit remains inside the infantry ring."""
    cylinder("Boot platform", (0, 0, .045), .15, .09, m["dark"], 8)
    # Split greaves and boots turn the original monolithic body into a readable
    # standing figure from the game camera while preserving its .60 height.
    for x in [-.065, .065]:
        cube("Armored boot", (x, .015, .105), (.085, .15, .09), m["rubber"], .022)
        cube("Lower leg greave", (x, -.005, .19), (.082, .105, .16), m["steel"], .022)
        cube("Knee armor", (x, .055, .235), (.09, .035, .065), m["edge"], .014)
    cube("Armored torso", (0, 0, .335), (.22, .20, .24), m["armor"], .045)
    cube("Chest plate", (0, .105, .34), (.19, .045, .16), m["edge"], .022)
    for x in [-.145, .145]:
        cube("Shoulder pauldron", (x, .005, .405), (.105, .12, .105), m["steel"], .025)
        # Keep the arm shells as separate named glTF nodes. Their origins sit
        # at the shoulder/elbow joints so later walk/aim clips can rotate them.
        upper = cube("Arm.L upper" if x < 0 else "Arm.R upper",
                     (x, .045, .335), (.085, .09, .13), m["armor"], .018)
        bpy.context.scene.cursor.location = (x, .01, .405)
        bpy.ops.object.select_all(action="DESELECT"); upper.select_set(True)
        bpy.context.view_layer.objects.active = upper
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
        forearm = cube("Arm.L forearm" if x < 0 else "Arm.R forearm",
                       (x * 1.12, .105, .31), (.075, .13, .085), m["armor"], .02)
        bpy.context.scene.cursor.location = (x * 1.12, .055, .365)
        bpy.ops.object.select_all(action="DESELECT"); forearm.select_set(True)
        bpy.context.view_layer.objects.active = forearm
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
    # Readable rear pack and segmented side pouches add value from the portrait
    # camera as well as in-game without changing the established unit envelope.
    cube("Field harness", (0, -.112, .34), (.17, .045, .16), m["dark"], .018)
    cube("Backpack", (0, -.16, .35), (.15, .09, .20), m["steel"], .025)
    for x in [-.13, .13]:
        cube("Utility pouch", (x, -.01, .30), (.055, .09, .09), m["dark"], .012)
    cylinder("Helmet", (0, -.015, .52), .12, .16, m["dark"], 8)
    cube("Helmet crown plate", (0, -.01, .605), (.13, .115, .035), m["steel"], .014)
    cube("Visor", (0, .09, .53), (.15, .04, .055), m["accent"], .015)
    # Side comms pads break the smooth cylindrical helmet into a more
    # recognizable infantry silhouette, including at the small battlefield
    # scale. Keep them compact so the soldier remains inside the unit ring.
    for x in [-.132, .132]:
        cube("Helmet comms pad", (x, .008, .525), (.052, .095, .075), m["steel"], .015)
    cube("Comms status lamp", (-.14, .061, .527), (.024, .018, .028), m["accent"], .006)
    # A bold Aegis chevron and helmet stripe establish team identity at RTS
    # camera distance, where the original narrow shoulder tab disappeared.
    cube("Faction chest insignia", (0, .133, .385), (.105, .018, .035), m["accent"], .009)
    cube("Helmet faction stripe", (0, .052, .626), (.035, .025, .018), m["accent"], .005)


def scale_infantry_for_game_readability(factor=1.25):
    """Scale the complete articulated infantry assembly around its foot point."""
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.location *= factor
            obj.scale *= factor


def rifle_infantry():
    clean(); m = palette()
    infantry_body(m)
    # Raised, shouldered rifle: its long, fine barrel reads differently from
    # the rocket trooper's broad launcher in the high tactical camera.
    cube("Rifle stock", (.155, -.005, .445), (.072, .16, .075), m["dark"], .016)
    cube("Rifle receiver", (.155, .145, .445), (.082, .19, .082), m["steel"], .014)
    cube("Rifle receiver stripe", (.155, .145, .492), (.045, .13, .015), m["accent"], .005)
    cube("Rifle handguard", (.155, .29, .445), (.065, .14, .064), m["dark"], .01)
    cylinder("Rifle barrel", (.155, .425, .445), .018, .19, m["edge"], 8, (math.pi/2, 0, 0))
    cylinder("Rifle muzzle", (.155, .522, .445), .027, .035, m["steel"], 8, (math.pi/2, 0, 0))
    # A raised optic and foregrip make the carbine read as a deliberate weapon
    # instead of a thin bar laid across the torso in the 3/4 portrait and game
    # camera. The lens uses the existing glass material and adds no draw batch.
    cube("Rifle optic housing", (.155, .145, .535), (.078, .075, .055), m["dark"], .012)
    cylinder("Rifle optic lens rim", (.155, .187, .535), .028, .018, m["steel"], 8, (math.pi/2, 0, 0))
    cylinder("Rifle optic lens", (.155, .198, .535), .019, .008, m["accent"], 8, (math.pi/2, 0, 0))
    cube("Rifle foregrip", (.155, .29, .382), (.052, .06, .10), m["steel"], .012)
    cube("Rifle magazine", (.155, .16, .386), (.048, .085, .095), m["dark"], .01)
    cube("Team shoulder tab", (-.145, .015, .405), (.045, .12, .055), m["accent"], .012)
    scale_infantry_for_game_readability()
    export("rifle-infantry")


def rocket_infantry():
    clean(); m = palette()
    infantry_body(m, "rocket")
    # Overslung, forward-facing anti-armor tube. Its wide octagonal barrel,
    # paired safety bands and tail fins stay legible at command zoom.
    x, z = -.18, .535
    forward_axis = (math.pi/2, 0, 0)
    cube("Launcher yoke", (-.145, -.035, .435), (.15, .26, .18), m["dark"], .025)
    cylinder("Rocket tube", (x, .025, z), .095, .62, m["steel"], 8, forward_axis)
    cylinder("Rocket rear collar", (x, -.265, z), .104, .075, m["dark"], 8, forward_axis)
    for y in [-.155, .215]:
        cylinder("Rocket safety band", (x, y, z), .101, .045, m["warning"], 8, forward_axis)
    cylinder("Rocket nose collar", (x, .34, z), .103, .055, m["dark"], 8, forward_axis)
    cone("Launcher nose", (x, .425, z), .092, .018, .15, m["warning"], 8, forward_axis)
    cylinder("Launcher exhaust", (x, -.34, z), .058, .035, m["recess"], 8, forward_axis)
    # Four planar vanes give the aft end a recognizable missile profile.
    cube("Rocket stabilizer left", (x - .115, -.265, z), (.13, .075, .025), m["warning"], .006)
    cube("Rocket stabilizer right", (x + .115, -.265, z), (.13, .075, .025), m["warning"], .006)
    cube("Rocket stabilizer upper", (x, -.265, z + .105), (.025, .075, .105), m["warning"], .006)
    cube("Rocket stabilizer lower", (x, -.265, z - .105), (.025, .075, .105), m["warning"], .006)
    cube("Launcher sight", (x, -.005, .648), (.115, .13, .055), m["glass"], .018)
    cube("Ammunition harness", (0, -.165, .36), (.24, .11, .23), m["dark"], .03)
    scale_infantry_for_game_readability()
    export("rocket-infantry")


def scout_infantry():
    clean(); m = palette()
    infantry_body(m, "scout")
    cube("Recon chest rig", (0, .105, .30), (.20, .045, .18), m["dark"], .02)
    cylinder("Scout helmet", (0, -.015, .52), .12, .16, m["warning"], 8)
    cube("Wide visor", (0, .09, .53), (.17, .045, .07), m["glass"], .018)
    # A raised rangefinder and shoulder radio separate the Pathfinder silhouette
    # from the rifleman even at the game's small infantry scale.
    cube("Rangefinder housing", (.17, .01, .52), (.12, .14, .13), m["dark"], .025)
    cylinder("Rangefinder lens", (.17, .09, .53), .045, .035, m["accent"], 8, (math.pi/2, 0, 0))
    cube("Scout pack", (-.17, -.11, .34), (.17, .18, .25), m["warning"], .035)
    cylinder("Radio antenna", (-.20, -.12, .48), .012, .25, m["accent"], 6)
    cube("Compact carbine", (.14, .16, .33), (.065, .34, .06), m["dark"], .018)
    cylinder("Carbine barrel", (.14, .38, .34), .022, .14, m["edge"], 8, (math.pi/2, 0, 0))
    cube("Recon sensor cheek", (.18, .03, .46), (.07, .08, .06), m["glass"], .012)
    export("scout")


def vesper_scout_infantry():
    """Vesper Pathfinder with a wide sensor crown and distinctive field kit."""
    clean(); m = palette()
    m["armor"] = material("Vesper Pathfinder oxblood armor", (.30, .105, .12), .38, .48)
    m["edge"] = material("Vesper Pathfinder pale ceramic", (.82, .57, .42), .36, .40)
    m["dark"] = material("Vesper Pathfinder charcoal", (.075, .045, .065), .28, .65)
    m["steel"] = material("Vesper Pathfinder plum alloy", (.28, .16, .24), .52, .38)
    m["accent"] = material("Vesper Pathfinder amber optics", (1.0, .30, .10), .24, .23, (.72, .09, .015), 1.1)
    infantry_body(m, "scout")
    # A broad, sloped sensor hood and paired amber optics form a recognizable
    # head silhouette; the offset dish and long antenna distinguish it from
    # Aegis' compact rangefinder at ordinary tactical zoom.
    cube("Vesper scout hood", (0, .045, .575), (.30, .22, .105), m["dark"], .035)
    cube("Vesper panoramic visor", (0, .153, .55), (.255, .035, .055), m["accent"], .012)
    for x in [-.083, .083]:
        cylinder("Vesper paired optic", (x, .18, .56), .036, .025, m["edge"], 8, (math.pi/2, 0, 0))
        cylinder("Vesper optic lens", (x, .197, .56), .021, .009, m["accent"], 8, (math.pi/2, 0, 0))
    cube("Vesper shoulder sensor boom", (-.205, .005, .46), (.18, .12, .09), m["edge"], .018)
    cylinder("Vesper shoulder dish", (-.27, .005, .535), .105, .035, m["steel"], 8)
    cylinder("Dish amber center", (-.27, .005, .557), .043, .012, m["accent"], 8)
    cube("Vesper beacon pack", (.17, -.135, .39), (.17, .11, .23), m["armor"], .025)
    cylinder("Vesper beacon aerial", (.22, -.16, .57), .012, .31, m["accent"], 6, (0, -.16, 0))
    cube("Vesper compact carbine", (.14, .16, .33), (.065, .34, .06), m["steel"], .018)
    cylinder("Vesper carbine muzzle", (.14, .38, .34), .022, .14, m["edge"], 8, (math.pi/2, 0, 0))
    scale_infantry_for_game_readability()
    export("vesper-scout")


def engineer_infantry():
    clean(); m = palette()
    infantry_body(m, "engineer")
    cube("Utility chest plate", (0, .11, .34), (.20, .045, .16), m["warning"], .025)
    cube("Work helmet", (0, -.015, .52), (.24, .20, .13), m["warning"], .04)
    cube("Helmet brow", (0, .105, .55), (.19, .055, .045), m["dark"], .012)
    cube("Inspection visor", (0, .13, .53), (.13, .025, .04), m["glass"], .012)
    cube("Tool pack", (-.19, -.09, .35), (.20, .24, .30), m["dark"], .04)
    cube("Repair canister", (-.20, -.10, .42), (.11, .13, .20), m["warning"], .025)
    cylinder("Spare conduit", (-.20, -.10, .31), .035, .23, m["accent"], 8, (math.pi/2, 0, 0))
    # Clearly visible handheld service tool and a compact diagnostic tablet.
    cube("Repair tool grip", (.17, .12, .31), (.08, .20, .10), m["dark"], .025)
    cube("Repair tool head", (.17, .25, .34), (.22, .11, .12), m["warning"], .035)
    cube("Tool jaws", (.17, .315, .34), (.14, .035, .15), m["edge"], .02)
    cube("Diagnostic tablet", (.11, .12, .43), (.17, .045, .15), m["glass"], .02)
    cube("Shoulder service tab", (-.15, .02, .37), (.06, .12, .13), m["accent"], .015)
    scale_infantry_for_game_readability()
    export("engineer")


def field_medic():
    clean(); m = palette()
    medical = material("Medical ceramic", (.82, .88, .82), .12, .50)
    signal = material("Medical signal", (.76, .16, .12), .08, .48, (.22, .025, .015), .35)
    cylinder("Boot platform", (0, 0, .045), .15, .09, m["dark"], 8)
    cube("Medic torso", (0, 0, .28), (.23, .20, .34), medical, .055)
    cube("Field vest", (0, .105, .30), (.20, .045, .20), m["edge"], .025)
    cylinder("Medic helmet", (0, -.015, .52), .12, .16, medical, 8)
    cube("Medical visor", (0, .09, .53), (.15, .04, .055), m["glass"], .015)
    cube("Cross vertical", (-.16, .035, .40), (.055, .035, .14), signal, .008)
    cube("Cross horizontal", (-.16, .035, .40), (.14, .035, .055), signal, .008)
    cube("Trauma pack", (-.18, -.12, .35), (.20, .22, .30), m["dark"], .04)
    cylinder("Medkit capsule", (-.18, -.13, .39), .08, .18, medical, 8, (0, math.pi/2, 0))
    cube("Injector grip", (.14, .13, .29), (.065, .23, .07), m["dark"], .018)
    cylinder("Injector lamp", (.14, .25, .32), .048, .08, m["accent"], 8, (math.pi/2, 0, 0))
    export("medic")


def flamer_infantry():
    clean(); m = palette()
    infantry_body(m, "flamer")
    cube("Heat shield chest", (0, .115, .34), (.23, .05, .19), m["warning"], .025)
    cylinder("Sealed helmet", (0, -.015, .53), .13, .17, m["dark"], 8)
    cube("Amber visor", (0, .105, .54), (.16, .045, .065), m["warning"], .018)
    # Twin pressure cylinders and a broad ignition nozzle clearly communicate
    # the incendiary role without enlarging the infantry footprint.
    for x in [-.13, .13]:
        cylinder("Fuel pressure cylinder", (x, -.16, .39), .085, .32, m["dark"], 9)
        cylinder("Cylinder shoulder", (x, -.16, .56), .09, .055, m["warning"], 9)
        cylinder("Cylinder base", (x, -.16, .22), .078, .045, m["edge"], 9)
    cube("Fuel harness", (0, -.12, .37), (.34, .10, .25), m["dark"], .025)
    cube("Flamer grip", (.16, .12, .31), (.09, .20, .09), m["dark"], .025)
    cylinder("Ignition lance", (.16, .31, .34), .07, .40, m["steel"], 8, (math.pi/2, 0, 0))
    cylinder("Nozzle collar", (.16, .48, .34), .085, .075, m["edge"], 8, (math.pi/2, 0, 0))
    cone("Flame projector", (.16, .56, .34), .11, .045, .16, m["warning"], 7, (math.pi/2, 0, 0))
    cube("Heat warning tab", (-.16, .03, .39), (.07, .12, .13), m["accent"], .014)
    export("flamer")


def mobile_command_rig():
    clean(); m = palette()
    # An eight-wheel carrier unfolds into a compact mobile command post. The
    # outriggers, side work decks, and mast make its deployment role legible.
    m["armor"] = material("Command rig ceramic", (.42,.53,.51), .43,.40)
    m["edge"] = material("Command rig alloy", (.72,.79,.72), .54,.32)
    m["dark"] = material("Command rig graphite", (.06,.13,.15), .38,.62)
    m["accent"] = material("Command rig status cyan", (.03,.60,.68), .30,.28,(.01,.22,.27),.9)
    for x in [-.57, .57]:
        for y in [-.58, -.20, .20, .58]:
            cylinder("Run-flat wheel", (x, y, .24), .20, .16, m["rubber"], 10, (0, math.pi/2, 0))
            cylinder("Wheel hub", (x*1.15, y, .24), .105, .035, m["edge"], 8, (0, math.pi/2, 0))
    cube("Command carrier chassis", (0, 0, .40), (1.02, 1.62, .36), m["dark"], .12)
    cube("Armored forward cab", (0, .52, .67), (.88, .61, .54), m["armor"], .10)
    cube("Panoramic cab glazing", (0, .75, .77), (.70, .055, .23), m["glass"], .025)
    cube("Cab roof", (0, .48, .96), (.94, .68, .13), m["edge"], .04)
    cube("Command operations pod", (0, -.30, .77), (1.02, .82, .59), m["armor"], .10)
    # Rear command pod has inset display panels and access shutters.
    cube("Rear status display recess", (0,-.72,.80), (.62,.055,.30), m["dark"],.025)
    for x in [-.22,-.07,.08,.23]:
        cube("Status display segment", (x,-.755,.80), (.09,.018,.20), m["accent"],.012)
    for x in [-.40,.40]:
        cube("Pod side armor rib", (x,-.30,.82), (.055,.55,.36), m["edge"],.022)
        cube("Service hatch", (x*1.08,-.38,.80), (.025,.29,.22), m["dark"],.014)
        for y in [-.47,-.25]:
            cylinder("Hatch latch", (x*1.12,y,.81), .025,.025,m["warning"],8,(0,math.pi/2,0))
    cube("Pod roof armor", (0,-.30,1.10), (1.08,.88,.12), m["dark"], .045)
    for x in [-.35,-.25,.25,.35]:
        cube("Roof cooling louver", (x,-.30,1.17), (.045,.42,.025), m["steel"],.008)
    # Stabilizer beams and broad footplates set the rig into a deployed stance.
    for side in [-1,1]:
        x=side
        cube("Outrigger socket", (x*.49,-.40,.56), (.12,.31,.17), m["dark"],.035)
        cube("Extended stabilizer beam", (x*.69,-.40,.48), (.48,.15,.12), m["steel"],.035)
        cylinder("Hydraulic stabilizer ram", (x*.78,-.40,.37), .045,.33,m["edge"],8)
        cube("Stabilizer ground shoe", (x*.91,-.40,.12), (.27,.30,.10), m["dark"],.035)
        cube("Ground shoe contact plate", (x*.91,-.40,.065), (.30,.32,.035), m["edge"],.012)
        # Fold-out work decks and diagonal braces expand the command footprint.
        cube("Fold-out command deck", (x*.78,-.04,.83), (.40,.72,.09), m["edge"],.035)
        cube("Deck non-slip inset", (x*.79,-.04,.88), (.29,.58,.025), m["dark"],.015)
        cylinder("Deck hinge", (x*.59,-.04,.82), .055,.78,m["steel"],8,(math.pi/2,0,0))
        cylinder("Deck support strut", (x*.83,-.12,.55), .035,.46,m["edge"],8,(0,math.pi/4,0))
        for y in [-.29,.20]:
            cube("Deck warning marker", (x*.78,y,.90), (.18,.045,.025), m["warning"],.008)
    # Telescoping communications mast and compact faceted radar plate.
    cube("Mast pedestal", (0,-.28,1.22), (.38,.34,.12), m["edge"],.035)
    cylinder("Mast lower sleeve", (0,-.28,1.47), .085,.44,m["dark"],10)
    cylinder("Telescoping mast", (0,-.28,1.76), .045,.48,m["edge"],8)
    cylinder("Mast collar", (0,-.28,1.67), .095,.075,m["warning"],10)
    cube("Command radar panel", (0,-.28,2.02), (.43,.10,.28), m["dark"],.035)
    cube("Radar face", (0,-.34,2.02), (.34,.025,.19), m["accent"],.02)
    cylinder("Mast beacon", (0,-.28,2.23), .055,.08,m["accent"],8)
    for x in [-.24,.24]:
        cylinder("Aux antenna", (x,-.48,1.48), .018,.46,m["edge"],6)
        cylinder("Pod status light", (x,-.30,1.20), .055,.035,m["accent"],8)
    cube("Front bumper", (0, .90, .34), (1.08, .16, .16), m["edge"], .04)
    for x in [-.38,.38]:
        cube("Cab marker lamp",(x,.81,.56),(.12,.05,.08),m["accent"],.015)
    export("mcv")


def guardian_tank():
    """Aegis heavy tank: broad enclosed tracks and a layered siege turret."""
    global LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    for x in [-.31, .31]:
        side = 1 if x > 0 else -1
        cube("Heavy continuous tread", (x, -.02, .115), (.17, .91, .22), m["rubber"], .045)
        for y in [-.38,-.19,0,.19,.38]:
            cylinder("Heavy road wheel", (x+side*.093, y, .12), .067, .025,
                     m["steel"], 10, (0, math.pi/2, 0))
            cylinder("Armored wheel hub", (x+side*.11, y, .12), .029, .027,
                     m["edge"], 8, (0, math.pi/2, 0))
        for y in [-.43,-.33,-.23,-.13,-.03,.07,.17,.27,.37,.47]:
            cube("Oversize tread grouser", (x, y, .232), (.186, .044, .028), m["dark"], .006)
        cube("Segmented track skirt", (x, -.035, .265), (.18, .76, .065), m["armor"], .018)
        for y in [-.30,-.10,.10,.30]:
            cube("Skirt armor seam", (x+side*.094, y, .27), (.012, .022, .048), m["recess"], .003)
    faceted_prism("Heavy chamfered chassis", [(-.29,-.45),(.29,-.45),(.36,-.30),(.36,.32),(.25,.47),(-.25,.47),(-.36,.32),(-.36,-.30)],
                  [(-.23,-.40),(.23,-.40),(.29,-.27),(.29,.27),(.21,.39),(-.21,.39),(-.29,.27),(-.29,-.27)],
                  .22,.38,m["armor"])
    faceted_prism("Layered front glacis", [(-.28,.20),(.28,.20),(.25,.45),(-.25,.45)],
                  [(-.23,.18),(.23,.18),(.19,.39),(-.19,.39)], .37,.43,m["edge"])
    for x in [-.20,.20]:
        cube("Glacis armor rib", (x, .29, .445), (.035, .21, .025), m["steel"], .005)
        cube("Hull forward lamp", (x, .44, .34), (.075, .025, .033), m["accent"], .005)
        cube("Rear cooling panel", (x, -.36, .392), (.13, .13, .023), m["recess"], .004)
        for y in [-.40,-.37,-.34,-.31]:
            cube("Cooling vane", (x, y, .407), (.12, .009, .009), m["steel"], .002)
    cylinder("Turret ring", (0, -.035, .414), .245, .052, m["dark"], 12)
    faceted_prism("Rotating heavy turret", [(-.22,-.23),(.22,-.23),(.27,-.09),(.25,.17),(.13,.30),(-.13,.30),(-.25,.17),(-.27,-.09)],
                  [(-.18,-.19),(.18,-.19),(.22,-.06),(.19,.14),(.10,.24),(-.10,.24),(-.19,.14),(-.22,-.06)],
                  .43,.565,m["steel"])
    for x in [-.19,.19]:
        faceted_prism("Turret cheek armor", [(x-.065,-.04),(x+.065,-.04),(x+.068,.20),(x-.068,.20)],
                      [(x-.045,-.04),(x+.045,-.04),(x+.055,.17),(x-.055,.17)], .505,.605,m["armor"])
        cube("Cheek inset", (x, .075, .614), (.055, .16, .014), m["edge"], .004)
    cube("Turret roof spine", (0, -.055, .579), (.085, .28, .026), m["edge"], .006)
    cylinder("Commander hatch", (-.095, -.135, .593), .071, .028, m["dark"], 10)
    cylinder("Hatch rim", (-.095, -.135, .611), .075, .015, m["edge"], 10)
    cube("Targeting visor", (.125, .112, .592), (.09, .074, .025), m["glass"], .005)
    cylinder("Main cannon barrel", (0, .345, .515), .052, .38, m["dark"], 10, (math.pi/2,0,0))
    cylinder("Barrel thermal sleeve", (0, .32, .515), .070, .20, m["edge"], 10, (math.pi/2,0,0))
    cylinder("Muzzle brake", (0, .535, .515), .078, .058, m["steel"], 10, (math.pi/2,0,0))
    cylinder("Recessed muzzle bore", (0, .566, .515), .038, .006, m["recess"], 10, (math.pi/2,0,0))
    cube("Rear turret equipment bustle", (0, -.235, .52), (.32, .11, .085), m["armor"], .015)
    consolidate_static_meshes(("Rotating heavy turret", "Main cannon barrel"))
    export("aegis-heavy-tank-game")
    LOW_POLY_BEVEL = False


def stealth_tank():
    global LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    cloak = material("Specter reclaimed plum armor", (.16, .105, .19), .42, .48)
    edge = material("Specter salvage alloy", (.43, .34, .47), .54, .37)
    shadow = material("Specter carbon recess", (.035, .022, .052), .37, .56)
    covert = material("Specter signal violet", (.62, .22, 1.0), .18, .22,
                      (.50, .09, 1.0), 1.35)
    heat = material("Specter heat warning", (.94, .32, .16), .26, .44)
    for x in [-.48, .48]:
        side = 1 if x > 0 else -1
        cube("Low profile track", (x, 0, .18), (.22, 1.24, .32), m["rubber"], .08)
        for y in [-.42, -.12, .18, .48]:
            cylinder("Track roller", (x*1.13, y, .18), .105, .035, edge, 8, (0, math.pi/2, 0))
        faceted_prism("Angular side skirt", [(x-.10,-.52),(x+.10,-.52),(x+.11,.42),(x+.04,.57),(x-.06,.57),(x-.11,.42)],
                      [(x-.08,-.48),(x+.08,-.48),(x+.08,.38),(x+.035,.52),(x-.035,.52),(x-.08,.38)],
                      .30,.39,cloak)
        for y in [-.36,-.13,.10,.33]:
            cube("Skirt stealth seam", (x+side*.106, y, .345), (.012, .016, .05), shadow, .003)
    faceted_prism("Wide stealth lower hull", [(-.41,-.59),(.41,-.59),(.43,.29),(.25,.65),(-.25,.65),(-.43,.29)],
                  [(-.34,-.51),(.34,-.51),(.35,.22),(.17,.54),(-.17,.54),(-.35,.22)],
                  .30,.51,cloak)
    faceted_prism("Faceted wedge glacis", [(-.35,.15),(.35,.15),(.25,.63),(-.25,.63)],
                  [(-.28,.10),(.28,.10),(.15,.54),(-.15,.54)], .50,.57,edge)
    cube("Recessed forward sensor", (0, .575, .445), (.31, .025, .033), covert, .004)
    for x in [-.28,.28]:
        cube("Covert nose lamp", (x, .558, .395), (.048, .02, .025), covert, .004)
        cube("Hull diamond panel", (x, .18, .583), (.12, .28, .018), shadow, .004)
    cylinder("Concealed turret bearing", (0, -.12, .535), .30, .05, shadow, 10)
    faceted_prism("Stealth turret", [(-.30,-.34),(.30,-.34),(.34,-.14),(.27,.16),(.10,.29),(-.10,.29),(-.27,.16),(-.34,-.14)],
                  [(-.23,-.28),(.23,-.28),(.26,-.11),(.20,.11),(.075,.22),(-.075,.22),(-.20,.11),(-.26,-.11)],
                  .55,.74,edge)
    faceted_prism("Shadow turret crown", [(-.19,-.25),(.19,-.25),(.23,-.08),(.14,.11),(-.14,.11),(-.23,-.08)],
                  [(-.14,-.20),(.14,-.20),(.17,-.07),(.10,.06),(-.10,.06),(-.17,-.07)],
                  .74,.79,shadow)
    for x in [-.205,.205]:
        cube("Low missile pod", (x, .105, .715), (.145, .31, .085), cloak, .022)
        cube("Missile port cover", (x, .267, .719), (.11, .012, .048), shadow, .004)
        for xx in [x-.033,x+.033]:
            cylinder("Missile aperture", (xx, .276, .719), .016, .008, covert, 8, (math.pi/2,0,0))
    cube("Turret covert sight", (0, .215, .675), (.082, .024, .026), covert, .004)
    for x in [-.23,.23]:
        cube("Rear heat suppressor", (x, -.405, .515), (.12, .19, .037), shadow, .008)
        for y in [-.46,-.41,-.36]:
            cube("Heat vent slit", (x, y, .538), (.105, .012, .009), edge, .003)
    cube("Specter identity stripe", (0, -.314, .595), (.23, .025, .026), covert, .005)
    # Off-center sensor fin and warm exhaust marks distinguish the covert
    # Vesper hunter from the broad, blue Aegis gun platforms at normal zoom.
    faceted_prism("Asymmetric sensor fin", [(.22,-.22),(.37,-.20),(.36,.02),(.27,.12)],
                  [(.24,-.18),(.32,-.17),(.32,.00),(.27,.07)], .72,.97,edge)
    cube("Sensor fin signal strip", (.326,-.08,.91), (.025,.17,.045), covert, .006)
    for x in [-.23,.23]:
        cube("Exhaust heat marker", (x,-.516,.53), (.075,.022,.026), heat, .005)
    consolidate_static_meshes(("Stealth turret",))
    export("stealth-tank")
    LOW_POLY_BEVEL = False


def recon_buggy():
    clean(); m = palette()
    # Game scale is about 1.2 x 1.5 tiles; open roll cage keeps the scout distinct.
    for x in [-.43, .43]:
        for y in [-.46, .46]:
            cylinder("All-terrain tire", (x, y, .22), .20, .15, m["dark"], 10, (0, math.pi/2, 0))
            cylinder("Wheel hub", (x*1.19, y, .22), .095, .025, m["accent"], 8, (0, math.pi/2, 0))
    cube("Buggy chassis", (0, 0, .35), (.72, .94, .18), m["dark"], .07)
    cube("Forward hood", (0, .29, .47), (.66, .40, .20), m["armor"], .07)
    cube("Hood center keel", (0, .31, .58), (.085, .28, .035), m["edge"], .012)
    for x in [-.22, .22]:
        cube("Hood service panel", (x, .28, .579), (.19, .24, .025), m["steel"], .012)
        cube("Hood service latch", (x, .39, .595), (.07, .025, .014), m["warning"], .004)
    cube("Crew cockpit", (0, -.16, .52), (.50, .42, .28), m["edge"], .06)
    cube("Cockpit glass", (0, .07, .56), (.42, .045, .16), m["glass"], .02)
    cube("Windshield lower armor", (0, .103, .475), (.48, .045, .055), m["steel"], .012)
    for x in [-.29, .29]:
        cube("Scout door armor", (x, -.15, .48), (.075, .28, .16), m["steel"], .02)
        cube("Scout door stripe", (x*1.14, -.12, .49), (.018, .19, .035), m["accent"], .006)
    for x in [-.27, .27]:
        cube("Roll cage upright", (x, -.18, .69), (.055, .055, .43), m["dark"], .018)
    cube("Roll cage crossbar", (0, -.18, .89), (.60, .07, .06), m["edge"], .02)
    # A compact roof mounted weapon and raised scan mast make the recon role
    # clear in silhouette while staying below the existing cage height.
    cylinder("Weapon pintle", (0, -.18, .735), .085, .10, m["steel"], 8)
    cylinder("Scout machine gun", (0, .005, .82), .055, .43, m["dark"], 8, (math.pi/2, 0, 0))
    cylinder("Gun muzzle sleeve", (0, .207, .82), .071, .07, m["edge"], 8, (math.pi/2, 0, 0))
    cube("Gun optical sight", (.075, -.045, .88), (.11, .10, .035), m["glass"], .009)
    cylinder("Recon sensor mast", (-.20, -.30, .77), .018, .30, m["steel"], 8)
    cube("Recon scanner head", (-.20, -.30, .875), (.15, .085, .035), m["dark"], .01)
    cube("Scanner status bar", (-.20, -.30, .898), (.105, .018, .012), m["accent"], .003)
    for x in [-.25, .25]:
        cube("Headlamp bezel", (x, .49, .46), (.16, .07, .10), m["dark"], .018)
        cube("Headlamp", (x, .53, .47), (.105, .025, .055), m["accent"], .012)
    cube("Recovery bumper", (0, .55, .32), (.82, .12, .12), m["steel"], .03)
    cube("Winch housing", (0, .615, .33), (.20, .035, .075), m["dark"], .012)
    cylinder("Winch drum", (0, .638, .33), .035, .15, m["copper"], 8, (0, math.pi/2, 0))
    for side in [-1, 1]:
        cube("Recovery hook", (side*.30, .61, .27), (.085, .045, .05), m["warning"], .012)
    consolidate_static_meshes()
    export("recon-buggy")


def vesper_recon_buggy():
    clean(); m = palette()
    # Vesper scouts trade the open cyan command buggy for a low, asymmetric
    # raider chassis with a shielded cockpit and a prominent signals package.
    m["armor"] = material("Vesper oxidized red armor", (.43, .17, .13), .48, .39)
    m["edge"] = material("Vesper sandblasted alloy", (.72, .48, .30), .58, .33)
    m["dark"] = material("Vesper charcoal structure", (.095, .065, .075), .38, .62)
    m["steel"] = material("Vesper plum gunmetal", (.25, .13, .17), .68, .39)
    m["glass"] = material("Vesper amber optics", (.88, .38, .10), .36, .2, (.42, .095, .015), .8)
    m["accent"] = material("Vesper identification orange", (.95, .24, .065), .32, .27, (.38, .055, .008), .8)
    m["warning"] = material("Vesper pale hazard", (.96, .73, .37), .22, .48)
    m["copper"] = material("Vesper coil copper", (.78, .27, .11), .67, .31)
    for x in [-.43, .43]:
        for y in [-.46, .46]:
            cylinder("All-terrain tire", (x, y, .22), .20, .15, m["dark"], 10, (0, math.pi/2, 0))
            cylinder("Wheel hub", (x*1.19, y, .22), .095, .025, m["accent"], 8, (0, math.pi/2, 0))
    cube("Buggy chassis", (0, 0, .35), (.72, .94, .18), m["dark"], .07)
    # Faceted sloped nose and offset armor cheeks give this a different outline.
    faceted_prism("Vesper wedge nose", [(-.34,.05),(.34,.05),(.31,.53),(.19,.64),(-.20,.64),(-.34,.48)],
                  [(-.29,.08),(.29,.08),(.25,.47),(.16,.56),(-.17,.56),(-.29,.43)], .36, .60, m["armor"])
    cube("Raised center armor keel", (0, .32, .615), (.095, .39, .035), m["edge"], .012)
    for side in [-1, 1]:
        cheek = cube("Angled nose cheek", (side*.275, .31, .48), (.10,.36,.16), m["steel"], .018)
        cheek.rotation_euler[2] = side * math.radians(8)
        cube("Amber running lamp", (side*.245, .535, .48), (.105,.026,.045), m["accent"], .01)
    cube("Shielded crew cell", (0, -.12, .52), (.48,.43,.28), m["dark"], .045)
    cube("Armored windshield", (0, .085, .58), (.40,.045,.13), m["glass"], .018)
    cube("Windshield brow", (0, .10, .665), (.53,.10,.065), m["edge"], .018)
    for x in [-.28, .28]:
        cube("Recessed side door", (x,-.15,.48), (.055,.28,.15), m["armor"], .014)
        cube("Door hazard slash", (x*1.12,-.12,.50), (.018,.16,.025), m["warning"], .004)
    # Roll cage protected by a slatted half roof; the driver's side stays open.
    for x in [-.27,.27]:
        cube("Roll cage upright", (x,-.18,.70), (.045,.05,.40), m["edge"], .012)
    cube("Cage crossbar", (0,-.18,.88), (.57,.06,.05), m["steel"], .014)
    cube("Offset signal shroud", (.13,-.18,.93), (.43,.36,.09), m["dark"], .025)
    for x in [-.02,.16,.34]:
        cube("Signal shroud vent", (x,-.18,.979), (.07,.22,.012), m["accent"], .004)
    # Compact roof gun and a tall, unmistakable Vesper direction-finding mast.
    cylinder("Weapon pintle", (-.12,-.14,.75), .07,.09,m["steel"],8)
    cylinder("Scout machine gun", (-.12,.04,.83), .045,.38,m["dark"],8,(math.pi/2,0,0))
    cylinder("Gun muzzle sleeve", (-.12,.225,.83), .058,.055,m["edge"],8,(math.pi/2,0,0))
    cube("Gun optical sight", (-.045,-.02,.88), (.10,.085,.03),m["glass"],.008)
    cylinder("Direction finder mast", (.27,-.31,.78), .018,.36,m["edge"],8)
    cube("Direction finder dish", (.27,-.31,.98), (.20,.12,.045),m["accent"],.012)
    cube("Dish dark aperture", (.27,-.31,1.005), (.115,.075,.014),m["dark"],.005)
    # Rear power pack and exposed copper exhausts balance the long sensor mast.
    cube("Rear engine pack", (0,-.49,.52), (.48,.28,.27),m["steel"],.035)
    for x in [-.16,.16]:
        cylinder("Exhaust stack", (x,-.49,.70), .055,.15,m["copper"],8)
        cube("Engine cooling grille", (x,-.49,.535), (.075,.20,.08),m["dark"],.01)
    cube("Recovery bumper", (0,.56,.32), (.80,.12,.11),m["edge"],.025)
    cube("Winch housing", (0,.625,.33), (.18,.04,.07),m["dark"],.01)
    cylinder("Winch drum", (0,.65,.33), .032,.14,m["copper"],8,(0,math.pi/2,0))
    consolidate_static_meshes()
    export("vesper-recon-buggy")


def siege_crawler():
    clean(); m = palette()
    # Palette remains faction-neutral: subdued ceramic, graphite, alloy, and
    # small cyan identification lights suit either Aegis or Vesper deployment.
    m["armor"] = material("Siege crawler ceramic", (.39,.49,.48), .48,.38)
    m["edge"] = material("Siege crawler pale armor", (.68,.75,.68), .58,.31)
    m["dark"] = material("Siege crawler graphite", (.055,.105,.12), .42,.62)
    m["accent"] = material("Siege crawler status cyan", (.025,.55,.66), .38,.26,(.01,.18,.24),.8)
    # Deep, separated track pods carry a readable continuous tread silhouette.
    for x in [-.66, .66]:
        cube("Armored track pod", (x, -.02, .27), (.27, 1.72, .48), m["dark"], .12)
        for y in [-.66,-.39,-.12,.15,.42,.69]:
            cylinder("Road wheel", (x*1.08, y, .25), .145, .045, m["steel"], 10, (0,math.pi/2,0))
            cylinder("Wheel hub", (x*1.12, y, .25), .062, .052, m["edge"], 8, (0,math.pi/2,0))
        # Repeated raised grousers read as tread at tactical zoom.
        for y in [-.72,-.48,-.24,0,.24,.48,.72]:
            cube("Track grouser", (x*1.19,y,.48), (.075,.15,.045), m["steel"], .012)
        cube("Track lower return", (x*1.19,0,.055), (.075,1.30,.06), m["steel"], .018)
        for y in [-.50,.50]:
            cube("Track guard panel", (x*1.19,y,.31), (.075,.34,.20), m["armor"], .025)
    # Layered hull has a wedge nose, broad shoulders, and visible service seams.
    cube("Lower armored hull", (0,-.02,.46), (1.10,1.66,.40), m["dark"], .10)
    cube("Main ceramic hull", (0,.01,.62), (1.04,1.52,.36), m["armor"], .13)
    cube("Forward glacis wedge", (0,.63,.62), (.91,.39,.26), m["edge"], .08)
    cube("Nose impact rail", (0,.82,.49), (.91,.09,.12), m["dark"], .025)
    for x in [-.42,.42]:
        cube("Glacis armor rib", (x,.57,.77), (.07,.39,.045), m["steel"], .014)
        cube("Hull flank applique", (x,-.12,.65), (.075,.67,.21), m["edge"], .025)
        for y in [-.38,-.08,.22]:
            cylinder("Flank fastener", (x*1.08,y,.66), .035,.025,m["dark"],8,(0,math.pi/2,0))
    # Raised rear engine deck: slatted cooling banks, exhausts, and access hatches.
    cube("Rear engine deck", (0,-.54,.84), (.88,.55,.20), m["edge"], .065)
    cube("Engine access hatch", (0,-.52,.955), (.44,.36,.035), m["armor"], .018)
    for x in [-.28,-.20,-.12,.12,.20,.28]:
        cube("Engine cooling louver", (x,-.55,.982), (.035,.30,.025), m["dark"], .008)
    for x in [-.34,.34]:
        cylinder("Exhaust stack", (x,-.78,.83), .075,.19,m["dark"],8,(math.pi/2,0,0))
        cylinder("Exhaust cap", (x,-.885,.83), .082,.035,m["steel"],8,(math.pi/2,0,0))
        cube("Deck tie-down", (x,-.30,.97), (.10,.10,.025), m["warning"],.01)
    # Turret ring, angular casemate, counterweight, and visible recoil hardware.
    cylinder("Turret race", (0,-.08,.84), .48,.13,m["dark"],12)
    cylinder("Bearing rim", (0,-.08,.915), .40,.045,m["steel"],12)
    cube("Low siege casemate", (0,-.02,1.04), (.83,.83,.31), m["armor"], .10)
    cube("Turret crown plate", (0,-.07,1.21), (.67,.57,.055), m["edge"], .035)
    cube("Recoil cradle", (0,.34,1.06), (.54,.37,.28), m["dark"], .075)
    cube("Cannon mantlet", (0,.48,1.08), (.47,.25,.30), m["edge"], .075)
    # Twin hydraulic rams connect cradle to barrel; nested barrel sleeves make
    # the segmented artillery tube clear in silhouette.
    for x in [-.20,.20]:
        cylinder("Recoil cylinder housing", (x,.67,1.08), .052,.42,m["steel"],10,(math.pi/2,0,0))
        cylinder("Polished recoil ram", (x,.86,1.08), .025,.34,m["edge"],8,(math.pi/2,0,0))
        cylinder("Ram clevis", (x,.48,1.08), .075,.09,m["dark"],8,(math.pi/2,0,0))
    cylinder("Barrel root sleeve", (0,.77,1.08), .115,.36,m["dark"],12,(math.pi/2,0,0))
    cylinder("Segmented cannon tube", (0,1.17,1.08), .092,.54,m["steel"],12,(math.pi/2,0,0))
    for y in [.98,1.22,1.40]:
        cylinder("Barrel reinforcement band", (0,y,1.08), .105,.045,m["edge"],12,(math.pi/2,0,0))
    cylinder("Muzzle brake", (0,1.52,1.08), .145,.18,m["dark"],12,(math.pi/2,0,0))
    cylinder("Muzzle crown", (0,1.62,1.08), .15,.045,m["edge"],12,(math.pi/2,0,0))
    cylinder("Bore recess", (0,1.647,1.08), .095,.012,m["recess"],12,(math.pi/2,0,0))
    for z in [.99,1.17]:
        cube("Muzzle brake port", (0,1.53,z), (.12,.05,.035), m["recess"],.008)
    # Compact sights, sensors, and restrained faction-neutral markings.
    cube("Optic pedestal", (.31,-.19,1.24), (.17,.20,.12), m["dark"],.03)
    cube("Rangefinder glass", (.31,-.19,1.31), (.14,.15,.045), m["glass"],.025)
    for x in [-.22,.22]:
        cube("Turret lifting lug", (x,-.26,1.25), (.09,.10,.07), m["steel"],.015)
    for x in [-.39,.39]:
        cube("Identification stripe", (x,.38,.79), (.035,.25,.025), m["accent"],.008)
        for y in [-.38,-.22]:
            cube("Status marker", (x*1.08,y,.77), (.025,.07,.025), m["accent"],.008)
    export("siege-crawler")


def gunship():
    clean(); m = palette()
    # Compact rotor gunship sized to its 0.4 radius, with twin pylons and tail boom.
    cube("Armored fuselage", (0, 0, .20), (.38, 1.02, .30), m["armor"], .12)
    cube("Cockpit canopy", (0, .30, .34), (.31, .42, .18), m["glass"], .07)
    cube("Nose armor", (0, .56, .20), (.30, .28, .18), m["edge"], .055)
    cube("Main wing", (0, -.08, .19), (1.34, .27, .10), m["dark"], .045)
    for x in [-.48, .48]:
        cube("Weapon pylon", (x, -.02, .15), (.22, .55, .10), m["edge"], .035)
        cube("Faction wing light", (x, .05, .23), (.13, .18, .045), m["accent"], .015)
        cylinder("Engine nacelle", (x, -.26, .12), .15, .48, m["dark"], 10, (math.pi/2, 0, 0))
        cylinder("Engine glow", (x, -.49, .12), .095, .045, m["accent"], 10, (math.pi/2, 0, 0))
    cube("Tail boom", (0, -.64, .23), (.13, .55, .14), m["armor"], .035)
    cube("Tailplane", (0, -.86, .22), (.48, .18, .07), m["edge"], .025)
    cylinder("Rotor mast", (0, -.10, .47), .06, .38, m["dark"], 8)
    cylinder("Rotor hub", (0, -.10, .68), .12, .09, m["accent"], 8)
    for angle in [0, math.pi/2]:
        blade = cube("Main rotor blade", (0, -.10, .74), (1.42, .08, .025), m["dark"], .02)
        blade.rotation_euler[2] = angle
    export("gunship")


def dropship():
    clean(); m = palette()
    # A broad, unarmed assault transport with a boxy cargo pod and tandem
    # lift fans. The two rotor stations make a distinctive fore/aft silhouette.
    m["armor"] = material("Aegis transport ceramic", (.40,.57,.59), .38,.48)
    m["edge"] = material("Aegis transport pale alloy", (.76,.83,.77), .48,.34)
    m["accent"] = material("Aegis transport cyan", (.025,.64,.85), .28,.26,(.01,.26,.48),1.2)
    cube("Cargo keel", (0,-.02,.27), (.82,1.38,.42), m["dark"], .12)
    cube("Armored cargo cabin", (0,-.02,.48), (.74,1.22,.48), m["armor"], .12)
    # The large, dark inset reads as an actual load bay from the game camera.
    cube("Recessed cargo bay door", (0,-.02,.735), (.47,.83,.045), m["recess"], .035)
    cube("Cargo door upper rail", (0,-.02,.765), (.55,.055,.035), m["edge"], .012)
    for x in [-.19,.19]:
        cube("Cargo door locking bar", (x,-.02,.77), (.025,.68,.025), m["steel"], .008)
    for y in [-.29,-.02,.25]:
        cube("Cargo tie-down", (0,y,.765), (.33,.035,.025), m["warning"], .006)
    # Faceted forward cockpit and blunt utility nose.
    cube("Forward flight deck", (0,.62,.48), (.68,.43,.39), m["edge"], .12)
    cube("Panoramic cockpit glass", (0,.70,.60), (.52,.30,.22), m["glass"], .075)
    cube("Nose bumper", (0,.91,.33), (.55,.13,.19), m["dark"], .05)
    for x in [-.29,.29]:
        cube("Cabin side window", (x,.22,.60), (.035,.39,.19), m["glass"], .025)
        cube("Faction rescue stripe", (x*1.02,-.45,.48), (.035,.48,.12), m["accent"], .012)
        # High shoulder pylons carry the tilt-fan nacelles clear of the bay.
        cube("Rotor shoulder sponson", (x*1.65,0,.43), (.43,1.16,.22), m["armor"], .09)
    for y in [-.49,.49]:
        x = -.91 if y < 0 else .91
        cube("Tilt fan nacelle", (x,y,.56), (.38,.40,.39), m["dark"], .095)
        cylinder("Fan shroud", (x,y,.77), .205,.075,m["edge"],12)
        cylinder("Fan hub", (x,y,.83), .075,.07,m["accent"],10)
        for angle in [0,math.pi/2,math.pi,3*math.pi/2]:
            blade = cube("Dropship lift fan blade", (x,y,.865), (.33,.052,.025), m["dark"], .012)
            blade.data.transform(__import__('mathutils').Matrix.Translation((.165,0,0)))
            blade.rotation_euler[2] = angle
        cube("Fan amber warning panel", (x,y,.38), (.24,.16,.055), m["warning"], .018)
    # Landing gear, aft ramp seam, and lights stay readable at isometric scale.
    for x in [-.37,.37]:
        for y in [-.48,.55]:
            cylinder("Landing wheel", (x,y,.095), .095,.07,m["rubber"],10,(0,math.pi/2,0))
            strut = cylinder("Landing gear strut", (x,y,.22), .035,.27,m["steel"],8)
    cube("Rear loading ramp", (0,-.75,.31), (.68,.12,.29), m["edge"], .035)
    cube("Ramp hinge seam", (0,-.68,.48), (.65,.035,.045), m["steel"], .01)
    for x in [-.30,.30]:
        cube("Navigation beacon", (x,.86,.29), (.08,.06,.055), m["accent"], .015)
    preserve = tuple("Dropship lift fan blade" + (f".{i:03d}" if i else "") for i in range(8))
    consolidate_static_meshes(preserved=preserve)
    export("dropship")


def apache():
    clean(); m = palette()
    # Vesper's attack helicopter is long and lean; the Aegis Orca remains a
    # short, broad twin-engine craft. Keep the rotor pieces separate for Three.
    hull = material("Vesper graphite armor", (.105, .115, .125), .38, .57)
    facet = material("Vesper warm armor", (.29, .23, .21), .45, .48)
    shadow = material("Vesper mechanical black", (.034, .043, .050), .26, .69)
    canopy = material("Smoked amber canopy", (.14, .24, .25), .57, .19,
                      (.13, .045, .018), .28)
    hot = material("Vesper weapon copper", (.67, .31, .19), .45, .33)

    def loft(name, sections, mat):
        # y, half-width, bottom, top: eight vertices per station produce a
        # faceted taper without the box silhouette of the Orca.
        verts = []
        for y, w, bottom, top in sections:
            h = top - bottom
            verts.extend([(w*.72,y,bottom), (w,y,bottom+h*.28),
                          (w,y,bottom+h*.76), (w*.62,y,top),
                          (-w*.62,y,top), (-w,y,bottom+h*.76),
                          (-w,y,bottom+h*.28), (-w*.72,y,bottom)])
        faces = [tuple(reversed(range(8)))]
        for i in range(len(sections)-1):
            a, b = i*8, (i+1)*8
            faces.extend((a+j, a+(j+1)%8, b+(j+1)%8, b+j)
                         for j in range(8))
        faces.append(tuple((len(sections)-1)*8+j for j in range(8)))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.materials.append(mat)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        bevel = obj.modifiers.new("Crisp panel edges", "BEVEL")
        bevel.width = .012
        bevel.segments = 1
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
        return obj

    def strut(name, start, end, radius, mat, sides=8):
        from mathutils import Vector
        a, b = Vector(start), Vector(end)
        vec = b-a
        obj = cylinder(name, (a+b)*.5, radius, vec.length, mat, sides)
        obj.rotation_euler = vec.to_track_quat('Z', 'Y').to_euler()
        return obj

    loft("Apache tapered fuselage", [
        (-.58,.15,.19,.48), (-.35,.26,.13,.54), (.09,.29,.09,.54),
        (.43,.25,.12,.49), (.70,.19,.15,.40), (.91,.07,.22,.33),
        (1.03,.015,.26,.29)], hull)
    # Stepped pilot and gunner glazing, with a raised rear cockpit.
    loft("Rear cockpit glazing", [(-.23,.16,.50,.57), (-.09,.19,.49,.68),
                                  (.18,.17,.47,.65), (.27,.12,.48,.54)], canopy)
    loft("Front cockpit glazing", [(.23,.13,.45,.52), (.34,.16,.43,.58),
                                   (.61,.13,.37,.53), (.73,.07,.35,.41)], canopy)
    for y in [-.09,.27,.64]:
        cube("Canopy frame", (0,y,.545 if y<.5 else .43),
             (.37 if y<.5 else .24,.026,.025), shadow, .006)
    cube("Nose sensor brow", (0,.77,.35), (.24,.14,.06), facet, .018)
    cylinder("Nose target optic", (0,.92,.30), .064, .09, m["accent"], 10,
             (math.pi/2,0,0))
    cylinder("Chin turret", (0,.67,.115), .105, .09, shadow, 10)
    strut("Chin chain gun", (0,.68,.11), (0,1.02,.08), .033, shadow)
    cylinder("Chain gun muzzle", (0,1.025,.08), .048, .07, hot, 8,
             (math.pi/2,0,0))

    # Narrow swept stub wings and external stores create the attack profile.
    for side in [-1,1]:
        wing = cube("Swept stub wing", (side*.49,-.13,.34), (.68,.29,.055), facet, .027)
        wing.rotation_euler[2] = side*.15
        cube("Wingtip Vesper stripe", (side*.78,-.10,.375), (.10,.20,.016),
             m["accent"], .006)
        cube("Inner weapon rail", (side*.39,-.14,.27), (.075,.40,.07), shadow, .01)
        strut("Four tube rocket pod", (side*.57,-.13,.22),
              (side*.57,.28,.22), .105, hull, 10)
        for xoff in [-.045,.045]:
            for zoff in [-.043,.043]:
                cylinder("Rocket port", (side*.57+xoff,.295,.22+zoff),
                         .025,.025,shadow,8,(math.pi/2,0,0))
        strut("Outer missile", (side*.83,-.23,.27),
              (side*.83,.28,.27), .037, hot, 8)
        cone("Missile nose", (side*.83,.32,.27), .038, 0, .13,
             facet, 8, (math.pi/2,0,0))
        # Exposed landing skids remain visible below the body from isometric view.
        for y in [-.36,.37]:
            strut("Landing skid brace", (side*.19,y,.20),
                  (side*.34,y,.035), .023, shadow)
        strut("Landing skid", (side*.34,-.53,.035),
              (side*.34,.61,.035), .034, shadow)

    loft("Long tail boom", [(-.50,.15,.24,.42), (-.82,.11,.27,.42),
                            (-1.25,.07,.30,.39), (-1.50,.055,.32,.40)], hull)
    cube("Tail stabilizer", (0,-1.35,.37), (.59,.20,.038), facet, .015)
    fin = cube("Tall swept tail fin", (0,-1.48,.55), (.046,.26,.39), facet, .014)
    fin.rotation_euler[0] = -.18
    cylinder("Tail rotor hub", (.045,-1.50,.65), .043,.055,hot,8,(0,math.pi/2,0))
    for angle in [0, math.pi/2]:
        blade = cube("Tail rotor blade", (.085,-1.50,.65),
                     (.023,.37,.034), shadow, .006)
        blade.rotation_euler[0] = angle
    cube("Tail warning lamp", (0,-1.52,.76), (.065,.055,.035), m["accent"], .01)

    cylinder("Rotor mast", (0,-.12,.69), .052,.29,shadow,10)
    cylinder("Rotor drive casing", (0,-.12,.56), .14,.13,facet,10)
    cylinder("Main rotor hub", (0,-.12,.855), .115,.065,hot,12)
    for angle in [0, math.pi/2, math.pi, 3*math.pi/2]:
        blade = cube("Apache main rotor blade", (0,-.12,.89),
                     (1.12,.074,.022), shadow, .008)
        # Origin at the mast gives each blade a separate animatable node.
        blade.data.transform(__import__('mathutils').Matrix.Translation((.56,0,0)))
        blade.rotation_euler[2] = angle
    consolidate_static_meshes(preserved=(
        "Apache main rotor blade", "Apache main rotor blade.001",
        "Apache main rotor blade.002", "Apache main rotor blade.003",
        "Tail warning lamp", "Wingtip Vesper stripe", "Wingtip Vesper stripe.001"))
    export("apache")


def helipad():
    clean(); m = palette()
    cube("Helipad foundation", (0, 0, .12), (2.86, 2.86, .24), m["dark"], .06)
    cube("Landing deck armor", (0, 0, .30), (2.48, 2.48, .14), m["edge"], .045)
    cylinder("Landing zone ring", (0, -.04, .39), 1.02, .045, m["dark"], 12)
    cylinder("Landing zone inner ring", (0, -.04, .42), .83, .03, m["accent"], 12)
    cube("Landing center stripe", (0, -.04, .445), (.09, 1.35, .035), m["edge"], .012)
    for x in [-1.02, 1.02]:
        for y in [-1.02, 1.02]:
            cube("Apron perimeter light", (x, y, .40), (.14, .14, .07), m["accent"], .025)
    # Rear service annex and compact flight-control glass keep the silhouette legible.
    cube("Flight service annex", (0, -.93, .57), (1.06, .50, .46), m["armor"], .07)
    cube("Control room glazing", (0, -.65, .65), (.72, .06, .20), m["glass"], .025)
    cube("Annex roof", (0, -.93, .82), (1.18, .60, .10), m["dark"], .035)
    cylinder("Landing beacon", (0, -.93, 1.01), .09, .28, m["accent"], 8)
    export("helipad")


def service_bay():
    """Open vehicle repair deck with an overhead gantry and visible tools."""
    global LOW_POLY_BEVEL
    LOW_POLY_BEVEL = True
    clean(); m = palette()
    cube("Service bay foundation", (0, 0, .12), (2.86, 2.86, .24), m["dark"], .055)
    cube("Recessed maintenance deck", (0, -.04, .285), (2.62, 2.43, .11), m["steel"], .035)
    cube("Vehicle receiving pad", (0, .13, .351), (1.52, 1.70, .035), m["recess"], .012)
    for x in [-.72, .72]:
        cube("Wheel alignment rail", (x, .15, .392), (.105, 1.66, .045), m["edge"], .011)
        cube("Rail luminous guide", (x, .15, .419), (.027, 1.48, .014), m["accent"], .004)
        for y in [-.53, -.17, .19, .55]:
            cube("Lift jack anchor", (x*.79, y, .397), (.14, .095, .054), m["warning"], .01)
    for y in [-.62,-.31,0,.31,.62]:
        cube("Deck cross cleat", (0, y, .377), (1.34, .032, .018), m["steel"], .004)
    # The striped open entry stays clear enough for a whole vehicle silhouette.
    cube("Entry ramp", (0, 1.27, .23), (1.70, .35, .12), m["edge"], .025)
    for x in [-.72,-.48,-.24,0,.24,.48,.72]:
        stripe = cube("Entry hazard chevron", (x, 1.27, .302), (.09, .27, .014),
                      m["warning"], .003)
        stripe.rotation_euler[2] = -.24
    for x in [-1.19, 1.19]:
        side = 1 if x > 0 else -1
        cube("Raised side service walk", (x, -.10, .39), (.26, 2.06, .14), m["armor"], .018)
        cube("Side walk safety edge", (x+side*.12, -.10, .475), (.035, 1.90, .038), m["warning"], .008)
        for y in [-.72,-.39,-.06,.27,.60]:
            cube("Inset tool locker", (x, y, .488), (.19, .22, .036), m["dark"], .008)
            cube("Locker handle", (x, y, .514), (.095, .014, .013), m["edge"], .003)
        for y in [-.95,.95]:
            cube("Gantry support pillar", (x, y, .76), (.20, .22, .70), m["steel"], .025)
            cube("Pillar safety foot", (x, y, .435), (.25, .28, .095), m["warning"], .015)
            cube("Pillar signal lamp", (x, y, 1.145), (.12, .13, .045), m["accent"], .01)
    # Twin overhead beams frame the deck from the game camera. The transverse
    # carriage and hanging tools are clear even at a small tactical zoom.
    for y in [-.95,.95]:
        cube("Gantry crossbeam", (0, y, 1.14), (2.56, .20, .17), m["edge"], .028)
        cube("Crossbeam inset", (0, y, 1.25), (1.95, .065, .025), m["dark"], .006)
    for x in [-1.18, 1.18]:
        cube("Gantry travel rail", (x, 0, 1.22), (.12, 1.93, .09), m["dark"], .015)
        cube("Travel rail guide", (x, 0, 1.275), (.035, 1.80, .018), m["accent"], .005)
    cube("Gantry carriage", (0, -.18, 1.30), (1.85, .35, .14), m["steel"], .025)
    cube("Carriage central motor", (0, -.18, 1.40), (.47, .33, .12), m["armor"], .018)
    for x in [-.55,.55]:
        side = 1 if x > 0 else -1
        cylinder("Repair arm piston", (x, -.18, 1.06), .055, .35, m["edge"], 10)
        cylinder("Repair arm collar", (x, -.18, .91), .095, .075, m["dark"], 10)
        arm = cube("Left repair arm" if x < 0 else "Right repair arm",
                   (x+side*.09, -.06, .79), (.25, .32, .085), m["armor"], .012)
        arm.rotation_euler[2] = -side*.25
        cylinder("Repair emitter", (x+side*.16, .10, .735), .085, .06,
                 m["accent"], 10)
        cube("Arm caution mark", (x, -.18, 1.386), (.18, .24, .014), m["warning"], .005)
    cube("Rear diagnostics console", (0, -1.15, .59), (.88, .24, .49), m["armor"], .025)
    cube("Console status display", (0, -1.016, .72), (.56, .022, .14), m["glass"], .006)
    for x in [-.25,0,.25]:
        cube("Diagnostic key", (x, -1.014, .58), (.10, .018, .035), m["accent"], .005)
    consolidate_static_meshes(("Gantry carriage", "Left repair arm", "Right repair arm"))
    export("service-bay")
    LOW_POLY_BEVEL = False


def research_center():
    clean(); m = palette()
    cube("Research campus foundation", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .065)
    cube("Research wing", (-.34, -.25, .49), (1.65, 1.78, .48), m["armor"], .09)
    cube("Lab roof", (-.34, -.25, .78), (1.78, 1.90, .10), m["edge"], .035)
    cube("Observation glass hall", (-.30, .06, 1.00), (1.12, .72, .34), m["glass"], .055)
    cube("Glass hall canopy", (-.30, .06, 1.20), (1.30, .88, .09), m["dark"], .035)
    # Three stepped sensor vanes and a bright core sell a late-game technology site.
    for x, y, height in [(-.74, -.70, .58), (0, .02, .88), (.74, -.70, .58)]:
        cube("Research sensor tower", (x, y, .28 + height/2), (.28, .30, height), m["dark"], .05)
        cube("Sensor light band", (x, y, .38 + height*.52), (.31, .32, .075), m["accent"], .02)
    cylinder("Quantum core housing", (-.30, -.60, 1.03), .25, .36, m["edge"], 8)
    cylinder("Quantum core", (-.30, -.60, 1.27), .16, .16, m["accent"], 8)
    cube("Entry portal", (-.34, .67, .40), (.48, .055, .28), m["dark"], .025)
    for x in [-.60, -.08]: cube("Entry guide light", (x, .71, .47), (.035, .04, .30), m["accent"], .01)
    export("research-center")


def aegis_watchtower():
    clean(); m = palette()
    cube("Watchtower foundation", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .06)
    cube("Reinforced tower foot", (0, -.12, .31), (1.42, 1.42, .18), m["edge"], .04)
    cube("Armored tower shaft", (0, -.12, .89), (.72, .72, 1.10), m["armor"], .10)
    for z in [.57, 1.08]:
        cube("Shaft accent band", (0, .26, z), (.48, .045, .075), m["accent"], .012)
    cube("Watch platform", (0, -.12, 1.51), (1.55, 1.42, .20), m["dark"], .06)
    for x in [-.60, .60]:
        cube("Platform armor wing", (x, -.12, 1.63), (.28, 1.10, .16), m["edge"], .04)
        cube("Platform light", (x, .47, 1.65), (.16, .045, .08), m["accent"], .015)
    # Sentry head swivels with the live target through a named animation pivot.
    cube("Watch head", (0, -.12, 1.83), (.86, .70, .40), m["armor"], .09)
    cylinder("Watch head pivot", (0, -.12, 1.62), .27, .15, m["edge"], 8)
    for x in [-.22, .22]:
        cylinder("Watch cannon", (x, .29, 1.83), .055, .48, m["dark"], 8, (math.pi/2, 0, 0))
    cube("Watch optic", (0, .30, 1.96), (.28, .08, .14), m["glass"], .03)
    cube("Watch optic accent", (0, .35, 1.96), (.12, .03, .055), m["accent"], .012)
    export("aegis-watchtower")


def skyshield_battery():
    clean(); m = palette()
    cube("Skyshield pad", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .06)
    cylinder("Battery turret race", (0, -.12, .36), .86, .24, m["edge"], 8)
    cylinder("Armored rotating platform", (0, -.12, .57), .70, .22, m["armor"], 8)
    # Aegis' vertically launched interceptors form a clear triple-prong silhouette.
    for x, y, height in [(-.42, -.12, .86), (.42, -.12, .86), (0, -.49, .72)]:
        cylinder("Interceptor canister", (x, y, .67 + height/2), .15, height, m["dark"], 8)
        cylinder("Canister cap", (x, y, .70 + height), .17, .09, m["edge"], 8)
        cube("Canister team stripe", (x, y+.15, .85), (.10, .035, .25), m["accent"], .012)
    cube("Skyshield radar optic", (0, .35, .80), (.45, .20, .24), m["glass"], .05)
    cylinder("Battery pivot hub", (0, -.12, .73), .20, .16, m["accent"], 8)
    export("skyshield-battery")


def vesper_sam():
    clean(); m = palette()
    cube("SAM installation foundation", (0, 0, .12), (2.86, 2.86, .24), m["dark"], .06)
    cube("Launch vehicle chassis", (0, -.16, .36), (1.88, 1.58, .26), m["armor"], .09)
    for x in [-.68, -.34, .34, .68]:
        cube("Chassis track", (x, -.16, .25), (.17, 1.35, .22), m["dark"], .05)
    cylinder("Launcher rotation ring", (0, -.15, .55), .64, .18, m["edge"], 8)
    # Twin canted missile rails differ from the vertical Aegis battery.
    for x in [-.35, .35]:
        rail = cube("SAM missile rail", (x, -.02, 1.01), (.23, 1.12, .22), m["dark"], .045)
        rail.rotation_euler.x = math.radians(-24)
        cylinder("Vesper missile", (x, .12, 1.28), .085, .70, m["edge"], 8, (math.radians(-24), 0, 0))
        cone("Missile nose", (x, .26, 1.54), .085, .008, .20, m["accent"], 6, (math.radians(-24), 0, 0))
        cube("Launcher status light", (x, -.44, .82), (.11, .06, .10), m["accent"], .015)
    cube("SAM target sensor", (0, -.68, .80), (.43, .40, .25), m["glass"], .055)
    cylinder("SAM sensor antenna", (0, -.68, 1.04), .035, .32, m["edge"], 8)
    export("vesper-sam")


def ion_spire():
    clean(); m = palette()
    cube("Ion platform", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .065)
    cube("Spire lower armor", (0, -.08, .39), (2.18, 2.00, .30), m["edge"], .09)
    cube("Spire armored body", (0, -.16, .79), (1.62, 1.48, .64), m["armor"], .12)
    cube("Emitter housing", (0, -.20, 1.24), (.96, .96, .46), m["dark"], .085)
    # Three bright coils orbit the exposed emitter cap; the cap pulses in runtime.
    for x, y in [(-.52, -.18), (.52, -.18), (0, .48)]:
        cube("Ion containment coil", (x, y, 1.28), (.20, .20, .84), m["edge"], .045)
        cube("Coil energy channel", (x, y+.11, 1.31), (.075, .035, .60), m["accent"], .018)
    cylinder("Ion emitter core", (0, -.20, 1.62), .31, .30, m["glass"], 8)
    cylinder("Ion emitter crown", (0, -.20, 1.81), .47, .09, m["accent"], 8)
    cone("Spire focus crystal", (0, -.20, 2.06), .24, .015, .46, m["edge"], 6)
    for x in [-.83, .83]:
        cube("Ion side capacitor", (x, .05, .52), (.28, .78, .40), m["dark"], .05)
        cube("Capacitor light", (x, .45, .54), (.16, .04, .08), m["accent"], .015)
    export("ion-spire")


def warhead_temple():
    clean(); m = palette()
    cube("Temple foundation", (0, 0, .13), (2.86, 2.86, .26), m["dark"], .065)
    cube("Temple armored nave", (0, -.22, .53), (2.05, 1.94, .55), m["armor"], .10)
    cube("Temple roof slab", (0, -.22, .86), (2.22, 2.08, .12), m["edge"], .04)
    # Vesper's warhead silo and ribbed containment shell make this read as a launch site.
    cylinder("Warhead silo casing", (0, -.36, 1.23), .59, .72, m["dark"], 8)
    cylinder("Silo armored rim", (0, -.36, 1.62), .72, .13, m["edge"], 8)
    cylinder("Warhead access lid", (0, -.36, 1.73), .49, .12, m["accent"], 8)
    cone("Temple crown", (0, -.36, 2.04), .44, .10, .53, m["armor"], 6)
    for angle in [0, math.pi/3, 2*math.pi/3, math.pi]:
        x, y = .65*math.cos(angle), -.36 + .65*math.sin(angle)
        cube("Temple buttress", (x, y, .75), (.18, .18, .72), m["dark"], .035)
        cube("Buttress warning light", (x, y, 1.14), (.16, .16, .075), m["accent"], .02)
    cube("Warhead temple entry", (0, .77, .39), (.46, .055, .36), m["dark"], .025)
    for x in [-.48, .48]: cube("Fallout vent", (x, .75, .53), (.13, .06, .28), m["edge"], .02)
    export("warhead-temple")


def collapsed_comms_mast():
    clean(); m = palette()
    basalt = material("Weathered basalt", (.16, .22, .21), .12, .88)
    rust = material("Oxidized salvage", (.55, .31, .18), .36, .72)
    cube("Mast anchor slab", (0, 0, .11), (1.38, 1.25, .22), basalt, .065)
    cube("Broken anchor footing", (-.27, -.34, .24), (.62, .58, .16), m["edge"], .045)
    # The mast lies across the terrain; one bent support and the torn dish give it
    # an unmistakable comms silhouette at the game's low viewing angle.
    mast = cylinder("Collapsed mast spine", (.12, -.03, .34), .075, 2.20, m["dark"], 8)
    mast.rotation_euler[0] = math.radians(82)
    mast.rotation_euler[1] = math.radians(27)
    for y in [-.66, -.24, .20, .64]:
        brace = cylinder("Mast cross brace", (.12, y, .34), .032, .86, rust, 6)
        brace.rotation_euler[1] = math.pi/2
        brace.rotation_euler[0] = math.radians(82)
    cube("Kinked support leg", (-.55, .12, .32), (.10, .10, .65), rust, .025).rotation_euler[1] = -0.78
    cylinder("Dish mount", (.82, .59, .24), .09, .48, basalt, 8, (math.pi/2, 0, .15))
    dish = cylinder("Crushed relay dish", (.82, .59, .43), .39, .085, m["edge"], 9, (math.radians(66), .1, .2))
    cube("Relay dish fracture", (.82, .60, .49), (.055, .48, .04), rust, .012).rotation_euler[1] = .2
    for x, y, angle in [(-.62, .48, .4), (.50, -.66, -.7)]:
        cube("Concrete rubble", (x, y, .22), (.42, .32, .24), basalt, .06).rotation_euler[2] = angle
    export("collapsed-comms-mast")


def industrial_cargo_stacks():
    clean(); m = palette()
    freight = material("Faded container paint", (.48, .39, .28), .21, .72)
    oxide = material("Cargo rust", (.34, .22, .16), .24, .82)
    hazard = material("Amber hazard paint", (.88, .55, .16), .12, .45, (.21, .085, .006), .4)
    cube("Cargo yard scatter base", (0, 0, .09), (1.92, 1.78, .18), m["dark"], .045)
    crates = [
        (-.43, -.35, .38, .82, .76, .52, freight),
        (.43, -.30, .34, .80, .82, .44, oxide),
        (-.18, .36, .35, 1.15, .66, .46, oxide),
        (.42, .31, .77, .72, .70, .42, freight),
    ]
    for idx, (x, y, z, w, d, h, mat) in enumerate(crates):
        cube("Cargo container", (x, y, z), (w, d, h), mat, .045)
        # Bold top ribs retain readability from above without dense detail.
        for xx in [-.31, 0, .31]:
            cube("Container roof rib", (x + xx*w*.75, y, z+h*.51), (.045, d*.82, .035), oxide if mat == freight else freight, .01)
        cube("Container identification plate", (x, y+d*.51, z), (w*.37, .035, h*.25), m["edge"], .015)
        if idx == 0:
            cube("Cargo hazard stripe", (x, y+d*.535, z), (w*.25, .025, .065), hazard, .01)
    cube("Broken pallet", (-.83, .54, .20), (.34, .52, .12), oxide, .025).rotation_euler[2] = -.35
    export("industrial-cargo-stacks")


def crystal_silo():
    """A compact pair of armored crystal storage cells with a transfer spine."""
    clean(); m = palette()
    ceramic = material("Silo pale ceramic", (.49, .62, .61), .48, .38)
    teal = material("Silo crystal glass", (.10, .48, .53), .42, .2, (.015, .20, .24), .55)
    dark = material("Silo frame graphite", (.045, .105, .12), .42, .56)
    amber = material("Silo safety amber", (.96, .57, .13), .18, .42, (.24, .075, .008), .3)
    cube("Reinforced silo foundation", (0, 0, .10), (1.92, 1.82, .20), dark, .055)
    for x in [-.48, .48]:
        cylinder("Armored storage vessel", (x, -.04, .78), .37, 1.18, ceramic, 12)
        cylinder("Lower vessel band", (x, -.04, .32), .385, .13, dark, 12)
        cylinder("Upper vessel collar", (x, -.04, 1.24), .395, .14, dark, 12)
        cylinder("Crystal level window", (x, -.04, .84), .376, .39, teal, 12)
        cone("Pressure cap", (x, -.04, 1.50), .32, .18, .28, ceramic, 10)
        cylinder("Vent beacon", (x, -.04, 1.68), .11, .12, amber, 8)
    cube("Central transfer manifold", (0, .47, .57), (.30, .28, .78), dark, .045)
    cube("Manifold status panel", (0, .625, .76), (.17, .025, .24), teal, .012)
    for x in [-.48, .48]:
        cylinder("Feed conduit", (x*.50, .32, .48), .07, .55, ceramic, 8, (math.pi/2, 0, 0))
    cube("Access hazard marker", (0, -.87, .22), (.46, .035, .055), amber, .008)
    consolidate_static_meshes()
    export("crystal-silo")


def crystal_palette():
    """A restrained mineral palette; bright cuts carry the readable inner ribs."""
    return {
        "root": material("Obsidian crystal matrix", (.025, .075, .086), .18, .82),
        "fracture": material("Deep teal crystal fracture", (.035, .19, .22), .18, .62),
        "body": material("Translucent sea glass", (.15, .62, .67), .10, .22, (.025, .16, .19), .32),
        "facet": material("Pale mineral facets", (.40, .88, .82), .08, .20, (.04, .27, .23), .42),
        "rib": material("Luminous crystal core", (.48, 1.0, .88), .04, .16, (.22, .78, .61), .72),
    }


def crystal_shard(name, base, height, radius, lean, seed, mats, sides=6):
    """Build a chipped, irregular crystal prism with broad facets and a bright cut."""
    verts = []
    # A buried dark root, broad shoulder and pinched crown give a mineral rather
    # than cone silhouette. The deterministic offsets prevent repeated clones.
    for ring, (z, scale) in enumerate(((0.00, 1.00), (.17, .93), (.69, .68))):
        for i in range(sides):
            angle = math.tau * i / sides + seed * .173
            jitter = 1 + .13 * math.sin(i * 2.13 + seed * 1.7 + ring * .83)
            zz = z * height + (height * .025 * math.sin(i * 1.9 + seed) if ring == 2 else 0)
            verts.append((math.cos(angle) * radius * scale * jitter,
                          math.sin(angle) * radius * scale * jitter, zz))
    tip = len(verts)
    verts.append((radius * .10 * math.sin(seed * 2.1), radius * .08 * math.cos(seed), height))
    faces, ids = [], []
    # Each band is triangulated with alternating diagonals. Selected inner
    # triangles form a luminous spine visible from the RTS camera.
    for ring in range(2):
        for i in range(sides):
            a, b = ring*sides+i, ring*sides+(i+1)%sides
            c, d = (ring+1)*sides+(i+1)%sides, (ring+1)*sides+i
            split = (i + seed + ring) % 2
            tris = ((a,b,c),(a,c,d)) if split else ((a,b,d),(b,c,d))
            for part, tri in enumerate(tris):
                faces.append(tri)
                if ring == 0:
                    ids.append(1 if (i + seed) % 3 == 0 else 0)
                elif ((i + seed) % sides in (seed % sides, (seed + 3) % sides)
                      and part == 0):
                    ids.append(3)
                else:
                    ids.append(2 if (i + seed + part) % 4 else 1)
    for i in range(sides):
        a, b = 2*sides+i, 2*sides+(i+1)%sides
        faces.append((a,b,tip))
        ids.append(3 if i in (seed % sides, (seed + 3) % sides) else (2 if (i+seed)%3 else 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for key in ("body", "fracture", "facet", "rib"):
        mesh.materials.append(mats[key])
    mesh.update()
    for polygon, index in zip(mesh.polygons, ids):
        polygon.material_index = index
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = base
    obj.rotation_euler[1] = lean
    obj.rotation_euler[0] = .035 * math.sin(seed * 1.3)
    # Small broken mineral plates gather around the buried root.
    for i in range(2):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius*.31,
             location=(base[0]+radius*.46*math.cos(seed+i*2.4),
                       base[1]+radius*.46*math.sin(seed+i*2.4), base[2]+radius*.10))
        rock = bpy.context.object
        rock.name = "Fractured crystal root"
        rock.scale = (1.3, .82, .64)
        rock.data.materials.append(mats["fracture"])


def crystal_growth_fan():
    clean(); m = crystal_palette()
    cube("Crystal growth bed", (0, 0, .09), (1.40, 1.20, .18), m["root"], .09)
    shards = [
        (-.43, -.15, .83, .21, -.32), (-.20, .18, 1.20, .23, -.18),
        (.12, .05, 1.55, .24, .08), (.43, -.20, 1.06, .19, .30),
        (.14, -.40, .72, .16, .18), (-.43, .34, .68, .15, -.40),
    ]
    for idx, (x, y, h, r, lean) in enumerate(shards):
        crystal_shard("Fan crystal", (x, y, .15), h, r, lean, idx, m)
    export("crystal-growth-fan")


def crystal_growth_spire():
    clean(); m = crystal_palette()
    cube("Crystal spire bed", (0, 0, .10), (1.32, 1.32, .20), m["root"], .085)
    # Compact, more vertical growth variant for seams and ridge lines.
    for idx, (x, y, h, r, lean) in enumerate([
        (0, 0, 1.72, .27, .02), (-.37, -.24, .92, .19, -.12),
        (.37, -.22, 1.10, .18, .16), (-.28, .36, .76, .15, -.22),
        (.32, .31, .84, .16, .22),
    ]):
        crystal_shard("Spire crystal", (x, y, .20), h, r, lean, idx+2, m)
        if idx == 0:
            cylinder("Spire dark fractured collar", (0, 0, .34), .31, .045, m["fracture"], 7)
    export("crystal-growth-spire")


def basalt_spires():
    clean(); m = palette()
    basalt = material("Basalt charcoal", (.105, .135, .15), .08, .94)
    basalt_hi = material("Basalt cut edge", (.34, .39, .35), .10, .82)
    basalt_strata = material("Basalt iron strata", (.29, .17, .115), .16, .83)
    cube("Basalt shelf", (0, 0, .10), (1.70, 1.62, .20), basalt, .09)
    # A broken, overhanging shelf makes the cluster read as a natural outcrop
    # instead of a row of isolated cones at the campaign camera scale.
    cube("Basalt fractured ledge", (0, 0, .205), (1.38, 1.26, .12), basalt_hi, .055)
    for idx, (x, y, h, r, tilt) in enumerate([
        (-.49, -.18, 1.22, .27, -.10), (-.12, .20, 1.72, .30, .08),
        (.40, -.30, 1.02, .25, .15), (.47, .38, .78, .20, -.16),
        (-.50, .45, .68, .19, .18),
    ]):
        spire = cone("Polygonal basalt spire", (x, y, .20+h/2), r, r*.12, h, basalt_hi if idx == 1 else basalt, 5 if idx % 2 else 6)
        spire.rotation_euler[1] = tilt
        # A narrow iron-red seam catches light across the dark rock faces.
        band = cylinder("Basalt iron seam", (x, y, .20+h*.39), r*.88, .055, basalt_strata, 5 if idx % 2 else 6)
        band.rotation_euler[1] = tilt
    for x, y, z, angle in [(-.62, -.54, .26, .2), (.65, .06, .24, -.4), (.10, -.62, .23, .6)]:
        cube("Basalt talus block", (x, y, z), (.32, .28, .24), basalt_hi, .055).rotation_euler[2] = angle
    export("basalt-spires")


def basalt_mesa():
    """A compact, fractured basalt mesa cluster for non-playable map rims."""
    clean()
    slate_palette = [(.045,.064,.072,1),(.16,.19,.19,1),(.32,.30,.25,1),(.009,.015,.019,1)]
    stone = material("Mesa vertex palette", (1,1,1), .025, .98)
    bsdf=stone.node_tree.nodes.get("Principled BSDF")
    color_node=stone.node_tree.nodes.new("ShaderNodeVertexColor")
    color_node.layer_name="Color"
    stone.node_tree.links.new(color_node.outputs["Color"],bsdf.inputs["Base Color"])

    def column(name, x, y, radius, height, sides, phase):
        verts=[]
        rings=((0.00,1.08),(.38,1.00),(.70,.88),(.91,.76),(1.00,.62))
        for ring_index,(height_t,radius_scale) in enumerate(rings):
            for i in range(sides):
                angle=math.tau*i/sides+phase
                jitter=1+0.18*math.sin(i*2.31+phase*4+ring_index*.7)
                z_jitter=0.18*math.sin(i*2.7+phase*3) if ring_index==4 else 0
                rr=radius*radius_scale*jitter
                verts.append((x+math.cos(angle)*rr,y+math.sin(angle)*rr,
                              .025+height*height_t+z_jitter))
        faces=[]; material_ids=[]
        for ring_index in range(len(rings)-1):
            for i in range(sides):
                faces.append((ring_index*sides+i,ring_index*sides+(i+1)%sides,
                              (ring_index+1)*sides+(i+1)%sides,(ring_index+1)*sides+i))
                fissure_face=int((phase*13)%sides)
                if i in (fissure_face,(fissure_face+sides//2)%sides):
                    material_ids.append(3)
                elif ring_index in (1,2,3) and (i+int(phase*5))%2==0:
                    material_ids.append(1)
                else:
                    material_ids.append(0)
        top_start=(len(rings)-1)*sides
        # Uneven crown vertices form a chipped mesa lip with a broken, faceted cap.
        faces.append(tuple(top_start+i for i in range(sides)))
        material_ids.append(2)
        mesh=bpy.data.meshes.new(name)
        mesh.from_pydata(verts,[],faces)
        mesh.materials.append(stone)
        mesh.update()
        colors=mesh.color_attributes.new(name="Color",type="FLOAT_COLOR",domain="CORNER")
        for polygon,material_index in zip(mesh.polygons,material_ids):
            for loop_index in polygon.loop_indices:
                colors.data[loop_index].color=slate_palette[material_index]
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)

    # A broad capped crown and broken shoulder give the outcrop a readable
    # mesa silhouette. Offset teeth keep the top line jagged at game zoom.
    column("Mesa crown column", -.02, -.035, .42, 1.28, 7, .21)
    column("Mesa west shard", -.39, .015, .21, .88, 6, .63)
    column("Mesa east shard", .37, .02, .24, 1.58, 5, 1.17)
    column("Mesa rear tooth", .00, .31, .22, 1.03, 6, 1.83)
    column("Mesa forward buttress", -.02, -.37, .26, .72, 5, 2.43)

    # Compact angular talus settles the columns into the root shelf.
    for idx,(x,y,size,scale,angle) in enumerate([
        (-.62,-.25,.11,(1.35,.85,.72),.25),(.61,-.22,.10,(1.5,.9,.78),-.38),
        (-.48,.40,.095,(1.4,.85,.74),.62),(.48,.40,.11,(1.3,.9,.82),-.20),
        (.02,-.66,.09,(1.6,.8,.7),.44),(-.04,.59,.095,(1.3,.9,.76),-.55),
    ]):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=size,location=(x,y,size*.7))
        rock=bpy.context.object;rock.name=f"Mesa talus {idx}"
        rock.scale=scale;rock.rotation_euler[2]=angle
        rock.data.materials.append(stone)
        colors=rock.data.color_attributes.new(name="Color",type="FLOAT_COLOR",domain="CORNER")
        color=slate_palette[1] if idx%3==0 else slate_palette[0]
        for color_loop in colors.data: color_loop.color=color

    consolidate_static_meshes()
    export("basalt-mesa")


def crystal_cluster():
    clean(); m = crystal_palette()
    # The field resource is deliberately deeper and more jewel-like than the
    # showcase growth assets. Its saturated facets survive the renderer's
    # per-instance tint at the normal camera zoom.
    cluster_colors = {
        "root": (.012, .032, .048),
        "fracture": (.016, .075, .12),
        "body": (.025, .19, .29),
        "facet": (.055, .39, .52),
        "rib": (.20, .83, .72),
    }
    for key, color in cluster_colors.items():
        mat = m[key]
        mat.diffuse_color = (*color, 1)
        mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*color, 1)
    # A broken, low basalt root anchors the crystals. Its irregular outline
    # stays within a 0.9 tile diameter after the renderer's instance scale.
    outline = [(-.36,-.16),(-.30,-.31),(-.08,-.37),(.12,-.34),(.34,-.23),
               (.39,-.04),(.32,.20),(.16,.34),(-.07,.37),(-.29,.27),(-.39,.07)]
    # Higher broken shoulders and deep angular breaks make the root read as a
    # fractured geode bed once the shard bases are embedded into it.
    top_z = [.16,.09,.20,.075,.23,.095,.18,.08,.21,.10,.17]
    verts = [(x,y,z) for (x,y),z in zip(outline,top_z)]
    verts += [(x*.91,y*.91,.025) for x,y in outline]
    center = len(verts); verts.append((-.015,.005,.145))
    faces=[]; ids=[]; n=len(outline)
    for i in range(n):
        j=(i+1)%n
        faces.append((center,i,j)); ids.append(1 if i%3 in (0, 1) else 0)
        faces.append((i,n+i,n+j,j)); ids.append(1 if i%3 == 0 else 0)
    faces.append(tuple(reversed(range(n,2*n)))); ids.append(0)
    root_mesh=bpy.data.meshes.new("Fractured basalt root mesh")
    root_mesh.from_pydata(verts,[],faces)
    root_mesh.materials.append(m["root"]); root_mesh.materials.append(m["fracture"])
    root_mesh.update()
    for poly,index in zip(root_mesh.polygons,ids): poly.material_index=index
    root_obj=bpy.data.objects.new("Fractured basalt root",root_mesh)
    bpy.context.collection.objects.link(root_obj)

    # A clustered silhouette with a dominant crown and short, splayed teeth.
    # Each column has a different profile, lean and facet rotation.
    shards = [
        (-.10,-.035,1.34,.19,-.12,7), (.12,.035,1.10,.155,.12,5),
        (-.245,.055,.91,.145,-.24,6), (.245,-.075,.84,.125,.21,7),
        (-.14,.225,.72,.115,-.08,5), (.025,-.215,.66,.105,.12,6),
        (.105,.235,.88,.12,.25,5),
    ]
    for idx,(x,y,height,radius,lean,sides) in enumerate(shards):
        crystal_shard("Cluster crystal",(x,y,.075),height,radius,lean,idx+17,m,sides=sides)
    # A few saturated cyan inclusions catch the light without washing out the
    # darker crystal bodies.
    for idx, (loc, size, rotation) in enumerate([
        ((-.31,-.22,.15), .052, .24), ((.31,.12,.17), .047, -.38),
        ((-.13,.30,.18), .043, .58),
    ]):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=size, location=loc)
        inclusion = bpy.context.object
        inclusion.name = f"Pale mineral inclusion {idx + 1}"
        inclusion.scale = (1.35, .82, .68)
        inclusion.rotation_euler[2] = rotation
        inclusion.data.materials.append(m["facet"])
    # renderer3d instances only the first mesh from this GLB. Join the entire
    # deposit into one primitive and bake facet/root colors per corner so all
    # shards remain present when the renderer applies its per-tile tint.
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(obj for obj in meshes if obj.name.startswith("Cluster crystal"))
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = "Complete crystal deposit"
    mesh = joined.data
    colors = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for polygon in mesh.polygons:
        source = mesh.materials[polygon.material_index] if polygon.material_index < len(mesh.materials) else m["body"]
        color = source.diffuse_color
        for loop_index in polygon.loop_indices:
            colors.data[loop_index].color = color
        polygon.material_index = 0
    mesh.materials.clear()
    mesh.materials.append(m["body"])
    bsdf = m["body"].node_tree.nodes.get("Principled BSDF")
    color_node = m["body"].node_tree.nodes.new("ShaderNodeVertexColor")
    color_node.layer_name = "Color"
    m["body"].node_tree.links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
    export("crystal-cluster")


GENERATORS = {
    "command-yard": command_yard,
    "vesper-command-yard": vesper_command_yard,
    "vesper-power-plant": vesper_power_plant,
    "vesper-barracks": vesper_barracks,
    "vesper-radar-array": vesper_radar_array,
    "vesper-research-center": vesper_research_center,
    "striker-tank": tank,
    "apc": apc,
    "harvester": harvester,
    "vesper-harvester": vesper_harvester,
    "crystal-cluster": crystal_cluster,
    "power-plant": power_plant,
    "refinery": refinery,
    "vesper-refinery": vesper_refinery,
    "barracks": barracks,
    "factory": factory,
    "vesper-factory": vesper_factory,
    "advanced-power": advanced_power,
    "radar-array": radar_array,
    "defense-turret": defense_turret,
    "modular-wall": modular_wall,
    "signal-obelisk": signal_obelisk,
    "rifle-infantry": rifle_infantry,
    "rocket-infantry": rocket_infantry,
    "scout": scout_infantry,
    "vesper-scout": vesper_scout_infantry,
    "engineer": engineer_infantry,
    "medic": field_medic,
    "flamer": flamer_infantry,
    "mcv": mobile_command_rig,
    "aegis-heavy-tank-game": guardian_tank,
    "stealth-tank": stealth_tank,
    "recon-buggy": recon_buggy,
    "vesper-recon-buggy": vesper_recon_buggy,
    "siege-crawler": siege_crawler,
    "gunship": gunship,
    "dropship": dropship,
    "apache": apache,
    "helipad": helipad,
    "service-bay": service_bay,
    "research-center": research_center,
    "aegis-watchtower": aegis_watchtower,
    "skyshield-battery": skyshield_battery,
    "vesper-sam": vesper_sam,
    "ion-spire": ion_spire,
    "warhead-temple": warhead_temple,
    "collapsed-comms-mast": collapsed_comms_mast,
    "industrial-cargo-stacks": industrial_cargo_stacks,
    "crystal-silo": crystal_silo,
    "crystal-growth-fan": crystal_growth_fan,
    "crystal-growth-spire": crystal_growth_spire,
    "basalt-spires": basalt_spires,
    "basalt-mesa": basalt_mesa,
}

if __name__ == "__main__":
    requested = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    selected = requested or list(GENERATORS)
    unknown = sorted(set(selected) - GENERATORS.keys())
    if unknown:
        raise SystemExit("Unknown asset generator(s): " + ", ".join(unknown))
    for name in selected:
        GENERATORS[name]()
