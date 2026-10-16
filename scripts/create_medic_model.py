"""Create the low-poly Aegis Field Medic and its front-facing portrait.

Run from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_medic_model.py
"""

import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import create_3d_assets as kit  # noqa: E402
import render_asset_portraits as portraits  # noqa: E402


def origin_at(obj, point):
    bpy.context.scene.cursor.location = point
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR", center="MEDIAN")


def build_model():
    kit.LOW_POLY_BEVEL = True
    kit.clean()
    m = kit.palette()
    m["armor"] = kit.material("Medic pale teal field armor", (.66, .78, .74), .29, .52)
    m["edge"] = kit.material("Medic ivory ceramic", (.91, .94, .84), .25, .46)
    m["steel"] = kit.material("Medic blue gray equipment", (.22, .38, .42), .52, .45)
    m["dark"] = kit.material("Medic dark harness", (.055, .105, .12), .28, .67)
    m["medical"] = kit.material("Medical lime signal", (.55, .94, .36), .12, .30,
                                 (.20, .68, .08), 1.2)

    # Boots, divided greaves, and a compact torso follow the rifle squad's
    # silhouette and scale without a weapon or heavy shoulder launcher. Each
    # leg's four armor pieces will travel as one hip-pivoted node.
    leg_groups = []
    for x, side in ((-.065, "L"), (.065, "R")):
        members = [
            kit.cube("Armored boot " + side, (x, .025, .052), (.092, .17, .10), m["rubber"], .022),
            kit.cube("Thigh armor " + side, (x, -.005, .27), (.092, .12, .15), m["armor"], .022),
            kit.cube("Knee armor " + side, (x, .055, .205), (.10, .045, .075), m["edge"], .014),
            kit.cube("Lower leg greave " + side, (x, -.005, .145), (.085, .12, .105), m["steel"], .018),
        ]
        # The authored hip is at each leg centerline, z=.34; scale this pivot
        # with the rest of the infantry after construction below.
        leg_groups.append(("Medic leg " + side, members,
                           (x * 1.25, 0, .34 * 1.25)))
    kit.cube("Armored torso", (0, 0, .355), (.24, .205, .27), m["armor"], .045)
    kit.cube("Medic chest vest", (0, .112, .37), (.235, .055, .22), m["edge"], .025)
    kit.cube("Torso shadow panel", (0, .144, .36), (.16, .018, .12), m["steel"], .012)
    # Broad two-piece medical cross reads on the chest at battlefield scale.
    kit.cube("Medical chest cross vertical", (0, .158, .385), (.044, .012, .112), m["medical"], .006)
    kit.cube("Medical chest cross horizontal", (0, .158, .385), (.112, .012, .044), m["medical"], .006)
    kit.cube("Aegis shoulder tab", (-.15, .035, .43), (.07, .10, .045), m["accent"], .012)

    # Helmet has a recognizable broad brim, pale crown, visor, and lime
    # medical stripe. Keep it close to the rifle model's head size.
    kit.cylinder("Field helmet", (0, -.005, .555), .119, .145, m["steel"], 10)
    kit.cylinder("Helmet pale crown", (0, -.005, .61), .113, .075, m["edge"], 10)
    kit.cube("Medic visor", (0, .094, .555), (.16, .035, .055), m["glass"], .014)
    kit.cube("Helmet medical stripe", (0, .015, .651), (.04, .07, .012), m["medical"], .004)
    kit.cube("Helmet crest cross stem", (0, -.055, .652), (.025, .035, .012), m["medical"], .004)
    kit.cube("Helmet crest cross bar", (0, -.055, .652), (.055, .018, .012), m["medical"], .004)

    # The deep soft-sided trauma pack and two pale canisters establish the
    # support role from the back and the oblique tactical portrait.
    kit.cube("Medic backpack frame", (0, -.145, .375), (.26, .13, .30), m["dark"], .028)
    kit.cube("Medic trauma pack", (0, -.205, .405), (.31, .16, .29), m["armor"], .035)
    kit.cube("Backpack medical panel", (0, -.291, .41), (.20, .018, .19), m["edge"], .014)
    kit.cube("Backpack cross stem", (0, -.303, .41), (.038, .012, .12), m["medical"], .006)
    kit.cube("Backpack cross bar", (0, -.303, .41), (.12, .012, .038), m["medical"], .006)
    for x in (-.20, .20):
        kit.cylinder("Trauma canister", (x, -.18, .405), .046, .19, m["edge"], 8)
        kit.cube("Canister signal band", (x, -.132, .405), (.042, .012, .07), m["medical"], .008)

    # Upper arms and forearms retain the exact names the existing renderer
    # animates. Their pivots are at the shoulder and elbow respectively.
    arm_upper = []
    forearm_groups = []
    for x, side in ((-.15, "L"), (.15, "R")):
        kit.cube("Shoulder pauldron " + side, (x, .005, .45), (.14, .15, .12), m["steel"], .028)
        upper = kit.cube("Arm." + side + " upper", (x, .04, .405), (.105, .13, .15), m["armor"], .022)
        origin_at(upper, (x, .01, .47))
        arm_upper.append(upper.name)

        elbow = (x, .105, .375)
        forearm = kit.cube("Arm." + side + " forearm", (x, .18, .365),
                           (.095, .15, .10), m["edge"], .02)
        origin_at(forearm, elbow)
        members = [forearm]
        if side == "R":
            # A broad scanner head and grip read as a medical instrument,
            # with its active face forward and no barrel-like profile.
            members.append(kit.cube("Medic scanner grip", (.15, .245, .36),
                                    (.07, .09, .16), m["dark"], .014))
            members.append(kit.cube("Medic field scanner", (.15, .285, .45),
                                    (.19, .09, .16), m["steel"], .026))
            members.append(kit.cube("Scanner glass display", (.15, .333, .45),
                                    (.135, .012, .10), m["glass"], .012))
            members.append(kit.cube("Scanner medical indicator", (.15, .342, .45),
                                    (.075, .008, .026), m["medical"], .004))
            members.append(kit.cube("Scanner side grip", (.25, .27, .43),
                                    (.035, .07, .09), m["edge"], .01))
        else:
            members.append(kit.cube("Medic left glove", (x, .265, .34),
                                    (.10, .08, .075), m["dark"], .015))
            # The free hand supports a small sterile field case, kept broad
            # enough to read as equipment without resembling a second weapon.
            members.append(kit.cube("Field dressing case", (-.12, .245, .34),
                                    (.16, .12, .11), m["edge"], .022))
            members.append(kit.cube("Field case medical mark", (-.12, .31, .34),
                                    (.075, .012, .05), m["medical"], .008))
        forearm_groups.append(("Arm." + side + " forearm", members,
                               (elbow[0] * 1.25, elbow[1] * 1.25, elbow[2] * 1.25)))

    # Preserve the same larger-in-battlefield readability pass used by the
    # authored infantry models; origins and pivots scale together.
    kit.scale_infantry_for_game_readability(1.25)
    preserved = (*arm_upper, "Arm.L forearm", "Arm.R forearm", "Medic leg L", "Medic leg R")
    kit.consolidate_static_meshes(preserved=preserved,
                                  join_groups=tuple((*forearm_groups, *leg_groups)))
    kit.export("medic")


def render_portrait():
    # Use the existing portrait renderer's light rig and transparent output,
    # while asking for its known +Y-facing infantry camera.
    kit.clean()
    bpy.ops.import_scene.gltf(filepath=str(ROOT / "public" / "assets" / "models" / "medic.glb"))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render]
    portraits.setup_render(meshes, "aegis", "rifle")
    destination = Path(portraits.OUTPUT) / "medic.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    portraits.strip_png_source_metadata(str(destination))
    print("RENDERED medic", destination.stat().st_size, "bytes")


if __name__ == "__main__":
    build_model()
    render_portrait()
