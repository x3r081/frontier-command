"""Generate only the Vesper Striker Tank variant with local Blender.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/refine_vesper_striker.py
"""

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import create_3d_assets as kit  # noqa: E402


def build():
    previous_bevel = kit.LOW_POLY_BEVEL
    kit.LOW_POLY_BEVEL = True
    kit.clean()
    m = kit.vesper_palette()
    m["armor"] = kit.material("Vesper Striker reclaimed basalt", (.22,.18,.27), .48,.54)
    m["edge"] = kit.material("Vesper Striker warm oxide alloy", (.68,.45,.37), .60,.39)
    m["steel"] = kit.material("Vesper Striker violet gunmetal", (.31,.23,.42), .58,.44)
    m["dark"] = kit.material("Vesper Striker carbon frame", (.035,.028,.052), .42,.68)
    m["accent"] = kit.material("Vesper Striker ion optic", (.58,.22,.95), .24,.22,(.38,.08,.72),1.7)
    m["glass"] = kit.material("Vesper Striker sensor glass", (.30,.16,.48), .42,.19,(.18,.04,.50),1.1)

    # Compact paired track pods, three exposed wheels, and broad segmented
    # upper shields stay close to the shared Striker footprint.
    for side in (-1,1):
        x=side*.37
        kit.cube("Vesper track belt", (x,-.005,.16), (.19,.88,.28),m["dark"],.055)
        for y in (-.29,0,.29):
            kit.cylinder("Vesper road wheel", (side*.465,y,.155), .082,.045,m["steel"],10,(0,math.pi/2,0))
            kit.cylinder("Vesper hub cap", (side*.500,y,.155), .037,.022,m["edge"],8,(0,math.pi/2,0))
        for y in (-.34,-.17,0,.17,.34):
            kit.cube("Vesper tread grouser", (x,y,.292), (.205,.055,.033),m["steel"],.009)
        for y in (-.245,0,.245):
            skirt=kit.cube("Vesper segmented track armor", (side*.37,y,.355), (.15,.21,.105),m["armor"],.032)
            skirt.rotation_euler[2]=side*math.radians(2)
        kit.cube("Vesper track shield plate", (side*.505,.18,.365), (.022,.27,.075),m["edge"],.009)
        kit.cube("Vesper track violet dash", (side*.506,-.15,.365), (.024,.16,.035),m["accent"],.008)

    # Low center hull, asymmetric salvaged cheek plates, and a stepped nose.
    kit.cube("Vesper lower hull", (0,-.015,.315), (.69,.83,.25),m["dark"],.075)
    kit.cube("Vesper ceramic hull", (0,-.005,.405), (.65,.73,.22),m["armor"],.075)
    glacis=kit.cube("Vesper forward wedge glacis", (0,.285,.43), (.62,.31,.145),m["steel"],.05)
    glacis.rotation_euler[0]=math.radians(-8)
    kit.cube("Vesper nose impact strip", (0,.427,.345), (.60,.075,.075),m["edge"],.018)
    for side in (-1,1):
        x=side*.255
        plate=kit.cube("Vesper hull shoulder plate", (x,.18,.53), (.18,.38,.085),m["edge"],.025)
        plate.rotation_euler[2]=side*math.radians(5)
        kit.cube("Vesper shoulder shadow port", (side*.348,.10,.47), (.018,.16,.055),m["recess"],.006)
    kit.cube("Vesper rear engine deck", (0,-.315,.535), (.54,.29,.11),m["steel"],.03)
    kit.cube("Vesper cooling well", (0,-.325,.598), (.38,.22,.025),m["recess"],.008)
    for x in (-.13,-.065,0,.065,.13):
        kit.cube("Vesper cooling louver", (x,-.325,.617), (.028,.18,.018),m["edge"],.005)

    # Retain the exact renderer pivot, Rotating turret assembly. Its muzzle
    # face stays at Blender (0, .789, .655), matching the hardcoded runtime
    # socket (0, .055, -.754) relative to the Three.js pivot.
    turret_parts=[]
    def tcube(*args,**kwargs):
        obj=kit.cube(*args,**kwargs);turret_parts.append(obj);return obj
    def tcylinder(*args,**kwargs):
        obj=kit.cylinder(*args,**kwargs);turret_parts.append(obj);return obj
    tcylinder("Vesper turret race", (0,.035,.60), .29,.19,m["dark"],12)
    tcylinder("Vesper race alloy lip", (0,.035,.705), .255,.035,m["edge"],12)
    # Broad offset armored crown, high cheek, and a recognizable reclaimed shield.
    tcube("Vesper angular turret shell", (0,-.045,.755), (.54,.43,.235),m["armor"],.065)
    tcube("Vesper offset rear bustle", (-.07,-.245,.785), (.43,.20,.19),m["dark"],.045)
    shield=tcube("Vesper reclaimed gun shield", (-.17,.19,.765), (.40,.17,.35),m["steel"],.045)
    shield.rotation_euler[1]=math.radians(-7)
    tcube("Vesper shield salvage plate", (-.19,.282,.79), (.22,.025,.22),m["edge"],.018)
    tcube("Vesper shield ion optic", (.215,.191,.79), (.12,.025,.085),m["accent"],.012)
    tcube("Vesper turret roof armor", (.02,-.025,.89), (.43,.33,.065),m["edge"],.025)
    tcube("Vesper command sensor housing", (.18,-.10,.925), (.14,.15,.065),m["dark"],.018)
    tcube("Vesper command sensor lens", (.18,-.015,.928), (.085,.018,.035),m["accent"],.008)
    tcylinder("Vesper commander hatch", (-.18,-.13,.89), .072,.026,m["steel"],10)
    tcylinder("Vesper hatch latch", (-.18,-.13,.908), .022,.01,m["edge"],8)

    # Keep established barrel components on the turret node for batching and
    # runtime rotation/recoil; the muzzle socket does not move from its contract.
    tcube("Cannon armored mantlet", (0,.26,.655), (.27,.15,.17),m["dark"],.04)
    tcube("Vesper mantlet salvage cap", (-.12,.345,.705), (.13,.035,.085),m["edge"],.012)
    tcylinder("Main cannon barrel", (0,.42,.655), .067,.46,m["steel"],10,(math.pi/2,0,0))
    tcylinder("Barrel reinforcing sleeve", (0,.49,.655), .088,.16,m["edge"],10,(math.pi/2,0,0))
    tcylinder("Vesper barrel thermal band", (0,.57,.655), .076,.12,m["dark"],10,(math.pi/2,0,0))
    tcylinder("Muzzle brake", (0,.75,.655), .09,.07,m["dark"],10,(math.pi/2,0,0))
    tcylinder("Muzzle inner bore", (0,.789,.655), .039,.008,m["recess"],10,(math.pi/2,0,0))
    for side in (-1,1):
        x=side*.22
        tcube("Vesper cheek armor wing", (x,.10,.72), (.12,.28,.17),m["steel"],.035)
        tcube("Vesper cheek oxide edge", (x,.215,.74), (.12,.035,.12),m["edge"],.014)
        tcube("Vesper rangefinder slit", (x,.205,.82), (.075,.022,.035),m["accent"],.008)
        tcube("Cannon recoil rail", (x*.36,.44,.68), (.025,.30,.025),m["edge"],.006)
    kit.consolidate_static_meshes(
        preserved=("Rotating turret assembly",),
        join_groups=(("Rotating turret assembly",turret_parts,(0,.035,.60)),),
    )
    kit.export("vesper-striker-tank")
    kit.LOW_POLY_BEVEL=previous_bevel


if __name__ == "__main__":
    build()
