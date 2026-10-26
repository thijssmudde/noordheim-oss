'use client';
import Image from 'next/image';
import { Check, FlaskConical, Lock, X, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  availability,
  inResearchRoster,
  inRoster,
  requirementOf,
  RESEARCH,
  RESEARCH_TIERS,
  researchAvailability,
  researchBlockReason,
  researchKeys,
  rosterOf,
  signatureOf,
  spec,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  tierOf,
  type Battle,
  type BuildingKind,
  type EntityKind,
  type ResearchKey,
} from '@/lib/tactics';
import { CULTURES, isCulture } from '@/lib/cultures';
import { skirmishRules } from '@/lib/skirmish-modes';

function duration(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** One project runs at a time; active and waiting projects are fully refundable. */
export function ResearchPanel({
  battle,
  owner,
  now,
  busy,
  onCancel,
}: {
  battle: Battle;
  owner: string;
  now: number;
  busy: boolean;
  onCancel: (key: ResearchKey) => void;
}) {
  const c = battle.commanders.find((c) => c.id === owner),
    current = c?.researching,
    pending = [
      ...(current ? [current.key] : []),
      ...(c?.researchQueue ?? []),
    ].filter((key): key is ResearchKey => key in RESEARCH),
    blocked =
      !current && pending.length
        ? researchBlockReason(battle, owner, pending[0])
        : null,
    done = c?.research ?? [];
  const estimates = pending.reduce<number[]>((times, key, i) => {
    times.push(
      i === 0 && current
        ? Math.max(now, current.readyAt)
        : (times[i - 1] ?? now) + RESEARCH[key].seconds * 1000,
    );
    return times;
  }, []);
  return (
    <section
      className="tac-queue tac-research-queue"
      aria-label="Research queue"
    >
      <div className="tac-panel-heading">
        <span>RESEARCH QUEUE</span>
        <span>Tier {c ? tierOf(battle, owner) : 1}</span>
      </div>
      {pending.length ? (
        pending.map((key, i) => {
          const r = RESEARCH[key],
            running = current?.key === key,
            seconds = running ? Math.max(0, (current.readyAt - now) / 1000) : 0;
          return (
            <div key={key} className="tac-queue-item tac-training-item">
              <span className="tac-research-mark">
                <FlaskConical size={18} />
              </span>
              <div>
                <strong>{r.name}</strong>
                <span>
                  {running
                    ? `Researching · ${duration(seconds)} remaining`
                    : i === 0 && blocked
                      ? blocked
                      : `Queued · #${i + 1}`}
                </span>
                {!running && (
                  <span>
                    {blocked
                      ? 'Queue paused until research can resume'
                      : `Finishes in ~${duration((estimates[i] - now) / 1000)}`}
                  </span>
                )}
                {running && (
                  <progress
                    className="tac-training-progress"
                    max={100}
                    aria-label={`${r.name} research`}
                    value={Math.max(
                      0,
                      Math.min(100, 100 - (seconds / r.seconds) * 100),
                    )}
                  />
                )}
              </div>
              <button
                className="tac-cancel-training"
                disabled={busy || battle.status !== 'active'}
                aria-label={`Cancel ${r.name}; refund ${r.cost} credits`}
                title={`Cancel research · Refund ₭ ${r.cost}`}
                onClick={() => onCancel(key)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })
      ) : (
        <p>
          {done.length
            ? `${done.length} of ${researchKeys.length} projects complete.`
            : 'Start with Tier 2 clearance, or select your command station on the map. A research station unlocks the rest.'}
        </p>
      )}
      <p>
        Projects run in order. Credits paid upfront; cancel any unfinished
        project for a full refund.
      </p>
    </section>
  );
}

type TechNode = {
  kind: EntityKind | ResearchKey;
  research?: boolean;
};
const TIERS: { title: string; note: string; nodes: TechNode[] }[] = [
  {
    title: 'Tier 1',
    note: 'Landing zone',
    nodes: [
      { kind: 'reactor' },
      { kind: 'refinery' },
      { kind: 'harvester' },
      { kind: 'barracks' },
      { kind: 'ranger' },
      { kind: 'rocket' },
      { kind: 'factory' },
      { kind: 'lynx' },
      { kind: 'outpost' },
      { kind: 'turret' },
      { kind: 'bunker' },
      { kind: 'hospital' },
      ...RESEARCH_TIERS[1].map((kind) => ({ kind, research: true })),
    ],
  },
  {
    title: 'Tier 2',
    note: 'Clearance from the command station',
    nodes: [
      { kind: 'tank' },
      { kind: 'howitzer' },
      { kind: 'airfield' },
      { kind: 'drone' },
      { kind: 'lab' },
      { kind: 'battery' },
      { kind: 'flak' },
      { kind: 'radar' },
      { kind: 'plant' },
      { kind: 'workshop' },
      ...RESEARCH_TIERS[2].map((kind) => ({ kind, research: true })),
    ],
  },
  {
    title: 'Tier 3',
    note: 'Clearance from the research station',
    nodes: [
      { kind: 'jotun' },
      { kind: 'gunship' },
      ...RESEARCH_TIERS[3].map((kind) => ({ kind, research: true })),
    ],
  },
];
/**
 * The tech tree only exists in the dialog: it evaluates availability for every
 * node, so it must not run on each server tick while the dialog is closed.
 */
export function TechTreeDialog({
  open,
  onOpenChange,
  battle,
  owner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  battle: Battle;
  owner: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tac-help tac-tech-dialog">
        <TechTree battle={battle} owner={owner} />
      </DialogContent>
    </Dialog>
  );
}

function TechTree({ battle, owner }: { battle: Battle; owner: string }) {
  const c = battle.commanders.find((c) => c.id === owner);
  const owned = new Set(
    battle.entities
      .filter((e) => e.owner === owner && e.hp > 0 && !e.readyAt)
      .map((e) => e.kind),
  );
  const culture = c && isCulture(c.culture) ? c.culture : null;
  const signature = culture ? signatureOf(culture) : null;
  const tiers = signature
    ? [
        ...TIERS,
        {
          title: `${CULTURES[culture!].name} signature`,
          note: `Only ${CULTURES[culture!].name} commanders can build these`,
          nodes: [
            { kind: signature.structure },
            ...signature.troops.map((kind) => ({ kind })),
          ] as TechNode[],
        },
      ]
    : TIERS;
  const roster = rosterOf(c?.culture);
  // A skirmish mode without ore leaves refineries, harvesters and their research out.
  const offered = (node: TechNode) =>
    node.research
      ? inResearchRoster(battle, node.kind as ResearchKey)
      : inRoster(battle, owner, node.kind as EntityKind);
  return (
    <>
      <DialogTitle>Northern Command tech tree</DialogTitle>
      <DialogDescription>
        Geothermal power feeds everything.{' '}
        {skirmishRules(battle).ore
          ? 'Refineries and harvesters pay for it.'
          : 'Oil derricks pay for it: there is no ore to mine.'}{' '}
        Clearance tiers unlock heavier equipment; the research station upgrades
        what you already field.
      </DialogDescription>
      <div className="tac-tech-tiers">
        {tiers.map((tier) => (
          <section key={tier.title} className="tac-tech-tier">
            <h3>
              {tier.title}
              <small>{tier.note}</small>
            </h3>
            {tier.nodes.filter(offered).map((node) => {
              const research = node.research
                ? RESEARCH[node.kind as ResearchKey]
                : undefined;
              const s = research ?? spec(node.kind as EntityKind);
              const reason = research
                ? researchAvailability(battle, owner, node.kind as ResearchKey)
                : availability(battle, owner, node.kind as EntityKind);
              const complete = research
                ? c?.research?.includes(node.kind)
                : owned.has(node.kind as EntityKind);
              const requirement = research
                ? `${TACTICAL_BUILDINGS[research.at].name}`
                : node.kind in TACTICAL_UNITS
                  ? TACTICAL_BUILDINGS[
                      TACTICAL_UNITS[node.kind as keyof typeof TACTICAL_UNITS]
                        .producer
                    ].name
                  : requirementOf(battle, node.kind as BuildingKind)
                    ? TACTICAL_BUILDINGS[
                        requirementOf(battle, node.kind as BuildingKind)!
                      ].name
                    : 'Command station';
              return (
                <div
                  key={node.kind}
                  className={`tac-tech-node ${complete ? 'complete' : reason ? 'locked' : 'open'} ${research ? 'research' : ''}`}
                >
                  {research ? (
                    <span className="tac-research-mark">
                      <FlaskConical size={17} />
                    </span>
                  ) : (
                    <Image
                      width={64}
                      height={48}
                      unoptimized
                      className="tac-portrait"
                      src={`/art/tactical/${node.kind}.png`}
                      alt=""
                    />
                  )}
                  <div>
                    <strong>{s.name}</strong>
                    <small>{s.role}</small>
                    <span>
                      <b>₭ {s.cost}</b>
                      <span>{s.seconds}s</span>
                      {!research && (
                        <span>
                          <Zap size={10} />
                          {(s as { power: number }).power}
                        </span>
                      )}
                      <em>via {requirement}</em>
                    </span>
                  </div>
                  <i
                    aria-label={complete ? 'Complete' : (reason ?? 'Available')}
                  >
                    {complete ? (
                      <Check size={14} />
                    ) : reason ? (
                      <Lock size={13} />
                    ) : null}
                  </i>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <p className="tac-tech-foot">
        Counters: rockets and sentries beat armor and aircraft, Jægers and the
        Lynx beat infantry, artillery and Jotuns break structures, pillboxes
        hold ground against infantry and flak towers clear the sky. Aid stations
        heal idle infantry nearby; field workshops repair idle vehicles and
        aircraft. Research tilts the odds: ammunition, plates, shells and
        composite armor at the research station, then sabots, avionics and
        ballistics behind Tier 3. Projects are expensive and one runs at a time,
        so pick a doctrine rather than buying the whole tree.{' '}
        {roster.filter((k) => k in TACTICAL_UNITS).length} unit types,{' '}
        {roster.filter((k) => k in TACTICAL_BUILDINGS).length} structures,{' '}
        {researchKeys.length} research projects. Every faction adds one
        signature structure and the two troops it trains.
      </p>
    </>
  );
}
