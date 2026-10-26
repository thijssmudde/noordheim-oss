'use client';
import { memo, useSyncExternalStore } from 'react';
import {
  buildSeconds,
  isUnit,
  RESEARCH,
  spec,
  TACTICAL_UNITS,
  type Battle,
  type Entity,
  type ResearchKey,
} from '@/lib/tactics';
import type { FogGrid } from '@/lib/tactical-fog';
import type { HoveredStructure } from '@/lib/hovered-structure';

const healthBand = (ratio: number) =>
  ratio > 0.6 ? 'high' : ratio > 0.3 ? 'mid' : 'low';
const OFFSET = 18;

/** What one of the commander's own structures is busy with, if anything. */
function activityOf(battle: Battle, owner: string, e: Entity, now: number) {
  const progress = (readyAt: number, seconds: number) =>
    Math.max(0, Math.min(1, 1 - (readyAt - now) / 1000 / seconds));
  if (e.readyAt > 0)
    return {
      label: 'Under construction',
      progress: progress(e.readyAt, buildSeconds(battle, owner, e.kind)),
    };
  for (const order of battle.training ?? []) {
    if (order.owner !== owner) continue;
    const line = order.lines?.find((l) => l.producer === e.id && l.readyAt > 0);
    if (line)
      return {
        label: `Training ${TACTICAL_UNITS[order.kind].name}${order.remaining > 1 ? ` · ${order.remaining} left` : ''}`,
        progress: progress(
          line.readyAt,
          buildSeconds(battle, owner, order.kind),
        ),
      };
  }
  const commander = battle.commanders.find((c) => c.id === owner);
  const research = commander?.researching;
  const project = research ? RESEARCH[research.key as ResearchKey] : undefined;
  if (research && project?.at === e.kind)
    return {
      label: `Researching ${project.name}`,
      progress: progress(research.readyAt, project.seconds),
    };
  return null;
}

/**
 * A compact card beside the pointer while it rests on a structure: name,
 * holder, health and role, plus production or research on the commander's own.
 */
export const StructureHoverCard = memo(function StructureHoverCard({
  hovered,
  battle,
  owner,
  fog,
  now,
  hidden,
}: {
  hovered: HoveredStructure;
  battle: Battle;
  owner: string;
  fog: FogGrid;
  now: number;
  /** Placement, aiming or a drag box owns the pointer. */
  hidden: boolean;
}) {
  const id = useSyncExternalStore(hovered.subscribe, hovered.get, () => null);
  const e = id ? battle.entities.find((u) => u.id === id) : undefined;
  if (hidden || !e || isUnit(e.kind) || e.hp <= 0) return null;
  // Allies are always on the map; a hostile structure only while it is in sight.
  if (e.team === 'red' && fog.sight(e) !== 'visible') return null;
  const s = spec(e.kind),
    ratio = Math.max(0, Math.min(1, e.hp / s.hp)),
    relation = e.owner === owner ? 'own' : e.team === 'blue' ? 'ally' : 'enemy';
  const holder =
    relation === 'own'
      ? 'Your command'
      : relation === 'ally'
        ? (battle.commanders.find((c) => c.id === e.owner)?.name ?? 'Ally')
        : 'Hostile garrison';
  const activity =
    relation === 'own' ? activityOf(battle, owner, e, now) : null;
  const follow = (node: HTMLElement | null) => {
    if (!node) return;
    const place = () => {
      const { x, y, bounds: b } = hovered,
        { offsetWidth: w, offsetHeight: h } = node;
      const left = x + OFFSET + w > b.right ? x - OFFSET - w : x + OFFSET,
        top = y + OFFSET + h > b.bottom ? y - OFFSET - h : y + OFFSET;
      node.style.translate = `${Math.max(b.left, left)}px ${Math.max(b.top, top)}px`;
    };
    place();
    return hovered.subscribeMove(place);
  };
  return (
    <aside
      ref={follow}
      className="tac-hover-card tac-plate"
      data-relation={relation}
      role="tooltip"
    >
      <strong>
        {s.name}
        <b>{holder}</b>
      </strong>
      <div className="tac-health">
        <i data-band={healthBand(ratio)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <small className="tac-hp">
        {Math.ceil(e.hp)} / {s.hp} HP
      </small>
      <p>{s.role}</p>
      {activity && (
        <span className="tac-hover-activity">
          <span>
            {activity.label}
            <b>{Math.round(activity.progress * 100)}%</b>
          </span>
          <em>
            <i style={{ width: `${activity.progress * 100}%` }} />
          </em>
        </span>
      )}
    </aside>
  );
});
