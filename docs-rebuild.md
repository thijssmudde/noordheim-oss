# Noordheim rebuild: the living diorama

Goal: rebuild what players see and feel so the game markets itself. Every
screenshot should look like a hand-painted tabletop miniature of a Nordic Cold
War front (Red Alert 3 spirit, *Purple Cow* standard: remarkable or invisible).
The backbone stays: the Convex server-authoritative simulation at 4 ticks/s,
lobbies, identity, research and economy rules, and the Stripe sponsor flow.

## Art direction: "living diorama"

Reference: `art/concepts/noordheim-gameplay.png`, `noordheim-home.png`,
`noordheim-hud.png`, `noordheim-atmosphere.png`.

- **Tilt-shift miniature.** Depth-of-field blur on the top and bottom of the
  frame, a slightly raised saturation, crisp centre. Camera looks down ~50°.
- **Golden low sun.** Warm key light with long soft shadows, cool sky fill, rim
  light on silhouettes. Snow reads warm-white in sun, blue in shadow.
- **Heroic proportions.** Buildings are big, detailed landmarks (red timber,
  slate/zinc roofs, brick chimneys, iron trusses, flags, crates, lamps). Troops
  are chunky and slightly oversized (vehicles ~1.3x, infantry ~1.5x) so they
  read at the play zoom. Readable silhouettes beat realism.
- **Faction paint is loud.** `culture_trim` material, tinted per commander, on
  large surfaces: roofs trims, banners, vehicle side panels, infantry jackets.
- **Everything moves.** Smoke from chimneys, flags, turning radar dishes,
  crews, gulls, water sparkle, falling snow; units lean into turns, tracks roll,
  turrets track targets, barrels recoil, dust kicks up.
- **Big readable combat.** Muzzle flashes, tracers, shell arcs, explosions with
  fireball + smoke column + debris, scorch decals, burning wrecks that linger.
- Palette: red timber `#8e2f25`, slate `#3b4450`, zinc `#8d97a0`, warm snow
  `#f3efe6`, shadow snow `#b9c8dc`, spruce `#2f4a3a`, signal orange `#ff8f3a`.

## Tracks and file ownership

Agents work in the same tree at the same time. Edit only files your track
owns; if you must touch another track's file, keep the edit minimal and say so
in your report. Never revert changes you did not make. Do not commit, push or
deploy.

| Track | Owns |
| --- | --- |
| A. Maps & simulation | `lib/maps/**`, `lib/tactical-terrain.ts`, `lib/tactical-world.ts`, `lib/battlefields.ts`, `lib/biome-atmosphere.ts`, `lib/landscape-dressing.ts`, `lib/tactical-navigation.ts`, terrain/world/map sections of `lib/tactics.ts`, `convex/tacticalValues.ts`, `convex/operations.ts`, `components/game/map-select.*`, `components/game/operation-settings.tsx`, map/world/terrain tests |
| B. World renderer & look | `components/game/world/**` (new), `tactical-scene.tsx` (except the `Equipment` rig animation), `tactical-environment.tsx`, `tactical-ground.tsx`, `tactical-landscape.tsx`, `tactical-lighting.tsx`, `tactical-combat.tsx`, `tactical-ore.tsx`, `sky-reflections.tsx`, `surface-detail.ts`, `terrain.ts`, `components/dev/art-review.tsx`, `lib/combat-presentation.ts`, `public/models/landscape/**`, `public/models/props/**` |
| C. Buildings | `art/blender/diorama_buildings.py` (new) and `art/diorama-*.blend`, `public/models/tactical/<building>.glb`, `public/art/tactical/<building>.png`, `lib/tactical-placement.ts` (footprints/exits), `tests/tactical-assets.test.ts` |
| D. Troops & movement | `art/blender/diorama_troops.py` (new), `public/models/tactical/<unit>.glb`, `public/art/tactical/<unit>.png`, `lib/tactical-motion.ts`, `lib/tactical-formation.ts`, `lib/unit-rig.ts` (new), the `walk`/movement/separation parts of `lib/tactics.ts`, motion/movement tests |
| E. Sponsors, home & marketing | `components/game/join-game.tsx`, `entrance.css`, `lobby-page.tsx`, `game-over.tsx`, `sponsor-*`, `battlefield-backdrop.tsx`, `app/sponsor/**`, `convex/sponsors*.ts`, `convex/http.ts`, `lib/sponsorship.ts`, `components/game/photo-mode.tsx` (new), `docs-sponsorships.md`, sponsor tests |

## Contracts

### Maps (A → everyone)

`lib/maps/types.ts` defines `MapDesign` (authored data) and `CompiledMap` (the
query API). Five hand-built maps replace the four procedural ones, with ids:

| id | name | capacity (players / enemies) | idea |
| --- | --- | --- | --- |
| `fjordmouth` | Fjordmouth | 2 / 2 | compact starter: a river delta, three crossings, enemy across the fjord |
| `ironpass` | Iron Pass | 4 / 3 | mountain pass, railway viaduct, flanking high ground |
| `glaciercrown` | Glacier Crown | 4 / 4 | king of the hill: rich ore on a central frozen plateau ringed by ramps |
| `skerryharbour` | Skerry Harbour | 4 / 4 | harbour town, islands linked by bridges, lighthouse |
| `nordlys` | Nordlys Valley | 8 / 8 | the big one: aurora dusk, long valley, many routes |

Enemy count and lobby size are clamped to the map's capacity. `MAP_VERSION`
becomes 8; sectors with an older version end gracefully instead of loading a
missing map. `terrainFor(battle)` returns a `CompiledMap`. `generateWorld`
places each hostile army's base inside its `strongholdAt(slot)` radius, home
ore beside each landing, and the design's `ore` seams (rich seams guarded).

### Rig names (C, D → B)

GLB node names the renderer animates. Keep origins at the pivot.

- Models face +Z (the renderer sets `rotation.y = entity.angle`, and the
  simulation's angle is `atan2(dx, dz)`).
- `turret` (yaw toward target), `barrel` (recoils along its local -Z),
  `muzzle` (empty at the barrel tip; flashes spawn here)
- `leg_left`, `leg_right`, `arm_left`, `arm_right` (infantry gait)
- `wheel_*` (spin about local X), `track_left`, `track_right` (UV scroll or
  bob), `rotor_pivot`, `tail_rotor_mount`
- `cargo_fill` (harvester load, scale Y)
- buildings: `flag` (wave), `radar_dish` (spin Y), `smoke_*` (empties where
  chimney smoke is emitted), `light_*` (empties for lamp glow at dusk),
  `door` (factory door: rotate/lift while producing)
- every model: at least one mesh using material `culture_trim`

`lib/unit-rig.ts` (D) exports the per-frame rig animation the renderer calls:
`collectRig(root)` and `animateRig(rig, state)` where state carries time,
speed, turn rate, aim yaw, firing recency, cargo and construction progress.

### Sponsors (E → B)

`components/game/sponsor-billboard.ts` (E) exports
`sponsorBillboardTexture(sponsors, size)` returning a `THREE.CanvasTexture`
painted in the in-world poster style, and a `useBillboardSponsors()` hook that
returns the active sponsors (fixed main sponsor first, then paid slots). B
places billboards from `design.billboards` and applies the texture.

### Attract mode (B → E)

`components/game/world/attract-scene.tsx` (B) exports
`<AttractScene mapId />`: a full-bleed live render of a map with a scripted
skirmish and the design's `shots` camera dolly, no HUD, no Convex. E uses it
as the home-screen hero.

## Tooling

- Dev server: `http://localhost:3111` is already running from this tree (HMR).
  Do not start another vinext instance; it refuses while one runs.
- Screenshots: `node /private/tmp/claude-501/-Users-thijssmudde-projects-noordheim/a90bb0e2-5aba-4f41-bbc8-20e3610fdf77/scratchpad/shot.mjs <url> <out.png> [waitMs] [w] [h] [js]`
  (headless Chrome over CDP; prints console errors).
  Zero-side-effect routes: `/?artReview=1&map=<id>`, `/?uiReview=hud|lobby|over`.
  Do not use the real entrance flow (it creates Convex records).
- Blender 4.5: `~/Applications/Blender.app/Contents/MacOS/Blender -b -P script.py`.
  See `art/README.md` for the existing pipeline and `scripts/tactical-art.mjs`.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest). Other tracks
  are mid-change, so a failure outside your files may not be yours: report it,
  don't fix it.
