'use client';
import { enemyForces } from '@/lib/tactics';
import { useEffect, useState } from 'react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import type { Id } from '@/convex/_generated/dataModel';
import {
  baseAt,
  joinBattle,
  logEvent,
  makeEntity,
  newBattle,
  sitesFor,
  tickBattle,
  type Battle,
  type EntityKind,
} from '@/lib/tactics';
import { terrainFor } from '@/lib/tactical-terrain';
import type { MapId } from '@/lib/maps';
import TacticalCommand from '../game/tactical-command';
import {
  ReviewBattleSource,
  type TacticalState as TacticalReviewState,
} from '../game/battle-source';
import {
  OperationProvider,
  type OperationSummary,
} from '../game/operation-source';
import { LobbyPage } from '../game/lobby-page';
import { GameOver } from '../game/game-over';
import { GameAudioProvider } from '../game/game-audio';
import { previewPaidSponsors } from '../game/sponsor-billboard';
import { SPONSOR_FIXTURE } from './sponsor-fixture';
import {
  stageSuperweapons,
  warnSnapshot,
  type SuperweaponStage,
} from './superweapon-fixture';
const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const player = {
  _id: 'interface-review' as Id<'players'>,
  name: 'Raven 07',
  culture: 'fjordborn',
};

const reviewWithdraw = async () => {
  throw new Error(
    'This is the interface preview. Return to the game to leave operations.',
  );
};

/** Uses the production UI with deterministic local data; no operation is created. */
export default function InterfaceReview({
  initial,
  demoSponsors = false,
  raid = false,
  lobbyGuest = false,
  superweapons,
  sites,
  won = false,
}: {
  initial: 'hud' | 'lobby' | 'over';
  /** `&sponsors=demo`: paid fixture sponsors on every sponsor surface. */
  demoSponsors?: boolean;
  /** `&raid=1`: hostiles hit the refinery and its harvester after 14 seconds. */
  raid?: boolean;
  /** `&as=guest`: the lobby as seen by a member who is not the host. */
  lobbyGuest?: boolean;
  /** `&sw=`, `&strike=`, `&ally=1`...: superweapons staged on the fixture (see superweapon-fixture.ts). */
  superweapons?: SuperweaponStage;
  /**
   * `&sites=<map>`: tech sites on that map in every state, simulated live: a
   * squad taking a derrick, a held hospital, an airstrip about to launch a
   * recon plane and a site in enemy hands.
   */
  sites?: MapId;
  /** `&won=1`: the operation just won; every hostile flag taken, the debrief a victory. */
  won?: boolean;
}) {
  if (demoSponsors) previewPaidSponsors(SPONSOR_FIXTURE);
  const [page, setPage] = useState(initial);
  const [review, setReview] = useState<TacticalReviewState>(() => {
    const now = Date.now();
    const battle = newBattle(now, { seed: 947, mapId: sites });
    joinBattle(
      battle,
      { id: player._id, name: player.name, culture: player.culture },
      now,
    );
    const base = sites
      ? terrainFor(battle).baseAt(battle.commanders[0].slot)
      : baseAt(battle.commanders[0].slot);
    for (const [kind, x, z] of [
      ['refinery', 18, -4],
      ['reactor', -16, -3],
      ['barracks', -10, -20],
      ['factory', 16, -23],
      ['lynx', 5, 13],
      ['lynx', 10, 13],
      ['ranger', -6, 13],
      ['ranger', -3, 13],
      ['ranger', 0, 13],
      ...(raid ? [['harvester', 24, 4]] : []),
    ] as [EntityKind, number, number][])
      battle.entities.push(
        makeEntity(battle, kind, player._id, 'blue', {
          x: base.x + x,
          z: base.z + z,
        }),
      );
    battle.commanders[0].credits = 2450;
    battle.nextWaveAt = now + 9 * 60_000;
    if (superweapons) stageSuperweapons(battle, player._id, superweapons);
    if (sites) stageSites(battle, now);
    if (won) stageVictory(battle, now);
    return {
      ...battle,
      ...sitesFor(battle, player._id),
      battlefieldFull: false,
      pendingCommandUnits: 0,
      enemyForces: enemyForces(battle),
      openEnrollment: false,
      id: 'interface-review' as Id<'sectors'>,
      mode: 'solo',
      maxPlayers: 1,
      viewerId: player._id,
      now,
    };
  });
  useEffect(() => {
    if (!superweapons?.warn) return;
    // One snapshot a second; the warning lands on the third.
    let second = 0;
    const timer = setInterval(() => {
      second++;
      setReview((previous) => ({
        ...warnSnapshot(previous, superweapons, second),
        tickAt: previous.tickAt + 1000,
        now: previous.now + 1000,
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, [superweapons]);
  useEffect(() => {
    if (!raid) return;
    // One snapshot a second like live play; seconds 14-16 carry the raid.
    let second = 0;
    const timer = setInterval(() => {
      const step = ++second - 14;
      setReview((previous) => raidSnapshot(previous, step));
    }, 1000);
    return () => clearInterval(timer);
  }, [raid]);
  // Paused until started, so a capture can be watched (or captured) from its first second.
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!sites || !running) return;
    // The real simulation, one second per snapshot like live play.
    const timer = setInterval(
      () => setReview((previous) => siteSnapshot(previous)),
      1000,
    );
    return () => clearInterval(timer);
  }, [sites, running]);
  return (
    <ConvexProvider client={client}>
      <GameAudioProvider>
        {page === 'over' ? (
          <OperationProvider
            operation={{
              battle: {
                ...review,
                gameOver: won ? 'victory' : 'buildings',
                status: won ? 'victory' : 'ended',
                startedAt: review.now - 754_000,
                endedAt: review.now,
              } as unknown as OperationSummary,
              withdraw: reviewWithdraw,
            }}
          >
            <GameOver />
          </OperationProvider>
        ) : page === 'hud' ? (
          <ReviewBattleSource state={review}>
            <TacticalCommand
              player={player}
              token="interface-preview"
              onOperations={() => setPage('lobby')}
              onDebrief={() => setPage('over')}
            />
          </ReviewBattleSource>
        ) : (
          <LobbyPage
            token="interface-preview"
            name={lobbyGuest ? 'Runa' : player.name}
            viewerId={
              lobbyGuest ? ('review-ally' as Id<'players'>) : player._id
            }
            lobby={{
              id: 'interface-review' as Id<'lobbies'>,
              name: 'Fjord patrol',
              code: 'ART234',
              maxPlayers: 4,
              count: 2,
              hostId: player._id,
              difficulty: 'normal',
              enemyCount: 2,
              mapId: 'glaciercrown',
              members: [
                {
                  id: player._id,
                  name: player.name,
                  culture: player.culture,
                },
                {
                  id: 'review-ally' as Id<'players'>,
                  name: 'Runa',
                  culture: 'hearthkin',
                },
              ],
            }}
            review
          />
        )}
        <nav className="interface-review-nav" aria-label="Interface preview">
          <span>ART REVIEW</span>
          <button onClick={() => setPage('hud')} aria-pressed={page === 'hud'}>
            HUD
          </button>
          <button
            onClick={() => setPage('lobby')}
            aria-pressed={page === 'lobby'}
          >
            Lobby
          </button>
          <button
            onClick={() => setPage('over')}
            aria-pressed={page === 'over'}
          >
            Debrief
          </button>
          {sites && (
            <button
              data-sites-run
              onClick={() => setRunning(!running)}
              aria-pressed={running}
            >
              {running ? 'Pause' : 'Run battle'}
            </button>
          )}
          <a href="/">Home</a>
        </nav>
      </GameAudioProvider>
    </ConvexProvider>
  );
}

/**
 * The next snapshot of the `&raid=1` fixture; during steps 0-2 hostiles hit the
 * refinery and its harvester. Battle time advances exactly one second per
 * snapshot, so a starved main thread (software WebGL) can't stretch the gap into
 * a reconnect that re-baselines the alerts.
 */
function raidSnapshot(
  previous: TacticalReviewState,
  step: number,
): TacticalReviewState {
  const now = previous.tickAt + 1000;
  if (step < 0 || step > 2) return { ...previous, tickAt: now, now };
  const refinery = previous.entities.find(
    (e) => e.owner === player._id && e.kind === 'refinery',
  )!;
  const hostileOwner =
    previous.entities.find((e) => e.team === 'red')?.owner ?? 'garrison';
  const next = { ...previous, entities: [...previous.entities] };
  if (step === 0)
    for (const [dx, dz] of [
      [14, 10],
      [17, 13],
      [11, 14],
    ])
      next.entities.push(
        makeEntity(next, 'ranger', hostileOwner, 'red', {
          x: refinery.x + dx,
          z: refinery.z + dz,
        }),
      );
  next.entities = next.entities.map((e) =>
    e.team === 'red' && Math.hypot(e.x - refinery.x, e.z - refinery.z) < 25
      ? { ...e, firedAt: now, shotX: refinery.x, shotZ: refinery.z }
      : e.owner === player._id &&
          (e.kind === 'refinery' || e.kind === 'harvester')
        ? { ...e, hp: Math.max(1, e.hp - (e.kind === 'refinery' ? 90 : 25)) }
        : e,
  );
  return { ...next, tickAt: now, now };
}

/**
 * The `&sites=<map>` fixture: the derrick nearest the landing is being taken by
 * a squad standing in its ring, the field hospital is ours (scuffed, healing a
 * wounded patrol), the airstrip is ours with a recon plane due over the enemy
 * base, and the farthest site is in enemy hands.
 */
function stageSites(b: Battle, now: number) {
  const terrain = terrainFor(b);
  const home = terrain.baseAt(b.commanders[0].slot);
  const sites = [...(b.sites ?? [])].sort(
    (a, z) =>
      Math.hypot(a.x - home.x, a.z - home.z) -
      Math.hypot(z.x - home.x, z.z - home.z),
  );
  const derrick = sites.find((s) => s.kind === 'derrick');
  const hospital = sites.find((s) => s.kind === 'fieldHospital');
  const airstrip = sites.find((s) => s.kind === 'airstrip');
  const enemy = [...sites]
    .reverse()
    .find((s) => s !== derrick && s !== hospital && s !== airstrip);
  const post = (at: { x: number; z: number }, count: number, hp = 1) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.4;
      const e = makeEntity(b, 'ranger', player._id, 'blue', {
        x: at.x + Math.sin(a) * 8,
        z: at.z + Math.cos(a) * 8,
      });
      e.order = 'hold';
      e.hp *= hp;
      b.entities.push(e);
    }
  };
  if (derrick) post(derrick, 4);
  if (hospital) {
    Object.assign(hospital, { team: 'blue', holder: player._id, heldAt: now });
    hospital.hp *= 0.7;
    post({ x: hospital.x + 10, z: hospital.z + 6 }, 3, 0.35);
  }
  if (airstrip) {
    Object.assign(airstrip, {
      team: 'blue',
      holder: player._id,
      heldAt: now,
      pulseAt: now + 3000,
    });
    // The recon plane circles the barracks' rally, over the enemy's front door.
    const hold = terrain.strongholdAt(0);
    const barracks = b.entities.find(
      (e) => e.owner === player._id && e.kind === 'barracks',
    );
    if (barracks)
      barracks.rally = {
        x: hold.x + Math.sin(hold.facing) * 30,
        z: hold.z + Math.cos(hold.facing) * 30,
      };
  }
  if (enemy) {
    Object.assign(enemy, { team: 'red', holder: 'hostile-1' });
    // A scout watching from beyond the ring, so the enemy's site is in sight.
    const scout = makeEntity(b, 'lynx', player._id, 'blue', {
      x: enemy.x + (enemy.x > home.x ? -24 : 24),
      z: enemy.z + 12,
    });
    scout.order = 'hold';
    b.entities.push(scout);
  }
}

/** The `&won=1` fixture: the last hostile flag carried home, every army collapsed. */
function stageVictory(b: Battle, now: number) {
  for (const f of b.flags ?? []) if (f.team === 'red') f.capturedAt = now;
  b.entities = b.entities.filter((e) => e.team !== 'red');
  b.startedAt = now - 754_000;
  b.status = 'victory';
  logEvent(b, now, 'Every enemy flag captured. The fjord is ours.', 'success');
}

/** One simulated second of the `&sites` fixture. */
function siteSnapshot(previous: TacticalReviewState): TacticalReviewState {
  const next = structuredClone(previous);
  tickBattle(next as unknown as Battle, previous.tickAt + 1000);
  return { ...next, enemyForces: enemyForces(next), now: next.tickAt };
}
