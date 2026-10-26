import { v } from 'convex/values';
export const point = v.object({ x: v.number(), z: v.number() });
export const unitKind = v.union(
  v.literal('ranger'),
  v.literal('rocket'),
  v.literal('harvester'),
  v.literal('lynx'),
  v.literal('tank'),
  v.literal('howitzer'),
  v.literal('jotun'),
  v.literal('drone'),
  v.literal('gunship'),
  v.literal('raider'),
  v.literal('snowmobile'),
  v.literal('sapper'),
  v.literal('mortar'),
  v.literal('militia'),
  v.literal('bulwark'),
  v.literal('marksman'),
  v.literal('fenrir'),
);
export const entityKind = v.union(
  unitKind,
  v.literal('hq'),
  v.literal('reactor'),
  v.literal('refinery'),
  v.literal('barracks'),
  v.literal('factory'),
  v.literal('outpost'),
  v.literal('turret'),
  v.literal('airfield'),
  v.literal('lab'),
  v.literal('battery'),
  v.literal('bunker'),
  v.literal('hospital'),
  v.literal('flak'),
  v.literal('radar'),
  v.literal('plant'),
  v.literal('workshop'),
  v.literal('camp'),
  v.literal('armory'),
  v.literal('depot'),
  v.literal('watchtower'),
  v.literal('boathouse'),
  v.literal('cannon'),
  v.literal('airstrip'),
  v.literal('launcher'),
  v.literal('weathermast'),
);
export const superweaponKind = v.union(
  v.literal('boathouse'),
  v.literal('cannon'),
  v.literal('airstrip'),
  v.literal('launcher'),
  v.literal('weathermast'),
);
export const orderKind = v.union(
  v.literal('move'),
  v.literal('attackMove'),
  v.literal('attack'),
  v.literal('hold'),
  v.literal('stop'),
  v.literal('harvest'),
);
export const researchKey = v.union(
  v.literal('clearance2'),
  v.literal('logistics'),
  v.literal('clearance3'),
  v.literal('drills'),
  v.literal('turbines'),
  v.literal('ammunition'),
  v.literal('plates'),
  v.literal('shells'),
  v.literal('composite'),
  v.literal('uranium'),
  v.literal('avionics'),
  v.literal('ballistics'),
);
export const difficulty = v.union(
  v.literal('easy'),
  v.literal('normal'),
  v.literal('hard'),
  v.literal('brutal'),
);
/** The hand-built maps a host may choose. */
export const mapChoice = v.union(
  v.literal('fjordmouth'),
  v.literal('ironpass'),
  v.literal('glaciercrown'),
  v.literal('skerryharbour'),
  v.literal('nordlys'),
);
/**
 * Stored map ids: the current maps plus the retired procedural ones, so
 * existing sector and lobby rows keep validating. New rows only use `mapChoice`.
 */
export const mapId = v.union(
  v.literal('fjordmouth'),
  v.literal('ironpass'),
  v.literal('glaciercrown'),
  v.literal('skerryharbour'),
  v.literal('nordlys'),
  v.literal('skerry'),
  v.literal('frostgate'),
  v.literal('amberfen'),
  v.literal('cinderreach'),
);
const trainingOrders = v.array(
  v.object({
    id: v.string(),
    owner: v.string(),
    kind: unitKind,
    remaining: v.number(),
    total: v.number(),
    readyAt: v.number(),
    lines: v.optional(
      v.array(v.object({ producer: v.string(), readyAt: v.number() })),
    ),
  }),
);
export const battleValues = {
  mapId: v.optional(mapId),
  seed: v.optional(v.number()),
  difficulty: v.optional(difficulty),
  enemyCount: v.optional(v.number()),
  training: v.optional(trainingOrders),
  hostileTraining: v.optional(trainingOrders),
  entities: v.array(
    v.object({
      id: v.string(),
      kind: entityKind,
      owner: v.string(),
      team: v.union(v.literal('blue'), v.literal('red')),
      hp: v.number(),
      x: v.number(),
      z: v.number(),
      angle: v.number(),
      path: v.array(point),
      order: orderKind,
      orderAt: v.optional(v.number()),
      target: v.optional(v.string()),
      readyAt: v.number(),
      firedAt: v.number(),
      shotX: v.number(),
      shotZ: v.number(),
      v: v.optional(v.number()),
      pace: v.optional(v.number()),
      cargo: v.optional(v.number()),
      rally: v.optional(point),
      boostUntil: v.optional(v.number()),
      frozenUntil: v.optional(v.number()),
      veteran: v.optional(v.boolean()),
    }),
  ),
  commanders: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      culture: v.string(),
      slot: v.number(),
      credits: v.number(),
      research: v.optional(v.array(v.string())),
      researching: v.optional(
        v.object({ key: v.string(), readyAt: v.number() }),
      ),
      // Plain strings: a queue saved before a release retired a project must still load.
      researchQueue: v.optional(v.array(v.string())),
      harvested: v.optional(v.number()),
      eliminatedAt: v.optional(v.number()),
      scouted: v.optional(v.string()),
    }),
  ),
  objectives: v.array(
    v.object({
      x: v.number(),
      z: v.number(),
      name: v.string(),
      progress: v.number(),
    }),
  ),
  // Optional: sectors stored before capture-the-flag have none.
  flags: v.optional(
    v.array(
      v.object({
        id: v.string(),
        owner: v.string(),
        team: v.union(v.literal('blue'), v.literal('red')),
        name: v.string(),
        x: v.number(),
        z: v.number(),
        radius: v.number(),
        progress: v.number(),
        contested: v.optional(v.boolean()),
        capturedAt: v.optional(v.number()),
        alertAt: v.optional(v.number()),
        // Carry the flag; optional so rows from the zone-hold rule still load.
        state: v.optional(
          v.union(
            v.literal('home'),
            v.literal('carried'),
            v.literal('dropped'),
          ),
        ),
        carrier: v.optional(v.string()),
        pickupBy: v.optional(v.string()),
        pickupProgress: v.optional(v.number()),
        droppedAt: v.optional(v.number()),
        homeX: v.optional(v.number()),
        homeZ: v.optional(v.number()),
      }),
    ),
  ),
  // Optional: sectors stored before tech sites have none.
  sites: v.optional(
    v.array(
      v.object({
        id: v.string(),
        kind: v.union(
          v.literal('derrick'),
          v.literal('fieldHospital'),
          v.literal('airstrip'),
        ),
        name: v.string(),
        x: v.number(),
        z: v.number(),
        angle: v.number(),
        hp: v.number(),
        team: v.optional(v.union(v.literal('blue'), v.literal('red'))),
        holder: v.optional(v.string()),
        capturing: v.optional(v.union(v.literal('blue'), v.literal('red'))),
        progress: v.number(),
        contested: v.optional(v.boolean()),
        heldAt: v.optional(v.number()),
        pulseAt: v.optional(v.number()),
        squad: v.optional(v.array(v.string())),
        alertAt: v.optional(v.number()),
      }),
    ),
  ),
  recon: v.optional(
    v.array(
      v.object({
        id: v.string(),
        team: v.union(v.literal('blue'), v.literal('red')),
        owner: v.string(),
        site: v.string(),
        fromX: v.number(),
        fromZ: v.number(),
        toX: v.number(),
        toZ: v.number(),
        exitX: v.number(),
        exitZ: v.number(),
        launchedAt: v.number(),
        arriveAt: v.number(),
        leaveAt: v.number(),
        goneAt: v.number(),
      }),
    ),
  ),
  deposits: v.optional(
    v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        x: v.number(),
        z: v.number(),
        amount: v.number(),
        capacity: v.number(),
      }),
    ),
  ),
  // Optional: sectors stored before superweapons have none.
  superweapons: v.optional(
    v.array(
      v.object({
        id: v.string(),
        owner: v.string(),
        team: v.union(v.literal('blue'), v.literal('red')),
        kind: superweaponKind,
        x: v.number(),
        z: v.number(),
        charge: v.number(),
        paused: v.optional(v.boolean()),
        warned: v.optional(v.boolean()),
      }),
    ),
  ),
  strikes: v.optional(
    v.array(
      v.object({
        id: v.string(),
        owner: v.string(),
        team: v.union(v.literal('blue'), v.literal('red')),
        kind: superweaponKind,
        x: v.number(),
        z: v.number(),
        radius: v.number(),
        launchedAt: v.number(),
        impactAt: v.number(),
        until: v.number(),
        landed: v.optional(v.boolean()),
        struck: v.optional(
          v.array(v.object({ id: v.string(), damage: v.number() })),
        ),
      }),
    ),
  ),
  events: v.array(
    v.object({
      at: v.number(),
      text: v.string(),
      kind: v.union(
        v.literal('info'),
        v.literal('combat'),
        v.literal('success'),
      ),
    }),
  ),
  status: v.union(
    v.literal('active'),
    v.literal('victory'),
    v.literal('defeat'),
  ),
  tickAt: v.number(),
  startedAt: v.number(),
  nextWaveAt: v.number(),
  wave: v.number(),
  serial: v.number(),
  mapVersion: v.optional(v.number()),
  mapScale: v.optional(v.number()),
  playerSlots: v.optional(v.number()),
};
