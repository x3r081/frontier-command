# Vesper Pathfinder infantry

The Pathfinder is Vesper's light recon infantry: a fieldcloth silhouette with
a dark wrapped hood and face guard, narrow salvaged ivory plates, a compact
violet survey optic, and a small sensor cassette with a slim antenna. Its
oxide-red marks stay limited to small service details. The shouldered carbine
uses the rifle hand contacts and keeps a short, narrow profile.

## Asset details

- Model: `public/assets/models/vesper-scout.glb`
- Portrait: `public/assets/portraits/scout-vesper.png` (384 × 384 RGBA, transparent)
- Blender mesh bounds: approximately 0.474 × 0.886 × 0.712 units (X × Y × Z)
- Skinned mesh: 2,893 vertices and 2,052 triangles
- Used materials: 8
- Rig: shared 14-bone infantry rig with the `FC_*` hooks, including `FC_Weapon`
- Build script: `scripts/create_vesper_pathfinder.py`

The mesh is consolidated into one skinned object with material sections. The
portrait was rendered from the exported GLB and passed through the existing
PNG metadata stripper.
