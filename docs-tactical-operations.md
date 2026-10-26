# Northern Command / Operation Skerry

Noordheim is a modern Nordic cooperative RTS sector in the style of a classic
base-building strategy game: harvest ore, build power, climb a tech tree, and push
across the fjord. The earlier persistent settlement game was retired on
2026-09-06; commanders and their recovery keys carried over, everything else was
removed.

## Rules and persistence

- One home screen does everything: a new commander types a callsign, picks a
  faction, a battlefield, a difficulty and an enemy count, and Deploy task force
  enrols them and starts a private skirmish in the same step; an enrolled
  commander sees their callsign instead. Create lobby opens the waiting room
  (the lobby page) and a six-character join code or the open-lobby list leads
  there too. An operation in progress shows Resume and Withdraw on the home
  screen. Matches run independently. Sectors created on earlier map layouts (map versions 1 to 5) finish on their
  own; new deployments start a version 6 operation with seeded Skerry geography.
- Up to eight commanders share allied vision and fight the same AI garrison on a
  300 × 260 m coast. Landing zones sit 70 m apart along the southern shore.
- **Landscape.** `lib/tactical-terrain.ts` describes the sector once for the
  server, the renderer and the minimap. The Skerry river meanders east to west
  with four road bridges. A brook drains the northern mountains into it and can
  be crossed at a ford (ground units wade at 45% speed) or a plank bridge. In the
  north west lies a tarn with a shallow outlet beck; in the north east the
  Nordåsen plateau rises 3–7 m behind cliffs and is reached only by a south ramp
  beside the eastern approaches and a west ramp. Enemy bases
  can occupy the plateau, lowlands, or ground near the tarn. Marsh pockets beside the river slow ground units to 55%,
  and a bay bites into the southern beach. Player foundations can prepare gentle marsh and dry banks; water, fords, ramps,
  cliffs and slopes over 1.5 m across the platform remain excluded. Ground A* weighs marsh and fords
  by their speed, so routes skirt them unless the detour is longer.
- **World generation.** Each new operation receives a server-generated seed.
  River position, bends and width, road crossings, the tributary and its crossings,
  the lake's position and size, plateau boundaries and height, marshes, rolling
  ground and the coastal bay vary with this seed. Maps retain the Skerry theme:
  coastal landings in the south and high ground in the north. The first landing
  rotates among the four primary pads; later commanders receive separate pads.
  Enemy fortresses, ore locations and richness, defenses, and
  patrol compositions also change each run. Generated bases use clear, level ground;
  production exits, bridge approaches, and ore loading space stay open. All
  eight landing zones keep a nearby 16,000-credit seam. Saved operations retain
  their layout through ticks and reconnects. Versions 1–5 use the original terrain
  even when they already have an enemy-placement seed. Terrain is passed explicitly
  into routing, movement prediction, formations, harvesting and construction;
  the renderer and minimap use the same version and seed. No global active map
  state is shared between simultaneous operations. The arithmetic map cache is
  capped at eight entries; generation's temporary reachability graph is released.
- **Lobbies.** Hosts choose a name, difficulty, and a player limit of 2–8.
  The waiting room shows the live roster and join code. The host can change the
  settings until starting; the limit cannot drop below the roster size. Leaving
  transfers hosting to the next commander, and an empty room closes. No world or
  clock exists until the host starts, then all members deploy together. Solo
  skirmishes start immediately. Started lobbies do not admit new players.
- **Difficulty.** Solo commanders and lobby hosts choose Easy, Normal, Hard, or
  Brutal; lobby members inherit the host’s selection. Starting credits are 2,200 / 1,500 / 1,250 /
  1,250, with the first wave after 4 / 2.5 / 2.25 / 2 minutes, then every
  210 / 120 / 95 / 75 seconds. Higher levels add garrison troops (home guard of
  4 / 6 / 8 / 10) and defenses (2 / 5 / 8 / 10 per base), larger waves (×0.7 /
  1 / 1.4 / 1.7), faster hostile production (×1.5 / 1 / 0.8 / 0.6 training
  time) and earlier advanced units (escalation 0 / 1 / 3 / 6 waves). Hostile
  troops gain veterancy: +0 / 3 / 5 / 7% damage per column launched, capped at
  +50%. Hard marches two armies per cadence and Brutal three, each choosing its
  own target, and 0 / 25 / 35 / 40% of columns raid a refinery, geothermal
  plant or outpost instead of the command station.
- Each starts with a command station, two Jæger patrols, a Lynx IFV, and the
  selected difficulty’s sector credits. The command station adds one credit per second; everything else
  comes from ore.
- **Ore.** Eighteen finite seams: a 16,000-credit seam beside every landing zone,
  five 45,000–54,000-credit shore fields between the bases and the river, four
  60,000–78,000-credit northern seams across the fjord, and a 45,000–60,000-credit seam near
  the enemy fortress. Richer seams are farther away and guarded. A harvester
  moves about 500 credits per half-minute cycle, so a home seam feeds two
  harvesters for roughly eight minutes and a shore field three for a quarter hour. An ore refinery (which arrives with a free Malm harvester)
  is the drop-off point; harvesters load 500 credits per trip, up to eight per
  commander, and automatically move to the nearest remaining seam when one is
  exhausted. Harvesters cannot be selected or ordered: they run themselves,
  and an idle one goes back to work as soon as ore is within reach.
- **Base building.** Build as many geothermal plants, refineries, factories,
  defenses and outposts as credits, power and land allow; only the command
  station is unique. Structures must stand within 32 m of a completed structure,
  48 m of the command station, or 56 m of a forward outpost. Outposts can also be
  placed outside the existing base on dry land currently in sight of your own
  troops. Each completed outpost opens an independent build radius, even after
  those troops leave. Select it to see its boundary and choose **Build around
  outpost** to open construction there. The placement preview shows the radius
  before you commit. Up to five foundations construct serially. Construction is
  quick (8–21 s per structure) and a commander's first three foundations rise
  in 60% of that time, so a base stands before the first column marches.
  Selling a finished structure refunds half; cancelling one under construction
  refunds all.
- **Tech tree.** Jæger hall → infantry; Vehicle works (needs a refinery) →
  harvesters and vehicles; Air base (Tier 2, needs the works) → aircraft.
  Tier 2 clearance is researched at the command station and unlocks armor,
  artillery, the air base, the research station and the coastal battery, plus
  the Tier 2 expansion structures. Growth comes mostly from concrete: the
  pillbox (Tier 1, needs the Jæger hall; a machine-gun bunker that shreds
  infantry and cannot fire upward), the aid station (Tier 1, needs the hall;
  idle infantry within 30 m recover 3% health per second), the flak tower
  (Tier 2, needs the works; twin autocannons that only engage aircraft), the
  radar mast (Tier 2; 72 m sight), the thermal power station (Tier 2, needs a
  geothermal plant; +30 power) and the field workshop (Tier 2, needs the works;
  idle vehicles and aircraft within 30 m repair 2% per second). Research is a
  focused dozen: the command station sells Tier 2 clearance and convoy
  logistics (harvesters carry 20% more and drive 15% faster); the research
  station sells hardened drills, turbines, armor-piercing rounds (+20% infantry
  damage), ceramic plates (infantry take 20% less), tungsten shells (+20%
  vehicle, aircraft and defense damage), composite armor (vehicles take 20%
  less) and Tier 3 clearance (Jotun heavy tank, Valkyrie gunship); Tier 3
  clearance opens depleted uranium sabots (tanks and Jotuns +25% against
  vehicles and structures; needs tungsten shells), advanced avionics (aircraft
  take 20% less and fly 15% faster) and ballistic computers (artillery range
  +15%). Projects cost 700–2,400 credits and take 28–72 seconds across all
  difficulties; Tier 2 clearance takes 36 seconds and Tier 3 takes 72. Queue unlocked projects
  with credits paid upfront; one runs at a time per commander, in order. Cancel
  any active or queued project for a full refund. Waiting projects pause if
  their research station is lost and resume when it is replaced; a project
  retired by a release is dropped from a saved queue.
- **Production.** Infantry, vehicles and aircraft each have their own line, up to
  100 queued troops in total, with a maximum of 30 field units plus 8 harvesters.
  New units roll out to the structure's rally point (select a production
  structure and click land). Ready troops wait for power, army space and a clear
  exit; the queue panel explains any pause.
- **Combat.** Armor classes (infantry, vehicle, air, structure) and per-unit
  multipliers give rock-paper-scissors counters. Every troop fires on the move:
  a plain move keeps walking while anything in range is engaged, an attack on
  a target still out of reach keeps closing while nearer enemies are shot at,
  and attack-move, hold and stop hold position to fight. Rocket Jægers and Bofors sentries
  punish armor and aircraft; Jægers and the Lynx cut down infantry; howitzers and
  coastal batteries outrange everything, wreck structures, and cannot fire inside
  their minimum range or at aircraft; tanks cannot shoot upward at all.
- A server-only scheduler simulates co-op operations: movement, harvesting,
  research and combat four times a second, continuing when browsers disconnect.
  Duplicate callbacks are guarded by the previous tick.
- Solo skirmishes run in the browser. A Web Worker
  (`components/game/local-sector.worker.ts`) owns the battle and replays the
  same flow through `lib/local-sector.ts`: orders queue as coalesced intents
  (four per commander), each tick routes the oldest slice before advancing the
  battle, and the page receives the same fog-filtered projection
  `api.tactics.state` returns. Convex only confirms the commander's identity.
  The worker saves the battle to IndexedDB every two seconds, after every
  action and when the page hides; it pauses while the tab is hidden, and
  resuming shifts every timer by the pause (`shiftTimers`, shared with
  `resumeStalledSector`). Withdrawal or game over clears the save.
  `?engine=server` still deploys a hosted solo operation.
- Victory requires capturing every hostile flag by carrying it home. Each army,
  hostile or allied, plants a flag in a 9 m zone about 22 m ahead of its command
  station, in open ground clear of foundations and exits; flag positions, their
  state (home, carried, dropped), carrier and pickup progress are public. A
  living ground troop of the opposing side (never aircraft, harvesters or
  unfinished troops) within 4 m of a flag at home or dropped for 2 s picks it up;
  one carrier per flag, and a carrier cannot hold a second flag. The carrier
  moves at 0.8x speed (applied in `speedScaleFor`, so client prediction matches)
  and is always visible to the flag owner's side. Reaching its own side's flag
  zone (its army's; for a commander's troop, any standing allied commander's)
  captures the flag and that army collapses (every structure and troop dies).
  A carrier that dies drops the flag on walkable ground where it fell: the
  opposing side can pick it up again (2 s), the owner's troops return it home
  instantly by touching it, and it returns on its own after 30 s untouched.
  Foundations may not be placed in a flag
  zone. The operation ends in defeat when every commander is out, or after 45
  minutes. Counterattacks launch from the hostile bases whose columns are ready
  and march on an allied flag; a raider picks it up and runs it back to its own
  flag zone while the rest of the column escorts it. On Normal and above some
  columns raid a refinery, geothermal plant or outpost instead, then make for
  the nearest flag. When a hostile flag zone is entered, that army's home guard
  falls back onto it; when an allied troop carries a hostile flag, that army's
  nearest troops (and passing hostile troops) hunt the carrier, and a dropped
  hostile flag is fetched back. Every troop on guard or attack-move fires at an
  enemy carrying its own side's flag before any other target. The difficulty's
  `flagReach`, `flagHunters` and `flagDutyMs` set how far, how many and how
  often: Easy reacts late with two troops, Brutal at once with many.
  Column cadence depends on difficulty;
  on Normal they start after two and a half minutes and return every two. They
  grow from patrols into combined-arms columns: rockets and a Lynx first, then
  tanks, drones, howitzers, gunships and Jotuns, each arm growing to its cap so
  late columns keep escalating instead of plateauing. Every column launched
  raises hostile veterancy. Nothing outlives its operation: a cron purges ended
  operations ten minutes after they end (with their orders, lobby and
  commanders), operations nobody commands any more at once, closed lobbies, and
  commanders who are neither in an operation nor in a waiting room thirty
  minutes after their last action, so callsigns become available again.
- Multiplayer operations are cooperative; there is no player-versus-player mode.
  Solo games are not listed or exposed to other commanders. Returning commanders
  reconnect to their selected operation or waiting room. The Operations menu lets
  them resume or explicitly withdraw; withdrawal removes only their own forces
  and orders, while allies continue. A commander is out when their flag is
  carried home by the enemy, or when nothing of theirs is left standing; that shows a personal
  Game Over screen. Defeated commanders cannot issue orders, and their
  production and research stop. Surviving allies continue; the match ends when
  every commander is out. Back to operations clears the defeated commander’s
  selection so they can start or join another game.
  A command station is no longer a lifeline: destroying it does not collapse
  its force. Without it a commander cannot place new foundations and a hostile
  army stops training, but its troops still defend the flag.
  Existing operations from before lobbies retain a compatibility deployment path.
- Superweapons. After Tier 3 clearance each faction may raise one superweapon
  structure per commander: the Fjordborn Naust storm-boat house (Skerry Strike
  lands six raiders, two snowmobiles and two tanks as veterans), the Ironclad
  Fjell railway gun (the Mountain Gun shells any ground the commander has ever
  scouted), the Hearthkin Vinterveg airstrip (the Winter Convoy fully repairs
  the coalition under it, pays credits and speeds up movement and fire for
  thirty seconds) and the Ashwalker Brann rocket battery (the Firestorm reveals
  a wide area for a minute and burns it, bogging hostile infantry down). From
  Normal up the garrison raises a destroyable Weather Mast beside every command
  station; it charges on its own and drops a freezing blizzard on the richest
  allied position. Charge starts on completion, pauses while the owner's grid is
  short and restarts on launch. Every countdown and every telegraph ring is
  visible to all commanders, a strike lands four seconds after launch, never
  hurts the coalition that fired it and takes at most 70% of a command station.
  Numbers live in `SUPERWEAPONS` (lib/tactics.ts) and `DIFFICULTIES`; the rules
  in lib/tactical-superweapons.ts. Press G (or Launch) to aim a charged weapon.
- Queries return only currently visible enemies (plus any enemy carrying an
  allied flag) and never their orders. Mutations
  validate session ownership, unit ownership, bounds, visibility,
  credits, the tech tree, power, and placement. Ground A* uses a binary heap and
  routes across the bridges, the ford and the plateau ramps.

## Interface

Left click or drag to select; Shift adds to selection. Double-click one of your
troops (or Ctrl/⌘-click it) to select every ready troop of that kind inside the
camera view, up to the selection limit; harvesters and units still in production
are skipped. Shift+double-click adds them to the current selection. A still
Ctrl/⌘-click selects; a Ctrl/⌘ drag still rotates the camera. Double-clicking a
roster card narrows the selection to that card's kind (or picks the whole kind
when the card was not selected). Right click moves, attacks, or (for harvesters)
harvests. M arms movement; Q arms attack-move; X stops; H holds; F selects all
field units; T opens the tech tree. Ctrl/⌘ + 1–9 binds the selection to a
control group (Alt + 1–9 too, for browsers that keep Ctrl/⌘ + number for tab
switching), and Shift with it adds to the group; 1–9 recalls the group's living
troops, and a quick double press centres the camera on them. Group chips above
the command bar recall on click and centre on double-click. Groups are
client-side and kept per operation in sessionStorage. The camera starts at a
three-quarter angle and supports full rotation: right drag, middle drag, or
Space + drag grabs the ground; arrow keys, WASD and the screen edges scroll; the
wheel or a pinch zooms towards the pointer; the minimap (click or drag) and Home
jump. Touch players select from the bottom roster and use a command button then
tap land.

The production panel has five tabs: structures, infantry, vehicles, aircraft and
research. Locked blueprints say what they require. Every commander sees the
shared roster plus their faction's signature kit: one structure that requires a
geothermal plant and trains that faction's two troops. Fjordborn build the Strandhogg
raiding camp for Fjord raiders and Varg snowmobiles; Ironclad the Bergverk armory
for sappers and Mjølnir siege mortars; Hearthkin the Lade storehouse for hearth
militia and Bulwark plough tanks; Ashwalkers the Varde watchtower for Ember
marksmen and Fenrir scout cars. Tier 2 clearance still gates the signature
vehicles. The tech tree dialog lists the faction's kit in its own section. The top bar shows credits and
harvested income, the power grid, harvesters and remaining ore, and the current
clearance tier. The minimap marks ore seams as diamonds that fade as they deplete.

Under-attack alerts are derived on the client by comparing the viewer's health
between consecutive snapshots (`lib/damage-alerts.ts`): "Base under attack"
(any structure), "Harvester under attack" and "Units under attack". Each
category warns at most once per 12 s per 40 m cell. The alert shows a
signal-orange notice (ice for troops) above the command bar and a pulsing ping
on the radar that fades after 6 s. The commander's existing radio lines voice
it: "base under attack" for any structure hit, "under attack" for troops and
harvesters. Tapping Space, clicking the notice or clicking the ping jumps the
camera to the latest alert; holding Space and dragging still grabs the ground. A tap is a release within
350 ms with no pointer press while Space was down. A snapshot gap over 5 s
(reconnect) re-baselines silently. The HUD fixture `/?uiReview=hud&raid=1`
stages a raid on the refinery and its harvester 14 s after load.

The battlefield uses exported Blender models, culture paint, articulated legs and
rotors, server-driven health, fire traces, command paths, harvester cargo, rally
markers, glowing ore fields, and visible construction. Naval warfare and PvP
tactical teams are not implemented.

Validation: pure movement, combat, economy, tech-tree and placement tests,
two-player Convex ownership and persistence tests, a scripted solo victory over
the full operation, enrolment and recovery, audio policy, and GLB asset budgets.

## Building placement

Choose a structure to enter placement mode. A translucent instance of the actual
Blender model shows the entire reserved foundation, including the factory apron.
Green allows placement; red supplies a reason. R rotates in quarter turns; Esc or
right click cancels. Click valid terrain to commit. On touch, tap to preview and
use Build here to confirm. Right or middle drag, two-finger pan/zoom, edge scroll
and camera keys work while positioning. Choosing and cancelling a preview costs nothing.

The shared Convex mutation validates finite coordinates, rotation, the build
perimeter, full dry-land footprint, 2 m building clearance, ore seams, queued
reservations, ground units, production exits, bridges, objectives, and future
commander landing zones. Credits and the serial construction queue change only
after acceptance. Coordinates and orientation persist on the sector entity, and
the same ghost rules run on the client.

Factories, halls and air bases produce units outside their placed, rotated exit;
refineries dock harvesters there. New construction clears overlapping decorative
trees. Ground navigation avoids building foundations and replans if a new
structure obstructs an existing route. Aircraft fly over buildings. Attack paths
approach structures from outside their footprint.

Move and attack-move arrange squads into staggered ranks facing their travel
direction. Slots are centred on the click, sized for the largest selected unit,
and matched to nearby soldiers to reduce crossing. Shorelines and foundations
shift slots onto separate reachable positions. Open-ground routes run directly;
longer routes lose unnecessary grid turns while retaining bridge, ramp and marsh
detours. Infantry strides follow distance travelled, with individual phases and
cadence, and vehicles turn more gradually.

Malm harvesters reserve separate work positions around seams and three unloading
bays at each refinery. Occupied bays send later trucks to spaced waiting positions.
They finish their approach before loading or unloading, and clear the refinery
after the final delivery. Cargo fills the Blender hopper from its floor; it no
longer appears as a floating crystal.

Camera rotation: hold Ctrl, Command (⌘), or Alt and drag to rotate and tilt; Shift-middle-drag does the same. [ and ] rotate, and backslash or the N camera button resets north. Scroll directions follow the screen after rotation. Two-finger twist rotates on touch. The minimap remains north-up and shows the actual rotated view.

Counterattacks have a minimum patrol size of three on Easy, four on Normal, and five on Hard. Brutal composition is unchanged. Failed launches retry after ten seconds without incrementing the wave; alternative hostile bases are tried when an exit cannot route to the target. The launch step routes its column leads on a route-search allowance of its own, so a busy update full of harvester and troop routing can never starve it. Each surviving hostile army keeps battlefield space reserved for its home guard plus six troops; allied construction and training stop short of that reserve, so a full eight-player lobby still receives columns. The HUD shows the next launch countdown (travel time is additional).

Solo setup and co-op hosts choose 1–8 enemy armies (default one). Each has a distinct owner, command station, production, defenses and troops. Larger matches use compact bases and a bounded population budget. Capturing an army's flag collapses that army: its buildings, defenses, home guard and marching columns die in the same update. Destroying its command station only stops its production. Old saves ignore their retired capture data. Public enemy totals include hidden forces without exposing their positions.

Construction reserves unused landing zones only in legacy sectors that accept late joiners. Solo and launched co-op matches can build there. Depleted ore no longer blocks foundations. Production aprons need walkable ground, rather than foundation-grade terrain. Placement rejection text appears above the ghost as well as in the command bar.
