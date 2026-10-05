"""Create the compact neutral salvage capsule used by multiplayer drops.

Run with Blender 5.x: blender -b -P scripts/create_salvage_drop.py
The model is deliberately texture-free and has four material batches.
"""
import bpy
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public/assets/models/salvage-pod.glb"
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def mat(name, color, metallic, roughness, emission=None, power=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if emission:
        p.inputs["Emission Color"].default_value = (*emission, 1)
        p.inputs["Emission Strength"].default_value = power
    return m

armor = mat("Salvage | ceramic alloy", (0.54, 0.59, 0.51), .62, .37)
dark = mat("Salvage | graphite frame", (.055, .092, .092), .48, .61)
amber = mat("Salvage | amber signal", (1.0, .43, .075), .22, .24, (1.0, .19, .025), 2.2)
cyan = mat("Salvage | cyan status", (.12, .83, .84), .18, .2, (.035, .72, .9), 1.5)

def add_mat(obj, material):
    obj.data.materials.append(material)
    return obj

def cube(name, loc, size, material, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_mat(o, material)
    if bevel:
        b=o.modifiers.new("Armor chamfer", "BEVEL"); b.width=bevel; b.segments=1
        o.modifiers.new("Weighted corner normals", "WEIGHTED_NORMAL")
    return o

def cyl(name, loc, radius, depth, material, sides=12, rotation=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth, location=loc, rotation=rotation)
    o=bpy.context.object; o.name=name; add_mat(o,material)
    o.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return o

def cone(name, loc, r1, r2, depth, material, sides=8):
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r1, radius2=r2, depth=depth, location=loc)
    o=bpy.context.object; o.name=name; add_mat(o,material); return o

# Squat impact-proof cache with broad feet and a strongly readable octagonal
# footprint. Z is up in Blender; the splayed legs remain legible from topdown.
cyl("Impact skid", (0,0,.13), .77, .18, dark, 10)
cyl("Lower warning belt", (0,0,.25), .75, .10, amber, 10)
cyl("Pressure vessel", (0,0,.68), .70, .78, dark, 10)
cyl("Lower shell seam", (0,0,.34), .73, .075, armor, 10)
cyl("Upper shell seam", (0,0,1.03), .70, .075, armor, 10)

def shell_panel(name, angle):
    """A thick beveled armor petal; gaps expose the dark vessel beneath."""
    radial=(math.cos(angle),math.sin(angle))
    obj=cube(name,(radial[0]*.75,radial[1]*.75,.70),(.23,.43,.58),armor,.035)
    obj.rotation_euler[2]=angle

for i in range(8):
    a=i*math.pi/4
    shell_panel(f"Raised shell petal {i+1}",a)
    # Three painted bands and a status lamp are mounted on the exposed outer
    # plate face (radial distance .865); the crisp gaps between plates remain
    # graphite-dark and read as service seams at command zoom.
    if i%2==0:
        for j,z in enumerate((.49,.55,.61)):
            x,y=math.cos(a)*.884,math.sin(a)*.884
            stripe=cube(f"Hazard stripe {i+1}-{j+1}",(x,y,z),(.026,.17,.027),amber,.004)
            stripe.rotation_euler[2]=a
        x,y=math.cos(a)*.884,math.sin(a)*.884
        lamp=cube(f"Petal status lamp {i+1}",(x,y,.83),(.028,.095,.075),cyan,.008)
        lamp.rotation_euler[2]=a

# Four independent-looking outriggers: graphite struts, armored pivot cuffs,
# and broad clawed landing shoes define the rescue pod silhouette from above.
for i in range(4):
    a=i*math.pi/2+math.pi/4
    radial=(math.cos(a),math.sin(a))
    strut=cube(f"Outrigger arm {i+1}",(radial[0]*.91,radial[1]*.91,.20),(.68,.17,.18),dark,.025)
    strut.rotation_euler[2]=a
    cuff=cyl(f"Outrigger pivot {i+1}",(radial[0]*.66,radial[1]*.66,.31),.15,.16,armor,8)
    shoe=cube(f"Impact foot {i+1}",(radial[0]*1.22,radial[1]*1.22,.13),(.33,.31,.16),dark,.035)
    shoe.rotation_euler[2]=a
    # Bright cyan inset means each foot reads as a deployed stabilizer, not a
    # random scrap fragment, at the miniature battlefield scale.
    pad=cube(f"Foot status lamp {i+1}",(radial[0]*1.22,radial[1]*1.22,.218),(.15,.065,.025),cyan,.008)
    pad.rotation_euler[2]=a

# Layered octagonal hatch, inset service panels, ventilation slots, and a
# raised dual-color signal heart give the top face a distinct command zoom read.
cyl("Hatch gasket",(0,0,1.12),.54,.12,dark,8)
cyl("Octagonal access hatch",(0,0,1.205),.49,.09,armor,8)
cyl("Hatch center well",(0,0,1.257),.285,.035,dark,8)
cyl("Cyan rescue core",(0,0,1.305),.22,.075,cyan,8)
cyl("Amber core crown",(0,0,1.36),.105,.065,amber,8)
# Four amber chevrons and four vents sit on the hatch quadrants.
for i in range(4):
    a=i*math.pi/2
    radial=(math.cos(a),math.sin(a))
    tang=(-math.sin(a),math.cos(a))
    x,y=radial[0]*.365,radial[1]*.365
    hatch=cube(f"Hatch hazard chevron {i+1}",(x,y,1.262),(.16,.052,.018),amber,.006)
    hatch.rotation_euler[2]=a
    vx,vy=radial[0]*.47,radial[1]*.47
    vent=cube(f"Hatch vent {i+1}",(vx,vy,1.255),(.105,.034,.018),dark,.004)
    vent.rotation_euler[2]=a
    light=cube(f"Hatch status lamp {i+1}",(tang[0]*.29,tang[1]*.29,1.27),(.07,.045,.025),cyan,.006)
    light.rotation_euler[2]=a

# Merge static geometry by material to keep the GLB at four draw calls.
for material in (armor,dark,amber,cyan):
    members=[o for o in bpy.context.scene.objects if o.type=="MESH" and o.data.materials and o.data.materials[0]==material]
    bpy.ops.object.select_all(action="DESELECT")
    for o in members: o.select_set(True)
    bpy.context.view_layer.objects.active=members[0]
    bpy.ops.object.join()
    joined=bpy.context.object
    joined.name=f"Salvage pod {material.name.split('|')[-1].strip()}"
    for mod in list(joined.modifiers):
        try: bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError: pass

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", use_selection=True, export_apply=True)
print("EXPORTED", OUT)
