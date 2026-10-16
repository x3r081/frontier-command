# Vesper Siege Crawler

The Vesper artillery chassis has a distinct reclaimed silhouette: a broad basalt hull, exposed six-wheel track trains, warm salvage plates, asymmetrical gunshield, rear cooling bank, violet optics, and an extended long-range barrel with a dark thermal jacket. It shares no external textures or downloaded geometry. The original faction-neutral `siege-crawler.glb` was left unchanged.

## Files

- Model: `public/assets/models/vesper-siege-crawler.glb`
- Tactical portrait: `public/assets/portraits/artillery-vesper.png`
- Generator: `scripts/create_3d_assets.py`, function `vesper_siege_crawler()` and selected generator entry `vesper-siege-crawler`
- Portrait lookup/camera: `scripts/render_asset_portraits.py`, ID `artillery-vesper`

## Animation and export

The cannon and recoil rods remain under the exact `Artillery cannon assembly` node. Its Blender-space pivot stays `(0, 0.48, 1.08)`, matching the renderer's current recoil setup. The exposed tube is 0.40 Blender units longer than the initial Vesper version; the mantlet and pivot are unchanged. The cooling jacket uses the existing moving assembly's dark material.

Direct GLB inspection reports 3,748 triangles, 10 mesh nodes/material primitives, and six used materials. Bounds in Three.js coordinates are `[-1.058, 0.040, -2.115]` to `[1.086, 1.558, 0.935]`; the total forward length is 3.05 units, about 15% beyond the initial Vesper version. The transparent portrait is 384 × 384 RGBA and about 90 KiB. Both outputs were inspected after regeneration.

## Reproduction

From the repository root, run only the selected new model generator and matching portrait:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/create_3d_assets.py -- vesper-siege-crawler
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- artillery-vesper
```

The renderer attaches the Vesper muzzle socket at pivot-local `(0, 0.09, -1.635)`, producing the authored barrel-face position `(0, 1.17, -2.115)` before recoil. Aegis and procedural artillery keep their prior muzzle coordinates. The actual-GLB rendering test verifies this alignment and the moving cannon after static compaction.
