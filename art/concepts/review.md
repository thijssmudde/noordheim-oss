# Noordheim art direction, 7 September 2026

## Targets and implementation

The built-in Codex imagegen tool generated `noordheim-atmosphere.png` and
`noordheim-gameplay.png`; the full prompts are in `prompts.md`. The second image
is the practical style target: sculpted spruce, substantial red timber buildings,
broad granite faces, ivory snow, muted heath and clearly readable equipment.
The first is an atmosphere reference, with more detail than the runtime target.

The references and concept are packed into `art/art-direction.blend`. The
concept is the scene custom property `NOORDHEIM_CONCEPT`. Blender MCP authored
and exported the new landscape and architecture meshes; GLBs and matching
building portraits are in `public/models` and `public/art/tactical`.

The visual iterations replaced thin needle sprays with solid scalloped boughs,
reduced tree scale variation, simplified snow shapes, tightened their edges,
reduced snow coverage, and replaced speckled granite with broad fractured faces.
The workshop, barracks and refinery now have complete façades and distinct
silhouettes. The starting camera is a three-quarter view, with full yaw and
bounded tilt. The concepts remain a direction reference, not a claim of a
pixel-identical recreation: the playable map has wider clearings and smaller
buildings so movement, construction and combat remain legible.

## Repeatable review

Run `pnpm dev`, then open `/?artReview=1` on the printed local port. This
development-only fixture uses the real battlefield renderer with a deterministic
seed, five allied buildings, 39 allied units and the generated hostile sector.
It never reads or writes an operation. It is excluded from the production page.

- Ctrl-, Command-, or Alt-left-drag rotates and tilts; Shift-middle-drag also works.
- `[` / `]` rotate, `\` resets north without changing the ground focus.
- Wheel zooms towards the pointer. Middle/right drag pans.
- WASD, arrows and edge scrolling remain relative to the current screen heading.
- Two-finger pinch zooms; twisting rotates.
- Base and Crossing buttons provide repeatable focus locations.
- The measurement overlay reports 120-frame windows, including the shadow pass.

## Performance observations

At 1280 × 720 CSS pixels, DPR 1.6, the original north-facing review scene
measured 85.74 fps / 13.6 ms p95, 1,094 draws and 1,954,669 triangles.
After the first tree and ground pass, the same view measured 120 fps / 9.3 ms
p95, 1,090 draws and 1,006,851 triangles. These are local observations, not a
cross-device guarantee. The embedded browser also produced a 30 fps cadence
while other desktop apps were in use, so background samples are not useful for
certifying the 60 fps target.

Further changes combine compatible rigid equipment surfaces once per shared
asset, preserving materials, local animation pivots and cargo. Asset tests cap
spruce at 1,000 triangles and check the new buildings use two meshes. Camera
tests cover quarter turns, screen-relative movement, pitch bounds and crossing
the north seam. Model batching tests preserve bounds, paint and animated parts.

After the architecture and rigid-surface batching pass, the three-quarter base
view measured **120 fps / 8.7 ms p95**, **757 draws**, **1,036,937 triangles**,
at the same 1280 × 720 / DPR 1.6. This includes 39 allied units, five allied
buildings, generated enemy entities, vegetation, shadows, contact AO and fog.
The fixture's Full visibility switch is available for terrain inspection; the
base measurements above use normal fog of war.

The completed bridge pass replaces the four procedural slabs with instanced
Blender steel trusses and stone footings. With patrols running, the base view
measured **120.01 fps / 9.9 ms p95**, **686 draws** and **1,014,893 triangles**.
The Patrol control animates the formation in the clearing from 250 ms state
snapshots; it does not run the backend combat simulation.

With the final assets and ground material, the widest zoom (distance 190),
Full visibility enabled, and the river and forest in view measured **95.86 fps /
11.4 ms p95**, **1,580 draws** and **2,331,815 triangles** at the same resolution.
This checks a substantially larger visible area than the base view. The local
renderer measurements exceed the 60 fps target; full live combat and other
devices still require their own measurements.

## Home screen and HUD pass

Generated two interface references with built-in imagegen. The implemented
interface adopts dark pine panels, ivory text, restrained brass accents and
Blender portraits. A new orbitable command-post diorama appears on enrolment
and operation setup. The home camera renders on demand; its static fallback
is an actual Blender render. The references guide palette and layout; their
more detailed architecture is not presented as shipped geometry.

The HUD keeps the full-size 3D canvas behind floating resource, production,
objective, selection and command panels. Removed the decorative rivets, radar
sweep and scanlines. Production labels wrap, selection controls remain visible
on phones, and all tabs, research, camera controls and operation modes retain
their existing behavior.

Local HUD fixture: **120 fps / 9.3 ms p95**, **423 draws** and **818,829 triangles**
at **1280 × 720 / DPR 1.6**, with selected units and infantry production open.
This is a local renderer measurement, not a live combat or cross-device guarantee.
Reviewed desktop and 390 × 844 layouts, including enrolment, faction selection,
operation mode selection, the production drawer and the technology dialog.

## Memory follow-up · 7 September 2026

The battlefield previously combined a 4× multisampled HDR/depth render target
with an antialiased default framebuffer. Drawing-buffer size was limited only
by DPR, so framebuffer allocations grew with the entire Retina/4K viewport.
The final fullscreen fog triangle now uses a default framebuffer without MSAA,
depth or stencil; the scene retains its HDR colour and 4× MSAA. A 2.4-million
pixel budget applies to the drawing buffer, including DPR below 1 on large
screens. HTML HUD text remains at native resolution. This intentionally trades
native 4K scene resolution for bounded memory and frame time.

The orbitable home scene has a separate 900,000-pixel budget. The decorative
operation-menu diorama uses its existing Blender-rendered poster and allocates
no WebGL canvas. Model batching now preserves indexed vertices instead of
expanding them into triangles, with unchanged triangle counts, bounds, paint
and animation pivots. Removed eager preloads for absent equipment and made
placement previews reuse the same versioned model URL as deployed buildings.

Same local HUD fixture and camera, Chromium in-app browser, development build:

| Measurement                                            | Before                  | After                          |
| ------------------------------------------------------ | ----------------------- | ------------------------------ |
| 2560 × 1440 CSS viewport, device DPR 1: drawing buffer | 2560 × 1440             | 2065 × 1161                    |
| Steady rendering at that viewport                      | 91.25 fps / 13.1 ms p95 | 119.01 fps / 9.0 ms p95        |
| Unique scene mesh attribute/index buffers              | 10.88 MiB               | 7.66 MiB                       |
| Home scene mesh buffers                                | 3.82 MiB                | 2.50 MiB                       |
| Default framebuffer antialiasing                       | enabled                 | disabled (scene MSAA retained) |
| Decorative lobby canvases                              | 1                       | 0                              |

At 3840 × 2160 CSS pixels the optimized drawing buffer remained 2065 × 1161,
measuring 119.02 fps / 8.5 ms p95. Three successive lobby/battle round trips
returned to 104 GPU geometries, 6 textures and 19 shader programs each time;
the lobby had zero canvases. The original 1280 × 720 at DPR 1.6 remains within
the budget. Inspected the home rotation and the battlefield after 4K resizing.

The DOM-only development monitor exposes geometry buffers, renderer resource
counts, dimensions and browser-reported heap on `canvas[data-memory-stats]`.
Geometry bytes exclude render targets, textures, browser overhead and loader
caches. Heap readings fluctuated with garbage collection (411, 373, 407 MiB
across the three round trips), and cannot establish the whole application's
memory footprint. The reported 1.4 GB process usage has **not** been reproduced
or verified as a new total. These measurements show specific allocation
reductions, not a claim that total memory is 7.66 MiB or that every device runs
at these frame rates. The full 220-test suite, typecheck, lint and production
build passed.

## Seeded geography · 7 September 2026

New version-6 operations generate the terrain itself: river course and width,
bridge sites, tributary crossings, lake dimensions, plateau boundaries/height,
marshes, relief and the coastal bay. The first commander rotates among the four
primary safe landing pads. This remains a Skerry coast with northern high ground,
not a generator for arbitrary biomes or entirely different map topologies.
Versions 1–5 retain the original geography. Rendering, minimap painting,
construction, A*, formations, movement interpolation and harvester work positions
consume the same per-operation terrain functions. The map cache holds at most
eight small arithmetic descriptions; generation's reachability graphs are temporary.

Verified two visibly different maps, seeds 947 and 948, in the 3D review.
At maximum zoom and full visibility, seed 948 measured 119.98 fps / 9.1 ms p95,
1,542 draws and 2,184,539 triangles at 1280 × 720, DPR 1.6. These are local
renderer measurements, not a guarantee for live combat on every device.
The review URL accepts `?artReview=1&seed=947` and offers a Next map link.

224 tests pass, including 160 generated layouts across all four difficulties,
40 seeds with traversable bridge approaches and dry landing pads, seed stability,
concurrent-map isolation/cache eviction, variable unique landing assignments,
and legacy terrain compatibility. Typecheck, lint and production build pass.
The development Convex backend was synchronized; production was not deployed.
