#!/usr/bin/env python3
"""Build the original Vesper Rocket Trooper with the shared infantry rig.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_vesper_rocket_trooper.py
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- -- rocket-vesper
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
    """Reclaimed charcoal, oxide, and violet optics, in the common draw palette."""
    return {
        "armor": helpers.material("Vesper oxide armor", (0.27, 0.105, 0.11), .58, .48),
        "edge": helpers.material("Vesper salvaged ivory", (0.70, 0.57, 0.43), .48, .39),
        "dark": helpers.material("Vesper basalt structure", (0.055, 0.047, 0.075), .42, .65),
        "rubber": helpers.material("Vesper field rubber", (0.035, 0.038, 0.050), .12, .84),
        "glass": helpers.material("Vesper violet glass", (0.27, 0.10, 0.66), .44, .17, (0.20, 0.04, 0.80), .85),
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

    # Shared soldier anatomy and bone-weight naming keep the production gait,
    # aim, and recoil paths compatible with the existing Rocket Trooper.
    helpers.infantry_body(m, "rocket")

    # A broad, offset thermal shield makes the salvaged launcher legible as a
    # heavy anti-armor weapon from above while leaving the tube and nose clear.
    helpers.cube("Vesper Rocket launcher thermal shield", (-.17, .045, .625),
                 (.30, .36, .095), m["armor"], .024)
    helpers.cube("Vesper Rocket shield cheek", (-.335, .025, .59),
                 (.055, .26, .17), m["edge"], .012)
    helpers.cube("Vesper Rocket top sight rail", (-.17, .075, .69),
                 (.08, .32, .035), m["dark"], .008)
    helpers.cube("Vesper Rocket violet optic", (-.17, .205, .714),
                 (.075, .07, .018), m["glass"], .008)

    # The shoulder and pack use broad repair plates rather than small bolts;
    # this asymmetry gives the faction a recognizable profile without clutter.
    helpers.cube("Vesper shoulder pauldron L", (-.245, .005, .415),
                 (.17, .17, .145), m["edge"], .026)
    helpers.cube("Vesper shoulder repair plate", (-.245, .097, .427),
                 (.11, .025, .078), m["armor"], .012)
    helpers.cube("Vesper rear reload cassette", (.17, -.175, .37),
                 (.20, .12, .24), m["copper"], .025)
    helpers.cube("Vesper reload latch", (.17, -.105, .39),
                 (.12, .035, .10), m["dark"], .008)
    helpers.cube("Vesper helmet brow shield", (0, .06, .565),
                 (.20, .06, .075), m["edge"], .018)
    helpers.cube("Vesper helmet split optic", (0, .097, .56),
                 (.11, .018, .027), m["glass"], .006)

    # Overslung anti-armor tube and fins preserve the original FC_Weapon path.
    x, z = -.17, .52
    forward_axis = (helpers.math.pi / 2, 0, 0)
    helpers.cube("Vesper Launcher yoke", (-.145, -.035, .425), (.14, .24, .15), m["dark"], .025)
    helpers.cylinder("Vesper Rocket tube", (x, .025, z), .078, .53, m["steel"], 8, forward_axis)
    helpers.cylinder("Vesper Rocket rear collar", (x, -.225, z), .087, .065, m["dark"], 8, forward_axis)
    for y in [-.12, .17]:
        helpers.cylinder("Vesper Rocket safety band", (x, y, z), .083, .04, m["warning"], 8, forward_axis)
    helpers.cylinder("Vesper Rocket nose collar", (x, .30, z), .086, .05, m["dark"], 8, forward_axis)
    helpers.cone("Vesper Launcher nose", (x, .372, z), .075, .016, .13, m["edge"], 8, forward_axis)
    helpers.cylinder("Vesper Launcher exhaust", (x, -.255, z), .05, .03, m["dark"], 8, forward_axis)
    helpers.cube("Vesper Rocket stabilizer left", (x - .095, -.225, z), (.105, .065, .022), m["warning"], .006)
    helpers.cube("Vesper Rocket stabilizer right", (x + .095, -.225, z), (.105, .065, .022), m["warning"], .006)
    helpers.cube("Vesper Rocket stabilizer upper", (x, -.225, z + .085), (.022, .065, .085), m["warning"], .006)
    helpers.cube("Vesper Rocket stabilizer lower", (x, -.225, z - .085), (.022, .065, .085), m["warning"], .006)
    helpers.cube("Vesper Launcher sight", (x, -.005, .63), (.10, .12, .05), m["steel"], .018)
    helpers.cube("Vesper ammunition harness", (0, -.165, .36), (.24, .11, .23), m["dark"], .03)

    helpers.scale_infantry_for_game_readability()
    helpers.rig_infantry("rocket")
    helpers.export("vesper-rocket-infantry")


if __name__ == "__main__":
    build()
