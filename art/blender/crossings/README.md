# Noordheim crossing kit

Four independently authored northern RTS crossings. All GLBs are origin-centered with glTF Y up, bounds X ±5.25 and Z ±8. Their deck surface is Y 0.60, nominal traversable X ±4.9. Scale X by target width/10.5 and Z by target length/16; preserve Y. Thin grain/tread/gravel faces extend less than 0.01 above the deck. Use the parent game's explicit crossing collision plane rather than detailed mesh collision.

- `bridge_suspension.glb`: weathered steel portal towers, sagging main cables, fine vertical hangers, timber planks, lower guard wires, bolted connection plates.
- `bridge_timber.glb`: rounded log stringers, stone footing trestles, diagonally braced bays, worn plank deck and round timber handrails.
- `bridge_pontoon.glb`: eight steel/olive deck modules, chamfered rusty orange floats, tread strips, bollards, drooping mooring ropes and rope coils.
- `bridge_causeway.glb`: three genuinely open transverse culverts, separate arch voussoirs, shaped spandrels, basalt masonry and capped stone parapets, fine embedded gravel accents.

Each uses one mesh, one primitive, one material, COLOR_0 vertex colors, normals and UV0. No textures or external assets. Material is neutral rough vertex paint. UV0 uses bridge-wide planar mapping, so the parent may replace the material. No runtime animation or lights in GLBs.

`create_crossings.py` regenerates GLBs, the editable `noordheim_crossings.blend`, individual studio PNGs and `manifest.json` using Blender. The four source meshes are all present at origin; only the suspension model is visible initially. Unhide a named mesh to edit it. Camera and lighting are studio-only.

`inspect_exports.py` requires Python and Pillow; it validates GLB single-batch caps and actual packed accessor bounds, writes `glb_checks.json`, and rebuilds `contact_sheet.png`.

Visual self-inspection: all four structures have distinct silhouettes and readable construction. Suspension towers/hangers, timber braces, pontoon floats/ropes, and three culvert apertures are visible. Corrected coplanar pontoon decking and checked the final contact sheet; no black overlap or clipping remains. Stone/wood palettes use shared-channel tint variation to avoid colored checkerboard artifacts. Parent integration must be checked in the live map because terrain/water can hide below-deck features.
