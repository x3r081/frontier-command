#!/usr/bin/env python3
"""Build a Vesper Rifle Squad member on the shared infantry skeleton.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_vesper_rifle_infantry.py
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- -- rifle-vesper
"""

import importlib.util
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "scripts" / "create_3d_assets.py"
spec = importlib.util.spec_from_file_location("frontier_asset_helpers", GENERATOR)
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


def vesper_palette():
    """Reclaimed basalt, oxide, pale field armor, and violet optics."""
    return {
        "armor": helpers.material("Vesper oxide armor", (0.28, 0.115, 0.13), .56, .48),
        "edge": helpers.material("Vesper salvaged ivory", (0.71, 0.59, 0.45), .48, .39),
        "dark": helpers.material("Vesper basalt structure", (0.055, 0.048, 0.072), .40, .65),
        "rubber": helpers.material("Vesper field rubber", (0.035, 0.038, 0.049), .12, .84),
        "glass": helpers.material("Vesper violet glass", (0.28, 0.11, 0.66), .44, .17, (0.20, 0.04, 0.80), .85),
        "accent": helpers.material("TeamAccent", (0.48, 0.16, 0.88), .34, .28, (0.30, 0.06, 0.72), 1.45),
        "glow": helpers.material("Vesper optic glow", (.70, .26, 1.0), .12, .16, (.46, .10, .90), 1.2),
        "recess": helpers.material("Vesper machinery recess", (.022, .020, .034), .28, .75),
        "steel": helpers.material("Vesper heat-darkened steel", (.20, .19, .25), .70, .43),
        "copper": helpers.material("Vesper oxidized copper", (.47, .20, .13), .64, .39),
        "warning": helpers.material("Vesper faded hazard ochre", (.78, .40, .15), .28, .53),
    }


def build():
    helpers.LOW_POLY_BEVEL = True
    helpers.clean()
    m = vesper_palette()
    helpers.infantry_body(m, "rifle")

    # A narrow oxide sling crosses the field plate without covering the hands
    # or head. The repaired hip cassette and radio canister add broad, useful
    # field-kit shapes instead of tiny cosmetic fittings.
    strap = helpers.cube("Vesper field sling strap", (-.025, .139, .355),
                         (.043, .027, .245), m["copper"], .012)
    strap.rotation_euler[1] = -.34
    helpers.cube("Vesper sling clasp", (-.087, .158, .405), (.075, .025, .054), m["edge"], .009)
    helpers.cube("Vesper hip field cassette", (-.17, -.012, .28),
                 (.105, .12, .13), m["copper"], .018)
    helpers.cube("Vesper radio shoulder cover", (-.18, -.09, .46),
                 (.12, .12, .15), m["edge"], .021)
    helpers.cube("Vesper helmet brow shield", (0, .077, .551),
                 (.18, .032, .048), m["edge"], .012)
    helpers.cube("Vesper helmet split optic", (0, .098, .526),
                 (.095, .018, .024), m["glass"], .006)
    helpers.cube("Vesper team shoulder tab", (-.145, .016, .405),
                 (.045, .12, .055), m["accent"], .012)

    # Keep the standard rifle grip and forearm contact locations. The local
    # heat-darkened handguard, warm receiver stripe, and violet optic make the
    # weapon distinctive without broadening it into a launcher silhouette.
    helpers.cube("Vesper Rifle stock", (.155, -.005, .445), (.072, .16, .075), m["dark"], .016)
    helpers.cube("Vesper Rifle receiver", (.155, .145, .445), (.082, .19, .082), m["steel"], .014)
    helpers.cube("Vesper Rifle receiver stripe", (.155, .145, .492), (.045, .13, .015), m["copper"], .005)
    helpers.cube("Vesper Rifle handguard", (.155, .29, .445), (.065, .14, .064), m["dark"], .01)
    helpers.cylinder("Vesper Rifle barrel", (.155, .425, .445), .018, .19, m["edge"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cylinder("Vesper Rifle muzzle", (.155, .522, .445), .027, .035, m["steel"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Vesper Rifle optic housing", (.155, .145, .535), (.078, .075, .055), m["dark"], .012)
    helpers.cylinder("Vesper Rifle optic lens rim", (.155, .187, .535), .028, .018, m["steel"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cylinder("Vesper Rifle optic lens", (.155, .198, .535), .019, .008, m["glass"], 8, (helpers.math.pi/2, 0, 0))
    helpers.cube("Vesper Rifle foregrip", (.155, .29, .382), (.052, .06, .10), m["steel"], .012)
    helpers.cube("Vesper Rifle magazine", (.155, .16, .386), (.048, .085, .095), m["copper"], .01)

    helpers.scale_infantry_for_game_readability()
    helpers.rig_infantry("rifle")
    helpers.export("vesper-rifle-infantry")


if __name__ == "__main__":
    build()
