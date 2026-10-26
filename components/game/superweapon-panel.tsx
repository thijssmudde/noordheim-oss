'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import {
  CloudSnow,
  Crosshair,
  Flame,
  Plane,
  Ship,
  Siren,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { TACTICAL_BUILDINGS, type Battle, type Point } from '@/lib/tactics';
import {
  chargeMs,
  chargeRemaining,
  isSuperweapon,
  ownWeapon,
  superweaponNotices,
  weaponLabel,
  weaponName,
  type SuperweaponCharge,
  type SuperweaponKind,
  type SuperweaponNotice,
} from '@/lib/tactical-superweapons';

const ICONS: Record<SuperweaponKind, LucideIcon> = {
  boathouse: Ship,
  cannon: Target,
  airstrip: Plane,
  launcher: Flame,
  weathermast: CloudSnow,
};
/** "6:30", "0:59". */
const countdown = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * Superweapon plate and every other commander's countdown, Red Alert style.
 * Countdowns derive from the last tick's charge and the HUD's one-second
 * clock, so a ticking timer adds no per-tick React state.
 */
export function SuperweaponStrip({
  battle,
  owner,
  now,
  aiming,
  onAim,
  onFocus,
}: {
  battle: Battle;
  owner: string;
  /** The HUD clock, ms. */
  now: number;
  aiming: boolean;
  onAim: () => void;
  onFocus: (p: Point) => void;
}) {
  const mine = ownWeapon(battle, owner);
  const site = mine
    ? undefined
    : battle.entities.find(
        (e) =>
          e.owner === owner &&
          isSuperweapon(e.kind) &&
          e.hp > 0 &&
          e.readyAt > 0,
      );
  const others = (battle.superweapons ?? [])
    .filter((s) => s !== mine)
    .sort(
      (a, z) =>
        chargeRemaining(battle, a, now) - chargeRemaining(battle, z, now),
    );
  if (!mine && !site && !others.length) return null;
  return (
    <section className="tac-superweapons" aria-label="Superweapons">
      {mine ? (
        <OwnWeapon
          battle={battle}
          weapon={mine}
          now={now}
          aiming={aiming}
          onAim={onAim}
        />
      ) : site ? (
        <div className="tac-sw-own tac-plate is-building">
          <Image
            width={256}
            height={192}
            unoptimized
            className="tac-sw-portrait"
            src={`/art/tactical/${site.kind}.png`}
            alt={TACTICAL_BUILDINGS[site.kind as SuperweaponKind].name}
            draggable={false}
          />
          <div className="tac-sw-readout">
            <small>{weaponName(site.kind as SuperweaponKind)}</small>
            <strong>Under construction</strong>
            <em>Charging starts when it is complete</em>
          </div>
        </div>
      ) : null}
      {others.length > 0 && (
        <ul className="tac-sw-timers" aria-label="Superweapon countdowns">
          {others.map((s) => {
            const left = chargeRemaining(battle, s, now),
              Icon = ICONS[s.kind];
            return (
              <li key={s.id}>
                <button
                  className={`tac-sw-timer is-${s.team} ${left ? '' : 'is-ready'} ${s.paused ? 'is-paused' : ''}`}
                  onClick={() => onFocus(s)}
                  title={`${weaponLabel(battle, s)}${s.paused ? ' · charging paused' : ''} · click to look`}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{weaponLabel(battle, s)}</span>
                  <strong suppressHydrationWarning>
                    {left ? countdown(left) : 'READY'}
                  </strong>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
function OwnWeapon({
  battle,
  weapon,
  now,
  aiming,
  onAim,
}: {
  battle: Battle;
  weapon: SuperweaponCharge;
  now: number;
  aiming: boolean;
  onAim: () => void;
}) {
  const full = chargeMs(battle, weapon.kind),
    left = chargeRemaining(battle, weapon, now),
    ready = left === 0,
    state = ready ? 'ready' : weapon.paused ? 'paused' : 'charging';
  return (
    <div
      className={`tac-sw-own tac-plate is-${state} ${aiming ? 'is-aiming' : ''}`}
    >
      <Image
        width={256}
        height={192}
        unoptimized
        className="tac-sw-portrait"
        src={`/art/tactical/${weapon.kind}.png`}
        alt={TACTICAL_BUILDINGS[weapon.kind].name}
        draggable={false}
      />
      <div className="tac-sw-readout">
        <small>{weaponName(weapon.kind)}</small>
        <strong suppressHydrationWarning>
          {ready ? 'READY' : countdown(left)}
        </strong>
        <i
          className="tac-sw-charge"
          style={{ '--p': `${100 - (left / full) * 100}%` } as CSSProperties}
        />
        <em>
          {aiming
            ? 'Choose a target · Esc cancels'
            : ready
              ? 'Standing by for a target'
              : weapon.paused
                ? 'Paused · not enough power'
                : 'Charging'}
        </em>
      </div>
      <button
        className="tac-sw-launch"
        disabled={!ready}
        aria-pressed={aiming}
        onClick={onAim}
        title={ready ? 'Choose a target (G)' : 'Still charging'}
      >
        <Crosshair size={16} aria-hidden="true" />
        {aiming ? 'Cancel' : 'Launch'}
        <kbd>G</kbd>
      </button>
    </div>
  );
}

/** Loudest first: a launch beats a warning, the garrison beats the coalition. */
const WEIGHT: Record<SuperweaponNotice['kind'], number> = {
  launch: 5,
  warning: 4,
  ready: 3,
  built: 2,
  destroyed: 1,
};
class NoticeWatch {
  private source: unknown;
  private previous: Battle | null = null;
  latest: (SuperweaponNotice & { at: number; serial: number }) | null = null;
  private serial = 0;
  observe(
    battle: (Battle & { id?: string }) | null | undefined,
    owner: string,
  ) {
    if (battle === this.source) return this.latest;
    this.source = battle;
    if (!battle) return this.latest;
    const notices = superweaponNotices(this.previous, battle, owner);
    this.previous = battle;
    const loudest = notices.sort(
      (a, z) =>
        WEIGHT[z.kind] - WEIGHT[a.kind] ||
        (z.team === 'red' ? 1 : 0) - (a.team === 'red' ? 1 : 0),
    )[0];
    if (loudest)
      this.latest = { ...loudest, at: battle.tickAt, serial: ++this.serial };
    return this.latest;
  }
}
/** The newest superweapon warning, derived once per snapshot. */
export function useSuperweaponNotice(
  battle: (Battle & { id?: string }) | null | undefined,
  owner: string,
) {
  const [watch] = useState(() => new NoticeWatch());
  return useMemo(() => watch.observe(battle, owner), [watch, battle, owner]);
}
/** "Hostile Weather Mast ready in 60 s": a banner every commander sees. Key it by serial. */
export function SuperweaponNoticeBanner({
  notice,
  onJump,
}: {
  notice: SuperweaponNotice;
  onJump: (p: Point) => void;
}) {
  const Icon = notice.team === 'red' ? Siren : ICONS[notice.weapon];
  return (
    <div role="alert" className="tac-attack-alert-slot">
      <button
        type="button"
        className={`tac-attack-alert tac-sw-alert is-${notice.team} is-${notice.kind}`}
        onClick={() => onJump(notice)}
        title="Look at it"
      >
        <Icon size={17} aria-hidden="true" />
        <strong>{notice.text}</strong>
      </button>
    </div>
  );
}
