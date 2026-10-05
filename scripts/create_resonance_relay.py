"""Build the hand-authored resonance relay capture-site landmark with Blender 5.x.

Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/create_resonance_relay.py
"""
import bpy
import math
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "models" / "resonance-relay.glb"


def material(name, color, metal, rough, emission=None, power=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = power
    return mat


def bevel(obj, amount=0.04):
    mod = obj.modifiers.new("Machined edge glints", "BEVEL")
    mod.width = amount
    mod.segments = 1
    obj.modifiers.new("Weighted facet normals", "WEIGHTED_NORMAL")
    return obj


def cube(name, loc, size, mat, bevel_size=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel_size:
        bevel(obj, bevel_size)
    return obj


def cylinder(name, loc, radius, depth, mat, vertices=8, rotation=(0,0,0), radius_top=None):
    if radius_top is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius_top, depth=depth, location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def beam(name, start, end, width, depth, mat, bevel_size=0.02):
    a, b = Vector(start), Vector(end)
    delta = b - a
    obj = cube(name, (a+b)*0.5, (width, depth, delta.length), mat, bevel_size)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    return obj


def torus(name, radius, minor, z, mat, major_segments=24, minor_segments=5):
    bpy.ops.mesh.primitive_torus_add(major_segments=major_segments, minor_segments=minor_segments,
                                     major_radius=radius, minor_radius=minor, location=(0,0,z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def crystal(name, loc, radius, height, mat):
    # Deliberately irregular octagonal facets keep the signal core legible at RTS zoom.
    sides = 7
    vertices = []
    for i in range(sides):
        a = 2*math.pi*i/sides + 0.14
        r = radius*(1.0 if i % 2 else 0.78)
        vertices.append((math.cos(a)*r, math.sin(a)*r, -height*0.35))
    for i in range(sides):
        a = 2*math.pi*i/sides + 0.14
        r = radius*(0.92 if i % 2 else 0.72)
        vertices.append((math.cos(a)*r, math.sin(a)*r, height*0.22))
    vertices += [(0.08*radius, -0.05*radius, height*0.65), (-0.04*radius, 0.02*radius, -height*0.72)]
    faces=[]
    top=sides*2
    bottom=top+1
    for i in range(sides):
        j=(i+1)%sides
        faces.extend([(i,j,sides+j,sides+i),(sides+i,sides+j,top),(j,i,bottom)])
    mesh=bpy.data.meshes.new(name+" geometry")
    mesh.from_pydata(vertices, [], faces); mesh.materials.append(mat); mesh.update()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj); obj.location=loc
    return obj


def main():
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.materials): bpy.data.materials.remove(block)
    dark=material("Relay Graphite",(0.025,0.075,0.095),0.62,0.52)
    alloy=material("Relay Blue Alloy",(0.17,0.31,0.36),0.72,0.34)
    ceramic=material("Relay Pale Ceramic",(0.66,0.76,0.71),0.48,0.33)
    amber=material("Relay Neutral Amber",(0.92,0.55,0.19),0.37,0.38,(0.42,0.16,0.025),0.32)
    signal=material("RelaySignal",(0.18,0.81,0.94),0.32,0.22,(0.03,0.39,0.66),1.65)

    # Wide octagonal foundation and stepped machinery collar.
    cylinder("Relay armored foot",(0,0,0.12),1.03,0.24,dark,8)
    cylinder("Inlaid ceramic rim",(0,0,0.27),0.89,0.09,ceramic,8)
    cylinder("Signal trench",(0,0,0.34),0.77,0.075,signal,8)
    cylinder("Inner service crown",(0,0,0.46),0.66,0.22,alloy,8)
    cylinder("Central plinth",(0,0,0.61),0.40,0.20,dark,8)
    for i in range(8):
        a=math.tau*i/8
        x,z=0.91*math.cos(a),0.91*math.sin(a)
        cylinder("Perimeter bolt",(x,z,0.255),0.045,0.045,amber,6)
        cube("Foot hazard inset",(0.79*math.cos(a),0.79*math.sin(a),0.39),(0.13,0.08,0.04),amber,0.01)

    # Three swept pylons establish a triangular crown silhouette around the core.
    for i in range(3):
        a=math.tau*i/3+math.pi/6
        def point(r,z): return (r*math.cos(a),r*math.sin(a),z)
        base=point(0.72,0.50); shoulder=point(0.50,1.53); crown=point(0.22,2.18)
        cylinder("Pylon heel",point(0.72,0.57),0.16,0.18,alloy,7)
        beam("Swept pylon ceramic armor",base,shoulder,0.24,0.16,ceramic,0.025)
        beam("Pylon graphite spine",point(0.64,0.89),point(0.40,1.83),0.12,0.10,dark,0.015)
        beam("Crown fork",shoulder,crown,0.15,0.12,alloy,0.018)
        beam("Live signal inlay",point(0.55,1.08),point(0.35,1.84),0.042,0.026,signal,0.005)
        cylinder("Crown receiver",point(0.22,2.14),0.105,0.12,amber,6)
        # Small horizontal ceramic fins turn the supports into an unmistakable relay glyph.
        fin=cube("Pylon tuning fin",point(0.49,1.57),(0.44,0.08,0.11),ceramic,0.014)
        fin.rotation_euler[2]=a+math.pi/2

    # Twin open tuning rings and three braces make the negative space intentional.
    torus("Lower tuning ring",0.57,0.065,1.05,alloy,24,6)
    torus("Upper signal ring",0.42,0.043,1.81,signal,24,5)
    torus("Amber calibration ring",0.30,0.025,1.93,amber,24,4)
    for i in range(3):
        a=math.tau*i/3+math.pi/6
        beam("Ring suspension",(0.57*math.cos(a),0.57*math.sin(a),1.08),
             (0.36*math.cos(a),0.36*math.sin(a),1.78),0.075,0.065,dark,0.01)

    # The faceted floating core is the only separately named animated hero piece.
    crystal("Relay Core",(0,0,2.37),0.24,0.72,signal)
    torus("Core magnetic collar",0.30,0.035,2.14,amber,16,4)
    cylinder("Lower crystal emitter",(0,0,1.98),0.22,0.12,signal,7)
    for i in range(6):
        a=math.tau*i/6
        beam("Foundation radial conduit",(0.38*math.cos(a),0.38*math.sin(a),0.48),
             (0.70*math.cos(a),0.70*math.sin(a),0.40),0.055,0.04,signal,0.006)

    # One static draw per material. Keep only the floating core node separate for animation.
    core=bpy.data.objects.get("Relay Core")
    groups={}
    for obj in list(bpy.context.scene.objects):
        if obj.type!="MESH" or obj is core: continue
        for modifier in list(obj.modifiers):
            bpy.context.view_layer.objects.active=obj
            try: bpy.ops.object.modifier_apply(modifier=modifier.name)
            except RuntimeError: pass
        key=obj.data.materials[0].name if obj.data.materials else "Relay Graphite"
        groups.setdefault(key,[]).append(obj)
    for group in groups.values():
        if len(group)<2: continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group: obj.select_set(True)
        bpy.context.view_layer.objects.active=group[0]
        bpy.ops.object.join()
        group[0].name=group[0].data.materials[0].name+" assembly"

    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        if obj.type=="MESH": obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT),export_format="GLB",use_selection=True,export_apply=True)
    print("EXPORTED",OUT,OUT.stat().st_size)


if __name__=="__main__": main()
