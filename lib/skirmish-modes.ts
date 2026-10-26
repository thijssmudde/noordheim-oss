/**
 * Skirmish missions: solo game modes layered over the standard rules. Each
 * mode is a row of rule overrides read by world generation (lib/tactical-world.ts),
 * the economy and the garrison AI (lib/tactics.ts), and the launcher and HUD.
 * A new mode is a row here plus whatever small hook its rules need.
 *
 * `ore` keeps seams, refineries and harvesters; without it every seam the map
 * draws (home seams beside the landings, the design's expedition seams and the
 * seam by each stronghold) becomes an oil derrick instead, and `locked`
 * blueprints and research leave the build menu. `homeDerricks` hands each
 * side the derrick beside its own base from the start. `creditScale` scales
 * the difficulty's starting credits and `derrickIncome` is what a derrick
 * pays per pulse. `requires` re-chains blueprints whose prerequisite is
 * locked. `garrison` funds the hostile armies: they start with `credits`,
 * draw `stipend` per second from each command station and derrick pay from
 * the derricks they hold, both divided by the difficulty's production scale,
 * and pay each troop's price before training it; with more than
 * `rushReserve` to spare an army pays double to train a troop in half the
 * time, so oil it holds turns into a faster stream of troops. Without
 * `garrison` the garrison is unfunded and a derrick only hastens its
 * production lines. The site knobs
 * make the garrison contest sites harder: `siteDutyScale` shortens the
 * difficulty's `siteDutyMs`, `siteSquadBonus` adds infantry to each
 * detachment and `siteGuardShare` is the part of the home guard a
 * detachment may draw on.
 */
import type { BuildingKind, EntityKind, ResearchKey } from './tactics';

export type SkirmishRules = {
  ore: boolean;
  homeDerricks: boolean;
  creditScale: number;
  derrickIncome: number;
  locked: readonly EntityKind[];
  lockedResearch: readonly ResearchKey[];
  requires: Partial<Record<BuildingKind, BuildingKind>>;
  garrison?: { credits: number; stipend: number; rushReserve: number };
  siteDutyScale: number;
  siteSquadBonus: number;
  siteGuardShare: number;
  /** Tech-site kinds the garrison goes for first. */
  sitePriority: readonly ('derrick' | 'fieldHospital' | 'airstrip')[];
};

export const SKIRMISH_MODES = {
  standard: {
    name: 'Standard',
    tagline: 'Harvest ore',
    picture: '/art/interface/mission-standard.webp',
    description:
      'Mine ore with harvesters, take tech sites for an edge and capture every enemy flag.',
    rules: {
      ore: true,
      homeDerricks: false,
      creditScale: 1,
      derrickIncome: 240,
      locked: [],
      lockedResearch: [],
      requires: {},
      siteDutyScale: 1,
      siteSquadBonus: 0,
      siteGuardShare: 0,
      sitePriority: [],
    },
  },
  megawealth: {
    name: 'Megawealth',
    tagline: 'Oil is money',
    picture: '/art/interface/mission-megawealth.webp',
    description:
      'No ore and no harvesters. Every seam is an oil derrick, and derricks are your only income. Hold ground or go broke.',
    rules: {
      ore: false,
      homeDerricks: true,
      creditScale: 2,
      derrickIncome: 300,
      locked: ['refinery', 'harvester'],
      lockedResearch: ['logistics', 'drills'],
      // The vehicle works no longer waits on a refinery nobody can build.
      requires: { factory: 'barracks' },
      garrison: { credits: 2000, stipend: 6, rushReserve: 1500 },
      siteDutyScale: 0.35,
      siteSquadBonus: 1,
      siteGuardShare: 0.5,
      sitePriority: ['derrick'],
    },
  },
} as const satisfies Record<
  string,
  {
    name: string;
    tagline: string;
    /** The launcher card's picture: a refinery with its harvester, or a derrick. */
    picture: string;
    description: string;
    rules: SkirmishRules;
  }
>;
export type SkirmishMode = keyof typeof SKIRMISH_MODES;
export const skirmishModes = Object.keys(SKIRMISH_MODES) as SkirmishMode[];
export const DEFAULT_SKIRMISH_MODE: SkirmishMode = 'standard';
export const isSkirmishMode = (mode: unknown): mode is SkirmishMode =>
  typeof mode === 'string' && mode in SKIRMISH_MODES;
/** The rules a battle runs under; operations from before modes are standard. */
export const skirmishRules = (b: { skirmish?: SkirmishMode }): SkirmishRules =>
  SKIRMISH_MODES[b.skirmish ?? DEFAULT_SKIRMISH_MODE].rules;
export const skirmishName = (b: { skirmish?: SkirmishMode }) =>
  SKIRMISH_MODES[b.skirmish ?? DEFAULT_SKIRMISH_MODE].name;
