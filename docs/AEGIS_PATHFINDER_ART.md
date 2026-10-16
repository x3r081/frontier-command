# Aegis Pathfinder

The Pathfinder is Aegis' light survey infantry: a fitted blue-gray field suit,
narrow ivory ceramic plates, and compact cyan instruments make it read as a
mobile specialist beside the broader Rifle Squad. Its helmet uses paired
survey optics and a short aerial. A close fitting field pack and shouldered
carbine complete the silhouette without adding broad shoulder armor.

The model is authored as one consolidated skinned mesh on the shared 14-bone
infantry rig. The carbine pieces use `rifle` in their object names so the shared
rig helper assigns them to `FC_Weapon`; the helper's standard rifle hand and
weapon contacts are retained. The exported skinned character measures about
0.46 × 0.89 × 0.79 Blender units (X, Y, Z), with 1,924 triangles and seven used
materials. The GLB preserves the shared `FC_Root`, `FC_Pelvis`, and
`FC_Weapon` joints along with the rest of the infantry bone set.

Files:

- `scripts/create_aegis_pathfinder.py` builds and exports the GLB.
- `public/assets/models/scout.glb` is the Pathfinder game model.
- `public/assets/portraits/scout.png` is a 384 × 384 transparent tactical portrait,
  rendered with the shared portrait lighting and front-facing infantry framing.
