# Noordheim art pipeline

Blender is the editable source for Northern Command's field equipment and coastal
scenery. Three.js renders the exported assets, animates legs and rotors, and handles
cameras, selection and effects. Convex remains authoritative for every unit,
structure, ore seam and order.

## Shipping the models: meshopt compression

Every GLB under `public/models` ships compressed with `EXT_meshopt_compression`
(about 4x smaller: 25 MB of models became 6.5 MB). The files are compressed
**in place**: the uncompressed exports only exist between a Blender run and the
compression step, and the Blender scripts are the source of truth. After any
export, run:

```sh
node scripts/compress-models.mjs              # every GLB that is not compressed yet
node scripts/compress-models.mjs public/models/tactical/tank.glb   # just some
```

Already-compressed files are skipped, so it is safe to re-run. Blender's glTF
importer cannot read meshopt, and several passes (menu, home, biome cards,
faction badges) import shipped models, so `pnpm art:tactical <pass>` first runs
`node scripts/compress-models.mjs --decompress` (plain glTF in place, the lossy
steps stay applied), then Blender, then compresses everything again. Run the
same pair around any other Blender script that reads `public/models`. Then bump
`MODEL_VERSION` in `components/game/world/models.ts`: `/models/*` is served with
an immutable cache header (`public/_headers`), so a changed file needs a new URL.

What the script changes, and what it deliberately leaves alone:

- Scene graph, node names and transforms, extras (Custom Properties/userData),
  materials and material names are untouched. Positions are *not* quantised
  into integers (that moves a dequantisation scale onto the node, which would
  break rigs such as `cargo_fill`, whose Y scale the renderer animates, and the
  `turret`/`barrel` pivots); they stay float32, snapped to a 1/4096 m grid so
  meshopt packs them well.
- Normals are stored as 8-bit octahedral (meshopt filter); `COLOR_0` as
  normalised 8-bit (the props already were); `COLOR_1` is kept as authored.
- Texture coordinates are dropped from files without textures: no material has
  a map, and the surface detail shader works in object space.
- Before writing, the result is parsed with three.js and compared with the
  export: same objects, types, local transforms, userData, materials, vertex
  colours, triangle counts and per-mesh bounds (within 1 mm). The export's
  structure is recorded in `tests/fixtures/model-manifest.json`, and
  `tests/model-compression.test.ts` checks the shipped files against it.

Every loader must register the decoder: in components use
`useModel(url)` / `preloadModel(url)` from `components/game/world/use-model.ts`
(or pass `withMeshopt` from `lib/gltf.ts` as `useLoader`'s third argument); in
tests and scripts use `parseGlb(bytes)` from `lib/gltf.ts`.

The material textures are WebP, derived from sources kept outside `public`:
`art/materials/northern-surfaces.png` (only its luminance is sampled, so the
shipped atlas is greyscale, 1024 px) and `art/materials/northern-sky.png`
(the reflection panorama, 1024×512). To regenerate:

```sh
magick art/materials/northern-surfaces.png -resize 1024x1024 -grayscale Rec601Luma /tmp/s.png
cwebp -q 82 -m 6 /tmp/s.png -o public/art/materials/northern-surfaces.webp
magick art/materials/northern-sky.png -resize 1024x512 /tmp/k.png
cwebp -q 85 -m 6 /tmp/k.png -o public/art/materials/northern-sky.webp
```

and bump their `?v=` in `components/game/surface-detail.ts` and
`components/game/sky-reflections.tsx`.

## Northern Command tactical equipment

### Landing-zone art pass

The Skerry coast uses eight instanced Blender assets from `art/landscape.blend`:
three spruce silhouettes, two fractured granite groups, juniper, timber fences and
field stores. Needle sprays are opaque geometry, so their silhouettes cast the
same shadows that players see. Vertex colours carry the foliage's shaded interiors,
snow, weathered bark and lichen. The complete kit is about 1.3 MB, with one material
and one mesh per asset. The renderer batches instances into 40 m cells so the
camera and shadow pass can skip distant forest.

`art/landing-equipment.blend` contains the refined HQ and Lynx. The HQ has entrance
steps, a canopy, gutters and a dispatch cabinet; the Lynx has inset doors, running
boards, mudflaps and stowed equipment. Cycles bakes contact occlusion into vertex
colours, combined with surface variation and road dust. Both models retain the
existing footprint, culture paint, triangle and download budgets.

```sh
pnpm art:tactical landscape  # Recreate landscape.blend and its eight GLBs
pnpm art:tactical landing    # Refine HQ/Lynx from tactical.blend and render portraits
pnpm art:tactical export     # Export manual edits from the art-pass .blend sources
```

The first two commands replace their named Blender sources. Make manual edits
in the `.blend` files and use the export command to preserve artist work. It keeps
vertex colours and Custom Properties and never saves over the source. Portraits
are rendered by the generation pass; the export command updates the game meshes.
Terrain height and gameplay remain
in the shared terrain module. `tactical-ground.tsx` shades heath, gravel, exposed
stone, snow and access-lane tyre ruts in world coordinates. `tactical-lighting.tsx`
keeps a 2048 px shadow map around the camera, and the existing fog composite adds
short-range contact occlusion using its depth buffer. Fog visibility rules are
unchanged. The standard home camera distance is 66 m.

`art/tactical.blend` is the editable source for nineteen original modern Nordic models:
Jæger and Rocket Jæger infantry, the Malm ore harvester, Lynx IFV, Stridsvagn tank,
Archer howitzer, Jotun heavy tank, Hugin drone, Valkyrie gunship, command station,
geothermal plant, ore refinery, Jæger hall, vehicle works, forward outpost, air base,
research station, Bofors sentry and coastal battery. Pitched metal roofs, red timber,
winter camouflage, and culture-colored identification panels connect the forces to
the northern setting. Each model uses shared neutral materials and individually
cloned `culture_trim` paint. The browser never runs Blender.

To regenerate this library, its GLBs and the rendered portraits from the authored
script (Blender 4.5 LTS at `/Applications` or `~/Applications`, or set `BLENDER_BIN`):

```sh
pnpm art:tactical
```

This replaces `art/tactical.blend`; run `pnpm art:tactical landing` afterwards to
reapply the landing-zone refinements. To export artist edits without recreating
models, use Blender's glTF 2.0 exporter with Selected Objects, Y Up, and Custom
Properties enabled. Select one parent with all descendants and export to
`public/models/tactical/<kind>.glb`. Keep the `leg_left`, `leg_right`, and
`rotor_pivot` object names when editing articulated parts; the gunship's tail rotor
spins inside a rotated `tail_rotor_mount` so the same runtime animation applies.
Structure bounds must stay inside the footprints in `lib/tactical-placement.ts`,
which `tests/tactical-assets.test.ts` enforces along with size, triangle and
portrait budgets. Portraits are rendered from these same authored models into
`public/art/tactical`.

The repaired Malm source is `art/harvester.blend`. Its hopper has separate walls
and a recessed floor; ribs stay outside the cargo space. The `cargo_fill` mesh is
non-emissive ironstone with its origin at the bin floor. The renderer scales only
its local Y height as cargo changes, hiding it when empty. Preserve that name and
origin when editing. `pnpm art:tactical harvester` regenerates just the Malm and
its portrait; `pnpm art:tactical export` exports manual source edits. The main
equipment generator also includes the hopper repair.

## Faction signature equipment

`art/factions.blend` holds twelve original models: each faction's own structure and
the two troops it trains there. Fjordborn: Strandhogg raiding camp, a tarred timber
lodge with a ridge tent, fire pit, ski rack and snowmobile lean-to, Fjord raider (white
anorak, skis on the pack, SMG and satchel charge), Varg snowmobile with a driver and a
standing gunner on a pintle machine gun. Ironclad: Bergverk bunker armory
with a forge stack and blast door, sapper in a blast helmet with breaching charges,
Mjølnir tracked siege mortar. Hearthkin: Lade storehouse on staddle stones with a
turf roof and hoist, hearth militia with a hunting rifle, Bulwark plough tank with a
hazard-striped dozer blade. Ashwalkers: Varde watchtower on a stone cairn with a
beacon brazier, Ember marksman in a ghillie cloak, Fenrir open scout car with a
sensor mast and flare launcher.

Infantry reuse the `leg_left` and `leg_right` pivots, so the existing runtime
animation applies unchanged. Every model carries `culture_trim` paint. Structure
bounds fit the footprints in `lib/tactical-placement.ts`, with the camp's yard
facing its production exit. There is no naval equipment: every faction fights on
the ground until water warfare exists.

```sh
uv run --python 3.11 --with mcp python scripts/blender-mcp.py factions  # Through Blender MCP
pnpm art:tactical factions                                             # Headless Blender
pnpm art:tactical export                                               # Export manual edits
```

The generator runs inside Blender MCP safe mode, so it avoids lambdas, `global`
statements and any module beyond bpy, mathutils and math. Regeneration replaces
`art/factions.blend`, the twelve GLBs and their portraits.

## Culture colors

`art/cultures.json` defines the four cultures' paint palettes. The `culture_trim`
material on every tactical model is cloned per instance and tinted with the
commander's primary color, so one task force cannot recolor another's equipment.

## Living coast

`art/environment.blend` contains original coastal gulls with articulated wings,
maintenance workers in orange winter clothing with moving arms and legs, and
weathered granite, lichen, sedge and heather. The three exported GLBs total about
175 KB and use 4,274 triangles before instancing. They are decorative and cannot
be selected or commanded.

```sh
pnpm art:tactical environment
```

This replaces `art/environment.blend`. To preserve manual Blender edits, export
one root and its descendants with Selected Objects, Y Up and Custom Properties
instead. Keep `wing_left`, `wing_right`, `leg_left`, `leg_right`, `arm_left` and
`arm_right` names for the animation pivots.

`components/game/tactical-environment.tsx` animates these assets, fabric pennants,
water, spruce crowns and light snow. One shared animation clock respects the
system's reduced-motion preference. Terrain dressing uses instanced meshes and
clears building footprints, ore seams and travel lanes. Crews remain around
command stations and on factory aprons; steam follows completed facilities from
the visible battle state. Ambient asset loading has its own boundary so a failed
decorative asset cannot prevent troops or placement controls from loading.

## Boundaries

Ore outcrops come from `art/ore.blend`: three low, fractured ironstone models
with warm oxidised mineral seams, exported to `public/models/ore` (about 123 KB
total). `pnpm art:tactical ore` regenerates them; `pnpm art:tactical export`
exports manual edits without replacing the Blender source. The runtime lays
them over irregular, feathered soil beds and removes outcrops as reserves fall.
Depleted seams retain the disturbed ground and exhausted label. There is no
permanent circular outline or emissive crystal material.

Equipment, spruce, granite, ore outcrops, field stores and coastal life come from Blender.
Terrain surfaces, sedge, ore soil beds, rivers, the tarn, cliffs, bridges,
selection rings, tracers, rally markers and construction scaffolds remain
procedural Three.js systems in `components/game/tactical-scene.tsx` and
`components/game/terrain.ts`. The landscape itself (water, fords, marsh, cliffs
and heights) is defined in `lib/tactical-terrain.ts` and shared with the server. Game state
never depends on an art download succeeding; while a model loads or if it fails, a
notice appears and the simulation continues on the server.

All artwork is original Noordheim source. The procedural scripts and exported files
are included in the repository; there are no external asset subscriptions or runtime
asset-service dependencies. Commander voice lines and the soundtrack are documented
in `art/audio/README.md`.

## Blender MCP and the second art pass

Blender MCP is configured in Codex as `blender`, using `uvx --python 3.11
blender-mcp`. The local Blender 4.5 add-on listens on localhost:9876; safe mode
is enabled and telemetry is disabled. Reopen the MCP connection from Blender's
sidebar when starting a new Blender session. Codex may need a new session to
load a newly added native MCP server; the repository bridge works immediately:

```sh
uv run --python 3.11 --with mcp python scripts/blender-mcp.py status
uv run --python 3.11 --with mcp python scripts/blender-mcp.py concept
uv run --python 3.11 --with mcp python scripts/blender-mcp.py landscape
uv run --python 3.11 --with mcp python scripts/blender-mcp.py architecture
```

The generation commands replace the current Blender scene's objects. Use the
Noordheim art scene. They regenerate only their respective asset families.
`pnpm art:tactical architecture` is the equivalent offline Blender build.
`pnpm art:tactical export` includes `architecture.blend` for exporting manual edits.
The architecture source contains complete buildings and emits their UI portraits.
Concept images, prompts, the visual comparison notes and measurement procedure
are in `art/concepts/`. Inspect the actual renderer at `/?artReview=1` in development.
The integration source is [MCP for Blender](https://github.com/ahujasid/blender-mcp).

## Home screen and HUD

`pnpm art:tactical menu` (or `uv run --python 3.11 --with mcp python
scripts/blender-mcp.py menu`) assembles the home-screen diorama from the game
kit. `art/menu-diorama.blend` contains its scene and both packed UI references.
It exports `public/models/menu/command-post.glb` and a transparent Blender
poster at `public/art/interface/command-post.png`. The poster remains visible
while the live model loads or if WebGL is unavailable.

The home and operation menu render the diorama on demand, without a continuous
animation loop. Drag or use the two camera buttons to orbit. The battlefield
HUD keeps the actual world canvas full size and uses compact floating panels.
`components/game/northern-interface.css` applies the shared palette; original
interaction rules remain in the command components.

`pnpm art:tactical home` renders the entrance's own graphics from the kit:
`art/home-vista.blend` is a coastal vista (sculpted heath, fjord, spruce slopes,
the ridge, coastal mist and the field base in its yard) rendered to
`public/art/interface/home-vista.jpg`, which sits behind the whole entrance.
`art/blender/render_faction_badges.py` renders one badge per faction from its
two signature troops in its own paint on a granite plinth,
`public/art/interface/faction-<key>.png`, used by the faction picker (the
earlier structure badges were retired on 2026-09-15 so the picker shows
people, not buildings). `pnpm art:tactical expansion` authors the six shared
expansion structures (pillbox, aid station, flak tower, radar mast, thermal
power station, field workshop) into `art/expansion.blend` with their GLBs and
portraits. The entrance keeps its text to the title, the
subtitle and the live sector status; everything else is rendered art.

The built-in imagegen concepts are `art/concepts/noordheim-home.png` and
`art/concepts/noordheim-hud.png`. Exact prompts: `art/concepts/interface-prompts.json`.
Development previews: `/?uiReview=hud` and `/?uiReview=lobby`. These reuse the
production components with deterministic data and explicitly reject mutation
actions. They never create or change a live operation and are not exposed by
the production page.

## Playable biome art

Frostgate, Amberfen and Cinderreach are available on the homepage and in solo/co-op
map selection. [The level art guide](concepts/levels.md) documents the image masters,
optimized homepage artwork, exact imagegen prompts, eleven Blender landscape assets
and shared terrain integration. `pnpm art:tactical biomes` regenerates
`art/biomes.blend` and its GLBs; `pnpm art:tactical export` exports manual edits.

`pnpm art:tactical biome-cards` renders the three new homepage views from the
actual shared terrain and game assets, then encodes PNG masters and WebP cards.
