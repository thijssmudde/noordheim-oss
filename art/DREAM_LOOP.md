# Noordheim asset and combat pass

This pass applies the approved northern art direction to the four biomes and all 54 existing GLB assets. It adds six distance foliage meshes, image surface detail, filtered sky reflections, differentiated biome lighting, river currents and shadow reception, bridge weathering, and a real local combat review. It is a development milestone toward the approved target, not an assertion of finished AAA quality.

## Current asset sources

- Tactical equipment: `equipment-finish.blend` and `blender/refine_equipment.py` cover all 31 models and matching 256×192 portraits. `equipment-finish-v2.blend` and `blender/refine_equipment_v2.py` contain additional geometry for ranger, rocket, raider, sapper, militia, marksman, tank, lynx and gunship. Original articulation, team-paint materials and bounds are retained.
- Landscape: `environment-finish.blend` and `blender/environment-finish/generate_environment.py` cover 20 original props and six foliage LODs. V2 supplies the four spruce LODs. `geology-finish.blend` and `blender/geology-finish/generate_geology.py` supply the eight ice, basalt and granite assets, with `ice-finish.blend` and `generate_ice_r2.py` providing the latest two ice meshes. The adjacent frozen source props and original bounds are inputs to regeneration. Each landscape asset remains one instancing mesh/material.
- Ambient life: `ambient-finish.blend` and `blender/refine_ambient.py` refine the original gull, technician and shore patch materials without changing bounds or articulation. Runtime gull scale is reduced to 0.42. The exporter explicitly preserves linear albedo alongside vertex wear; an asset regression test guards this contract.
- Generated surface atlas and sky panorama: exact prompts are in `materials/`; runtime PNGs are in `public/art/materials/`. These are original generated images, not downloaded third-party materials. The panorama is an LDR reflection source, not a measured HDR environment.
- Original synthesized weapon audio: `scripts/generate-combat-audio.py` regenerates the five PCM WAVs in `public/audio/combat/` using Python's standard library. These are designed sounds, not recorded weapon foley.

Run Blender generators into a separate working directory. The equipment and ambient scripts accept source/output arguments. Landscape scripts use their adjacent helpers and write local output folders; collect V1, overwrite the four spruce LODs with V2, then overwrite the eight rock assets with the geology pass and the two ice meshes with ice R2. Preserve the authored sources when exporting.

## Runtime behavior

Rifles, machine guns, cannons, rockets and artillery have separate cadence, muzzle height, projectile speed, burst size, recoil and sound. Effects consume authoritative fire timestamps and health; they never apply damage. Duplicate snapshots, reconnects and hidden shots cannot replay effects. Damaged visible vehicles and buildings smoke; entity disappearance is never treated as proof of destruction. Projectiles, particles and simultaneous audio sources are bounded. Weapon sound requires the existing audio gesture gate and follows mute, volume and tab visibility.

The review fixture uses actual `tickBattle` damage and resets with a fresh operation identity. It is isolated from backend mutations. Open `/?artReview=1&map=frostgate&seed=947`, choose a biome, and toggle **Firefight**. **Next crossing**, **Overview**, **Explore landmark**, **Full visibility** and **Patrol** support repeatable rendering checks.

Tree LODs preserve near-mesh bounds and reduce triangle count by more than 70%. Tactical models remain below 25,000 triangles, 25 meshes and 1.1 MB each. A shared glacial bridgehead height correction grades the ridge into the deck; terrain classifications and navigation rules are retained. Decorative bridgeheads remain clear of formation centers, and reeds no longer spill onto bridge decks after scatter jitter.

## Quality status

Independent dream-loop reviews progressed from 2.8 to 3.6, 4.1, 5.2, 5.4 and 6.0 out of 10. The last scored frame passed composition and lighting; it did not pass the material gate. Subsequent ice topology, grouped outcrops, wave variation and oblique snow drifts are preserved for review. The approved target of 8/10 has not yet been reached. The latest two ice meshes and surface refinements remain unscored.

The remaining work is material realism, less repeated geological dressing, finer foliage and snow interaction, and continued combat animation/sound authoring. This pass does not add a campaign or claim production completeness. Performance measurements are local desktop fixture observations, not a cross-device certification.

## Verification

- Full suite: 309 tests passed across 35 files (`pnpm exec vitest run --maxWorkers=2`).
- Later visual changes: terrain/biome checks and all 31 landscape/placement checks passed; glacier exports retain original bounds and one primitive/material.
- Type checking, lint and production build passed. The build retains the existing large-chunk and Vinext route-classification notices.
- Browser: all four biomes and the real firefight fixture inspected, no new console or shader errors after the snow shader correction. Settled final views reached about 108–120 fps at 1280×720 on this local desktop.
- Validation above records the local development pass before publication.

## Map design follow-up — generation 7

New operations use biome-specific crossing families with authored Blender structures, seeded angles and distinct widths. Frostgate combines suspension and steel spans; Amberfen uses narrow timber trestles, an old stone causeway and two shallow fords; Cinderreach combines a basalt causeway, steel and suspension; Skerry mixes a causeway, modular pontoons, steel and timber. The four additional GLBs and reproducible source live in `crossings.blend` and `blender/crossings/`. Each remains one mesh/material, under 10,000 triangles and 700 KB.

Raised islands now divide widened river channels, with northern shallow approaches for forward lookouts. Frostgate gains rolling glacial relief; Cinderreach gains thermal rims. Island outcrops and vegetation create landmarks, and review controls jump between crossings, named landmarks and the central overview. Ford guideposts and quieter shallow-water currents identify slow routes; their banks grade into the existing ground instead of cutting rectangular trenches.

Navigation and building reservations share crossing widths, rotations and approach bounds. Version-6 saves keep their original channels, bridge classification and placement reservations; terrain caches distinguish generation versions. No capture objectives or new economy rules were introduced.

Validation: 313 tests across 36 files pass, including full winning operations on versions 6 and 7, generated-map route checks, island access, usable crossing lanes, authored deck geometry, and saved-map compatibility. The scripted version-7 commander now relocates a planned foundation when generated ore occupies its original site. Type checking, lint, production build and whitespace checks pass. The existing build chunk-size and route-classification notices remain. Timber, ford, pontoon, causeway and suspension views were inspected in the local browser; settled sampled views approached 120 fps on this desktop. These are local observations, not a new independent AAA fidelity score or cross-device benchmark.

This map-design milestone was validated locally before publication.

## Formation and radio follow-ups

Mixed armies allocate space by unit size, and all faction infantry use infantry spacing. Tests cover full 80-unit formations, mixed armor, bridge clearance and movement completion. Adaptive radio chatter shares a cooldown, caps repeated routine cues, and stops them after five minutes; alerts and mission results remain enabled. Audio settings offer Adaptive, Alerts only and Full radio and persist on the device. The complete development suite passed 321 tests before the deployment test was split into individual seed cases for hosted runners. Production build, type checking and lint passed.
