"""Generate the Aegis and Vesper mobile command rigs with Blender.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_mcv_models.py
"""

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import create_3d_assets as kit  # noqa: E402


def beam(name, start, end, width, depth, mat, bevel=0):
    """Create one broad box beam between two Blender-space points."""
    a, b = Vector(start), Vector(end)
    direction = b - a
    obj = kit.cube(name, (a + b) * .5, (width, direction.length, depth), mat, bevel)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(direction.normalized())
    return obj


def build_mcv(vesper=False):
    kit.LOW_POLY_BEVEL = True
    kit.clean()
    m = kit.vesper_palette() if vesper else kit.palette()
    if vesper:
        m["armor"] = kit.material("Vesper MCV reclaimed basalt", (.27, .22, .32), .50, .48)
        m["edge"] = kit.material("Vesper MCV salvaged warm alloy", (.69, .45, .38), .61, .38)
        m["steel"] = kit.material("Vesper MCV patched violet steel", (.29, .21, .39), .57, .46)
        m["dark"] = kit.material("Vesper MCV carbon frame", (.035, .027, .049), .42, .65)
    else:
        m["armor"] = kit.material("Aegis MCV pale teal armor", (.52, .66, .64), .39, .45)
        m["edge"] = kit.material("Aegis MCV ceramic alloy", (.82, .88, .82), .52, .34)
        m["steel"] = kit.material("Aegis MCV blue gunmetal", (.20, .35, .39), .61, .43)
        m["dark"] = kit.material("Aegis MCV graphite frame", (.055, .12, .14), .35, .65)

    # Eight separately named wheels remain available to the runtime's modest
    # roll animation. Hubs and all other stationary parts batch by material.
    wheel_nodes = []
    for x in (-.59, .59):
        for y in (-.57, -.19, .19, .57):
            wheel_nodes.append(kit.cylinder("Run-flat wheel", (x, y, .235), .19, .15,
                                            m["rubber"], 10, (0, math.pi / 2, 0)))
            # Hub faces stay flush with their axle and do not need independent
            # rotation. Avoid the runtime's `Wheel hub` animation name so this
            # shared material batch cannot spin with all eight wheels at once.
            kit.cylinder("Wheel hub trim", (x * 1.13, y, .235), .092, .025,
                         m["edge"], 8, (0, math.pi / 2, 0))

    # Low rectangular carrier and visible wheel-train guards.
    kit.cube("Mobile rig lower chassis", (0, 0, .39), (1.12, 1.66, .34), m["dark"], .085)
    kit.cube("Armored belly skid", (0, -.02, .205), (.82, 1.32, .10), m["steel"], .035)
    for side in (-1, 1):
        for y in (-.38, 0, .38):
            panel = kit.cube("Wheel train armor segment", (side * .56, y, .40),
                             (.14, .29, .18), m["armor"], .035)
            panel.rotation_euler[2] = side * math.radians(3)
        kit.cube("Carrier side rail", (side * .48, -.02, .58), (.12, 1.35, .14), m["steel"], .03)

    # Forward cab is tall and glazed, with a broad armored brow and bumper.
    kit.cube("Armored forward cab", (0, .47, .70), (.88, .70, .60), m["armor"], .11)
    kit.cube("Panoramic cab windshield", (0, .833, .77), (.68, .045, .25), m["glass"], .025)
    for side in (-1, 1):
        kit.cube("Cab side glazing", (side * .447, .47, .76), (.026, .36, .19), m["glass"], .012)
        kit.cube("Cab door armor", (side * .455, .36, .52), (.03, .40, .15), m["steel"], .018)
    kit.cube("Cab armored brow", (0, .52, 1.015), (.98, .78, .13), m["edge"], .04)
    kit.cube("Cab roof equipment plate", (0, .48, 1.092), (.62, .48, .035), m["dark"], .012)
    kit.cube("Front recovery bumper", (0, .925, .34), (1.12, .15, .16), m["steel"], .035)
    for side in (-1, 1):
        kit.cube("Cab marker lamp", (side * .37, .895, .55), (.12, .045, .08), m["accent"], .014)

    # A deep rear engineering pod carries the folded lifting and digging gear.
    kit.cube("Rear construction module", (0, -.34, .78), (1.04, .88, .66), m["armor"], .085)
    kit.cube("Module front armor collar", (0, .105, .78), (1.11, .12, .50), m["steel"], .025)
    kit.cube("Module roof armor deck", (0, -.34, 1.125), (1.10, .93, .12), m["dark"], .035)
    kit.cube("Rear service recess", (0, -.792, .78), (.62, .035, .31), m["recess"], .016)

    # A broad folded box boom lies over its pod in transport position. Twin
    # load-bearing braces and hydraulic-looking cylinders show how it deploys.
    if vesper:
        boom_x = .17
        boom = kit.cube("Vesper folded recovery boom", (boom_x, -.47, 1.265),
                        (.40, .80, .20), m["steel"], .045)
        boom.rotation_euler[2] = math.radians(-8)
        kit.cube("Vesper boom salvage panel", (boom_x, -.48, 1.375),
                 (.31, .62, .035), m["edge"], .014).rotation_euler[2] = math.radians(-8)
        for side in (-1, 1):
            beam("Vesper folded boom brace",
                 (boom_x + side * .30, -.16, 1.03),
                 (boom_x + side * .22, -.51, 1.33), .10, .11, m["edge"], .018)
        # Offset reclaimed tool head and broad violet signal panel give Vesper
        # a visibly scavenged silhouette without a turret or tiny ornaments.
        kit.cube("Vesper recovery tool head", (.17, -.78, 1.22), (.50, .15, .22), m["dark"], .035)
        kit.cube("Vesper tool cutting edge", (.17, -.86, 1.20), (.42, .035, .055), m["edge"], .012)
        kit.cube("Vesper signal panel", (-.40, -.34, 1.205), (.30, .54, .055), m["accent"], .018)
        # The conversion crane is folded diagonally up the vehicle's right
        # shoulder. Its broad armor cap and open load brace break the shared
        # roofline in silhouette, while the lowered tool pod fills the other
        # side of the roof with a visibly salvaged utility block.
        beam("Vesper offset folded crane arm", (.12, -.20, 1.22), (.61, -.51, 1.65),
             .34, .20, m["steel"], .035)
        beam("Vesper crane salvage cap", (.12, -.20, 1.34), (.61, -.51, 1.77),
             .38, .045, m["edge"], .018)
        beam("Vesper crane load brace", (.50, -.22, 1.08), (.76, -.49, 1.57),
             .105, .11, m["dark"], .018)
        kit.cube("Vesper salvaged roof tool pod", (-.34, -.34, 1.36),
                 (.63, .70, .28), m["armor"], .045)
        kit.cube("Vesper roof pod impact plate", (-.34, -.34, 1.515),
                 (.69, .74, .055), m["edge"], .018)
        kit.cube("Vesper roof pod violet vent", (-.34, .026, 1.39),
                 (.40, .024, .11), m["accent"], .012)
        beam("Vesper pod salvage brace", (-.62, -.08, 1.02), (-.58, -.29, 1.50),
             .10, .11, m["steel"], .018)
    else:
        kit.cube("Aegis folded construction boom", (0, -.45, 1.265),
                 (.42, .88, .20), m["steel"], .045)
        kit.cube("Aegis boom armor cap", (0, -.46, 1.375), (.32, .66, .035), m["edge"], .014)
        for side in (-1, 1):
            beam("Aegis folded boom brace",
                 (side * .38, -.12, 1.03), (side * .25, -.51, 1.33),
                 .10, .11, m["edge"], .018)
        kit.cube("Aegis folded tool head", (0, -.78, 1.22), (.52, .14, .22), m["dark"], .035)
        kit.cube("Aegis tool cutting edge", (0, -.86, 1.20), (.44, .035, .055), m["edge"], .012)

    # Wide, stowed stabilizers, gusset braces and pads remain inside the
    # established ~2.2 by ~1.9 vehicle envelope.
    for side in (-1, 1):
        kit.cube("Outrigger root socket", (side * .50, -.34, .57), (.19, .38, .23), m["dark"], .035)
        kit.cube("Folded outrigger beam", (side * .76, -.37, .51), (.54, .18, .15), m["steel"], .035)
        kit.cube("Outrigger footplate", (side * .98, -.38, .12), (.24, .29, .12), m["dark"], .035)
        kit.cube("Outrigger ground shoe", (side * .98, -.38, .055), (.27, .31, .035), m["edge"], .012)
        beam("Outrigger load brace", (side * .50, -.33, .72), (side * .84, -.38, .30),
             .105, .105, m["edge"], .018)
        beam("Outrigger hydraulic ram", (side * .63, -.17, .65), (side * .88, -.22, .28),
             .065, .065, m["dark"], .012)

    if vesper:
        # Two short staggered utility aerials keep a split, low profile rather
        # than copying the Aegis' tall central command mast.
        kit.cube("Vesper split signal pedestal", (-.04, -.27, 1.235),
                 (.76, .34, .09), m["dark"], .025)
        for side, height, mat in ((-1, 1.57, m["edge"]), (1, 1.62, m["steel"])):
            x = side * .34
            kit.cylinder("Vesper short utility aerial", (x, -.27, height), .042,
                         .34 if side < 0 else .40, mat, 8)
            kit.cube("Vesper split signal blade", (x, -.27, height + .19),
                     (.10, .22, .10), m["accent"] if side < 0 else m["edge"], .014)
        # One asymmetrical side rack and recovered pod distinguish the
        # salvaged Vesper conversion while keeping the loaded width unchanged.
        kit.cube("Vesper side salvage rack", (-.44, -.38, .69), (.13, .72, .36), m["edge"], .025)
        kit.cube("Vesper recovered power pod", (-.42, -.38, .82), (.24, .42, .24), m["armor"], .028)
        kit.cube("Vesper pod violet seam", (-.555, -.38, .82), (.022, .30, .055), m["accent"], .008)
    else:
        # Aegis retains the tall, orderly radar mast and aligned utility dish.
        mast_x = .32
        kit.cube("Mast armored pedestal", (mast_x, -.28, 1.225), (.36, .36, .10), m["edge"], .025)
        kit.cylinder("Mast lower sleeve", (mast_x, -.28, 1.46), .075, .42, m["dark"], 10)
        kit.cylinder("Telescoping mast", (mast_x, -.28, 1.79), .038, .40, m["edge"], 8)
        kit.cylinder("Mast collar", (mast_x, -.28, 1.72), .087, .065, m["warning"], 10)
        kit.cube("Command radar panel", (mast_x, -.28, 2.035), (.43, .11, .27), m["dark"], .03)
        kit.cube("Radar face", (mast_x, -.345, 2.035), (.34, .022, .18), m["accent"], .018)
        kit.cylinder("Mast beacon", (mast_x, -.28, 2.22), .05, .075, m["accent"], 8)
        kit.cube("Aegis module access plate", (-.39, -.35, .86), (.035, .50, .28), m["edge"], .016)
        kit.cube("Aegis module status strip", (-.414, -.35, .84), (.012, .31, .035), m["accent"], .006)

    kit.consolidate_static_meshes(preserved=tuple(obj.name for obj in wheel_nodes))
    kit.export("vesper-mcv" if vesper else "mcv")


if __name__ == "__main__":
    build_mcv(vesper=False)
    build_mcv(vesper=True)
