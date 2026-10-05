#!/usr/bin/env python3
"""Render isolated, transparent tactical portraits from the authored GLB assets.

Run from the repository root with Blender 5.x:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- --all
  ... -- ids lightTank engineer stealthTank factory
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "public", "assets", "models")
OUTPUT = os.path.join(ROOT, "public", "assets", "portraits")

# id, source model, faction lighting accent
ASSETS = {
    "scout": ("scout", "all"), "scout-vesper": ("vesper-scout", "vesper"), "rifle": ("rifle-infantry", "all"),
    "rocket": ("rocket-infantry", "all"), "engineer": ("engineer", "all"),
    "harvester": ("harvester", "all"), "harvester-vesper": ("vesper-harvester", "vesper"), "mcv": ("mcv", "all"),
    "apc": ("apc", "all"),
    "buggy": ("recon-buggy", "all"), "buggy-vesper": ("vesper-recon-buggy", "vesper"), "lightTank": ("striker-tank", "all"),
    "artillery": ("siege-crawler", "all"), "guardian": ("aegis-heavy-tank-game", "aegis"),
    "medic": ("medic", "aegis"), "orca": ("gunship", "aegis"),
    "flamer": ("flamer", "vesper"), "stealthTank": ("stealth-tank", "vesper"),
    "apache": ("apache", "vesper"),
    "dropship": ("dropship", "aegis"),
    "command": ("command-yard", "all"), "power": ("power-plant", "all"),
    "command-vesper": ("vesper-command-yard", "vesper"),
    "power-vesper": ("vesper-power-plant", "vesper"),
    "barracks-vesper": ("vesper-barracks", "vesper"),
    "radar-vesper": ("vesper-radar-array", "vesper"),
    "tech-vesper": ("vesper-research-center", "vesper"),
    "advancedPower": ("advanced-power", "all"), "refinery": ("refinery", "all"),
    "refinery-vesper": ("vesper-refinery", "vesper"),
    "barracks": ("barracks", "all"), "factory": ("factory", "all"),
    "factory-vesper": ("vesper-factory", "vesper"),
    "radar": ("radar-array", "all"), "turret": ("defense-turret", "all"),
    "wall": ("modular-wall", "all"),
    "guardTower": ("aegis-watchtower", "aegis"), "aaTower": ("skyshield-battery", "aegis"),
    "sam": ("vesper-sam", "vesper"), "obelisk": ("signal-obelisk", "vesper"),
    "helipad": ("helipad", "all"), "serviceBay": ("service-bay", "all"),
    "silo": ("crystal-silo", "all"),
    "tech": ("research-center", "all"), "superweapon": ("ion-spire", "aegis"),
    "warhead": ("warhead-temple", "vesper"),
}

ACCENTS = {
    "all": (0.38, 0.72, 1.0),
    "aegis": (0.30, 0.78, 1.0),
    "vesper": (0.82, 0.38, 1.0),
}


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name, location, power, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, (0, 0, 0))


def setup_render(meshes, faction, asset_id=None):
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    high = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    center = (low + high) * 0.5
    extent = max((high - low).length, 0.01)

    # These vehicles carry their defining equipment at the front of the hull.
    front_view = asset_id in {"apache", "harvester", "guardian", "stealthTank", "serviceBay",
                              "lightTank", "rifle", "rocket", "engineer", "power", "barracks-vesper", "scout-vesper", "harvester-vesper",
                              "radar-vesper", "tech-vesper", "buggy-vesper", "barracks", "factory"}
    direction = Vector((5.5, 8.0 if front_view else -8.0, 5.6)).normalized()
    right = direction.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(direction).normalized()
    projected_w = max(abs((corner - center).dot(right)) for corner in corners) * 2
    projected_h = max(abs((corner - center).dot(up)) for corner in corners) * 2

    camera_data = bpy.data.cameras.new("PortraitCamera")
    camera = bpy.data.objects.new("PortraitCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = center + direction * extent * 3.0
    aim(camera, center)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(projected_w, projected_h) * 1.20
    camera_data.lens = 50
    camera_data.dof.use_dof = False
    bpy.context.scene.camera = camera

    accent = ACCENTS[faction]
    # Broad key, cool fill, and faction tinted rim keep material details legible.
    add_area("Key", center + Vector((-3.5, -5.0, 7.0)) * extent / 5, 125 * extent, 4.0 * extent, (1.0, 0.88, 0.72))
    add_area("Fill", center + Vector((5.0, -1.5, 3.4)) * extent / 5, 70 * extent, 4.8 * extent, (0.58, 0.72, 1.0))
    add_area("FactionRim", center + Vector((1.5, 4.5, 5.2)) * extent / 5, 140 * extent, 3.5 * extent, accent)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.image_settings.compression = 20
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.world.color = (0.045, 0.055, 0.075)
    scene.render.filepath = ""


def render_one(asset_id):
    model, faction = ASSETS[asset_id]
    source = os.path.join(MODELS, model + ".glb")
    if not os.path.isfile(source):
        print(f"SKIP {asset_id}: missing {source}")
        return
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=source)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        print(f"SKIP {asset_id}: no meshes in {source}")
        return
    setup_render(meshes, faction, asset_id)
    os.makedirs(OUTPUT, exist_ok=True)
    destination = os.path.join(OUTPUT, asset_id + ".png")
    bpy.context.scene.render.filepath = destination
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {asset_id} {os.path.getsize(destination)} bytes")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("ids", nargs="*")
    args = parser.parse_args(argv)
    ids = list(ASSETS) if args.all else args.ids
    if not ids:
        parser.error("provide ids or --all")
    unknown = [item for item in ids if item not in ASSETS]
    if unknown:
        parser.error("unknown ids: " + ", ".join(unknown))
    for asset_id in ids:
        render_one(asset_id)


if __name__ == "__main__":
    main()
