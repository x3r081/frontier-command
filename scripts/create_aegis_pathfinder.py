#!/usr/bin/env python3
"""Build the Aegis Pathfinder on the shared infantry skeleton.

Run from the repository root with Blender 5.x:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_aegis_pathfinder.py
"""

import importlib.util
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "scripts" / "create_3d_assets.py"
spec = importlib.util.spec_from_file_location("frontier_asset_helpers", GENERATOR)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def aegis_palette():
    """Pale ceramic, blue-gray textile, and restrained cyan survey optics."""
    return {
        "armor": helpers.material("Aegis Pathfinder ivory ceramic", (0.73, 0.79, 0.78), .28, .43),
        "edge": helpers.material("Aegis Pathfinder pale alloy", (0.90, 0.91, 0.85), .46, .34),
        "dark": helpers.material("Aegis Pathfinder blue gray suit", (0.12, 0.19, 0.22), .18, .72),
        "rubber": helpers.material("Aegis Pathfinder boot rubber", (0.045, 0.075, 0.085), .08, .86),
        "glass": helpers.material("Aegis Pathfinder optic glass", (0.10, 0.45, 0.56), .52, .18, (0.015, .17, .24), .5),
        "accent": helpers.material("Aegis Pathfinder sensor cyan", (0.06, .78, .91), .27, .25, (.01, .34, .48), 1.25),
        "steel": helpers.material("Aegis Pathfinder blue steel", (0.27, .39, .43), .62, .4),
        "recess": helpers.material("Aegis Pathfinder dark recess", (0.025, .045, .055), .2, .78),
    }


def build_body(m):
    """Light scout armor with narrow shoulders and separate joint pieces."""
    for x in (-.065, .065):
        side = "L" if x < 0 else "R"
        helpers.cube("Armored boot " + side, (x, .025, .045), (.084, .155, .082), m["rubber"], .018)
        helpers.cube("Thigh armor " + side, (x, -.005, .275), (.078, .105, .13), m["armor"], .018)
        helpers.cube("Knee armor " + side, (x, .050, .202), (.084, .035, .060), m["edge"], .010)
        helpers.cube("Lower leg greave " + side, (x, -.005, .142), (.074, .10, .10), m["steel"], .014)

    # A fitted torso and overlapping chest insert keep the profile lighter than
    # the line infantry plate while giving the pale team color a broad read.
    helpers.cube("Armored torso", (0, 0, .335), (.195, .175, .22), m["dark"], .032)
    helpers.cube("Pathfinder chest plate", (0, .091, .35), (.177, .035, .143), m["armor"], .018)
    helpers.cube("Chest survey mark", (0, .112, .359), (.074, .014, .026), m["accent"], .006)
    helpers.cube("Waist field belt", (0, .005, .245), (.175, .125, .042), m["steel"], .012)

    # Minimal shoulder caps leave a recognizably narrow, mobile silhouette.
    for x in (-.128, .128):
        side = "L" if x < 0 else "R"
        helpers.cube("Shoulder pauldron " + side, (x, .005, .405), (.078, .092, .072), m["armor"], .018)
        arm_loc = ((-.135, .055, .355) if x < 0 else (.15, .04, .385))
        forearm_loc = ((.055, .225, .405) if x < 0 else (.155, .17, .43))
        upper = helpers.cube("Arm." + side + " upper", arm_loc, (.082, .105, .115), m["dark"], .014)
        bpy.context.scene.cursor.location = (x, .01, .405)
        bpy.ops.object.select_all(action="DESELECT")
        upper.select_set(True)
        bpy.context.view_layer.objects.active = upper
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
        forearm = helpers.cube("Arm." + side + " forearm", forearm_loc, (.075, .125, .073), m["armor"], .015)
        elbow = ((-.015, .16, .385) if x < 0 else (.155, .08, .43))
        bpy.context.scene.cursor.location = elbow
        bpy.ops.object.select_all(action="DESELECT")
        forearm.select_set(True)
        bpy.context.view_layer.objects.active = forearm
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")
    helpers.cube("Glove.L", (.105, .285, .435), (.067, .067, .05), m["dark"], .010)
    helpers.cube("Glove.R", (.155, .275, .445), (.067, .067, .05), m["dark"], .010)

    # Compact survey pack sits tight to the back; the cyan locator is visible
    # in profile without creating a tall radio silhouette.
    helpers.cube("Field harness", (0, -.104, .34), (.15, .038, .145), m["steel"], .014)
    helpers.cube("Backpack", (0, -.143, .355), (.125, .078, .17), m["dark"], .018)
    helpers.cube("Survey pack panel", (0, -.184, .365), (.077, .012, .092), m["armor"], .008)
    helpers.cube("Pack locator", (0, -.192, .405), (.035, .009, .016), m["accent"], .004)
    for x in (-.125, .125):
        helpers.cube("Utility pouch", (x, -.005, .292), (.045, .072, .073), m["steel"], .010)

    # Narrow shell, split optics, and one short aerial form the Pathfinder's
    # survey helmet. Its crown stays below the rifleman helmet top.
    helpers.cylinder("Pathfinder helmet", (0, -.015, .505), .094, .132, m["armor"], 10)
    helpers.cube("Helmet crown ridge", (0, -.012, .574), (.105, .080, .022), m["edge"], .008)
    helpers.cube("Helmet brow", (0, .061, .514), (.145, .029, .035), m["steel"], .010)
    helpers.cube("Survey visor", (0, .081, .505), (.112, .014, .021), m["glass"], .005)
    for x in (-.047, .047):
        helpers.cylinder("Survey optic rim", (x, .083, .532), .021, .014, m["steel"], 8, (helpers.math.pi/2, 0, 0))
        helpers.cylinder("Survey optic lens", (x, .092, .532), .013, .006, m["accent"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Helmet comms pad L", (-.103, .004, .505), (.025, .057, .043), m["steel"], .008)
    helpers.cube("Helmet comms pad R", (.103, .004, .505), (.025, .057, .043), m["steel"], .008)
    helpers.cylinder("Short survey antenna", (-.061, -.04, .581), .0065, .105, m["accent"], 6, (0, -.15, 0))


def build_carbine(m):
    """Shouldered compact carbine whose named pieces follow FC_Weapon."""
    helpers.cube("Pathfinder rifle stock", (.155, -.005, .445), (.068, .14, .071), m["dark"], .012)
    helpers.cube("Pathfinder rifle receiver", (.155, .137, .445), (.078, .17, .078), m["steel"], .012)
    helpers.cube("Pathfinder rifle ceramic shroud", (.155, .271, .445), (.061, .12, .061), m["armor"], .009)
    helpers.cube("Pathfinder rifle top rail", (.155, .145, .491), (.032, .16, .012), m["dark"], .004)
    helpers.cylinder("Pathfinder rifle barrel", (.155, .414, .445), .015, .17, m["edge"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cylinder("Pathfinder rifle muzzle", (.155, .501, .445), .021, .026, m["steel"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Pathfinder rifle optic", (.155, .144, .525), (.049, .060, .038), m["dark"], .008)
    helpers.cylinder("Pathfinder rifle optic lens", (.155, .177, .525), .017, .009, m["glass"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Pathfinder rifle magazine", (.155, .150, .383), (.043, .069, .081), m["steel"], .008)
    helpers.cube("Pathfinder rifle foregrip", (.155, .282, .387), (.043, .045, .080), m["dark"], .008)


def build():
    helpers.LOW_POLY_BEVEL = True
    helpers.clean()
    m = aegis_palette()
    build_body(m)
    build_carbine(m)
    helpers.scale_infantry_for_game_readability()
    # The default rifle weapon_start/end exactly match the shared rifle hand
    # contact frame. rig_infantry preserves the common 14 bone names.
    helpers.rig_infantry("rifle")
    helpers.export("scout")


if __name__ == "__main__":
    build()
