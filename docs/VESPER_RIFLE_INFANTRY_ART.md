# Vesper Rifle Infantry

The Vesper Rifle infantry variant uses dark oxide armor, salvaged ivory helmet
and radio protection, violet optics, and a narrow slung field strap with a
repair cassette. Its standard shouldered rifle keeps the existing hand
contacts and `FC_Weapon` aim/recoil bone. The exported GLB retains the complete
14-bone shared infantry rig.

Rebuild the GLB and transparent portrait from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_vesper_rifle_infantry.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- -- rifle-vesper
```

The generator uses only local Blender and the existing authored infantry
geometry helpers. The GLB contains 2,032 triangles, 8 mesh/material
primitives, and 8 used materials. Outputs:

- `public/assets/models/vesper-rifle-infantry.glb`
- `public/assets/portraits/rifle-vesper.png`
