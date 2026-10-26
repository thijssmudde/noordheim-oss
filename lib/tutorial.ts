/**
 * The first-match tutorial: six objectives a new commander works through,
 * each completed by what the battle shows (a plant standing, troops in
 * training) or by what the commander did (an order given). Pure, so the HUD
 * derives the current step in render and the rules can be tested.
 */
import {
  isHarvester,
  isProducer,
  isUnit,
  type Battle,
  type BuildingKind,
  type UnitKind,
} from './tactics';
import { skirmishRules } from './skirmish-modes';

export type TutorialStepId =
  | 'power'
  | 'refinery'
  | 'barracks'
  | 'train'
  | 'command'
  | 'victory';

export type TutorialStep = {
  id: TutorialStepId;
  title: string;
  detail: string;
  /** The sidebar blueprint this step asks for, highlighted while it is current. */
  target?: {
    tab: 'structures' | 'infantry';
    kind: BuildingKind | UnitKind;
  };
};

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'power',
    title: 'Build a power plant',
    detail:
      'Open Structures, choose Geothermal plant, then click clear land near your command station.',
    target: { tab: 'structures', kind: 'reactor' },
  },
  {
    id: 'refinery',
    title: 'Build an ore refinery',
    detail:
      'It comes with a harvester that mines ore and brings in credits on its own.',
    target: { tab: 'structures', kind: 'refinery' },
  },
  {
    id: 'barracks',
    title: 'Build a Jæger hall',
    detail: 'Your barracks. It trains infantry.',
    target: { tab: 'structures', kind: 'barracks' },
  },
  {
    id: 'train',
    title: 'Train troops',
    detail:
      'Open Infantry and click Jæger patrol. New troops walk out of the hall.',
    target: { tab: 'infantry', kind: 'ranger' },
  },
  {
    id: 'command',
    title: 'Move your army',
    detail:
      'Drag a box around your troops (or tap one), then click land to move or an enemy to attack.',
  },
  {
    id: 'victory',
    title: 'Capture every enemy flag',
    detail:
      'Find the enemy base, keep a ground troop at its flag to pick it up, then carry it back to your own flag.',
  },
];

/** Without ore the economy step asks for a derrick instead of a refinery. */
const OIL_STEP: TutorialStep = {
  id: 'refinery',
  title: 'Take an oil derrick',
  detail:
    'No ore here, so no harvesters. Walk infantry into a neutral derrick’s ring and hold it: derricks are your only income.',
};
/** The objectives for this battle's skirmish mode, in the same six slots. */
export const tutorialSteps = (
  b: Pick<Battle, 'skirmish'>,
): readonly TutorialStep[] =>
  skirmishRules(b).ore
    ? TUTORIAL_STEPS
    : TUTORIAL_STEPS.map((s) => (s.id === 'refinery' ? OIL_STEP : s));

/** What the commander has done that the battle state cannot show. */
export type TutorialActions = { trained: boolean; commanded: boolean };

/** Which objectives the battle shows as met, for one commander. */
export function tutorialFacts(
  b: Pick<Battle, 'entities' | 'training' | 'status' | 'flags'> &
    Partial<Pick<Battle, 'sites' | 'skirmish'>>,
  owner: string,
  actions: TutorialActions,
): Record<TutorialStepId, boolean> {
  const built = (match: (kind: BuildingKind) => boolean) =>
    b.entities.some(
      (e) =>
        e.owner === owner &&
        e.hp > 0 &&
        !e.readyAt &&
        !isUnit(e.kind) &&
        match(e.kind),
    );
  return {
    power: built((k) => k === 'reactor'),
    // Without ore: a derrick taken beyond the one held from the start.
    refinery: skirmishRules(b).ore
      ? built((k) => k === 'refinery')
      : (b.sites ?? []).filter(
          (s) => s.kind === 'derrick' && s.holder === owner,
        ).length >= 2,
    barracks: built(isProducer),
    train:
      actions.trained ||
      (b.training ?? []).some((q) => q.owner === owner && !isHarvester(q.kind)),
    command: actions.commanded,
    victory: b.status === 'victory',
  };
}

/**
 * The step to show: the first one not yet met, never before `floor` (steps the
 * commander skipped with Next). A later objective met counts the earlier ones
 * done, so a plant lost to a raid does not send the tutorial back.
 */
export function tutorialStep(
  facts: Record<TutorialStepId, boolean>,
  floor = 0,
) {
  let reached = 0;
  TUTORIAL_STEPS.forEach((s, i) => {
    if (facts[s.id]) reached = i + 1;
  });
  return Math.min(Math.max(reached, floor), TUTORIAL_STEPS.length - 1);
}

/** Saved tutorial progress; floor and actions belong to one sector. */
export type TutorialProgress = {
  status: 'new' | 'active' | 'done' | 'skipped';
  sector?: string;
  floor: number;
  trained: boolean;
  commanded: boolean;
};
export const NEW_TUTORIAL: TutorialProgress = {
  status: 'new',
  floor: 0,
  trained: false,
  commanded: false,
};

export function parseTutorial(raw: string | null): TutorialProgress {
  try {
    const stored = JSON.parse(raw ?? 'null') as Partial<TutorialProgress>;
    if (!stored || typeof stored !== 'object') return NEW_TUTORIAL;
    return {
      status: ['new', 'active', 'done', 'skipped'].includes(
        stored.status as string,
      )
        ? stored.status!
        : 'new',
      sector: typeof stored.sector === 'string' ? stored.sector : undefined,
      floor:
        Number.isInteger(stored.floor) && stored.floor! >= 0
          ? Math.min(stored.floor!, TUTORIAL_STEPS.length - 1)
          : 0,
      trained: stored.trained === true,
      commanded: stored.commanded === true,
    };
  } catch {
    return NEW_TUTORIAL;
  }
}

/** Progress as it applies to this sector: another sector's floor and actions do not carry over. */
export function progressIn(
  progress: TutorialProgress,
  sector: string | undefined,
): TutorialProgress {
  return progress.sector === sector
    ? progress
    : { ...progress, sector, floor: 0, trained: false, commanded: false };
}

/** Whether the coach shows: on its own for a first solo match, or after a restart. */
export function tutorialVisible(
  progress: TutorialProgress,
  mode: 'solo' | 'coop' | undefined,
) {
  return (
    progress.status === 'active' ||
    (progress.status === 'new' && mode === 'solo')
  );
}
