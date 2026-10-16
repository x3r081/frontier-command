#!/usr/bin/env python3
"""Build the Vesper Pathfinder recon infantry on the shared infantry rig.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_vesper_pathfinder.py
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- -- scout-vesper
"""

import importlib.util
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "scripts" / "create_3d_assets.py"
spec = importlib.util.spec_from_file_location("frontier_asset_helpers", GENERATOR)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def palette():
    """Muted field colors with a small violet sensor and oxide-red markings."""
    return {
        "field": helpers.material("Vesper Pathfinder oxide fieldcloth", (0.24, 0.255, 0.27), .22, .74),
        "ivory": helpers.material("Vesper Pathfinder salvaged ivory", (0.67, 0.61, 0.50), .34, .48),
        "dark": helpers.material("Vesper Pathfinder wrapped charcoal", (0.047, 0.052, 0.066), .12, .86),
        "rubber": helpers.material("Vesper Pathfinder boot rubber", (0.025, 0.029, 0.038), .08, .91),
        "steel": helpers.material("Vesper Pathfinder oxide steel", (0.145, 0.16, 0.18), .58, .48),
        "recess": helpers.material("Vesper Pathfinder recessed seams", (0.018, 0.020, 0.027), .25, .82),
        "violet": helpers.material("Vesper Pathfinder survey glass", (0.27, 0.10, 0.55), .42, .19, (0.19, 0.035, 0.47), .72),
        "copper": helpers.material("Vesper Pathfinder oxide red detail", (0.43, 0.13, 0.095), .38, .53),
    }


def build():
    helpers.LOW_POLY_BEVEL = True
    helpers.clean()
    m = palette()

    # Lean lower body, with fieldcloth between small salvaged plates. Keep
    # names aligned to the shared rig's rigid limb weighting rules.
    for x in (-.065, .065):
        side = "L" if x < 0 else "R"
        helpers.cube("Armored boot " + side, (x, .025, .045), (.082, .15, .082), m["rubber"], .019)
        helpers.cube("Thigh armor " + side, (x, -.005, .275), (.076, .105, .132), m["field"], .018)
        helpers.cube("Knee armor " + side, (x, .052, .205), (.084, .038, .064), m["ivory"], .011)
        helpers.cube("Lower leg greave " + side, (x, -.005, .145), (.074, .10, .095), m["steel"], .014)
    helpers.cube("Pathfinder torso field jacket", (0, 0, .335), (.195, .176, .225), m["field"], .038)
    helpers.cube("Pathfinder narrow chest plate", (0, .094, .344), (.16, .035, .139), m["ivory"], .018)
    helpers.cube("Pathfinder chest recess", (0, .115, .345), (.103, .012, .07), m["recess"], .008)
    helpers.cube("Pathfinder oxide chest mark", (.025, .124, .374), (.025, .008, .025), m["copper"], .004)

    # Shoulder protection is a pair of narrow, irregular salvage caps. The
    # dark wrap around the head and neck makes the silhouette read as recon.
    for x, side in ((-.145, "L"), (.145, "R")):
        helpers.cube("Shoulder pauldron " + side, (x, .003, .411), (.085, .103, .072), m["ivory"], .018)
    helpers.cube("Pathfinder wrapped neck", (0, .008, .451), (.146, .143, .09), m["dark"], .035)
    helpers.cylinder("Pathfinder hood crown", (0, -.018, .516), .097, .115, m["dark"], 8)
    helpers.cube("Pathfinder hood brow", (0, .068, .532), (.154, .041, .04), m["dark"], .014)
    helpers.cube("Pathfinder salvaged brow plate", (0, .094, .546), (.105, .019, .025), m["ivory"], .008)
    helpers.cube("Pathfinder wrapped face guard", (0, .073, .478), (.111, .026, .041), m["dark"], .011)
    helpers.cube("Pathfinder respirator plate", (-.012, .091, .481), (.049, .012, .021), m["steel"], .005)
    for x in (-.027, -.012, .003):
        helpers.cube("Pathfinder respirator vent", (x, .098, .481), (.004, .004, .01), m["copper"], .001)
    # One compact survey optic is offset to keep the face asymmetrical and
    # recognizable. Violet remains an indicator, not the overall armor color.
    helpers.cube("Pathfinder compact optic housing", (.045, .103, .51), (.061, .031, .045), m["steel"], .009)
    helpers.cylinder("Pathfinder survey optic lens", (.045, .122, .51), .018, .012, m["violet"], 8, (helpers.math.pi/2, 0, 0))

    # Light sensor cassette and narrow aerial sit above the pack rather than
    # widening the shoulders. A small red service tab carries faction color.
    helpers.cube("Field harness", (0, -.11, .34), (.155, .037, .15), m["dark"], .015)
    helpers.cube("Backpack", (0, -.155, .352), (.132, .078, .18), m["steel"], .019)
    helpers.cube("Pathfinder sensor cassette", (-.015, -.202, .374), (.091, .045, .078), m["ivory"], .012)
    helpers.cube("Pathfinder cassette window", (-.015, -.228, .375), (.048, .009, .035), m["violet"], .004)
    helpers.cylinder("Pathfinder narrow antenna", (.05, -.155, .492), .006, .16, m["steel"], 6)
    helpers.cube("Pathfinder red shoulder tab", (-.145, .017, .409), (.025, .094, .022), m["copper"], .005)
    for x in (-.13, .13):
        helpers.cube("Utility pouch", (x, -.004, .297), (.046, .073, .074), m["dark"], .01)

    # Compact shouldered carbine, held to the existing hand and forearm
    # contacts. Every weapon node contains "rifle" for FC_Weapon assignment.
    helpers.cube("Pathfinder rifle stock", (.155, -.008, .445), (.061, .126, .063), m["dark"], .013)
    helpers.cube("Pathfinder rifle receiver", (.155, .13, .445), (.069, .162, .068), m["steel"], .012)
    helpers.cube("Pathfinder rifle receiver inset", (.155, .139, .47), (.042, .088, .018), m["copper"], .004)
    helpers.cube("Pathfinder rifle handguard", (.155, .263, .445), (.055, .112, .055), m["dark"], .009)
    helpers.cylinder("Pathfinder rifle barrel", (.155, .386, .445), .014, .153, m["steel"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cylinder("Pathfinder rifle muzzle", (.155, .463, .445), .021, .027, m["dark"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Pathfinder rifle optic", (.155, .13, .508), (.055, .057, .038), m["dark"], .008)
    helpers.cylinder("Pathfinder rifle survey lens", (.155, .161, .508), .016, .009, m["violet"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Pathfinder rifle magazine", (.155, .148, .384), (.038, .065, .075), m["steel"], .008)
    helpers.cube("Pathfinder rifle foregrip", (.155, .263, .391), (.042, .047, .074), m["recess"], .009)

    # The arm and hand names/positions preserve the shared rifle grip.
    helpers.cube("Arm.L upper", (-.09, .052, .378), (.082, .105, .106), m["field"], .017)
    helpers.cube("Arm.L forearm", (.055, .225, .405), (.078, .13, .071), m["field"], .017)
    helpers.cube("Arm.R upper", (.15, .04, .385), (.082, .105, .106), m["field"], .017)
    helpers.cube("Arm.R forearm", (.155, .17, .43), (.074, .128, .067), m["field"], .016)
    helpers.cube("Glove.L", (.105, .285, .435), (.067, .067, .05), m["dark"], .011)
    helpers.cube("Glove.R", (.155, .275, .445), (.067, .067, .05), m["dark"], .011)

    helpers.scale_infantry_for_game_readability()
    helpers.rig_infantry("rifle")
    helpers.export("vesper-scout")


if __name__ == "__main__":
    build()
