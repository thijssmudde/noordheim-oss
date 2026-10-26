import type { Footprint } from './tactical-placement';
import type { Point, TechSiteDesign, TechSiteKind } from './maps/types';
export type { TechSiteDesign, TechSiteKind } from './maps/types';

/**
 * Neutral tech sites. Each map plants a few capturable structures at its
 * contested midpoints. Infantry take a site by standing in its capture ring
 * for `captureSeconds` with no enemy ground troops inside; a contested ring
 * pauses the count. The holding side (the whole coalition, or the garrison)
 * draws the site's bonus. Sites take fire but never fall: at 0 HP a site
 * reverts to neutral at full strength.
 */
export type SiteTeam = 'blue' | 'red';
export type TechSite = Point & {
  id: string;
  kind: TechSiteKind;
  name: string;
  /** Heading of the model, radians. */
  angle: number;
  hp: number;
  /** The side holding the site; absent while neutral. */
  team?: SiteTeam;
  /** The commander or hostile army that took it: derrick pay and recon planes go here. */
  holder?: string;
  /** The side whose infantry are taking it, and their seconds in the ring so far. */
  capturing?: SiteTeam;
  progress: number;
  /** Both sides have ground troops in the ring: the count is paused. */
  contested?: boolean;
  heldAt?: number;
  /** Next derrick payout or recon launch while held. */
  pulseAt?: number;
  /** Hostile troops detached to take or hold this site. */
  squad?: string[];
  /** Whose home derrick this is (a skirmish mode without ore); see TechSiteDesign. */
  home?: string;
  /** Last "under attack" log line, so the log is not flooded. */
  alertAt?: number;
};
/** An unarmed recon plane from an airstrip: its flight is a pure function of time. */
export type ReconFlight = {
  id: string;
  team: SiteTeam;
  owner: string;
  site: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  exitX: number;
  exitZ: number;
  launchedAt: number;
  arriveAt: number;
  leaveAt: number;
  goneAt: number;
};

/** Rules every site shares. */
export const SITE_RULES = {
  /** Infantry inside this ring take the site, metres from its centre. */
  captureRadius: 14,
  /** Uncontested seconds needed to take a site. */
  captureSeconds: 6,
  /** Progress lost per second once the takers leave or the holder returns. */
  drainPerSecond: 1,
  /** Minimum time between two "under attack" lines for one site. */
  alertMs: 15000,
  /** A held site watches this far around it for the whole holding side. */
  vision: 30,
} as const;

/**
 * Per-kind balance. A derrick pays its holder `income` credits every
 * `pulseSeconds` (24/s: about what one harvester delivers from a home
 * seam); the garrison has no credits, so a hostile derrick instead
 * shaves `hostileHasteSeconds` off each production line of its holder.
 * A field hospital restores `healPerSecond` of its holder side's infantry
 * per second within `healRadius`, in or out of a fight. An airstrip launches
 * a free recon plane `firstPlaneSeconds` after capture and then every
 * `planeSeconds`; it flies at `planeSpeed` to the holder's rally point (or
 * the map centre), circles for `loiterSeconds` revealing `reconVision` metres
 * of fog, then leaves the map.
 */
export const TECH_SITES = {
  derrick: {
    name: 'Oil derrick',
    description: 'Pays its holder 240 credits every 10 seconds.',
    bonus: '+240 credits every 10 s',
    hp: 2400,
    footprint: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    income: 240,
    pulseSeconds: 10,
    hostileHasteSeconds: 4,
  },
  fieldHospital: {
    name: 'Field hospital',
    description: "Heals the holder's infantry within 25 m, even under fire.",
    bonus: 'infantry within 25 m heal',
    hp: 2200,
    footprint: { minX: -5.5, maxX: 5.5, minZ: -5, maxZ: 5 },
    healRadius: 25,
    healPerSecond: 0.025,
  },
  airstrip: {
    name: 'Airstrip',
    description:
      'Launches a free recon plane over the rally point every 3 minutes.',
    bonus: 'a recon plane every 3 min',
    hp: 2000,
    footprint: { minX: -6, maxX: 6, minZ: -5.5, maxZ: 5.5 },
    firstPlaneSeconds: 20,
    planeSeconds: 180,
    planeSpeed: 30,
    loiterSeconds: 45,
    loiterRadius: 16,
    reconVision: 55,
  },
} as const;
type SiteSpec = {
  name: string;
  description: string;
  /** Short form for the event log. */
  bonus: string;
  hp: number;
  footprint: Footprint;
};
/** The rules every kind shares, checked against the table above. */
const SPECS: Record<TechSiteKind, SiteSpec> = TECH_SITES;
export const techSiteKinds = Object.keys(TECH_SITES) as TechSiteKind[];
export const isTechSiteKind = (kind: unknown): kind is TechSiteKind =>
  typeof kind === 'string' && kind in TECH_SITES;

/** A fresh, neutral site for each one a map design plants. */
export function createSites(designs: readonly TechSiteDesign[]): TechSite[] {
  return designs.map((d, i) => ({
    id: `site-${i + 1}`,
    kind: d.kind,
    name: d.name,
    x: d.x,
    z: d.z,
    angle: d.angle ?? 0,
    hp: SPECS[d.kind].hp,
    progress: 0,
    ...(d.home && { home: d.home }),
  }));
}
/** Ground the site's structure covers; troops walk around it and nothing builds on it. */
export function siteFootprint(
  site: Pick<TechSite, 'kind' | 'x' | 'z' | 'angle'>,
): Footprint {
  const b = SPECS[site.kind].footprint,
    c = Math.cos(site.angle),
    s = Math.sin(site.angle);
  const xs: number[] = [],
    zs: number[] = [];
  for (const [x, z] of [
    [b.minX, b.minZ],
    [b.minX, b.maxZ],
    [b.maxX, b.minZ],
    [b.maxX, b.maxZ],
  ]) {
    xs.push(site.x + x * c + z * s);
    zs.push(site.z - x * s + z * c);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}
/** Distance from `p` to the nearest point of the site's structure. */
export function siteReach(site: TechSite, p: Point) {
  const box = siteFootprint(site);
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX),
    dz = Math.max(box.minZ - p.z, 0, p.z - box.maxZ);
  return Math.hypot(dx, dz);
}
export const siteSpec = (site: Pick<TechSite, 'kind'>) => SPECS[site.kind];
/** Capture progress, 0..1. */
export const captureShare = (site: Pick<TechSite, 'progress'>) =>
  Math.min(1, site.progress / SITE_RULES.captureSeconds);

/**
 * A recon flight: out to `to`, round it for the loiter, then off the map.
 * The Convex tick and every browser compute the same position from time alone.
 */
export function reconPosition(f: ReconFlight, at: number) {
  const r = TECH_SITES.airstrip.loiterRadius,
    speed = TECH_SITES.airstrip.planeSpeed;
  const inbound = Math.atan2(f.toX - f.fromX, f.toZ - f.fromZ);
  if (at <= f.arriveAt) {
    const t =
      f.arriveAt > f.launchedAt
        ? Math.max(0, (at - f.launchedAt) / (f.arriveAt - f.launchedAt))
        : 1;
    return {
      x: f.fromX + (f.toX - f.fromX) * t,
      z: f.fromZ + (f.toZ - f.fromZ) * t,
      heading: inbound,
    };
  }
  // The circuit starts where the plane arrives, turning clockwise round `to`.
  const circle = (time: number) => {
    const a =
      inbound - Math.PI / 2 + ((time - f.arriveAt) / 1000) * (speed / r);
    return {
      x: f.toX + Math.sin(a) * r,
      z: f.toZ + Math.cos(a) * r,
      heading: a + Math.PI / 2,
    };
  };
  if (at <= f.leaveAt) {
    const p = circle(at);
    // Ease from the inbound line onto the circle over the first quarter turn.
    const blend = Math.min(
      1,
      (at - f.arriveAt) / ((Math.PI / 2) * (r / speed) * 1000),
    );
    return {
      x: f.toX + (p.x - f.toX) * blend,
      z: f.toZ + (p.z - f.toZ) * blend,
      heading: p.heading,
    };
  }
  const start = circle(f.leaveAt);
  const t =
    f.goneAt > f.leaveAt
      ? Math.min(1, (at - f.leaveAt) / (f.goneAt - f.leaveAt))
      : 1;
  return {
    x: start.x + (f.exitX - start.x) * t,
    z: start.z + (f.exitZ - start.z) * t,
    heading: Math.atan2(f.exitX - start.x, f.exitZ - start.z),
  };
}
/** Whether a site held by `team` watches over `p`. */
export const siteSees = (
  site: Pick<TechSite, 'team' | 'x' | 'z'>,
  team: SiteTeam,
  p: Point,
) =>
  site.team === team &&
  Math.hypot(site.x - p.x, site.z - p.z) < SITE_RULES.vision;
/** Whether a recon plane is overhead at `at` and sees `p`. */
export function reconSees(f: ReconFlight, at: number, p: Point) {
  if (at < f.launchedAt || at >= f.goneAt) return false;
  const q = reconPosition(f, at);
  return Math.hypot(q.x - p.x, q.z - p.z) < TECH_SITES.airstrip.reconVision;
}
/**
 * Plan a flight from an airstrip to `to`: in at `planeSpeed`, round the loiter,
 * then out past the nearest map edge along the inbound heading.
 */
export function planFlight(
  site: TechSite,
  to: Point,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  now: number,
  id: string,
  team: SiteTeam,
  owner: string,
): ReconFlight {
  const spec = TECH_SITES.airstrip;
  let dx = to.x - site.x,
    dz = to.z - site.z;
  const length = Math.hypot(dx, dz);
  if (length < 1) {
    dx = 0;
    dz = -1;
  } else {
    dx /= length;
    dz /= length;
  }
  // Leave along the inbound heading until the plane is clear of the sector.
  const clear = 30;
  const along = (lo: number, hi: number, p: number, d: number) =>
    d > 0 ? (hi + clear - p) / d : d < 0 ? (lo - clear - p) / d : Infinity;
  const out = Math.min(
    along(bounds.minX, bounds.maxX, to.x, dx),
    along(bounds.minZ, bounds.maxZ, to.z, dz),
  );
  const exit = { x: to.x + dx * out, z: to.z + dz * out };
  const arriveAt = now + (length / spec.planeSpeed) * 1000;
  const leaveAt = arriveAt + spec.loiterSeconds * 1000;
  return {
    id,
    team,
    owner,
    site: site.id,
    fromX: site.x,
    fromZ: site.z,
    toX: to.x,
    toZ: to.z,
    exitX: Math.round(exit.x * 100) / 100,
    exitZ: Math.round(exit.z * 100) / 100,
    launchedAt: now,
    arriveAt: Math.round(arriveAt),
    leaveAt: Math.round(leaveAt),
    // Generous: the exit leg starts from the circuit, at most a loiter radius further.
    goneAt: Math.round(
      leaveAt + ((out + spec.loiterRadius) / spec.planeSpeed) * 1000,
    ),
  };
}
