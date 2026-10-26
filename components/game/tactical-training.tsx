'use client';
import Image from 'next/image';
import { X } from 'lucide-react';
import {
  buildSeconds,
  categoryOf,
  priceOf,
  spec,
  TACTICAL_UNITS,
  trainingBlockReason,
  trainingCount,
  TRAINING_QUEUE_LIMIT,
  type Battle,
  type UnitCategory,
} from '@/lib/tactics';

function duration(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function TroopBatchSize({
  quantity,
  onChange,
}: {
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <fieldset className="tac-batch-size">
      <legend className="sr-only">Troops per order</legend>
      <span>Per order</span>
      {[1, 5, 10].map((n) => (
        <button
          key={n}
          aria-pressed={quantity === n}
          onClick={() => onChange(n)}
        >
          ×{n}
        </button>
      ))}
    </fieldset>
  );
}

const LABELS: Record<UnitCategory, string> = {
  infantry: 'INFANTRY QUEUE',
  vehicle: 'VEHICLE QUEUE',
  air: 'AIRCRAFT QUEUE',
};

/** Every completed production building trains its own unit, so more buildings mean more troops. */
export function TroopQueue({
  battle,
  owner,
  category,
  now,
  busy,
  onCancel,
}: {
  battle: Battle;
  owner: string;
  category: UnitCategory;
  now: number;
  busy: boolean;
  onCancel: (id: string) => void;
}) {
  const queue = (battle.training ?? []).filter(
    (q) => q.owner === owner && categoryOf(q.kind) === category,
  );
  /** Why a finished unit of this order is being held, if any. */
  const blockedFor = (q: (typeof queue)[number]) => {
    const held = (q.lines ?? []).find((l) => l.readyAt <= now);
    if (!held) return null;
    const producer = battle.entities.find((e) => e.id === held.producer);
    return trainingBlockReason(battle, owner, q.kind, producer);
  };
  // Estimates assume enough power and clear exits, with every building of the kind working.
  const buildings = new Map<string, number>();
  for (const e of battle.entities)
    if (e.owner === owner && e.hp > 0 && !e.readyAt)
      buildings.set(e.kind, (buildings.get(e.kind) ?? 0) + 1);
  const ahead = new Map<string, number>();
  const estimates = queue.map((q) => {
    const producer = TACTICAL_UNITS[q.kind].producer,
      units = (ahead.get(producer) ?? 0) + q.remaining,
      cycles = Math.ceil(units / Math.max(1, buildings.get(producer) ?? 0));
    ahead.set(producer, units);
    return (
      Math.max(now, q.readyAt || now) +
      (cycles - (q.readyAt ? 1 : 0)) *
        buildSeconds(battle, owner, q.kind) *
        1000
    );
  });
  return (
    <section className="tac-queue tac-troop-queue" aria-label="Troop queue">
      <div className="tac-panel-heading">
        <span>{LABELS[category]}</span>
        <span>
          {trainingCount(battle, owner)} / {TRAINING_QUEUE_LIMIT}
        </span>
      </div>
      {queue.length ? (
        queue.map((q, i) => {
          const s = spec(q.kind),
            active = q.lines?.length ?? 0,
            blocked = blockedFor(q),
            seconds = Math.max(0, (q.readyAt - now) / 1000),
            refund = q.remaining * priceOf(battle, owner, q.kind);
          return (
            <div key={q.id} className="tac-queue-item tac-training-item">
              <Image
                width={40}
                height={33}
                unoptimized
                className="tac-portrait"
                src={`/art/tactical/${q.kind}.png`}
                alt=""
              />
              <div>
                <strong>
                  {s.name} ×{q.remaining}
                </strong>
                <span>
                  {active
                    ? (blocked ??
                      `Training${active > 1 ? ` ×${active}` : ''} · Next in ${duration(seconds)}`)
                    : 'Queued'}
                </span>
                <span>
                  {blocked
                    ? 'Line paused until deployment is possible'
                    : `Batch finishes in ~${duration((estimates[i] - now) / 1000)}`}
                </span>
                {active > 0 && (
                  <progress
                    className="tac-training-progress"
                    max={100}
                    aria-label={`${s.name} training`}
                    value={Math.max(
                      0,
                      Math.min(
                        100,
                        100 -
                          (seconds / buildSeconds(battle, owner, q.kind)) * 100,
                      ),
                    )}
                  />
                )}
              </div>
              <button
                className="tac-cancel-training"
                disabled={busy || battle.status !== 'active'}
                aria-label={`Cancel ${q.remaining} ${s.name}; refund ${refund} credits`}
                title={`Cancel remaining batch · Refund ₭ ${refund}`}
                onClick={() => onCancel(q.id)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })
      ) : (
        <p>
          Choose a batch size, then a unit. Each production building trains one
          unit at a time; build more to train more at once.
        </p>
      )}
      <p>
        Credits paid upfront. Ready troops wait for power, army space or a clear
        exit. Cancel to refund undeployed troops.
      </p>
    </section>
  );
}
