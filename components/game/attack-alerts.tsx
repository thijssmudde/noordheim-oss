'use client';
import { useMemo, useState } from 'react';
import { Siren } from 'lucide-react';
import {
  ALERT_PING_MS,
  ALERT_TEXT,
  DamageAlertTracker,
  type DamageAlert,
  type DamageAlertLog,
} from '@/lib/damage-alerts';
import type { Battle } from '@/lib/tactics';

/**
 * Derives under-attack alerts from consecutive snapshots. One O(entities) pass
 * per new snapshot; re-renders between snapshots reuse the same log.
 */
export function useAttackAlerts(
  battle: (Battle & { id?: string }) | null | undefined,
  owner: string,
): DamageAlertLog {
  const [tracker] = useState(() => new DamageAlertTracker());
  return useMemo(
    () => tracker.observe(battle, owner),
    [tracker, battle, owner],
  );
}

/** The newest alert while its ping is still live, or null. */
export function activeAlert(log: DamageAlertLog): DamageAlert | null {
  return log.latest && log.recent.includes(log.latest) ? log.latest : null;
}

/** "Base under attack · Space": click (or Space) jumps the camera there. Key it by `alert.id` so each alert restarts the flash. */
export function AttackAlertNotice({
  alert,
  onJump,
}: {
  alert: DamageAlert;
  onJump: (alert: DamageAlert) => void;
}) {
  return (
    <div role="alert" className="tac-attack-alert-slot">
      <button
        type="button"
        className={`tac-attack-alert is-${alert.kind}`}
        onClick={() => onJump(alert)}
        title="Jump to the attack (Space)"
      >
        <Siren size={17} aria-hidden="true" />
        <strong>{ALERT_TEXT[alert.kind]}</strong>
        <kbd>Space</kbd>
      </button>
    </div>
  );
}

/** Pulsing rings on the radar where the viewer's forces were hit; CSS fades them out. */
export function RadarPings({ alerts }: { alerts: readonly DamageAlert[] }) {
  return alerts.map((a) => (
    <g
      key={a.id}
      className={`tac-map-ping is-${a.kind}`}
      style={{ animationDuration: `${ALERT_PING_MS}ms` }}
    >
      <circle cx={a.x} cy={a.z} r={6} vectorEffect="non-scaling-stroke" />
      <circle
        className="tac-map-ping-ring"
        cx={a.x}
        cy={a.z}
        r={34}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  ));
}
