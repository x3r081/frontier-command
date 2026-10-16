# Vesper Rocket Trooper

This authored Vesper variant gives the anti-armor infantry a broad salvaged
launcher heat shield, offset reload cassette, and dark oxide armor with violet
optics. The launcher remains visually clear and keeps the shared `FC_Weapon`
bone contract for aim and recoil; the infantry arm and leg bone names match the
existing Rocket Trooper rig.

Rebuild the model and transparent portrait from the repository root with:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_vesper_rocket_trooper.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- -- rocket-vesper
```

The generator uses only the local Blender installation and the shared authored
infantry geometry helpers. The exported model has 2,248 triangles, 9 mesh
primitives, and 9 used materials. Its GLB and portrait are
`public/assets/models/vesper-rocket-infantry.glb` and
`public/assets/portraits/rocket-vesper.png`.
