# Battlefield operating envelope

## What failed

On 10 September 2026, production `tactics:tick` repeatedly timed out at the
Convex runtime's **one-second limit for user code**. The stalled battle had 341
entities and about 80 KB of JSON state. This was a simulation CPU problem, not
the **1 MiB document-size limit**. Production insights also recorded troop
commands losing database write conflicts with the scheduled simulation.

Limits reference: https://docs.convex.dev/production/state/limits

The watchdog could resume the scheduler but then repeated the same expensive
work. A sanitized copy of that battle reproduced a 320 ms local update before
these changes. Local timings understate cloud timings and must not be used
alone to approve an increased limit.

## Enforced parameters

| Parameter                                                                     | Limit                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Human players                                                                 | 8                                                                                 |
| Enemy armies, each with a complete base                                       | 8                                                                                 |
| Combat troops per human                                                       | min(80, floor(160 / configured player slots))                                     |
| Harvesters per human, including orders                                        | min(8, floor(32 / configured player slots))                                       |
| Structures per human, including construction                                  | 128                                                                               |
| Enemy troops, across all armies, including planned production                 | min(128, 100 + 4 × (enemies − 1))                                                 |
| Battlefield space reserved for enemy troops (allied growth stops short of it) | min(enemy troop limit, surviving armies × (home guard + 6)) − living enemy troops |
| New A* searches for the counterattack launch, on its own allowance            | max(3, columns per cadence)                                                       |
| Total living troops and structures                                            | 512                                                                               |
| Pending command groups per human                                              | 4; redirects of the same group coalesce                                           |
| New A* searches per command slice                                             | 3                                                                                 |
| New A* searches per simulation update                                         | 3                                                                                 |
| Command groups handled per update                                             | 1, oldest first; unfinished groups yield their turn                               |

The global ceiling takes precedence over individual allowances. Paid troop
orders wait for room; they are not lost. A full battlefield rejects new
construction, prevents free refinery harvesters and enemy deployments, and
rejects late legacy enrollment. Existing units and structures above a newly
introduced cap remain intact; further growth waits for space.

Map scale is saved at match creation:
`max(1, 0.3 * enemyCount + 0.06 * (playerSlots - 1))`, rounded to two decimals.
Up to three armies fit the 300 × 260 m coast; a solo eight-enemy map is
approximately 720 × 624 m and eight humans versus eight enemies approximately
846 × 733 m, so travel times stay those of a skirmish map. Enemy bases stretch
along the northern band (48 m either side of the station) rather than across
it. Existing matches retain their saved scale. Navigation grid spacing scales
with the map, keeping its cell count bounded; every grid edge samples the ground
between its cells every two metres, so cliff lines and becks thinner than a
step never hide inside an edge. Building sizes, weapon range, sight and movement
speeds remain in metres.

## Work that is bounded

Commands validate quickly and write an intent instead of calculating paths
while competing to update the battle document. The scheduled simulation
processes those intents. Full formations are assigned once and preserved as
route work continues over later updates; nearby troops reuse collision-checked
corridors. A budget deferral retains unfinished orders. A genuine unreachable
destination reports an order error. Dead squad members do not discard orders
for the survivors. Enemy columns likewise establish one approach and route
their remaining troops over later updates.

The first queued command wakes the simulation after a 10 ms coalescing delay.
While orders remain, bounded routing passes continue with the same short delay
instead of adding 250 ms of idle time per squad or formation slice. Once the
queue drains, the normal 250 ms cadence resumes. Expected tick timestamps
discard the superseded periodic callback, preserving a single simulation chain.
These are scheduler delays; processing and network time still add to latency.

Combat target lookup uses tick-local spatial buckets. Terrain classification
does not calculate decorative ground height. Refinery, troop and enemy
production respect the limits. Rendering steps through four render tiers
(`lib/frame-budget.ts`) under sustained frame pressure (below 45 fps over two
seconds): first ambient occlusion goes, then SMAA gets cheaper and the shadow
map is redrawn every second frame, then tilt-shift and anti-aliasing go and
shadows redraw every third frame, with 90/80/70% render resolution. No tier
switches shadows or lights off, because that recompiles every material (a
freeze of a second or more) exactly when the device is struggling. Quality
returns one tier at a time after 12 healthy seconds; a tier that fails again
right after returning doubles that wait (up to two minutes), so a borderline
device does not oscillate. HUD resolution is unchanged.

Client main-thread work per server tick is bounded too. Each piece of
equipment is a memoized component: a tick re-renders construction sites and
pieces whose selection, rally point, kind, owner or paint changed, while
positions, health bars, cargo, recoil and gait follow the newest server
snapshot through a shared ref inside the frame loop. Fog of war repaints ten
times a second rather than every frame (eyes glide between repaints, and the
texture upload was the expensive part), and its paint loop skips the square
root inside a unit's true sight radius. The eased credit counter is its own
component, so its per-frame updates no longer re-render the whole command
screen. A headless profile of a Hard eight-army skirmish on 2026-09-15 had
23% of CPU in the fog repaint before these changes.

Troop presentation also follows observed update cadence: allied route prediction
covers slow updates with a hard one-second ceiling, and enemy interpolation
uses the observed tick interval up to one second. Small early arrivals retain
the presentation clock rather than accumulating drift. Enemy paths stay private.

Move and attack-move orders answer on the next frame instead of after the
server round trip and routing slice. A ground marker pings at the ordered
point, and each selected troop faces it and walks up to 0.35 s straight toward
it (stopping short of footprints, cliffs and water; troops exchanging fire on
attack-move stay put). When the server's route lands, recognised by a new
`orderAt`, the head start blends out over up to one second, so the troop eases
off rather than stepping backwards; later snapshots keep that blend's pace. A
rejected order, or one not routed within four seconds, settles back the same
way. This is presentation only: the simulation and routing are unchanged. A
full 80-troop solo army takes eight routing slices on the server benchmark, so
the last squads wait facing their destination until their slice arrives.

Selected troop routes use persistent line buffers. Movement updates the first
vertex from the rendered troop position; route vertices and their terrain heights
change only when the approved route changes. Server snapshots no longer rebuild
every selected troop's React tree and dispose its route geometry and material.
Enemy interpolation validates an observed movement segment once per snapshot,
rechecking if the building obstacles change, instead of rescanning them each frame.

## Repeat the measurements before raising limits

The final development-cloud probes on 10 September completed the first combined
order slice and simulation update in **333–398 ms of user CPU** for the tested
512-entity lobbies and the 356-entity, 80-troop solo scenario. Before slicing, the
same full-army solo order timed out. These are measured samples, not a worst-case
latency guarantee. Synthetic battle documents remained about **100–112 KiB**.
The benchmark also exercises subsequent slices until the entire order completes.

```sh
NOORDHEIM_BENCHMARK_OUTPUT=/tmp/noordheim-envelope pnpm test tests/battle-performance.test.ts --maxWorkers=1
pnpm exec convex dev --once
node scripts/probe-battle.mjs /tmp/noordheim-envelope-amberfen-8.json --command
node scripts/probe-battle.mjs /tmp/noordheim-envelope-amberfen-1.json --command
pnpm exec convex logs --history 30 --jsonl
```

`performance:probe` is an **internal, read-only query**. It performs no database
writes and creates no players or games. Its cloud log's `userExecutionTime`
measures the command slice plus simulation step. The fixtures contain synthetic
players only. The normal test suite also verifies that every deferred group
finishes, full-army formation destinations stay distinct, production respects
caps, all four biomes stay active at maximum load, and state stays below 256 KiB.

Do not raise the ceilings solely because document size is small. Keep a generous
margin below the one-second CPU limit, inspect write-conflict insights, and test
representative target devices before promising a frame rate. Larger-scale RTS
play would need another simulation architecture, not merely more database
storage. These limits bound one match; concurrent-match capacity depends on the
deployment's concurrency and throughput limits.

## Rendering cost (client)

Measured headlessly on an M4 Pro (Chrome, ANGLE Metal, 1600×900). On this
path the frame is bound by the GPU process decoding WebGL commands, not by
pixels: rendering at a quarter of the resolution was no faster, while fewer
draw calls were. So the levers are draw calls and passes:

- Equipment casts shadows through merged *shadow proxies*
  (`lib/shadow-proxies.ts`): per animated part (turret, legs, door, cargo...)
  one hidden mesh of all its geometry, shown only while the shadow map
  renders. The shadow is the same geometry; the Fjordmouth art-review view went
  from 1,253 to 794 draw calls per frame.
- The world regenerated by the attract loop and the art review (every half
  minute) is charted once per seed and handed out as copies; charting cost a
  60 ms+ hitch (over 100 ms on a 4× slower CPU) on each restage.
- The tech tree evaluates availability for every node; it now renders only
  while its dialog is open, not on every server tick.

Development probes: `?debug=noao,nobloom,nosmaa,notilt,nopost,noshadow,
novegetation,noproxy,noadapt` switch parts off, `?look=tier:N` pins a render
tier (with `debug=noadapt`), and the canvas exposes `data-frame-stats`. Uncapped
throughput needs `--disable-gpu-vsync --disable-frame-rate-limit`; close stray
headless browsers first, since another page's WebGL shares the GPU process
and halves the numbers.
