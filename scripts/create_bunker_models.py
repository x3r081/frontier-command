"""Generate the Aegis and Vesper Field Bunkers with Blender.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_bunker_models.py
"""

import sys
import math
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import create_3d_assets as kit  # noqa: E402


def build_bunker(vesper=False):
    kit.LOW_POLY_BEVEL = True
    kit.clean()
    m = kit.vesper_palette() if vesper else kit.palette()

    if vesper:
        m["armor"] = kit.material("Vesper bunker reclaimed basalt", (.20, .17, .23), .48, .62)
        m["edge"] = kit.material("Vesper bunker salvaged warm alloy", (.66, .43, .34), .58, .43)
        m["dark"] = kit.material("Vesper bunker carbon concrete", (.028, .022, .033), .34, .80)
        m["steel"] = kit.material("Vesper bunker patched steel", (.24, .16, .23), .62, .48)
        m["glow"] = kit.material("Vesper bunker violet entry light", (.78, .34, 1.0), .15, .18, (.54, .08, 1.0), 2.2)
    else:
        m["armor"] = kit.material("Aegis bunker pale teal armor", (.48, .63, .62), .38, .54)
        m["edge"] = kit.material("Aegis bunker light ceramic", (.78, .85, .80), .47, .40)
        m["dark"] = kit.material("Aegis bunker graphite concrete", (.045, .085, .092), .32, .76)
        m["steel"] = kit.material("Aegis bunker teal gunmetal", (.17, .29, .31), .59, .48)

    # Standard 2x2 building footprint; no walls or steps extend past its pad.
    kit.cube("Bunker foundation", (0, 0, .12), (2.78, 2.78, .24), m["dark"], .045)
    kit.cube("Bunker plinth", (0, 0, .28), (2.48, 2.48, .12), m["steel"], .035)
    lower = [(-1.15, -.88), (-.84, -1.14), (.84, -1.14), (1.15, -.88),
             (1.15, .88), (.84, 1.14), (-.84, 1.14), (-1.15, .88)]
    upper = [(-.99, -.75), (-.73, -.98), (.73, -.98), (.99, -.75),
             (.99, .75), (.73, .98), (-.73, .98), (-.99, .75)]
    kit.faceted_prism("Armored bunker casemate", lower, upper, .34, 1.04, m["armor"])
    kit.cube("Bunker roof armor deck", (0, 0, 1.02), (2.08, 2.08, .16), m["dark"], .035)

    # The roof carries a faction-specific silhouette. Keep these forms broad
    # and low so they read at RTS scale without turning the roof into greebles.
    if vesper:
        # A scavenged plate sits askew over the roof, with its warm edge showing
        # as a second, slightly smaller layer.
        plate = kit.cube("Vesper salvaged roof reinforcement", (.24, .12, 1.145),
                         (1.48, 1.18, .085), m["steel"], .025)
        plate.rotation_euler[2] = math.radians(-12)
        rim = kit.cube("Vesper reinforcement edge", (.24, .12, 1.192),
                       (1.36, 1.06, .035), m["edge"], .012)
        rim.rotation_euler[2] = math.radians(-12)
        # A compact breather/manifold and one tall, thin comm fin make the
        # recovered hardware distinct from Aegis' orderly observation pod.
        kit.cube("Vesper roof breather manifold", (-.48, .30, 1.30),
                 (.62, .38, .20), m["dark"], .025)
        kit.cube("Vesper manifold cap", (-.48, .30, 1.405), (.68, .43, .045), m["edge"], .014)
        kit.cube("Vesper comm fin", (.72, .45, 1.325), (.075, .38, .25), m["armor"], .018)
    else:
        # The low shielded observation housing is deliberately offset from a
        # separate orderly service hatch, giving the Aegis roof a deliberate
        # military layout instead of a generic flat slab.
        kit.cube("Aegis roof service hatch", (-.48, -.20, 1.145),
                 (.70, .86, .085), m["steel"], .025)
        kit.cube("Aegis hatch locking bar", (-.48, -.20, 1.197),
                 (.10, .68, .035), m["edge"], .012)
        kit.cube("Aegis shielded observation housing", (.40, .30, 1.225),
                 (.72, .60, .19), m["steel"], .025)
        kit.cube("Aegis observation shield", (.40, .30, 1.335),
                 (.84, .70, .055), m["edge"], .018)
        kit.cube("Aegis observation optic", (.40, -.014, 1.255),
                 (.48, .028, .060), m["accent"], .008)

    # Large front access faces Blender -Y, which maps toward the tactical
    # camera's Three.js +Z side. The entry and its short steps stay on the pad.
    kit.cube("Bunker doorway recess", (0, -1.015, .57), (.94, .07, .60), m["dark"], .025)
    kit.cube("Bunker armored doorway", (0, -1.065, .54), (.69, .055, .46), m["steel"], .020)
    kit.cube("Bunker door center plate", (0, -1.099, .54), (.16, .014, .36), m["armor"], .008)
    kit.cube("Bunker entry header", (0, -1.08, .88), (1.14, .15, .12), m["edge"], .025)
    kit.cube("Bunker entry light", (0, -1.161, .895), (.68, .024, .038), m["glow"], .008)
    kit.cube("Bunker threshold", (0, -1.16, .31), (.96, .28, .08), m["steel"], .018)
    kit.cube("Bunker entry step", (0, -1.31, .255), (.78, .12, .07), m["edge"], .014)

    # Thick corner buttresses and sloping armor shoulders make this read as a
    # concrete hardpoint rather than a small production building.
    for x in (-1, 1):
        for y in (-.72, .72):
            kit.cube("Bunker corner buttress", (x*.98, y*.98, .60), (.28, .30, .60), m["steel"], .025)
    # Three optically lit firing ports face the front, flank, and rear sectors.
    # Their meshes remain individually named/emissive for crew-fire pulses.
    port_positions = [
        ("Bunker firing slit 1", (.62, -1.115, .76), (.30, .022, .095), (0, -1, 0)),
        ("Bunker firing slit 2", (1.105, .48, .75), (.022, .36, .095), (1, 0, 0)),
        ("Bunker firing slit 3", (.30, 1.115, .76), (.36, .022, .095), (0, 1, 0)),
    ]
    for name, location, size, normal in port_positions:
        # Dark armored bezel is static; the luminous slit itself stays named.
        kit.cube(name + " bezel", location, (size[0]*1.32, size[1]*1.8, size[2]*1.8), m["dark"], .015)
        slit_location = tuple(location[axis] + normal[axis]*.028 for axis in range(3))
        kit.cube(name, slit_location, size, m["accent"], .006)

    kit.consolidate_static_meshes(preserved=(
        "Bunker firing slit 1", "Bunker firing slit 2", "Bunker firing slit 3", "Bunker entry light",
    ))
    kit.export("vesper-bunker" if vesper else "bunker")


if __name__ == "__main__":
    build_bunker(vesper=False)
    build_bunker(vesper=True)
