'use client';
import {
  BATTLEFIELDS,
  mapIds,
  isMapId,
  DEFAULT_MAP_ID,
  type MapId,
} from '@/lib/battlefields';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { combatFixture } from './combat-fixture';
import { GameAudioProvider, AudioControls } from '../game/game-audio';
import TacticalScene from '../game/tactical-scene';
import { LocalOrders } from '@/lib/tactical-motion';
import {
  isUnit,
  TACTICAL_UNITS,
  joinBattle,
  makeEntity,
  newBattle,
  tickBattle,
  type EntityKind,
} from '@/lib/tactics';
import { terrainFor } from '@/lib/tactical-terrain';
import {
  DEFAULT_SKIRMISH_MODE,
  skirmishRules,
  type SkirmishMode,
} from '@/lib/skirmish-modes';
import { FogGrid } from '@/lib/tactical-fog';
import { AttractScene } from '../game/world/attract-scene';
import { previewPaidSponsors } from '../game/sponsor-billboard';
import { SPONSOR_FIXTURE } from './sponsor-fixture';

const noop = () => {};
class ReviewFog extends FogGrid {
  constructor(
    readonly reveal: boolean,
    sector: ConstructorParameters<typeof FogGrid>[1],
  ) {
    super(null, sector);
  }
  override update(...args: Parameters<FogGrid['update']>) {
    super.update(...args);
    if (this.reveal) this.data.fill(255);
  }
}

/** A base, an army and every faction signature, parked on the first landing. */
function reviewBattle(seed: number, mapId: MapId, skirmish: SkirmishMode) {
  const b = newBattle(1000, { seed, mapId, skirmish });
  // A mode without ore parks no refinery or harvesters.
  const { ore } = skirmishRules(b);
  joinBattle(b, { id: 'art', name: 'Art review', culture: 'fjordborn' }, 1000);
  b.nextWaveAt = 1e12;
  const h = terrainFor(b).baseAt(b.commanders[0].slot);
  for (const [kind, x, z] of [
    ...(ore ? ([['refinery', 22, -6]] as const) : []),
    ['reactor', -20, -4],
    ['barracks', -14, -26],
    ['factory', 20, -28],
    ['camp', -34, 44],
    ['armory', -12, 44],
    ['depot', 12, 44],
    ['watchtower', 32, 44],
  ] as [EntityKind, number, number][])
    b.entities.push(
      makeEntity(b, kind, 'art', 'blue', { x: h.x + x, z: h.z + z }),
    );
  for (let i = 0; i < 36; i++) {
    const kind = i < 24 ? 'ranger' : i < 31 || !ore ? 'lynx' : 'harvester';
    const e = makeEntity(b, kind, 'art', 'blue', {
      x: h.x - 24 + (i % 9) * 5.5,
      z: h.z + 14 + Math.floor(i / 9) * 5,
    });
    e.angle = (i % 5) * 0.45;
    if (kind === 'harvester') e.cargo = (i - 30) * 60;
    b.entities.push(e);
  }
  (
    [
      'raider',
      'sapper',
      'militia',
      'marksman',
      'snowmobile',
      'mortar',
      'bulwark',
      'fenrir',
    ] as EntityKind[]
  ).forEach((kind, i) => {
    const e = makeEntity(b, kind, 'art', 'blue', {
      x: h.x - 24 + i * 6.5,
      z: h.z + 32,
    });
    e.angle = 0.4;
    b.entities.push(e);
  });
  b.status = 'victory';
  return b;
}

/**
 * The renderer's visual test harness (`/?artReview=1&map=<id>`): a deterministic
 * fixture that never connects to or mutates a live operation.
 */
export default function ArtReview(props: {
  seed?: number;
  mapId?: MapId;
  demoSponsors?: boolean;
  /** `&skirmish=megawealth`: the layout a skirmish mode generates. */
  skirmish?: SkirmishMode;
}) {
  // `&sponsors=demo` hangs paid fixture posters on the billboards.
  if (props.demoSponsors) previewPaidSponsors(SPONSOR_FIXTURE);
  const [attract, setAttract] = useState<'live' | 'capture' | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('attract') === '1')
      setAttract(query.get('capture') === '1' ? 'capture' : 'live');
  }, []);
  if (attract)
    return (
      <main style={{ position: 'fixed', inset: 0, background: '#0d1012' }}>
        <AttractScene
          mapId={props.mapId ?? DEFAULT_MAP_ID}
          capture={attract === 'capture'}
        />
      </main>
    );
  return <FixtureReview {...props} />;
}

function FixtureReview({
  seed = 947,
  mapId = DEFAULT_MAP_ID,
  skirmish = DEFAULT_SKIRMISH_MODE,
}: {
  seed?: number;
  mapId?: MapId;
  skirmish?: SkirmishMode;
}) {
  const id: MapId = isMapId(mapId) ? mapId : DEFAULT_MAP_ID;
  const [baseline] = useState(() => reviewBattle(seed, id, skirmish));
  const terrain = terrainFor(baseline);
  const design = terrain.design;
  const home = terrain.baseAt(baseline.commanders[0].slot);
  const [crossingIndex, setCrossingIndex] = useState(0);
  const [scene, setScene] = useState(baseline);
  const [patrol, setPatrol] = useState(false);
  const [combat, setCombat] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  useEffect(() => {
    if (!combat) return;
    let startedAt = 1000,
      battle = combatFixture(seed, id, startedAt),
      frames = 0;
    const timer = window.setInterval(() => {
      if (frames++ > 56 || battle.status !== 'active') {
        startedAt += 20_000;
        battle = combatFixture(seed, id, startedAt);
        frames = 0;
      }
      tickBattle(battle, battle.tickAt + 250);
      setScene(structuredClone(battle));
    }, 250);
    return () => window.clearInterval(timer);
  }, [combat, seed, id]);
  useEffect(() => {
    if (!patrol) return;
    const started = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      setScene({
        ...baseline,
        status: 'active',
        tickAt: Date.now(),
        entities: baseline.entities.map((e) => {
          if (e.owner !== 'art' || !isUnit(e.kind) || e.z < home.z + 14)
            return e;
          const phase = (elapsed * TACTICAL_UNITS[e.kind].speed) / 12;
          const fraction = phase % 2;
          const forward = fraction < 1;
          const offset = (forward ? fraction : 2 - fraction) * 12;
          return {
            ...e,
            z: e.z + offset,
            angle: forward ? 0 : Math.PI,
            order: 'move',
            path: [{ x: e.x, z: e.z + (forward ? 12 : 0) }],
          };
        }),
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [patrol, baseline, home.z]);
  const [reveal, setReveal] = useState(true);
  const fog = useMemo(
    () => new ReviewFog(reveal, terrain.bounds),
    [reveal, terrain.bounds],
  );
  const [focus, setFocus] = useState({ ...home, serial: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [orders] = useState(() => new LocalOrders());
  const [metrics, setMetrics] = useState('Measuring…');
  useEffect(() => {
    const interval = window.setInterval(() => {
      const data = document.querySelector('canvas')?.dataset.frameStats;
      if (!data) return;
      const { fps, p95, draws, triangles } = JSON.parse(data);
      setMetrics(
        `${fps} fps · p95 ${p95} ms · ${draws} draws · ${(triangles / 1000000).toFixed(2)}M triangles`,
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);
  const go = (p: { x: number; z: number }, distance?: number) => {
    setCinematic(false);
    setFocus((f) => ({ x: p.x, z: p.z, distance, serial: f.serial + 1 }));
  };
  const centre = {
    x: (terrain.bounds.minX + terrain.bounds.maxX) / 2,
    z: (terrain.bounds.minZ + terrain.bounds.maxZ) / 2,
  };
  const select = {
    background: '#182523',
    color: '#fff',
    maxWidth: 190,
  } as const;
  return (
    <GameAudioProvider>
      <main style={{ position: 'fixed', inset: 0, background: '#0d1012' }}>
        <TacticalScene
          battle={patrol || combat ? scene : baseline}
          owner="art"
          fog={fog}
          orders={orders}
          selected={selected}
          armed={false}
          placement={null}
          focus={focus}
          cinematic={cinematic ? design.shots : null}
          onPlacementHover={noop}
          onPlace={noop}
          onCancelPlacement={noop}
          onSelect={setSelected}
          onGround={noop}
          onEnemy={noop}
          onRally={noop}
          onBox={noop}
        />
        <output
          data-art-review-metrics
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            background: '#182523e8',
            color: '#f4ecd3',
            padding: '9px 13px',
            borderRadius: 7,
            font: '12px monospace',
          }}
        >
          {metrics}
        </output>
        <div
          data-art-review-bar
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            color: '#fff',
            background: '#182523df',
            padding: '10px 14px',
            font: '12px system-ui',
            borderRadius: 8,
            display: 'flex',
            flexWrap: 'wrap',
            maxWidth: 'calc(100% - 24px)',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <b>
            Noordheim · {BATTLEFIELDS[id].name} · {seed}
          </b>
          <select
            aria-label="Review battlefield"
            value={id}
            onChange={(event) =>
              window.location.assign(
                `?artReview=1&map=${event.target.value}&seed=${seed}`,
              )
            }
            style={select}
          >
            {mapIds.map((m) => (
              <option key={m} value={m}>
                {BATTLEFIELDS[m].name}
              </option>
            ))}
          </select>
          <select
            aria-label="Camera preset"
            value=""
            style={select}
            onChange={(e) => {
              const [kind, index] = e.target.value.split(':');
              const i = Number(index);
              if (kind === 'landing') go(design.landings[i], 66);
              if (kind === 'stronghold') go(design.strongholds[i], 90);
              if (kind === 'landmark') go(design.landmarks[i], 95);
              if (kind === 'site') go(design.techSites[i], 58);
              if (kind === 'overview') go(centre, 190);
            }}
          >
            <option value="" disabled>
              Camera preset
            </option>
            {design.landings.map((_, i) => (
              <option key={`l${i}`} value={`landing:${i}`}>
                Landing {i + 1}
              </option>
            ))}
            {design.strongholds.map((s, i) => (
              <option key={`s${i}`} value={`stronghold:${i}`}>
                Stronghold · {s.name}
              </option>
            ))}
            {design.landmarks.map((l, i) => (
              <option key={`m${i}`} value={`landmark:${i}`}>
                {l.name}
              </option>
            ))}
            {design.techSites.map((t, i) => (
              <option key={`t${i}`} value={`site:${i}`}>
                Tech site · {t.name}
              </option>
            ))}
            <option value="overview:0">Overview</option>
          </select>
          <button
            onClick={() => {
              const list = terrain.riverBridges();
              const crossing = list[crossingIndex % list.length];
              if (crossing) go(crossing, Math.max(52, crossing.length * 1.8));
              setCrossingIndex((i) => i + 1);
            }}
          >
            Next crossing
          </button>
          <button
            onClick={() => setCinematic(!cinematic)}
            aria-pressed={cinematic}
          >
            Cinematic {cinematic ? 'on' : 'off'}
          </button>
          <button onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
            Full visibility {reveal ? 'on' : 'off'}
          </button>
          <button
            onClick={() => {
              setCombat(false);
              setPatrol(!patrol);
            }}
            aria-pressed={patrol}
          >
            Patrol {patrol ? 'on' : 'off'}
          </button>
          <button
            onClick={() => {
              setPatrol(false);
              setCombat(!combat);
              go({ x: home.x, z: home.z + 16 });
            }}
            aria-pressed={combat}
          >
            Firefight {combat ? 'on' : 'off'}
          </button>
          <AudioControls />
          <Link href="/" style={{ color: '#dde8df' }}>
            Return to game
          </Link>
        </div>
      </main>
    </GameAudioProvider>
  );
}
