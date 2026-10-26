/**
 * Operation-wide rules; every commander joining a sector shares these settings.
 * `guards` is the home guard each hostile army raises before it sends columns;
 * `production` multiplies hostile training times, so harder garrisons rearm faster;
 * `mobilisation` shortens them further per column launched (to at most half),
 * so later columns keep growing instead of plateauing at the opening rate.
 * `veterancy` is the hostile damage bonus gained per column launched (capped at
 * +50%), `columns` how many armies may march on the same cadence, and `raids`
 * the chance a column targets refineries, plants and outposts instead of a
 * command station. The flag knobs set how the AI fights over flags: `flagReach`
 * (metres) and `flagHunters` bound who hunts a carrier holding its flag or
 * retrieves a dropped one, and `flagDutyMs` is how often it reconsiders
 * (0: every update), so Easy reacts late and thinly and Brutal at once.
 * `mast` raises a Weather Mast beside each hostile command station and
 * `mastSeconds` is how long its blizzard takes to charge.
 * Tech sites: every `siteDutyMs` an army with troops to spare sends a
 * `siteSquad`-strong infantry detachment to take (and then guard) a site it
 * does not hold, so Easy rarely contests them and Brutal keeps coming.
 */
export const DIFFICULTIES = {
  easy: {
    name: 'Easy',
    description: 'Room to build. Light garrisons and slower counterattacks.',
    credits: 2200,
    firstWaveMs: 240000,
    waveIntervalMs: 210000,
    waveScale: 0.7,
    escalation: 0,
    guards: 2,
    defenses: 2,
    production: 1.5,
    mobilisation: 0,
    veterancy: 0,
    columns: 1,
    raids: 0,
    flagReach: 45,
    flagHunters: 2,
    flagDutyMs: 6000,
    mast: false,
    mastSeconds: 900,
    siteDutyMs: 240000,
    siteSquad: 2,
  },
  normal: {
    name: 'Normal',
    description: 'A steady garrison that raids your ore and hardens with time.',
    credits: 1500,
    firstWaveMs: 150000,
    waveIntervalMs: 120000,
    waveScale: 1,
    escalation: 1,
    guards: 4,
    defenses: 5,
    production: 1,
    mobilisation: 0.02,
    veterancy: 0.03,
    columns: 1,
    raids: 0.25,
    flagReach: 75,
    flagHunters: 4,
    flagDutyMs: 2000,
    mast: true,
    mastSeconds: 600,
    siteDutyMs: 90000,
    siteSquad: 3,
  },
  hard: {
    name: 'Hard',
    description:
      'Fortified bases, early armor, twin columns, and little time to settle.',
    credits: 1250,
    firstWaveMs: 135000,
    waveIntervalMs: 95000,
    waveScale: 1.4,
    escalation: 3,
    guards: 6,
    defenses: 8,
    production: 0.8,
    mobilisation: 0.04,
    veterancy: 0.05,
    columns: 2,
    raids: 0.35,
    flagReach: 120,
    flagHunters: 8,
    flagDutyMs: 750,
    mast: true,
    mastSeconds: 480,
    siteDutyMs: 45000,
    siteSquad: 4,
  },
  brutal: {
    name: 'Brutal',
    description:
      'Heavy defenses, veteran troops and relentless multi-pronged attacks. Bring allies.',
    credits: 1250,
    firstWaveMs: 120000,
    waveIntervalMs: 75000,
    waveScale: 1.7,
    escalation: 6,
    guards: 8,
    defenses: 10,
    production: 0.6,
    mobilisation: 0.06,
    veterancy: 0.07,
    columns: 3,
    raids: 0.4,
    flagReach: 170,
    flagHunters: 16,
    flagDutyMs: 0,
    mast: true,
    mastSeconds: 360,
    siteDutyMs: 15000,
    siteSquad: 6,
  },
} as const;
export type Difficulty = keyof typeof DIFFICULTIES;
export const difficultyKeys = Object.keys(DIFFICULTIES) as Difficulty[];
export const difficultyFor = (battle: { difficulty?: Difficulty }) =>
  DIFFICULTIES[battle.difficulty ?? 'normal'];
/**
 * Beyond four garrisons the armies share one home guard's worth of troops and
 * march twice as many columns per wave, so eight enemies hit about twice as hard as four on
 * any difficulty instead of idling at home under the shared troop budget.
 */
export const crowdFor = (battle: { enemyCount?: number }) =>
  Math.max(1, (battle.enemyCount ?? 1) / 4);
/** Home guard each army raises before it sends columns. */
export const guardsFor = (battle: {
  difficulty?: Difficulty;
  enemyCount?: number;
}) =>
  Math.max(
    2,
    Math.round((difficultyFor(battle).guards + 2) / crowdFor(battle)),
  );
/** Armies that may march on the same cadence. */
export const columnsFor = (battle: {
  difficulty?: Difficulty;
  enemyCount?: number;
}) => Math.round(difficultyFor(battle).columns * crowdFor(battle));
/** Hostile training time multiplier after `wave` columns have marched. */
export const productionFor = (battle: {
  difficulty?: Difficulty;
  wave: number;
}) => {
  const rules = difficultyFor(battle);
  return rules.production * Math.max(0.5, 1 - rules.mobilisation * battle.wave);
};
/** Hostile damage multiplier after `wave` columns have marched. */
export const veterancyFor = (battle: {
  difficulty?: Difficulty;
  wave: number;
}) => 1 + Math.min(0.5, difficultyFor(battle).veterancy * battle.wave);

/** A local stream, never shared mutable RNG state between operations or clients. */
export function operationRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
