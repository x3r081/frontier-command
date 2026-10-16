# Vesper Striker Tank

This authored variant gives the shared Striker a distinct Vesper profile: dark basalt track armor with segmented outer guards and visible wheels, an offset salvage turret shield, warm oxide plates, and violet range optics. The original `striker-tank.glb` is unchanged.

## Files

- Model: `public/assets/models/vesper-striker-tank.glb`
- Portrait: `public/assets/portraits/lightTank-vesper.png`
- Generator: `scripts/refine_vesper_striker.py`
- Portrait lookup and front camera: `scripts/render_asset_portraits.py`, ID `lightTank-vesper`

## Animation contract and metrics

The GLB retains `Rotating turret assembly` with the original pivot: Blender `(0, 0.035, 0.60)`, exported Three.js `(0, 0.60, -0.035)`. The muzzle bore face remains at Blender `(0, 0.789, 0.655)`, matching the renderer's fixed turret-local muzzle socket `(0, 0.055, -0.754)`. This keeps existing turret aim and recoil placement aligned.

Direct GLB inspection reports 3,136 triangles, 12 mesh/material primitives, and six used materials. Three.js bounds are `[-0.518, 0.020, -0.793]` to `[0.518, 0.958, 0.460]`, close to the existing Striker envelope. The GLB is about 170 KiB. The portrait is 384 × 384 transparent RGBA, about 116 KiB, and was inspected after rendering.

## Reproduction

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/refine_vesper_striker.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_asset_portraits.py -- lightTank-vesper
```
