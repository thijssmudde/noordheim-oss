/**
 * Commander factions. Every task force fields the same equipment roster; a
 * faction sets identification paint, callsigns and a doctrine that bends the
 * shared rules in one direction. Multipliers of 1 leave a rule untouched.
 */
export type Doctrine = {
  name: string;
  summary: string;
  /** Player-facing perk lines, in the order the join screen lists them. */
  perks: readonly string[];
  /** Multiplier on troop training time; lower is faster. */
  training: number;
  /** Multiplier on ground and air unit speed. */
  speed: number;
  /** Multiplier on structure prices. */
  structureCost: number;
  /** Multiplier on infantry prices. */
  infantryCost: number;
  /** Multiplier on damage dealt by defensive structures. */
  defenseDamage: number;
  /** Multiplier on harvester cargo capacity. */
  cargo: number;
  /** Multiplier on harvester loading speed. */
  load: number;
  /** Multiplier on sight range for units and structures. */
  vision: number;
};
export const NEUTRAL_DOCTRINE: Doctrine = {
  name: 'Standard doctrine',
  summary: 'Shared equipment, shared rules.',
  perks: [],
  training: 1,
  speed: 1,
  structureCost: 1,
  infantryCost: 1,
  defenseDamage: 1,
  cargo: 1,
  load: 1,
  vision: 1,
};
export const CULTURES = {
  fjordborn: {
    name: 'Fjordborn',
    title: 'Coastal raiders',
    description:
      'Raiding parties from the outer skerries. Sea-blue panels, quick over snow and shingle.',
    color: '#547c86',
    doctrine: {
      ...NEUTRAL_DOCTRINE,
      name: 'Raiding doctrine',
      summary: 'Fast to muster, fast to move. Built for early pressure.',
      perks: ['Troops train 20% faster', 'Units move 10% faster'],
      training: 0.8,
      speed: 1.1,
    },
  },
  ironclad: {
    name: 'Ironclad',
    title: 'Mountain garrison',
    description:
      'Fortress engineers from the high passes. Slate-violet paint, patient under fire.',
    color: '#897385',
    doctrine: {
      ...NEUTRAL_DOCTRINE,
      name: 'Fortress doctrine',
      summary: 'Cheap concrete and heavier guns. Built to hold ground.',
      perks: [
        'Structures cost 15% less',
        'Sentries and batteries hit 20% harder',
      ],
      structureCost: 0.85,
      defenseDamage: 1.2,
    },
  },
  hearthkin: {
    name: 'Hearthkin',
    title: 'Valley logistics corps',
    description:
      'Supply columns from the farming valleys. Moss-green stripes, always harvesting.',
    color: '#8b994d',
    doctrine: {
      ...NEUTRAL_DOCTRINE,
      name: 'Supply doctrine',
      summary: 'Bigger loads, faster drills. Built to outproduce.',
      perks: ['Harvesters carry 30% more ore', 'Harvesters load 20% faster'],
      cargo: 1.3,
      load: 1.2,
    },
  },
  ashwalkers: {
    name: 'Ashwalkers',
    title: 'Forest reconnaissance',
    description:
      'Scouts and forward observers from the burnt woods. Ember-orange marks, first to see.',
    color: '#b2774f',
    doctrine: {
      ...NEUTRAL_DOCTRINE,
      name: 'Recon doctrine',
      summary:
        'Long sight lines and cheap boots. Built to find the enemy first.',
      perks: ['Sight range 30% longer', 'Infantry cost 15% less'],
      vision: 1.3,
      infantryCost: 0.85,
    },
  },
} as const satisfies Record<
  string,
  {
    name: string;
    title: string;
    description: string;
    color: string;
    doctrine: Doctrine;
  }
>;
export type Culture = keyof typeof CULTURES;
export const cultureKeys = Object.keys(CULTURES) as Culture[];
export const isCulture = (value: string): value is Culture => value in CULTURES;
/** The doctrine for a commander's culture; unknown or legacy cultures get the neutral rules. */
export const doctrineOf = (culture: string | undefined): Doctrine =>
  culture && isCulture(culture) ? CULTURES[culture].doctrine : NEUTRAL_DOCTRINE;
