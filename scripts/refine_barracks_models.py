"""Refine the authored Aegis and Vesper Barracks at tactical viewing scale.

Run from the repository root with Blender 5.x:
  Blender -b --python scripts/refine_barracks_models.py

Geometry helpers and faction palettes come from create_3d_assets.py. The two
critical animation meshes are kept as separate glTF nodes during batching.
"""

import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import create_3d_assets as kit  # noqa: E402


def aegis_barracks():
    kit.LOW_POLY_BEVEL = True
    kit.clean()
    m = kit.palette()
    m["armor"] = kit.material("Barracks Aegis layered ceramic", (.43, .55, .54), .44, .42)
    m["edge"] = kit.material("Barracks Aegis pale armor edge", (.80, .86, .78), .58, .31)
    m["dark"] = kit.material("Barracks Aegis structural graphite", (.045, .090, .105), .40, .62)
    m["steel"] = kit.material("Barracks Aegis blue steel", (.18, .29, .33), .64, .42)
    m["accent"] = kit.material("Barracks Aegis team cyan", (.035, .52, .82), .34, .25, (.01, .17, .50), 1.0)
    m["recess"] = kit.material("Barracks Aegis entry shadow", (.018, .035, .046), .26, .76)

    # Keep the exact 2.78-unit foundation and low, broad building footprint.
    kit.cube("Barracks foundation", (0, 0, .12), (2.78, 2.78, .24), m["dark"], .05)
    kit.cube("Armored lower chassis", (0, -.06, .31), (2.48, 2.20, .20), m["steel"], .045)
    kit.cube("Troop quarters", (0, -.18, .55), (2.20, 1.78, .50), m["armor"], .085)
    kit.cube("Upper armor belt", (0, -.18, .81), (2.34, 1.92, .13), m["dark"], .035)
    # Broad layered side armor and four repeated modular wall panels create a
    # readable barracks rhythm without dozens of tiny surface pieces.
    for side in (-1, 1):
        kit.cube("Side armor skirt", (side*1.105, -.18, .50), (.10, 1.58, .38), m["steel"], .025)
        for y in (-.73, -.20, .33):
            kit.cube("Modular side armor panel", (side*1.165, y, .58), (.055, .42, .39), m["armor"], .025)
        # Deep, repeated ventilation slots on both flanks.
        kit.cube("Side intake cassette", (side*1.205, -.54, .38), (.035, .40, .20), m["recess"], .012)
        for z in (.32, .37, .42, .47):
            kit.cube("Intake blade", (side*1.228, -.54, z), (.016, .32, .018), m["edge"], .004)
        for xside in (side*.78, side*1.01):
            kit.cube("Facade armored pilaster", (xside, .715, .53), (.12, .11, .51), m["edge"], .022)

    # Recessed central blast door, with a distinct upper canopy and landing.
    kit.cube("Entry recess", (0, .80, .44), (.70, .08, .56), m["recess"], .024)
    door = kit.cube("Entry blast door", (0, .858, .43), (.46, .045, .40), m["steel"], .012)
    door_parts = [door, kit.cube("Door center seam", (0, .884, .43), (.016, .012, .35), m["dark"], .003)]
    for x in (-.18, .18):
        door_parts.append(kit.cube("Door locking rail", (x, .884, .43), (.018, .014, .31), m["edge"], .003))
    kit.cube("Entry header armor", (0, .87, .74), (.91, .13, .11), m["accent"], .022)
    kit.cube("Entry canopy supports", (0, .94, .80), (.92, .35, .085), m["dark"], .023)
    kit.cube("Entry canopy fascia", (0, 1.105, .82), (1.02, .055, .09), m["edge"], .018)
    kit.cube("Entry canopy light", (0, 1.035, .858), (.66, .16, .022), m["glow"], .006)
    kit.cube("Entry landing", (0, 1.115, .22), (.88, .36, .10), m["steel"], .020)
    for y, z in ((1.30, .14), (1.43, .075)):
        kit.cube("Entry step", (0, y, z), (.72, .15, .075), m["edge"], .014)
    for x in (-.89, .89):
        kit.cube("Entry approach marker", (x, .91, .30), (.20, .08, .11), m["accent"], .016)
        kit.cube("Approach beacon", (x, 1.00, .25), (.10, .08, .06), m["warning"], .010)

    # Recessed windows read as inhabited quarters at normal zoom.
    for x in (-.72, .72):
        kit.cube("Barracks window recess", (x, .735, .57), (.33, .04, .22), m["recess"], .018)
        kit.cube("Barracks armored window", (x, .762, .57), (.23, .028, .135), m["glass"], .010)
        kit.cube("Window brow", (x, .77, .705), (.38, .09, .045), m["edge"], .010)

    # Low training/muster deck and a functional HVAC package establish the
    # production identity from the elevated RTS camera.
    kit.cube("Roof training deck", (0, -.24, .94), (1.62, 1.10, .12), m["steel"], .035)
    kit.cube("Muster deck inset", (0, -.22, 1.005), (1.32, .78, .018), m["dark"], .012)
    for x in (-.46, -.23, 0, .23, .46):
        kit.cube("Muster bay marking", (x, -.22, 1.017), (.09, .48, .012), m["accent"], .004)
    # Two compact roof HVAC units use big readable forms and visible grilles.
    for x, y in ((-.78, -.52), (.78, -.52)):
        kit.cube("Roof HVAC plinth", (x, y, .98), (.42, .58, .13), m["dark"], .025)
        kit.cube("Roof HVAC casing", (x, y, 1.10), (.34, .48, .16), m["edge"], .025)
        kit.cube("Roof HVAC intake", (x, y+.012, 1.185), (.24, .32, .014), m["recess"], .006)
        for yy in (y-.105, y-.035, y+.035, y+.105):
            kit.cube("HVAC grille slat", (x, yy, 1.196), (.25, .018, .012), m["steel"], .004)
    kit.cube("Training booth base", (0, -.91, 1.00), (.76, .42, .16), m["dark"], .025)
    kit.cube("Training booth glazing", (0, -.91, 1.12), (.62, .31, .18), m["glass"], .024)
    kit.cube("Training booth roof", (0, -.91, 1.235), (.78, .46, .075), m["edge"], .022)
    kit.cube("Barracks signal panel", (0, -.91, 1.278), (.40, .09, .018), m["accent"], .005)
    for x in (-.38, .38):
        kit.cylinder("Barracks antenna", (x, -1.02, 1.37), .020, .22, m["steel"], 8)
        kit.cylinder("Antenna beacon", (x, -1.02, 1.49), .038, .045, m["warning"], 8)

    # Batch static meshes by material while retaining semantic animation nodes.
    kit.consolidate_static_meshes(
        preserved=("Entry canopy light",),
        join_groups=(("Entry blast door", door_parts, (0, .858, .43)),),
    )
    kit.export("barracks")


def vesper_barracks():
    kit.LOW_POLY_BEVEL = True
    kit.clean()
    m = kit.vesper_palette()

    # Reclaimed bunk pods sit on the original broad 2.82-unit salvage skid.
    kit.cube("Vesper barracks skid", (0, 0, .12), (2.82, 2.82, .24), m["dark"], .035)
    kit.cube("Underframe crossmember", (0, -.08, .27), (2.42, 1.95, .12), m["steel"], .022)
    # Three big containers in an offset cluster give the building its distinct
    # pod-complex shape; chunky end caps and roof plates imply repurposed cargo.
    # Leave clear seams between containers so the silhouette reads as three
    # reclaimed modules instead of one broad roof slab.
    pods = [(-.79, -.12, .62, .56, .84), (0, -.30, .69, .64, .90), (.79, -.12, .60, .54, .82)]
    for i, (x, y, z, w, length) in enumerate(pods):
        kit.cube("Reclaimed bunk container", (x, y, z), (w, length, .58), m["armor" if i != 1 else "steel"], .035)
        kit.cube("Container armor roof", (x, y, z+.31), (w+.07, length+.04, .075), m["edge"], .018)
        # Large panel ribs and latches retain the container reading at distance.
        for dx in (-w*.38, w*.38):
            kit.cube("Container corner post", (x+dx, y, z), (.075, length+.03, .62), m["dark"], .012)
        for yy in (y-length*.24, y+length*.24):
            kit.cube("Container side rib", (x, yy, z), (w-.12, .05, .43), m["steel"], .012)
        # Preserve each named luminous vent so renderer's faction pulse stays bound.
        kit.cube("Pod violet vent", (x, y-length*.56, z+.06), (w*.56, .025, .10), m["accent"], .005)
        kit.cube("Pod service panel", (x, y-length*.57, z-.10), (w*.42, .025, .09), m["recess"], .006)

    # Salvaged trestles carry the pods above the skid. The front opening is
    # framed as a shared troop muster porch with a broad shadowed entry.
    for x in (-1.07, 1.07):
        for y in (-.68, .40):
            kit.cube("Salvaged support foot", (x, y, .34), (.22, .24, .18), m["dark"], .016)
            kit.cube("Salvaged support upright", (x*.94, y, .57), (.105, .13, .55), m["edge"], .015)
    kit.cube("Muster porch lintel", (0, .62, .90), (1.55, .16, .15), m["edge"], .022)
    kit.cube("Dugout entry shadow", (0, .82, .43), (.68, .055, .46), m["recess"], .012)
    kit.cube("Armored entry door", (0, .858, .42), (.42, .028, .34), m["dark"], .006)
    for x in (-.19, .19):
        kit.cube("Door edge signal", (x, .878, .42), (.025, .012, .29), m["accent"], .003)
    kit.cube("Salvage awning", (0, .97, .78), (1.02, .52, .09), m["dark"], .020)
    kit.cube("Awning salvage edge", (0, 1.225, .81), (1.06, .045, .09), m["warning"], .012)
    kit.cube("Awning violet strip", (0, 1.02, .832), (.66, .18, .018), m["accent"], .005)
    kit.cube("Muster landing", (0, 1.12, .22), (.92, .40, .09), m["steel"], .018)
    for y, z in ((1.30, .14), (1.36, .075)):
        kit.cube("Salvage entry step", (0, y, z), (.73, .10, .07), m["edge"], .012)

    # Two structural pipe runs visibly connect the pods to the reclaimed
    # utilities spine. Keep elbows and pipes broad enough to read at RTS zoom.
    for side in (-1, 1):
        x = side*1.04
        kit.cylinder("Utility riser", (x, -.52, .76), .055, .82, m["warning"], 8)
        kit.cylinder("Utility manifold", (x, -.05, 1.17), .055, .66, m["steel"], 8, (0, 1.5708, 0))
        for y in (-.50, -.05, .40):
            kit.cylinder("Pipe union", (x, y, 1.17), .075, .07, m["edge"], 8, (0, 1.5708, 0))
        kit.cube("Violet vent bank", (side*1.22, -.50, .83), (.04, .50, .32), m["recess"], .008)
        for z in (.70, .78, .86, .94):
            kit.cube("Venting louver", (side*1.245, -.50, z), (.018, .38, .027), m["accent"], .004)
    # Elevated violet extractor creates a strong faction read and functions as
    # shared exhaust for the pod row without excessive tiny ornament.
    kit.cube("Violet vent stack base", (0, -.92, .91), (.66, .52, .18), m["dark"], .025)
    kit.cube("Violet vent stack housing", (0, -.93, 1.10), (.46, .40, .25), m["steel"], .035)
    kit.cube("Violet vent stack grille", (0, -.71, 1.10), (.30, .025, .15), m["accent"], .006)
    for x in (-.10, 0, .10):
        kit.cube("Vent grille rib", (x, -.69, 1.10), (.018, .018, .13), m["edge"], .004)
    kit.cylinder("Vesper salvage signal mast", (-.90, -.98, 1.34), .028, .48, m["edge"], 8)
    kit.cube("Vesper signal pennant", (-.72, -.98, 1.49), (.34, .055, .16), m["accent"], .008)
    kit.cylinder("Mast beacon", (-.90, -.98, 1.60), .052, .06, m["warning"], 8)
    kit.cube("Roof signal", (.91, -.86, 1.08), (.30, .12, .04), m["accent"], .006)

    kit.consolidate_static_meshes(preserved=("Pod violet vent",))
    kit.export("vesper-barracks")


if __name__ == "__main__":
    aegis_barracks()
    vesper_barracks()
