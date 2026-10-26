# Noordheim

Noordheim is a cooperative real-time strategy game built with React, Vinext, Three.js
and Convex. Play a private solo skirmish or create a cooperative lobby for up to
eight commanders: harvest ore, power a
base, climb a three-tier tech tree, and push across the fjord against an AI garrison.
The server simulates the battle four times a second and keeps going when browsers
close. See [the operations notes](docs-tactical-operations.md) for the rules.

## Run locally

Use Node.js 22.13+ and pnpm.

```sh
pnpm install
pnpm db:dev
# In another terminal:
pnpm dev
```

Convex configuration belongs in `.env.local`. The configured Noordheim project has
separate development and production deployments. Never commit environment files or
deployment keys.

```dotenv
CONVEX_DEPLOYMENT=dev:your-deployment
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

Play it at [noordheim.com](https://noordheim.com). The production site runs on
Cloudflare Workers with a Convex backend.

## Deploy your own copy

`wrangler.jsonc` owns the Worker name, Cloudflare account, and custom domains:
replace them with your own. The Vite plugin generates `dist/server/wrangler.json`;
deployment must use that generated file. Put your production Convex URL and
deployment key in ignored `.env.production`, then run:

```sh
pnpm exec convex deploy --env-file .env.production
pnpm run deploy
```

The build embeds `NEXT_PUBLIC_CONVEX_URL` in browser JavaScript. Changing it
requires a rebuild.

## Google Analytics

Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` to the GA4 web stream's `G-…` measurement ID
in `.env.production`, then rebuild
and deploy. Analytics stays disabled in development or without a valid ID.

The site loads Google's tag only after a visitor allows analytics. Visitors can
reject or withdraw consent using Cookie settings. Advertising consent and Google
signals stay disabled. Page views include campaign tags but exclude other query
parameters and URL fragments, including checkout session IDs.

Turn **Enhanced measurement off** for the GA4 web stream: the application sends
its own page views, including client-side navigation, and does not collect form
interactions or player identities. Leaving automatic page views enabled can
duplicate events and include unfiltered URLs.

## Playable systems

- Explicit enrolment with a unique commander name and one of four factions. A
  faction sets identification paint, a doctrine that bends the shared rules, and
  signature equipment: one structure of its own and the two troops it trains
  there (Fjordborn raiding camp, ski raiders and snowmobiles; Ironclad armory, sappers and
  siege mortars; Hearthkin storehouse, militia and plough tanks; Ashwalker
  watchtower, marksmen and scout cars). Private recovery keys, shown in the field manual, return
  the same commander on another device. Visiting the entrance never creates a player.
- Independent solo and cooperative matches whose battlefield grows from 300 × 260 m
  with the selected enemy count and lobby capacity, staying compact in the manner of
  a classic skirmish map: about 720 × 624 m for eight armies solo and approximately
  846 × 733 m for eight human players and eight enemy armies. Each map includes eight landing
  zones and biome-specific river crossings. Every operation rolls fresh enemy bases and ore fields from a
  saved seed. No hostile troops exist at the start: each enemy base trains its
  own home guard and attack columns in its barracks, vehicle works and air base,
  and they roll out of those buildings' production exits.
- Choose 1–8 enemy armies and Easy, Normal, Hard, or Brutal before a new operation.
  Every army owns a separate territory with a headquarters, barracks, factory,
  refinery, reactor, airfield, defenses, and a nearby ore field. Starting credits,
  home-guard size, hostile production speed, column size and cadence scale
  together. There is no countdown; a column marches when its base has trained it.
  Hostile troops gain veterancy with every column launched (up to +50% damage),
  Hard and Brutal march two or three armies per cadence, and from Normal upward
  some columns raid refineries, plants and outposts instead of the command
  station. Each surviving army keeps battlefield space reserved for its home
  guard and a minimum column, so a full lobby cannot silence the garrisons.
- Multiplayer waiting rooms with names, six-character join codes, an open-lobby
  browser, configurable limits of 2–8 players, and host-controlled difficulty and
  start. The simulation begins only when the host launches. Solo games are private;
  each commander reconnects to their own selected match or waiting room.
- Ore economy: eighteen finite ore seams, richer and better guarded the farther they
  lie from the landing zones. Refineries arrive with a Malm harvester; up to eight
  harvesters per commander (four in an eight-player lobby) mine, return, unload and move on to the next seam.
- Free-form base building within credits, power, land, and a 128-structure allowance
  per commander: geothermal plants, refineries, factories, defenses and forward outposts, which
  extend the build perimeter toward distant ore. Construction is quick and a
  commander's first three foundations rise in 60% of the usual time. Sell or
  cancel structures for a refund. Placement previews use the real Blender model
  and explain every rejection.
- A three-tier tech tree with sixteen shared structures, nine shared unit types
  and twelve research projects. Tier 1: geothermal plant, refinery, Jæger hall,
  vehicle works, forward outpost, Bofors sentry, pillbox (machine-gun bunker) and
  aid station (idle infantry nearby heal). Tier 2: air base, research station,
  coastal battery, flak tower (anti-air), radar mast (long sight), thermal power
  station (+30 power) and field workshop (idle vehicles and aircraft nearby
  repair). Research is a focused dozen: Tier 2 clearance and convoy logistics at
  the command station; drills, turbines, armor-piercing rounds, ceramic plates,
  tungsten shells, composite armor and Tier 3 clearance at the research station;
  uranium sabots, avionics and ballistic computers behind Tier 3. Prices are
  steep enough that an operation affords a doctrine, not the whole tree. Each
  faction adds its signature structure and two troops on top; other factions
  never see them.
- Rock-paper-scissors combat across infantry, vehicle, air and structure armor
  classes, troops that fire on the move (a plain move keeps walking while the
  guns work; attack-move, hold and stop hold position to fight),
  long-range artillery with minimum ranges, parallel infantry, vehicle and
  aircraft production lines, rally points, fog of war, and escalating enemy
  columns raised by the enemy's own production. Operations last up to 45 minutes.
- Thirty-one original Blender models with rendered portraits, culture paint,
  articulated legs and rotors, mineral outcrops, harvester cargo, rally markers,
  tracers, visible construction, and an animated coast with gulls, crews, steam,
  snow and water.
- Commander Ravn radio calls and an adaptive soundtrack, with per-device volume
  settings.

## Performance limits

The battlefield has a shared ceiling of 512 living troops and structures. Combat
capacity is 80 per commander in solo/two-player games, reducing to 20 each in an
eight-player lobby; enemy production is capped at 128 troops across all armies.
Orders route in bounded batches so large groups cannot stall the simulation.
See [the performance notes](docs-performance.md) for the measured bottleneck,
all enforced limits, and the repeatable cloud profiling workflow.

## Architecture

- `lib/tactics.ts`: the sector rules shared by the browser and Convex: the map, ore
  seams, harvesting, the tech tree and research, per-category production, armor
  counters, placement, selling, rally points, enemy waves and the tick simulation.
  Balance numbers live in its unit, building and research tables.
- `lib/tactical-world.ts`, `lib/tactical-difficulty.ts`: seeded, terrain-aware
  world generation and shared difficulty presets.
- `lib/tactical-placement.ts`, `lib/tactical-motion.ts`, `lib/tactical-input.ts`:
  footprints and build radii, client-side motion interpolation, and click
  resolution.
- `lib/cultures.ts`, `lib/player-identity.ts`: culture definitions and the
  256-bit bearer keys that identify commanders.
- `convex/schema.ts`: `players`, `lobbies`, and `sectors`. `convex/players.ts`: enrolment,
  session lookup and the entrance. `convex/operations.ts`: private solo matches,
  lobby creation, joining, host settings, starting, and withdrawal. `convex/tactics.ts` and
  `convex/tacticalValues.ts`: sector queries, mutations (deploy, produce, command,
  research, sell, rally) and the scheduled tick.
- `components/game/game.tsx`: the Convex provider, session gate and entrance.
  `join-game.tsx`: the one home screen: enrolment or the commander's callsign,
  difficulty and enemy count, Deploy task force (a private skirmish starts at
  once), Create lobby, join by code or from the open-lobby list, and
  resume/withdraw controls. `lobby-page.tsx`: the waiting room with roster,
  join code and host settings. `tactical-command.tsx`,
  `tactical-tech.tsx`, `tactical-training.tsx`: the command interface, tech tree
  dialog and production lines. `tactical-scene.tsx`, `tactical-environment.tsx`,
  `terrain.ts`: the Three.js battlefield.
- `lib/audio-policy.ts`, `lib/game-audio.ts`, `components/game/game-audio.tsx`:
  radio cue rules, playback and controls.
- `art/`: Blender sources and generator scripts; see [the art workflow](art/README.md).

Queries return only currently visible enemies and never their orders. Mutations
validate session ownership, unit ownership, bounds, visibility, credits, the tech
tree, power and placement. Job completion and tick callbacks are idempotent.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Tests cover movement, combat, economy, tech tree and placement rules in isolation, a
scripted solo victory over the full operation, two-player Convex ownership and
persistence, enrolment and recovery, audio policy, and GLB asset budgets. Lint
targets the authored application, game logic, and tests; the scaffold's unmodified
UI catalog has independent pre-existing lint findings and is not part of that
command.

## Boundaries

Player identities use random 256-bit bearer tokens saved in browser storage. Copy
the private recovery key from the field manual to continue on another device.
Recovery never creates or resets a player; without browser storage or a saved key, a
commander cannot be recovered. Keys must not be shared or placed in invite URLs.
No data is retained beyond an operation: a cron removes ended operations ten
minutes after they end together with their orders, lobby and commanders, removes
operations nobody commands any more at once, and forgets commanders who are
neither in an operation nor in a waiting room thirty minutes after their last
action, so callsigns become available again.
Email login, verified identities, key rotation, and public-server abuse prevention
remain future work.

The earlier persistent settlement game was retired on 2026-09-06. Its Convex tables
(`worlds`, `villages`, `jobs`, `marches`, `reports`, `offers`, `alliances`,
`messages`, `operations`, `routes`) are no longer in the schema and can be deleted
from the dashboard; `players` and `sectors` keep optional legacy fields so existing
records stay valid. Naval warfare, player-versus-player sectors, ranked matchmaking, and joining a
cooperative operation after it starts are not implemented. Convex scheduled mutations preserve
timestamped orders and transactional outcomes, but wall-clock execution is not a
hard real-time guarantee.

Victory requires capturing every enemy flag, classic carry-the-flag style. Every army,
each hostile garrison and each commander, plants a flag on a pole in a 9 m zone just
ahead of its command station. A ground troop (not an aircraft or harvester) that stays
within 4 m of an enemy flag for 2 seconds picks it up; it then moves at 80% speed and is
always visible to the flag's owners. When it walks into its own side's flag zone (in
co-op, any standing ally's zone counts) the flag is captured and that army collapses:
every structure and troop it fields dies at once. A carrier that falls drops the flag
where it stood; either side's troops can pick it up again, the owner's troops return it
home with a touch, and a flag nobody touches returns home by itself after 30 seconds.
Destroying a command station no longer collapses a force, though without one a commander
cannot place new foundations and a hostile army stops training. A commander whose flag is
carried home is out; in co-op the rest fight on, and the operation is lost when every
commander is out. Hostile columns march on your flag, carry it off and escort the carrier
home; their home guard falls back onto their own flag when you step in, hunts a troop
carrying it (every troop on guard or attack-move fires at a carrier of its own side's
flag first), and fetches it back when it drops. Harder settings hunt farther, with more
troops and at once; Easy reacts late and thinly.

## License

The code is [MIT](LICENSE). The art and audio (Blender models, images, voice
lines, music and sound effects) are [CC BY-NC 4.0](LICENSE-ASSETS.md): free to
use non-commercially with credit, commercial use needs permission.
