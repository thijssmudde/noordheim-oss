import {
  joinBattle,
  makeEntity,
  SUPERWEAPONS,
  type Battle,
  type EntityKind,
  type Point,
} from '../../lib/tactics';
import {
  chargeMs,
  superweaponOf,
  type SuperweaponKind,
} from '../../lib/tactical-superweapons';
import { terrainFor } from '../../lib/tactical-terrain';

/**
 * Development staging for the interface review (`/?uiReview=hud&sw=...`):
 * superweapons, countdowns and strikes on the local fixture battle. Never
 * shipped: only the development-only review page imports it.
 *
 *   sw=<culture>|gallery   the viewer's own superweapon, or every structure on show
 *   swState=charging|paused|ready
 *   strike=<kind>          a strike landing beside the base (pin its clock with strikeT=)
 *   ally=1                 an allied commander and the garrison's mast, for countdowns
 *   warn=ally|mast         one of them reaches its one-minute warning after warnAt seconds (3)
 */
export type SuperweaponStage = {
  sw?: string;
  swState?: string;
  strike?: string;
  ally?: boolean;
  warn?: string;
  /** Second of the fixture's clock the warning lands on (default 3). */
  warnAt?: number;
};
const ALLY = 'review-ally';
function put(
  b: Battle,
  kind: EntityKind,
  owner: string,
  team: 'blue' | 'red',
  p: Point,
) {
  const e = makeEntity(b, kind, owner, team, p);
  b.entities.push(e);
  return e;
}
function record(b: Battle, id: string, kind: SuperweaponKind, charge: number) {
  const e = b.entities.find((e) => e.id === id)!;
  (b.superweapons ??= []).push({
    id,
    owner: e.owner,
    team: e.team,
    kind,
    x: e.x,
    z: e.z,
    charge,
  });
  return b.superweapons.at(-1)!;
}
export function stageSuperweapons(
  b: Battle,
  viewer: string,
  stage: SuperweaponStage,
) {
  const terrain = terrainFor(b),
    home = terrain.baseAt(b.commanders[0].slot);
  const at = (dx: number, dz: number) => ({ x: home.x + dx, z: home.z + dz });
  b.superweapons = [];
  const viewerCommander = b.commanders.find((c) => c.id === viewer)!;
  viewerCommander.research = ['clearance2', 'clearance3'];
  // Plenty of power so nothing pauses unless asked to.
  put(b, 'plant', viewer, 'blue', at(-30, 10));
  if (stage.sw === 'gallery') {
    // Every superweapon structure around the command station, in place of the starter base.
    b.entities = b.entities.filter(
      (e) =>
        e.owner !== viewer ||
        !['refinery', 'reactor', 'barracks', 'factory'].includes(e.kind),
    );
    const spots: [SuperweaponKind, number, number][] = [
      ['airstrip', 40, -16],
      ['weathermast', -16, -40],
      ['cannon', 14, -42],
      ['boathouse', -32, -4],
      ['launcher', 36, 14],
    ];
    for (const [kind, dx, dz] of spots) {
      const red = kind === 'weathermast';
      const e = put(
        b,
        kind,
        red ? 'hostile-1' : viewer,
        red ? 'red' : 'blue',
        at(dx, dz),
      );
      e.angle = Math.PI;
      // A sentry beside each one keeps it in sight.
      put(b, 'ranger', viewer, 'blue', at(dx + 6, dz + 10)).order = 'hold';
    }
    b.entities = b.entities.filter((e) => e.kind !== 'plant');
    return b;
  }
  const culture = stage.sw ?? viewerCommander.culture;
  viewerCommander.culture = culture;
  const kind = superweaponOf(culture);
  if (kind) {
    const e = put(b, kind, viewer, 'blue', at(30, 12));
    e.angle = Math.PI;
    const full = chargeMs(b, kind);
    const s = record(
      b,
      e.id,
      kind,
      stage.swState === 'ready'
        ? full
        : stage.swState === 'paused'
          ? full * 0.42
          : full * 0.63,
    );
    if (stage.swState === 'paused') s.paused = true;
    if (stage.swState === 'ready') s.warned = true;
  }
  if (stage.ally) {
    joinBattle(b, { id: ALLY, name: 'Runa', culture: 'hearthkin' }, b.tickAt);
    const ally = b.commanders.find((c) => c.id === ALLY)!;
    ally.research = ['clearance2', 'clearance3'];
    const strip = put(b, 'airstrip', ALLY, 'blue', terrain.baseAt(ally.slot));
    record(b, strip.id, 'airstrip', chargeMs(b, 'airstrip') - 64_000);
    const mast = b.entities.find((e) => e.kind === 'weathermast');
    if (mast)
      record(b, mast.id, 'weathermast', chargeMs(b, 'weathermast') - 64_000);
  }
  if (stage.strike && stage.strike in SUPERWEAPONS) {
    const strikeKind = stage.strike as SuperweaponKind;
    const red = strikeKind === 'weathermast';
    // Friendly weapons hit hostiles staged in front of the base; the blizzard hits the base.
    const target = at(red ? 0 : 18, red ? 14 : 4);
    if (!red)
      for (const [k, dx, dz] of [
        ['ranger', -6, -2],
        ['ranger', 4, 3],
        ['tank', 8, -6],
        ['lynx', -10, 6],
      ] as [EntityKind, number, number][])
        put(b, k, 'hostile-1', 'red', { x: target.x + dx, z: target.z + dz });
    const rules = SUPERWEAPONS[strikeKind];
    (b.strikes ??= []).push({
      id: `review-${strikeKind}`,
      owner: red ? 'hostile-1' : viewer,
      team: red ? 'red' : 'blue',
      kind: strikeKind,
      ...target,
      radius: rules.radius,
      launchedAt: b.tickAt,
      impactAt: b.tickAt + rules.telegraphSeconds * 1000,
      until: b.tickAt + 120_000,
      landed: true,
    });
    if (red)
      for (const e of b.entities)
        if (
          e.team === 'blue' &&
          Math.hypot(e.x - target.x, e.z - target.z) <= rules.radius &&
          e.kind in { ranger: 1, lynx: 1, tank: 1, harvester: 1 }
        )
          e.frozenUntil = b.tickAt + 120_000;
  }
  return b;
}
/** The fixture's next snapshot: after three seconds one weapon crosses its warning. */
export function warnSnapshot<B extends Battle>(
  b: B,
  stage: SuperweaponStage,
  second: number,
): B {
  if (!stage.warn || second !== (stage.warnAt ?? 3)) return b;
  return {
    ...b,
    superweapons: (b.superweapons ?? []).map((s) =>
      (stage.warn === 'mast' ? s.team === 'red' : s.owner === ALLY)
        ? { ...s, warned: true, charge: chargeMs(b, s.kind) - 59_000 }
        : s,
    ),
  };
}
