'use client';
import {
  PICKUP_SECONDS,
  RETURN_SECONDS,
  carrierOf,
  enemyForces,
  flagHome,
  flagState,
  type Flag as BattleFlag,
} from '@/lib/tactics';
import { BATTLEFIELDS, DEFAULT_MAP_ID, isMapId } from '@/lib/battlefields';
import { terrainFor, type TerrainMap } from '@/lib/tactical-terrain';

import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { ConvexError } from 'convex/values';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { useBattleActions, useBattleState } from './battle-source';
import { FogGrid, loadExplored, saveExplored } from '@/lib/tactical-fog';
import { LocalOrders } from '@/lib/tactical-motion';
import { mergeSelection, rosterKindSelection } from '@/lib/tactical-selection';
import {
  SCROLL_KEYS,
  ORBIT_KEYS,
  type CameraFocus,
} from '@/lib/tactical-camera';
import {
  ArrowUpRight,
  CircleHelp,
  Crosshair,
  Factory,
  Flag,
  FlaskConical,
  Gem,
  GitBranch,
  Hammer,
  KeyRound,
  LocateFixed,
  Lock,
  Maximize,
  Mountain,
  Move,
  Plane,
  Radar,
  Radio,
  Shield,
  Square,
  Swords,
  Truck,
  Trash2,
  Users,
  X,
  Zap,
  Droplet,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  availability,
  buildSeconds,
  categoryOf,
  commandLimit,
  STRUCTURE_LIMIT,
  CONSTRUCTION_QUEUE_LIMIT,
  fieldCount,
  harvesterLimit,
  HARVESTER_LIMIT,
  harvesterOrderReason,
  isHarvester,
  isUnit,
  joinBattle,
  newBattle,
  OPERATION_MINUTES,
  placementError,
  powerFor,
  priceOf,
  RESEARCH,
  researchAvailability,
  researchKeys,
  type ResearchKey,
  SECTOR,
  type Terrain,
  spec,
  TACTICAL_BUILDINGS,
  TACTICAL_UNITS,
  SUPERWEAPONS,
  tierOf,
  TRAINING_QUEUE_LIMIT,
  trainingCount,
  buildingKinds,
  inResearchRoster,
  inRoster,
  TECH_SITES,
  derrickIncome,
  startingCredits,
  isProducer,
  unitKinds,
  type Battle,
  type EntityKind,
  type OrderKind,
  type Point,
  type UnitCategory,
} from '@/lib/tactics';
import { fmt } from '@/lib/format';
import { difficultyFor } from '@/lib/tactical-difficulty';
import { skirmishName, skirmishRules } from '@/lib/skirmish-modes';
import { TroopBatchSize, TroopQueue } from './tactical-training';
import {
  AttackAlertNotice,
  RadarPings,
  activeAlert,
  useAttackAlerts,
} from './attack-alerts';
import type { DamageAlert } from '@/lib/damage-alerts';
import { SponsorBadge } from './sponsor-badge';
import { SiteRadarMarkers, TechSiteObjectives } from './tech-site-objectives';
import { SponsorRoll } from './sponsor-wall';
import { VictoryBanner } from './victory-banner';
import { PhotoMode } from './photo-mode';
import { HowToPlaySteps } from './how-to-play';
import { TutorialCoach } from './tutorial-coach';
import { saveTutorial, useTutorialProgress } from './tutorial-progress';
import {
  NEW_TUTORIAL,
  TUTORIAL_STEPS,
  progressIn,
  tutorialFacts,
  tutorialStep,
  tutorialSteps,
  tutorialVisible,
  type TutorialProgress,
} from '@/lib/tutorial';
import {
  SuperweaponNoticeBanner,
  SuperweaponStrip,
  useSuperweaponNotice,
} from './superweapon-panel';
import {
  chargeRemaining,
  ownWeapon,
  targetError,
  weaponName,
} from '@/lib/tactical-superweapons';
import { ResearchPanel, TechTreeDialog } from './tactical-tech';
import { StructureHoverCard } from './structure-hover';
import { HoveredStructure } from '@/lib/hovered-structure';
import {
  AudioControls,
  CommanderRadio,
  CommanderCaption,
  useBattleAudio,
  useGameAudio,
} from './game-audio';
import { commandFailureCue, orderCue, type VoiceCue } from '@/lib/audio-policy';
import {
  addToGroup,
  assignGroup,
  GROUP_SLOTS,
  groupSlot,
  isDoubleTap,
  pruneGroups,
  recallGroup,
  type GroupTap,
} from '@/lib/control-groups';
import {
  ControlGroupChip,
  ControlGroupStrip,
  useControlGroups,
} from './control-groups';
import {
  buildRadius,
  snapPlacement,
  type PlaceableKind,
} from '@/lib/tactical-placement';
const TacticalScene = dynamic(() => import('./tactical-scene'), { ssr: false });
type Player = NonNullable<FunctionReturnType<typeof api.players.session>>;
type Tab = 'structures' | UnitCategory | 'research';
const CATEGORY_NOUNS: Record<UnitCategory, string> = {
  infantry: 'Infantry',
  vehicle: 'Vehicle',
  air: 'Aircraft',
};
const TABS: { key: Tab; label: string; icon: typeof Factory }[] = [
  { key: 'structures', label: 'Structures', icon: Factory },
  { key: 'infantry', label: 'Infantry', icon: Swords },
  { key: 'vehicle', label: 'Vehicles', icon: Truck },
  { key: 'air', label: 'Aircraft', icon: Plane },
  { key: 'research', label: 'Research', icon: FlaskConical },
];
const subscribe = (callback: () => void) => {
  const t = setInterval(callback, 1000);
  return () => clearInterval(t);
};
function useClock() {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => 0,
  );
}
/** Credits per second delivered by harvesters over the last half minute. */
function useIncome(harvested: number | undefined, at: number | undefined) {
  const [samples, setSamples] = useState<{ at: number; harvested: number }[]>(
    [],
  );
  // Store the latest server tick during render; no effect is needed for derived history.
  const last = samples[samples.length - 1];
  if (harvested !== undefined && at !== undefined && last?.at !== at) {
    const next = last && harvested < last.harvested ? [] : [...samples];
    next.push({ at, harvested });
    while (next.length > 2 && at - next[0].at > 30000) next.shift();
    setSamples(next);
  }
  if (samples.length < 2) return 0;
  const first = samples[0],
    tail = samples[samples.length - 1],
    seconds = (tail.at - first.at) / 1000;
  return seconds > 0 ? (tail.harvested - first.harvested) / seconds : 0;
}
function commandError(error: unknown) {
  const raw =
    error instanceof ConvexError
      ? String(error.data)
      : error instanceof Error
        ? error.message
        : 'Unable to complete this order.';
  return raw.replace(/^[\s\S]*ConvexError: /, '').split('\n')[0];
}
/** Eases the displayed balance toward the real one, like a Red Alert credit ticker. */
function useTicker(target: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      const gap = target - current.current;
      if (Math.abs(gap) < 1) {
        current.current = target;
        setShown(target);
        return;
      }
      current.current += Math.sign(gap) * Math.max(1, Math.abs(gap) * 0.18);
      setShown(Math.round(current.current));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}
/** The eased balance lives in its own component so its per-frame updates re-render one span, not the whole HUD. */
const CreditTicker = memo(function CreditTicker({
  target,
}: {
  target: number;
}) {
  const shown = useTicker(target);
  return <span className="tac-readout">{fmt(shown)}</span>;
});
const healthBand = (ratio: number) =>
  ratio > 0.6 ? 'high' : ratio > 0.3 ? 'mid' : 'low';
type Peek = {
  name: string;
  role: string;
  cost: number;
  seconds: number;
  power?: number;
  tier: number;
  via?: string;
  reason: string | null;
};
function Portrait({
  kind,
  className = '',
}: {
  kind: EntityKind;
  className?: string;
}) {
  return (
    <Image
      width={256}
      height={192}
      unoptimized
      className={`tac-portrait ${className}`}
      src={`/art/tactical/${kind}.png`}
      alt={spec(kind).name}
      draggable={false}
    />
  );
}
const MAP_W = SECTOR.maxX - SECTOR.minX,
  MAP_H = SECTOR.maxZ - SECTOR.minZ;
/** Paints the commander's fog over the minimap: black where unseen, dim where remembered. */
function MiniMapShroud({ fog }: { fog: FogGrid }) {
  const {
    bounds: FOG_BOUNDS,
    columns: FOG_COLUMNS,
    rows: FOG_ROWS,
    sector: SECTOR,
  } = fog;
  const MAP_W = SECTOR.maxX - SECTOR.minX,
    MAP_H = SECTOR.maxZ - SECTOR.minZ;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const image = context.createImageData(FOG_COLUMNS, FOG_ROWS);
    let painted = -1;
    const paint = () => {
      if (painted === fog.version) return;
      painted = fog.version;
      const px = image.data,
        d = fog.data;
      for (let i = 0; i < d.length; i += 4) {
        const visible = d[i] / 255,
          explored = d[i + 1] / 255;
        px[i] = 4;
        px[i + 1] = 10;
        px[i + 2] = 16;
        px[i + 3] = Math.round(255 * (1 - visible) * (1 - explored * 0.45));
      }
      context.putImageData(image, 0, 0);
    };
    paint();
    const timer = setInterval(paint, 250);
    return () => clearInterval(timer);
  }, [fog, FOG_COLUMNS, FOG_ROWS]);
  // The fog grid extends past the sector; the overflow is cropped by the wrapper.
  return (
    <div className="tac-map-shroud" aria-hidden="true">
      <canvas
        ref={canvas}
        width={FOG_COLUMNS}
        height={FOG_ROWS}
        style={{
          width: `${(FOG_BOUNDS.width / MAP_W) * 100}%`,
          height: `${(FOG_BOUNDS.depth / MAP_H) * 100}%`,
          left: `${((FOG_BOUNDS.minX - SECTOR.minX) / MAP_W) * 100}%`,
          top: `${((FOG_BOUNDS.minZ - SECTOR.minZ) / MAP_H) * 100}%`,
        }}
      />
    </div>
  );
}
const MINIMAP_COLORS: Record<Terrain, string> = {
  land: '#435e54',
  plateau: '#5d6d5e',
  shore: '#6e6a54',
  bank: '#5c675d',
  marsh: '#3b4f3d',
  ford: '#4c6a6d',
  ramp: '#66705f',
  bridge: '#83948a',
  river: '#234859',
  road: '#7d7a6c',
  lake: '#1f4556',
  cliff: '#2d3230',
  sea: '#1d3d4b',
  void: '#101a1c',
};
/** One pixel per metre of the sector, classified by the shared terrain rules. */
function paintLandscape(canvas: HTMLCanvasElement, map: TerrainMap) {
  const { terrainAt, bounds } = map;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(MAP_W, MAP_H);
  const rgb = new Map<Terrain, [number, number, number]>();
  for (const [kind, hex] of Object.entries({
    ...MINIMAP_COLORS,
    land: BATTLEFIELDS[map.mapId].surface.heath,
    plateau:
      map.design.atmosphere.snowCover > 0.8
        ? BATTLEFIELDS[map.mapId].surface.snow
        : BATTLEFIELDS[map.mapId].surface.rock,
    shore: BATTLEFIELDS[map.mapId].surface.shore,
    marsh: BATTLEFIELDS[map.mapId].surface.marsh,
    river: BATTLEFIELDS[map.mapId].surface.water,
    lake: BATTLEFIELDS[map.mapId].surface.water,
    sea: BATTLEFIELDS[map.mapId].surface.water,
  }) as [Terrain, string][])
    rgb.set(kind, [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
  for (let row = 0; row < MAP_H; row++)
    for (let col = 0; col < MAP_W; col++) {
      const [r, g, b] = rgb.get(
        terrainAt(
          bounds.minX + ((col + 0.5) / MAP_W) * (bounds.maxX - bounds.minX),
          bounds.minZ + ((row + 0.5) / MAP_H) * (bounds.maxZ - bounds.minZ),
        ),
      )!;
      image.data.set([r, g, b, 255], (row * MAP_W + col) * 4);
    }
  ctx.putImageData(image, 0, 0);
}
/** One line per flag in play: taken, carried, dropped or being picked up. */
function flagAlert(f: BattleFlag) {
  const ours = f.team === 'blue';
  switch (flagState(f)) {
    case 'carried':
      return ours
        ? `${f.name}'s flag has been taken! Stop the carrier`
        : `${f.name}'s flag taken! Bring it home`;
    case 'dropped':
      return ours
        ? `${f.name}'s flag dropped · touch it to return it`
        : `${f.name}'s flag dropped · pick it up again`;
    default:
      return ours
        ? `${f.name}'s flag is being taken!`
        : `Taking ${f.name}'s flag`;
  }
}
function MiniMap({
  battle,
  owner,
  fog,
  viewRef,
  onFocus,
  pings,
}: {
  battle: Battle;
  owner: string;
  fog: FogGrid;
  /** Outline of the ground the camera currently sees; the scene updates it directly. */
  viewRef: RefObject<SVGPolygonElement | null>;
  onFocus: (p: Point) => void;
  /** Recent under-attack alerts, pulsing where the viewer's forces were hit. */
  pings: readonly DamageAlert[];
}) {
  const map = terrainFor(battle);
  const { bounds: SECTOR, baseAt } = map;
  const MAP_W = SECTOR.maxX - SECTOR.minX,
    MAP_H = SECTOR.maxZ - SECTOR.minZ;

  const scrub = useRef<number | null>(null);
  const carriers = new Set(
    (battle.flags ?? []).map(carrierOf).filter((id) => id !== undefined),
  );
  const focusAt = (e: {
    clientX: number;
    clientY: number;
    currentTarget: Element;
  }) => {
    const r = e.currentTarget.getBoundingClientRect();
    onFocus({
      x: SECTOR.minX + ((e.clientX - r.left) / r.width) * MAP_W,
      z: SECTOR.minZ + ((e.clientY - r.top) / r.height) * MAP_H,
    });
  };
  const land = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (land.current) paintLandscape(land.current, map);
  }, [map]);
  return (
    <div className="tac-minimap">
      <div className="tac-panel-heading">
        <span>
          <Radar size={13} /> RADAR
        </span>
        <span>{BATTLEFIELDS[map.mapId].name.toUpperCase()} · N ↑</span>
      </div>
      <div className="tac-map-frame">
        <button
          className="tac-map-button"
          style={{ '--tac-map-ratio': MAP_W / MAP_H } as CSSProperties}
          aria-label="Tactical minimap. Click or drag to move the camera; Enter to recenter."
          onClick={(e) => {
            if (e.detail === 0)
              onFocus(
                baseAt(
                  battle.commanders.find((c) => c.id === owner)?.slot ?? 0,
                ),
              );
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            scrub.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            focusAt(e);
          }}
          onPointerMove={(e) => {
            if (scrub.current === e.pointerId) focusAt(e);
          }}
          onPointerUp={(e) => {
            if (scrub.current === e.pointerId) scrub.current = null;
          }}
          onPointerCancel={() => {
            scrub.current = null;
          }}
        >
          <canvas
            ref={land}
            className="tac-map-land"
            width={300}
            height={260}
            aria-hidden="true"
          />
          <svg
            className="tac-map-base"
            viewBox={`${SECTOR.minX} ${SECTOR.minZ} ${MAP_W} ${MAP_H}`}
            aria-hidden="true"
          >
            {(battle.flags ?? []).map((f) => (
              <g key={f.id} opacity={f.capturedAt === undefined ? 1 : 0.35}>
                <circle
                  cx={flagHome(f).x}
                  cy={flagHome(f).z}
                  r={f.radius}
                  fill="none"
                  stroke={f.team === 'red' ? '#fa7c65' : '#87f6de'}
                  strokeWidth={1.6}
                />
                <path
                  d={`M${f.x} ${f.z + 3}V${f.z - 7}l6 2.5-6 2.5`}
                  stroke="#f4efe4"
                  strokeWidth={1.2}
                  fill={f.team === 'red' ? '#fa7c65' : '#87f6de'}
                />
              </g>
            ))}
            {(battle.deposits ?? []).map((d) => (
              <rect
                key={d.id}
                x={d.x - 3.5}
                y={d.z - 3.5}
                width={7}
                height={7}
                transform={`rotate(45 ${d.x} ${d.z})`}
                fill={d.amount > 0 ? '#7fe3d6' : '#4e615f'}
                opacity={
                  d.amount > 0 ? 0.35 + 0.65 * (d.amount / d.capacity) : 0.6
                }
              />
            ))}
            {battle.entities.map((e) => {
              // A flag carrier is always on the radar (see the markers above the shroud).
              if (carriers.has(e.id)) return null;
              if (e.team === 'red') {
                const seen = fog.sight(e);
                if (
                  seen === 'hidden' ||
                  (seen === 'explored' && isUnit(e.kind))
                )
                  return null;
              }
              return (
                <rect
                  key={e.id}
                  x={e.x - 1.8}
                  y={e.z - 1.8}
                  width={isUnit(e.kind) ? 3.6 : 5.5}
                  height={isUnit(e.kind) ? 3.6 : 5.5}
                  fill={
                    e.team === 'red'
                      ? '#fa7c65'
                      : e.owner === owner
                        ? '#87f6de'
                        : '#91bde7'
                  }
                />
              );
            })}
          </svg>
          <MiniMapShroud fog={fog} />
          <svg
            className="tac-map-view"
            viewBox={`${SECTOR.minX} ${SECTOR.minZ} ${MAP_W} ${MAP_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon
              ref={viewRef}
              points=""
              stroke="#ecf5e4"
              strokeWidth={1.4}
              fill="#ffffff0c"
              vectorEffect="non-scaling-stroke"
            />
            <RadarPings alerts={pings} />
            <SiteRadarMarkers battle={battle} />
            {battle.entities
              .filter((e) => carriers.has(e.id))
              .map((e) => (
                <g key={e.id} className="tac-map-carrier">
                  <circle
                    cx={e.x}
                    cy={e.z}
                    r={7}
                    fill="none"
                    stroke={e.team === 'red' ? '#fa7c65' : '#87f6de'}
                    strokeWidth={1.6}
                    vectorEffect="non-scaling-stroke"
                  >
                    <animate
                      attributeName="r"
                      values="5;9;5"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  <rect
                    x={e.x - 2.2}
                    y={e.z - 2.2}
                    width={4.4}
                    height={4.4}
                    fill={e.team === 'red' ? '#fa7c65' : '#87f6de'}
                  />
                </g>
              ))}
          </svg>
          <span className="tac-radar-glass" aria-hidden="true" />
          <span className="tac-radar-sweep" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
export default function TacticalCommand({
  player,
  token,
  onOperations,
  onDebrief,
}: {
  player: Player;
  token: string;
  onOperations: () => void;
  /** Leave a won operation's banner for its debrief; without it the banner leads to operations. */
  onDebrief?: () => void;
}) {
  const state = useBattleState();
  const map = terrainFor(state ?? {});
  const { baseAt } = map;
  const {
    produce,
    cancelTroops,
    research: startResearch,
    abandonResearch,
    sell,
    rally,
    rallyCategory,
    command,
    launch,
    persistent,
  } = useBattleActions();
  const now = useClock(),
    owner = player._id;
  const fog = useMemo(() => new FogGrid(undefined, map.bounds), [map]);
  const [localOrders] = useState(() => new LocalOrders());
  // Hover lives in this store, not state: pointer moves re-render only the card.
  const [hovered] = useState(() => new HoveredStructure());
  const sectorId = state?.id;
  useEffect(() => {
    if (!sectorId || !persistent) return;
    fog.reset(loadExplored(sectorId, owner, fog.columns * fog.rows));
    const save = () => saveExplored(sectorId, owner, fog);
    const timer = setInterval(save, 5000);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [fog, sectorId, owner, persistent]);
  const audio = useGameAudio();
  useBattleAudio(state, owner);
  const preview = useMemo(() => {
    const b = newBattle(0);
    joinBattle(b, { id: owner, name: player.name, culture: player.culture }, 0);
    b.entities = b.entities.filter((e) => e.team === 'blue');
    return b;
  }, [owner, player.name, player.culture]);
  const battle: Battle = state ?? preview;
  const alerts = useAttackAlerts(state, owner),
    alert = activeAlert(alerts),
    weaponNotice = useSuperweaponNotice(state, owner);
  const homeward = (battle.flags ?? []).filter(
    (f) =>
      f.team === 'red' &&
      f.capturedAt === undefined &&
      flagState(f) === 'carried',
  ).length;
  const remainingEnemies = state?.enemyForces ?? enemyForces(battle);
  const commander = state?.commanders.find((c) => c.id === owner);
  const income = useIncome(commander?.harvested, state?.tickAt);
  const [selectedIds, setSelectedIds] = useState<string[]>([]),
    [tab, setTab] = useState<Tab>('structures'),
    [quantity, setQuantity] = useState(1);
  const [aiming, setAiming] = useState(false);
  const [armed, setArmed] = useState<'move' | 'attackMove' | null>(null),
    [message, setMessage] = useState<{ text: string; error: boolean } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false),
    [tech, setTech] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [reports, setReports] = useState(false);
  const [hover, setHover] = useState<EntityKind | ResearchKey | null>(null),
    [pinned, setPinned] = useState<EntityKind | ResearchKey | null>(null);
  const [placing, setPlacing] = useState<{
    kind: PlaceableKind;
    rotation: number;
    position: Point | null;
  } | null>(null);
  const placementPending = useRef(false);
  const [box, setBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [focus, setFocus] = useState<CameraFocus>(() => ({
    ...baseAt(commander?.slot ?? 0),
    serial: 0,
  }));
  const viewRef = useRef<SVGPolygonElement>(null);
  const showViewport = useCallback(
    (corners: Point[]) =>
      viewRef.current?.setAttribute(
        'points',
        corners.map((c) => `${c.x.toFixed(1)},${c.z.toFixed(1)}`).join(' '),
      ),
    [],
  );
  // Flag carriers run home on their own and cannot be selected.
  const carriers = new Set(
    (battle.flags ?? []).map(carrierOf).filter((id) => id !== undefined),
  );
  const own = battle.entities.filter((e) => e.owner === owner),
    selected = own.filter(
      (e) =>
        selectedIds.includes(e.id) &&
        e.hp > 0 &&
        !carriers.has(e.id) &&
        (!e.readyAt || !isUnit(e.kind)),
    ),
    units = selected.filter((e) => isUnit(e.kind));
  const first = selected[0],
    power = powerFor(battle, owner),
    tier = tierOf(battle, owner),
    counts = fieldCount(battle, owner),
    queue = own
      .filter((e) => e.readyAt > 0 && !isUnit(e.kind))
      .sort((a, b) => a.readyAt - b.readyAt);
  const won = state?.status === 'victory',
    mapName =
      BATTLEFIELDS[isMapId(battle.mapId) ? battle.mapId : DEFAULT_MAP_ID].name,
    hostileFlags = !!battle.flags?.some((f) => f.team === 'red');
  const active = Boolean(commander && state?.status === 'active'),
    needsClearance = active && tier === 1 && !commander?.researching;
  // The first-match coach: its step is read off the battle on every render.
  const tutorial = progressIn(useTutorialProgress(), sectorId),
    coaching = active && tutorialVisible(tutorial, state?.mode),
    coachIndex = tutorialStep(
      tutorialFacts(battle, owner, tutorial),
      tutorial.floor,
    ),
    coachSteps = tutorialSteps(battle),
    coachTarget = coaching ? coachSteps[coachIndex].target : undefined;
  const recordTutorial = (change: Partial<TutorialProgress>) =>
    saveTutorial({
      ...tutorial,
      status: tutorial.status === 'new' ? 'active' : tutorial.status,
      ...change,
    });
  const blockReason = (kind: EntityKind): string | null => {
    const s = spec(kind),
      count = isUnit(kind) ? quantity : 1;
    if (!active) return 'Deploy to this sector first';
    const locked = availability(battle, owner, kind);
    if (locked) return locked;
    if (isUnit(kind)) {
      const capped = isHarvester(kind)
        ? harvesterOrderReason(battle, owner, count)
        : null;
      if (capped) return capped;
      if (trainingCount(battle, owner) + count > TRAINING_QUEUE_LIMIT)
        return 'Troop queue full — choose a smaller batch';
      if (commander!.credits < priceOf(battle, owner, kind) * count)
        return 'Insufficient credits for this batch';
      return null;
    }
    if (queue.length >= CONSTRUCTION_QUEUE_LIMIT)
      return 'Construction queue full';
    if (commander!.credits < priceOf(battle, owner, kind))
      return 'Insufficient credits';
    if (s.power > 0 && power.used + s.power > power.capacity)
      return 'More power required';
    return null;
  };
  // A structure chosen before it is affordable or unlocked stays armed; the
  // ghost shows why, and the first click after the block clears places it.
  const placementReason = placing
    ? (blockReason(placing.kind) ??
      (placing.position
        ? placementError(battle, owner, placing.kind, {
            position: placing.position,
            rotation: placing.rotation,
          })
        : null))
    : null;
  const hoverPlacement = useCallback((point: Point | null) => {
    const p = point ? snapPlacement(point) : null;
    setPlacing((previous) =>
      !previous ||
      (previous.position?.x === p?.x && previous.position?.z === p?.z)
        ? previous
        : { ...previous, position: p },
    );
  }, []);
  const cancelPlacement = () => {
    if (!placementPending.current) setPlacing(null);
  };
  const rotatePlacement = () => {
    if (!placementPending.current)
      setPlacing((p) => (p ? { ...p, rotation: (p.rotation + 1) % 4 } : p));
  };
  const beginPlacement = (kind: PlaceableKind) => {
    setPlacing({ kind, rotation: 2, position: null });
    setArmed(null);
    setBox(null);
    setMessage(null);
    setSidebar(false);
    setReports(false);
  };
  async function placeBuilding(position: Point) {
    if (!placing || !state || !active || busy || placementPending.current)
      return;
    const placement = {
      position: snapPlacement(position),
      rotation: placing.rotation,
    };
    hoverPlacement(placement.position);
    const reason =
      blockReason(placing.kind) ??
      placementError(battle, owner, placing.kind, placement);
    if (reason) {
      setMessage({ text: reason, error: true });
      return;
    }
    placementPending.current = true;
    setBusy(true);
    try {
      await produce({
        kind: placing.kind,
        placement,
      });
      setPlacing(null);
      audio.say('queued');
      setMessage({
        text:
          placing.kind === 'outpost'
            ? `Forward outpost queued. Its ${buildRadius('outpost')}m build radius opens when construction finishes.`
            : `${spec(placing.kind).name} placed. Construction queued.`,
        error: false,
      });
    } catch (error) {
      const text = commandError(error);
      const cue = commandFailureCue(text);
      if (cue) audio.say(cue);
      setMessage({ text, error: true });
    } finally {
      placementPending.current = false;
      setBusy(false);
    }
  }
  const selectedRef = selected.map((e) => e.id).join(',');
  // The selection before a roster double-click began, so it can be narrowed.
  const rosterPrevious = useRef<string[]>([]);
  const select = useCallback(
    (ids: string[], add: boolean) => {
      if (placing) return;
      // Harvesters and flag carriers run themselves and never enter the selection.
      ids = ids.filter(
        (id) =>
          !(battle.flags ?? []).some((f) => carrierOf(f) === id) &&
          !battle.entities.some((e) => e.id === id && isHarvester(e.kind)),
      );
      setSelectedIds((previous) => mergeSelection(previous, ids, add));
      setArmed(null);
      if (
        active &&
        ids.some((id) =>
          battle.entities.some(
            (e) => e.id === id && isUnit(e.kind) && !e.readyAt,
          ),
        )
      )
        audio.say('select');
    },
    [active, audio, battle.entities, battle.flags, placing, setArmed],
  );
  const look = useCallback(
    (p: Point) =>
      setFocus((previous) => ({ ...p, serial: previous.serial + 1 })),
    [],
  );
  const jumpToAlert = (a: DamageAlert | null) => {
    if (a) look({ x: a.x, z: a.z });
  };
  const [groups, setGroups] = useControlGroups(sectorId, owner, persistent);
  const lastGroupTap = useRef<GroupTap | null>(null);
  // Only living, deployed combat troops answer a group call.
  const troops = new Map(
    own
      .filter(
        (e) => isUnit(e.kind) && !isHarvester(e.kind) && !e.readyAt && e.hp > 0,
      )
      .map((e) => [e.id, e]),
  );
  // Before the sector loads the preview battle stands in; never prune against it.
  const liveGroups = state
    ? pruneGroups(groups, (id) => own.some((e) => e.id === id && e.hp > 0))
    : groups;
  const centreGroup = (ids: string[]) => {
    if (!ids.length) return;
    let x = 0,
      z = 0;
    for (const id of ids) {
      const e = troops.get(id)!;
      x += e.x;
      z += e.z;
    }
    look({ x: x / ids.length, z: z / ids.length });
  };
  const bindGroup = (slot: number, add: boolean) => {
    const ids = units.map((e) => e.id).filter((id) => troops.has(id));
    if (!ids.length) {
      setMessage({
        text: `Select troops to bind to group ${slot}.`,
        error: true,
      });
      return;
    }
    const next = add
      ? addToGroup(liveGroups, slot, ids)
      : assignGroup(liveGroups, slot, ids);
    setGroups(next);
    const size = next[slot]?.length ?? 0;
    setMessage({
      text: `Group ${slot} ${add ? 'reinforced' : 'bound'} · ${size} ${size === 1 ? 'troop' : 'troops'}.`,
      error: false,
    });
  };
  const recallTroops = (slot: number) =>
    recallGroup(liveGroups, slot, (id) => troops.has(id));
  const pressGroup = (slot: number, at: number) => {
    const twice = isDoubleTap(lastGroupTap.current, slot, at);
    lastGroupTap.current = { slot, at };
    setGroups(liveGroups);
    const ids = recallTroops(slot);
    if (!ids.length) {
      if (groups[slot])
        setMessage({ text: `Group ${slot} has no troops left.`, error: true });
      return;
    }
    select(ids, false);
    if (twice) centreGroup(ids);
  };
  async function act(
    fn: () => Promise<unknown>,
    success?: string,
    cue?: VoiceCue,
  ) {
    if (busy) return;
    audio.unlock();
    setBusy(true);
    try {
      await fn();
      if (cue) audio.say(cue);
      if (success) setMessage({ text: success, error: false });
    } catch (e) {
      const cue = commandFailureCue(commandError(e));
      if (cue) audio.say(cue);
      setMessage({
        text: commandError(e),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  const orderSequence = useRef(0);
  async function order(kind: OrderKind, point?: Point, target?: string) {
    const ids = selectedRef
      ? selectedRef
          .split(',')
          .filter((id) =>
            battle.entities.some((e) => e.id === id && isUnit(e.kind)),
          )
      : [];
    if (!state || !active || !ids.length) {
      setMessage({ text: 'Select your deployed units first.', error: true });
      return;
    }
    const sequence = ++orderSequence.current;
    setArmed(null);
    audio.say(orderCue(kind));
    // Troops answer on the next frame; the server's route replaces the head start.
    const anticipated =
      point && !target && (kind === 'move' || kind === 'attackMove')
        ? localOrders.issue(ids, kind, point)
        : 0;
    try {
      await command({
        ids,
        order: kind,
        point,
        target,
      });
      if (
        coaching &&
        !tutorial.commanded &&
        (kind === 'move' || kind === 'attackMove' || kind === 'attack')
      )
        recordTutorial({ commanded: true });
      if (sequence !== orderSequence.current) return;
      setMessage({
        text:
          kind === 'attack'
            ? 'Engaging hostile target.'
            : kind === 'attackMove'
              ? 'Advancing. Engage hostiles en route.'
              : kind === 'move'
                ? 'Moving to position.'
                : kind === 'harvest'
                  ? 'Harvesters working the ore field.'
                  : kind === 'hold'
                    ? 'Holding position.'
                    : 'Orders cancelled.',
        error: false,
      });
    } catch (e) {
      if (anticipated) localOrders.cancel(ids, anticipated);
      if (sequence !== orderSequence.current) return;
      setMessage({
        text: commandError(e),
        error: true,
      });
    }
  }
  const sidebarRef = useRef<HTMLElement>(null);
  async function setCategoryRally(category: UnitCategory, point: Point) {
    // Narrow screens hide the sidebar; a tap on the map must not reuse a closed tab.
    if (!state || !active || !sidebarRef.current?.checkVisibility()) return;
    try {
      const count = await rallyCategory({
        category,
        point,
      });
      setMessage({
        text: `${CATEGORY_NOUNS[category]} rally point set${
          typeof count === 'number' && count > 1
            ? ` for ${count} buildings`
            : ''
        }.`,
        error: false,
      });
    } catch (e) {
      setMessage({ text: commandError(e), error: true });
    }
  }
  async function setRallyPoint(id: string, point: Point) {
    if (!state || !active) return;
    try {
      await rally({ id, point });
      setMessage({ text: 'Rally point set.', error: false });
    } catch (e) {
      setMessage({ text: commandError(e), error: true });
    }
  }
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);
  // A superweapon target cursor only while the weapon is charged.
  const weapon = active ? ownWeapon(battle, owner) : undefined,
    weaponReady =
      !!weapon && chargeRemaining(battle, weapon, now || battle.tickAt) === 0,
    aimingNow = aiming && weaponReady && !placing;
  function toggleAim() {
    if (!weapon) return;
    audio.unlock();
    if (!weaponReady) {
      setMessage({
        text: `${weaponName(weapon.kind)} is still charging.`,
        error: true,
      });
      return;
    }
    setArmed(null);
    setAiming((a) => !a);
  }
  function fireSuperweapon(point: Point) {
    if (!state || !weapon || !aimingNow) return;
    const reason = targetError(battle, owner, weapon.kind, point);
    if (reason) {
      setMessage({ text: reason, error: true });
      return;
    }
    setAiming(false);
    void act(
      () => launch({ point }),
      `${weaponName(weapon.kind)} launched. Impact in seconds.`,
      'attack',
    );
  }
  const handleKey = useEffectEvent((e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) ||
        e.target.isContentEditable)
    )
      return;
    if (help || tech || document.querySelector('[data-slot=dialog-content]'))
      return;
    // Control groups: Ctrl, ⌘ or Alt + number binds (Shift adds); the number alone recalls.
    const slot = groupSlot(e.code);
    if (slot && !placing) {
      const bind = e.ctrlKey || e.metaKey || e.altKey;
      if (bind || !e.shiftKey) {
        e.preventDefault();
        if (e.repeat) return;
        if (bind) bindGroup(slot, e.shiftKey);
        else pressGroup(slot, e.timeStamp);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (ORBIT_KEYS.has(k)) return;
    if (k === 'escape' && aiming) {
      setAiming(false);
      e.preventDefault();
      return;
    }
    if (k === 'escape' && (sidebar || reports)) {
      setSidebar(false);
      setReports(false);
      e.preventDefault();
      return;
    }
    if (
      e.target instanceof HTMLElement &&
      e.target.closest('.tac-build-panel, .tac-mission-panel, .tac-briefing') &&
      [
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        'home',
        'end',
        'pageup',
        'pagedown',
        'enter',
        ' ',
      ].includes(k)
    )
      return;
    if (placing && k !== 'home' && !SCROLL_KEYS.has(k)) {
      if (['r', 'escape', 'enter', 'm', 'q', 'h', 'x', 'f'].includes(k))
        e.preventDefault();
      if (k === 'escape') cancelPlacement();
      else if (k === 'r' && !e.repeat) rotatePlacement();
      else if (k === 'enter' && placing.position)
        void placeBuilding(placing.position);
      return;
    }
    if (
      ['m', 'q', 'h', 'x', 't', 'escape', 'f', 'home'].includes(k) ||
      SCROLL_KEYS.has(k)
    )
      e.preventDefault();
    if (k === 'g') {
      e.preventDefault();
      toggleAim();
      return;
    }
    if (k === 'm') setArmed('move');
    else if (k === 'q') setArmed('attackMove');
    else if (k === 'h') void order('hold');
    else if (k === 'x') void order('stop');
    else if (k === 't') setTech(true);
    else if (k === 'escape') {
      setArmed(null);
      setSelectedIds([]);
    } else if (k === 'f')
      select(
        own
          .filter((e) => isUnit(e.kind) && !isHarvester(e.kind) && !e.readyAt)
          .map((e) => e.id),
        false,
      );
    else if (k === 'home') look(baseAt(commander?.slot ?? 0));
    // Arrow keys and WASD scroll the camera continuously; the scene's camera rig owns them.
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const cameraFocus =
    focus.serial === 0 && commander
      ? { ...baseAt(commander.slot), serial: commander.slot + 1 }
      : { ...focus, serial: focus.serial + 10 };
  // Other factions' signature kit never appears; the commander's own sits beside the shared roster.
  const assets: EntityKind[] = (
    tab === 'structures'
      ? buildingKinds.filter((k) => k !== 'hq')
      : tab === 'research'
        ? []
        : unitKinds.filter((k) => categoryOf(k) === tab)
  ).filter((k) => inRoster(battle, owner, k));
  const elapsed = Math.max(
    0,
    Math.floor(((now || battle.tickAt) - battle.startedAt) / 1000),
  );
  const home = baseAt(commander?.slot ?? 0);
  const firstStructure = first && !isUnit(first.kind) ? first : null;
  const structureRefund = firstStructure
    ? Math.floor(
        priceOf(battle, owner, firstStructure.kind) /
          (firstStructure.readyAt ? 1 : 2),
      )
    : 0;
  function removeBuilding() {
    if (
      !state ||
      !active ||
      !firstStructure ||
      firstStructure.kind === 'hq' ||
      placing
    )
      return;
    const structure = firstStructure;
    void act(async () => {
      const refund = await sell({
        id: structure.id,
      });
      setSelectedIds((ids) => ids.filter((id) => id !== structure.id));
      setMessage({
        text: `${spec(structure.kind).name} ${structure.readyAt ? 'construction cancelled' : 'removed'}. ₭ ${refund} refunded.`,
        error: false,
      });
    });
  }
  /** The selected command or research station offers its own research, so the lock hints lead somewhere. */
  const researchAction = (() => {
    if (
      !active ||
      !firstStructure ||
      firstStructure.readyAt > 0 ||
      (firstStructure.kind !== 'hq' && firstStructure.kind !== 'lab')
    )
      return null;
    const projects = researchKeys.filter(
      (k) =>
        RESEARCH[k].at === firstStructure.kind && inResearchRoster(battle, k),
    );
    const next = projects.find((k) => !commander?.research?.includes(k));
    if (!next) return null;
    const r = RESEARCH[next],
      current = commander?.researching,
      locked = researchAvailability(battle, owner, next),
      openTab = projects.length > 1;
    return {
      key: next,
      name: r.name,
      role: r.role,
      openTab,
      reason: openTab
        ? null
        : (locked ??
          (commander!.credits < r.cost ? 'Insufficient credits' : null)),
      label: openTab
        ? 'Research projects'
        : current
          ? `Researching ${RESEARCH[current.key as ResearchKey].name}`
          : `Research ${r.name} · ₭ ${r.cost}`,
    };
  })();
  const canRally =
    firstStructure &&
    !firstStructure.readyAt &&
    isProducer(firstStructure.kind);
  const oreRemaining = (battle.deposits ?? []).reduce(
    (n, d) => n + d.amount,
    0,
  );
  // Without ore the economy readout counts the derricks this commander holds instead.
  const mode = skirmishRules(battle),
    derricks = (battle.sites ?? []).filter((s) => s.kind === 'derrick'),
    heldDerricks = derricks.filter((s) => s.holder === owner).length;
  const clockNow = now || battle.tickAt;
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  /** Progress and queued counts per blueprint, painted over the cameos. */
  const production = new Map<string, { progress: number; count: number }>();
  queue.forEach((e, i) => {
    const entry = production.get(e.kind) ?? { progress: 0, count: 0 };
    entry.count += 1;
    if (i === 0)
      entry.progress = clamp(
        100 -
          ((e.readyAt - clockNow) /
            1000 /
            buildSeconds(battle, owner, e.kind)) *
            100,
      );
    production.set(e.kind, entry);
  });
  for (const q of (battle.training ?? []).filter((q) => q.owner === owner)) {
    const entry = production.get(q.kind) ?? { progress: 0, count: 0 };
    entry.count += q.remaining;
    // The cameo shows the unit closest to rolling out.
    if (q.readyAt)
      entry.progress = Math.max(
        entry.progress,
        clamp(
          100 -
            ((q.readyAt - clockNow) /
              1000 /
              buildSeconds(battle, owner, q.kind)) *
              100,
        ),
      );
    production.set(q.kind, entry);
  }
  if (commander?.researching) {
    const key = commander.researching.key as ResearchKey;
    production.set(key, {
      count: 1,
      progress: clamp(
        100 -
          ((commander.researching.readyAt - clockNow) /
            1000 /
            RESEARCH[key].seconds) *
            100,
      ),
    });
  }
  for (const key of commander?.researchQueue ?? [])
    production.set(key, { count: 1, progress: 0 });
  const researchReason = (k: ResearchKey): string | null => {
    if (!active) return 'Deploy to this sector first';
    if (commander?.research?.includes(k)) return null;
    return (
      researchAvailability(battle, owner, k) ??
      (commander!.credits < RESEARCH[k].cost ? 'Insufficient credits' : null)
    );
  };
  const peekKey = hover ?? pinned;
  const peek: Peek | null = !peekKey
    ? null
    : researchKeys.includes(peekKey as ResearchKey)
      ? (() => {
          const r = RESEARCH[peekKey as ResearchKey];
          return {
            name: r.name,
            role: r.role,
            cost: r.cost,
            seconds: r.seconds,
            tier: 1,
            via: TACTICAL_BUILDINGS[r.at].name,
            reason: researchReason(peekKey as ResearchKey),
          };
        })()
      : (() => {
          const kind = peekKey as EntityKind,
            s = spec(kind),
            count = isUnit(kind) ? quantity : 1;
          return {
            name: count > 1 ? `${s.name} ×${count}` : s.name,
            role: s.role,
            cost: priceOf(battle, owner, kind) * count,
            seconds: buildSeconds(battle, owner, kind),
            power: s.power,
            tier: (s as { tier?: number }).tier ?? 1,
            reason: blockReason(kind),
          };
        })();
  return (
    <main
      className={`tactical-game ${armed || placing || aimingNow || (active && units.length) ? 'tac-targeting' : ''} ${won ? 'is-complete' : ''}`}
    >
      <div className="tac-scene" aria-label="3D cooperative battlefield">
        <TacticalScene
          battle={battle}
          owner={owner}
          fog={fog}
          orders={localOrders}
          selected={selectedIds}
          armed={!!armed}
          placement={
            active && placing ? { ...placing, reason: placementReason } : null
          }
          onPlacementHover={hoverPlacement}
          onPlace={(point, touch) => {
            if (touch) hoverPlacement(point);
            else void placeBuilding(point);
          }}
          onCancelPlacement={cancelPlacement}
          focus={cameraFocus}
          onViewport={showViewport}
          onSpaceTap={() => jumpToAlert(alerts.latest)}
          onSelect={select}
          onGround={(point) => void order(armed ?? 'move', point)}
          aim={
            aimingNow && weapon
              ? { kind: weapon.kind, radius: SUPERWEAPONS[weapon.kind].radius }
              : null
          }
          onAim={fireSuperweapon}
          onCancelAim={() => setAiming(false)}
          onEnemy={(id) => void order('attack', undefined, id)}
          onRally={(id, point) => void setRallyPoint(id, point)}
          rallyCategory={
            tab === 'structures' || tab === 'research' ? null : tab
          }
          onRallyCategory={(category, point) =>
            void setCategoryRally(category, point)
          }
          onBox={setBox}
          hovered={hovered}
        />
        {box && (
          <div
            className="tac-select-box"
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
            }}
          />
        )}
      </div>
      <StructureHoverCard
        hovered={hovered}
        battle={battle}
        owner={owner}
        fog={fog}
        now={clockNow}
        hidden={!!box || !!placing || aimingNow}
      />
      <header className="tac-topbar">
        <div className="tac-brand">
          <div className="tac-insignia">
            <Mountain size={22} />
          </div>
          <div>
            <strong>NOORDHEIM</strong>
            <span>NORTHERN COMMAND</span>
          </div>
        </div>
        <div className="tac-stat tac-credits">
          <span className="tac-stat-icon">₭</span>
          <div>
            <small>Credits</small>
            <CreditTicker target={Math.floor(commander?.credits ?? 0)} />
          </div>
          <em title="Ore delivered per second over the last 30 seconds">
            +{active ? Math.round(income + 1) : 0}/s
          </em>
        </div>
        <div
          className={`tac-stat ${power.used > power.capacity ? 'overload' : ''}`}
        >
          <Zap size={22} />
          <div>
            <small>Power</small>
            <strong>
              {commander ? power.used : 0}
              <span> / {commander ? power.capacity : 0}</span>
            </strong>
          </div>
          <div className="tac-power-meter">
            <i
              style={{
                width: `${Math.min(100, (power.used / Math.max(1, power.capacity)) * 100)}%`,
              }}
            />
          </div>
        </div>
        {mode.ore ? (
          <div className="tac-stat tac-ore">
            <Gem size={20} />
            <div>
              <small>Harvesters · ore</small>
              <strong>
                {counts.harvesters}
                <span>
                  {' '}
                  / {harvesterLimit(battle, owner)} · ₭{' '}
                  {fmt(Math.floor(oreRemaining))}
                </span>
              </strong>
            </div>
          </div>
        ) : (
          <div
            className="tac-stat tac-ore"
            title={`Each derrick you hold pays ₭ ${derrickIncome(battle)} every ${TECH_SITES.derrick.pulseSeconds} s`}
          >
            <Droplet size={20} />
            <div>
              <small>Oil derricks</small>
              <strong>
                {heldDerricks}
                <span>
                  {' '}
                  / {derricks.length} · +₭{' '}
                  {fmt(
                    (heldDerricks * derrickIncome(battle)) /
                      TECH_SITES.derrick.pulseSeconds,
                  )}
                  /s
                </span>
              </strong>
            </div>
          </div>
        )}
        <button
          className="tac-stat tac-tier"
          onClick={() => setTech(true)}
          title="Open the tech tree (T)"
        >
          <GitBranch size={20} />
          <div>
            <small>Clearance</small>
            <strong>Tier {commander ? tier : 1}</strong>
          </div>
          {needsClearance && <em>Research T2</em>}
        </button>
        <div className="tac-status">
          <div>
            <span className={active ? 'tac-live' : ''} />
            {active
              ? // A skirmish mission is solo only, so its name stands in for SOLO.
                `${difficultyFor(battle).name.toUpperCase()} · ${battle.skirmish ? skirmishName(battle).toUpperCase() : state?.mode === 'solo' ? 'SOLO' : 'CO-OP'}`
              : state?.status === 'victory'
                ? 'SECTOR SECURED'
                : 'OPERATIONS'}
          </div>
          <small>
            {commander
              ? `${Math.floor(elapsed / 60)
                  .toString()
                  .padStart(
                    2,
                    '0',
                  )}:${(elapsed % 60).toString().padStart(2, '0')}`
              : '--:--'}
            {active &&
              remainingEnemies.headquarters === 0 &&
              ' · Hostile production stopped'}
          </small>
        </div>
        <button
          className={`tac-icon-button tac-mobile-build ${coachTarget && !sidebar ? 'coached' : ''}`}
          onClick={() => {
            setSidebar(!sidebar);
            setReports(false);
          }}
          aria-expanded={sidebar}
          aria-controls="tactical-production"
          aria-label="Toggle production"
        >
          <Hammer size={19} />
        </button>
        <button
          className="tac-help-button"
          onClick={() => setHelp(true)}
          aria-label="How to play"
          title="How to play · controls and field manual"
        >
          <CircleHelp size={18} />
          <span>How to play</span>
        </button>
        <button
          className="tac-operations-button"
          onClick={onOperations}
          aria-label="Open operations menu"
        >
          <Users size={18} />
          <span>Operations</span>
        </button>
      </header>
      <SuperweaponStrip
        battle={battle}
        owner={owner}
        now={clockNow}
        aiming={aimingNow}
        onAim={toggleAim}
        onFocus={look}
      />
      <aside
        ref={sidebarRef}
        id="tactical-production"
        aria-label="Radar and field production"
        className={`tac-sidebar ${sidebar ? 'is-open' : ''}`}
      >
        <div className="tac-radar tac-plate tac-rivets">
          <MiniMap
            battle={battle}
            owner={owner}
            fog={fog}
            viewRef={viewRef}
            onFocus={look}
            pings={alerts.recent}
          />
        </div>
        <div className="tac-sidebar-body">
          <div
            className={`tac-power-column ${
              power.used > power.capacity
                ? 'overload'
                : power.used > power.capacity * 0.85
                  ? 'warn'
                  : ''
            }`}
            title={`Power ${power.used} / ${power.capacity}`}
          >
            <span>POWER</span>
            <div>
              <i
                style={{
                  height: `${commander ? Math.min(100, (power.used / Math.max(1, power.capacity)) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="tac-production tac-plate">
            <div className="tac-panel-heading">
              <span>
                <Hammer size={13} /> PRODUCTION
              </span>
              <button
                className="tac-mobile-build"
                onClick={() => setSidebar(false)}
                aria-label="Close production"
              >
                <X size={16} />
              </button>
            </div>
            <div
              className="tac-production-tabs"
              role="tablist"
              aria-label="Production category"
            >
              {TABS.map((t) => {
                const pending =
                  t.key === 'structures'
                    ? queue.length
                    : t.key === 'research'
                      ? (commander?.researching ? 1 : 0) +
                        (commander?.researchQueue?.length ?? 0)
                      : trainingCount(battle, owner, t.key);
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    aria-label={t.label}
                    title={t.label}
                    className={
                      (t.key === 'research' &&
                        needsClearance &&
                        tab !== 'research') ||
                      (coachTarget?.tab === t.key && tab !== t.key)
                        ? 'tac-tab-hint'
                        : undefined
                    }
                    onClick={() => {
                      setTab(t.key);
                      setPinned(null);
                      if (t.key !== 'structures') cancelPlacement();
                    }}
                  >
                    <t.icon size={15} />
                    <small>{t.label}</small>
                    {pending > 0 && <b>{pending}</b>}
                  </button>
                );
              })}
            </div>
            <div
              className="tac-production-body"
              aria-label="Blueprints and production queue"
            >
              <p className="tac-tab-title">
                {TABS.find((t) => t.key === tab)?.label}
                {tab !== 'structures' && tab !== 'research' && (
                  <span>
                    {tab === 'vehicle' && mode.ore
                      ? `${counts.units}/${commandLimit(battle)} field · ${counts.harvesters}/${harvesterLimit(battle, owner)} harv.`
                      : `${counts.units}/${commandLimit(battle)} field units`}
                  </span>
                )}
              </p>
              {tab !== 'structures' && tab !== 'research' && (
                <TroopBatchSize quantity={quantity} onChange={setQuantity} />
              )}
              {tab !== 'structures' && tab !== 'research' && (
                <small className="tac-rally-hint">
                  Nothing selected? Click land to send new{' '}
                  {tab === 'vehicle'
                    ? 'vehicles'
                    : CATEGORY_NOUNS[tab].toLowerCase()}{' '}
                  there.
                </small>
              )}
              {tab === 'research' ? (
                <ul className="tac-cameo-grid">
                  {researchKeys
                    .filter((k) => inResearchRoster(battle, k))
                    .map((k) => {
                      const r = RESEARCH[k],
                        done = commander?.research?.includes(k),
                        progressState = production.get(k),
                        reason = researchReason(k);
                      return (
                        <li
                          key={k}
                          onPointerEnter={() => setHover(k)}
                          onPointerLeave={() => setHover(null)}
                        >
                          <button
                            className={`tac-cameo ${done ? 'complete' : ''} ${progressState?.progress ? 'building' : ''}`}
                            disabled={busy || !!done}
                            aria-disabled={!!reason}
                            aria-label={`${r.name} · ₭ ${r.cost}`}
                            title={reason ?? r.role}
                            onFocus={() => setHover(k)}
                            onBlur={() => setHover(null)}
                            onClick={() => {
                              if (reason) {
                                setPinned(k);
                                audio.unlock();
                                const cue = commandFailureCue(reason);
                                if (cue) audio.say(cue);
                                return;
                              }
                              void act(
                                () =>
                                  startResearch({
                                    key: k,
                                  }),
                                `${r.name} added to the research queue.`,
                                'queued',
                              );
                            }}
                          >
                            <span className="tac-cameo-research">
                              <FlaskConical />
                            </span>
                            <span className="tac-cameo-cost">₭ {r.cost}</span>
                            {progressState?.progress ? (
                              <i
                                className="tac-cameo-progress"
                                style={
                                  {
                                    '--p': `${progressState.progress}%`,
                                  } as CSSProperties
                                }
                              />
                            ) : null}
                            {progressState && !progressState.progress && (
                              <b className="tac-cameo-count">
                                {progressState.count}
                              </b>
                            )}
                            {reason && !done && active && (
                              <span className="tac-cameo-lock">
                                <Lock size={18} />
                              </span>
                            )}
                            <span className="tac-cameo-name">
                              {done ? '✓ ' : ''}
                              {r.name}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <ul className="tac-cameo-grid">
                  {assets.map((kind) => {
                    const s = spec(kind),
                      count = isUnit(kind) ? quantity : 1,
                      unitTier = (s as { tier: number }).tier,
                      progressState = production.get(kind),
                      reason = blockReason(kind);
                    return (
                      <li
                        key={kind}
                        onPointerEnter={() => setHover(kind)}
                        onPointerLeave={() => setHover(null)}
                      >
                        <button
                          className={`tac-cameo ${placing?.kind === kind ? 'placing' : ''} ${progressState?.progress ? 'building' : ''} ${coachTarget?.kind === kind && !placing ? 'coached' : ''}`}
                          aria-pressed={
                            !isUnit(kind) ? placing?.kind === kind : undefined
                          }
                          disabled={busy}
                          aria-disabled={!!reason}
                          aria-label={`${s.name}${count > 1 ? ` ×${count}` : ''} · ₭ ${priceOf(battle, owner, kind) * count}`}
                          title={
                            reason ??
                            (isUnit(kind)
                              ? s.role
                              : 'Choose a location for this structure')
                          }
                          onFocus={() => setHover(kind)}
                          onBlur={() => setHover(null)}
                          onClick={() => {
                            if (reason && !isUnit(kind) && active) {
                              beginPlacement(kind as PlaceableKind);
                              audio.unlock();
                              const cue = commandFailureCue(reason);
                              if (cue) audio.say(cue);
                              return;
                            }
                            if (reason) {
                              setPinned(kind);
                              audio.unlock();
                              const cue = commandFailureCue(reason);
                              if (cue) audio.say(cue);
                              return;
                            }
                            if (!isUnit(kind))
                              beginPlacement(kind as PlaceableKind);
                            else
                              void act(
                                async () => {
                                  await produce({
                                    kind,
                                    quantity,
                                  });
                                  if (
                                    coaching &&
                                    !tutorial.trained &&
                                    !isHarvester(kind)
                                  )
                                    recordTutorial({ trained: true });
                                },
                                `${quantity} × ${s.name} added to the ${tab} queue.`,
                                'queued',
                              );
                          }}
                        >
                          <Portrait kind={kind} />
                          <span className="tac-cameo-cost">
                            ₭ {priceOf(battle, owner, kind) * count}
                          </span>
                          {unitTier > 1 && (
                            <span className="tac-cameo-tier">T{unitTier}</span>
                          )}
                          {progressState?.progress ? (
                            <i
                              className="tac-cameo-progress"
                              style={
                                {
                                  '--p': `${progressState.progress}%`,
                                } as CSSProperties
                              }
                            />
                          ) : null}
                          {progressState && progressState.count > 0 && (
                            <b className="tac-cameo-count">
                              {progressState.count}
                            </b>
                          )}
                          {reason && active && (
                            <span className="tac-cameo-lock">
                              <Lock size={18} />
                            </span>
                          )}
                          <span className="tac-cameo-name">
                            {s.name}
                            {count > 1 ? ` ×${count}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {tab === 'research' ? (
                <ResearchPanel
                  battle={battle}
                  owner={owner}
                  now={state?.now ?? battle.tickAt}
                  busy={busy}
                  onCancel={(key) =>
                    void act(async () => {
                      const refund = await abandonResearch({
                        key,
                      });
                      setMessage({
                        text: `${RESEARCH[key].name} cancelled. ₭ ${refund} refunded.`,
                        error: false,
                      });
                    })
                  }
                />
              ) : tab !== 'structures' ? (
                <TroopQueue
                  battle={battle}
                  owner={owner}
                  category={tab}
                  now={state?.now ?? battle.tickAt}
                  busy={busy}
                  onCancel={(orderId) =>
                    void act(async () => {
                      const refund = await cancelTroops({
                        orderId,
                      });
                      setMessage({
                        text: `Troop order cancelled. ₭ ${refund} refunded.`,
                        error: false,
                      });
                    })
                  }
                />
              ) : (
                <div className="tac-queue">
                  <div className="tac-panel-heading">
                    <span>CONSTRUCTION</span>
                    <span>
                      {queue.length} / {CONSTRUCTION_QUEUE_LIMIT}
                    </span>
                  </div>
                  {queue.length ? (
                    queue.map((e, i) => {
                      const remaining = Math.max(
                          0,
                          Math.ceil((e.readyAt - clockNow) / 1000),
                        ),
                        seconds = spec(e.kind).seconds;
                      return (
                        <div key={e.id} className="tac-queue-item">
                          <Portrait kind={e.kind} />
                          <div>
                            <strong>{spec(e.kind).name}</strong>
                            <span>
                              {i === 0 ? 'Building' : 'Queued'} · {remaining}s
                            </span>
                            <div className="tac-progress">
                              <i
                                style={{
                                  width: `${Math.max(0, Math.min(100, 100 - (remaining / seconds) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>
                          <button
                            className="tac-cancel-training"
                            disabled={busy}
                            aria-label={`Cancel ${spec(e.kind).name}; full refund`}
                            title="Cancel construction · Full refund"
                            onClick={() =>
                              void act(async () => {
                                const refund = await sell({
                                  id: e.id,
                                });
                                setMessage({
                                  text: `Construction cancelled. ₭ ${refund} refunded.`,
                                  error: false,
                                });
                              })
                            }
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p>
                      Pick a structure, then place it on the battlefield. Build
                      as many as credits, power and land allow.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="tac-cameo-info" aria-live="polite">
              {peek ? (
                <>
                  <strong>
                    {peek.name}
                    <b>₭ {peek.cost}</b>
                  </strong>
                  <p className={peek.reason ? 'blocked' : ''}>
                    {peek.reason ?? peek.role}
                  </p>
                  <span>
                    <span>{peek.seconds}s</span>
                    {peek.power !== undefined && (
                      <span>
                        <Zap size={10} />
                        {peek.power > 0 ? `${peek.power} power` : 'no power'}
                      </span>
                    )}
                    {peek.tier > 1 && <span>Tier {peek.tier}</span>}
                    {peek.via && <span>via {peek.via}</span>}
                  </span>
                </>
              ) : (
                <div className="tac-hint">
                  <Zap size={15} />
                  <span>
                    {power.used > power.capacity
                      ? 'Grid overloaded. Build a geothermal plant.'
                      : !mode.ore && heldDerricks < 2 && active
                        ? 'No harvesters here: send infantry into a derrick ring to take its oil.'
                        : mode.ore && counts.harvesters === 0 && active
                          ? 'Build a refinery near ore. It comes with a harvester.'
                          : needsClearance && tab !== 'research'
                            ? 'Armor, artillery and the air base need Tier 2 clearance.'
                            : mode.ore
                              ? 'Harvest ore. Research clearance. Push north.'
                              : 'Hold derricks. Research clearance. Push north.'}
                  </span>
                  {needsClearance && tab !== 'research' && (
                    <button
                      type="button"
                      onClick={() => {
                        setTab('research');
                        cancelPlacement();
                      }}
                    >
                      Research
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
      <div className="tac-sector-caption tac-mobile-caption">
        <span>OPERATION 01</span>
        <h1>
          {BATTLEFIELDS[
            isMapId(battle.mapId) ? battle.mapId : DEFAULT_MAP_ID
          ].name.toUpperCase()}
        </h1>
      </div>
      <aside
        id="tactical-reports"
        aria-label="Objectives and field reports"
        className={`tac-mission-panel ${reports ? 'is-open' : ''} ${coaching ? 'has-coach' : ''} ${sidebar ? 'is-covered' : ''}`}
      >
        <div className="tac-sector-caption">
          <span>OPERATION 01</span>
          <h1>
            {BATTLEFIELDS[
              isMapId(battle.mapId) ? battle.mapId : DEFAULT_MAP_ID
            ].name.toUpperCase()}
          </h1>
          <p>
            {
              BATTLEFIELDS[
                isMapId(battle.mapId) ? battle.mapId : DEFAULT_MAP_ID
              ].biome
            }
          </p>
        </div>
        {coaching && (
          <TutorialCoach
            step={coachIndex}
            steps={coachSteps}
            onShow={
              coachTarget
                ? () => {
                    setTab(coachTarget.tab);
                    setPinned(null);
                    setSidebar(true);
                    setReports(false);
                  }
                : undefined
            }
            onNext={() =>
              coachIndex === TUTORIAL_STEPS.length - 1
                ? recordTutorial({ status: 'done' })
                : recordTutorial({ floor: coachIndex + 1 })
            }
            onSkip={() => recordTutorial({ status: 'skipped' })}
          />
        )}
        <section className="tac-objectives tac-plate tac-rivets">
          <div className="tac-panel-heading">
            <span>
              <Flag size={13} /> ENEMY FORCES
            </span>
            <span>{remainingEnemies.armies} remaining</span>
            <button
              className="tac-mobile-build"
              onClick={() => setReports(false)}
              aria-label="Close field reports"
            >
              <X size={16} />
            </button>
          </div>
          <div className="tac-objective">
            <div>
              <strong>
                Capture enemy flags{' '}
                {
                  (battle.flags ?? []).filter(
                    (f) => f.team === 'red' && f.capturedAt !== undefined,
                  ).length
                }
                /{(battle.flags ?? []).filter((f) => f.team === 'red').length}
              </strong>
              <p>
                {remainingEnemies.buildings} buildings ·{' '}
                {remainingEnemies.units} units remaining
                {homeward > 0 &&
                  ` · ${homeward} flag${homeward === 1 ? '' : 's'} on the way home`}
              </p>
            </div>
          </div>
          {(battle.flags ?? [])
            .filter(
              (f) =>
                f.capturedAt === undefined &&
                (flagState(f) !== 'home' || !!f.pickupBy) &&
                // Enemy flags we carry are summed up in the objective line.
                !(f.team === 'red' && flagState(f) === 'carried'),
            )
            .map((f) => (
              <div key={f.id} className="tac-objective tac-capture">
                <div style={{ width: '100%' }}>
                  <strong>{flagAlert(f)}</strong>
                  <progress
                    max={
                      flagState(f) === 'dropped'
                        ? RETURN_SECONDS
                        : PICKUP_SECONDS
                    }
                    value={
                      flagState(f) === 'dropped'
                        ? Math.max(
                            0,
                            RETURN_SECONDS -
                              (battle.tickAt - (f.droppedAt ?? battle.tickAt)) /
                                1000,
                          )
                        : flagState(f) === 'carried'
                          ? PICKUP_SECONDS
                          : (f.pickupProgress ?? 0)
                    }
                    aria-label={`${f.name}'s flag`}
                    style={{
                      width: '100%',
                      height: 6,
                      accentColor: f.team === 'red' ? '#87f6de' : '#fa7c65',
                    }}
                  />
                </div>
              </div>
            ))}
          <TechSiteObjectives battle={battle} onFocus={look} />
          <div className="tac-mission-foot">
            <Shield size={13} />
            <span>Richer ore lies north, under enemy guns.</span>
          </div>
        </section>
        <section className="tac-events" aria-label="Field reports">
          <div className="tac-events-title">
            <Radio size={11} /> FIELD REPORTS{' '}
            <span className="tac-signal">●</span>
          </div>
          {active && !!state?.pendingCommandUnits && (
            <output>
              Dispatching orders to {state.pendingCommandUnits} troops…
            </output>
          )}
          {battle.events.slice(0, 5).map((e, i) => (
            <div key={`${e.at}:${i}`} className={`tac-event ${e.kind}`}>
              <span>
                {e.kind === 'combat' ? (
                  <Crosshair size={13} />
                ) : e.kind === 'success' ? (
                  <Flag size={13} />
                ) : (
                  <Radio size={13} />
                )}
              </span>
              <p>{e.text}</p>
            </div>
          ))}
          {!state && (
            <p className="tac-empty-report">Northern command standing by.</p>
          )}
        </section>
        <section className="tac-allies">
          <Users size={14} />
          <strong>
            {state?.commanders.length ?? 0}/{state?.maxPlayers ?? 8}
          </strong>
          <span>commanders in this sector</span>
        </section>
        <SponsorBadge />
      </aside>
      <div className="tac-camera-tools">
        <button
          className="tac-mobile-build"
          onClick={() => {
            setReports(!reports);
            setSidebar(false);
          }}
          aria-label="Toggle objectives and field reports"
          aria-expanded={reports}
          aria-controls="tactical-reports"
        >
          <Flag size={17} />
        </button>
        <button
          onClick={() =>
            setFocus((p) => ({ ...home, serial: p.serial + 1, north: true }))
          }
          title="North view (\\) · Ctrl / ⌘ / Alt-drag to rotate and tilt · [ / ] to rotate"
          aria-label="Reset camera north"
        >
          N
        </button>
        <AudioControls />
        <PhotoMode />
        <button
          onClick={() => setTech(true)}
          title="Tech tree (T)"
          aria-label="Open tech tree"
        >
          <GitBranch size={17} />
        </button>
        <button
          onClick={() => look(home)}
          title="Return to command station (Home)"
          aria-label="Return to command station"
        >
          <LocateFixed size={17} />
        </button>
        <button
          onClick={() => {
            void (
              document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen()
            ).catch(() =>
              setMessage({
                text: 'The battlefield already fills your browser window.',
                error: false,
              }),
            );
          }}
          aria-label="Fullscreen"
        >
          <Maximize size={17} />
        </button>
      </div>
      {won ? (
        <VictoryBanner
          mapName={mapName}
          flags={hostileFlags}
          onDebrief={onDebrief ?? onOperations}
        />
      ) : (
        (!commander || state?.status !== 'active') && (
          <div className="tac-briefing-region">
            <div className="tac-briefing" aria-label="Operation briefing">
              <span className="tac-eyebrow">
                {state?.status === 'defeat'
                  ? 'COMMAND LOST'
                  : `MISSION BRIEFING · ${mapName.toUpperCase()}`}
              </span>
              <h2>
                {state?.status === 'defeat'
                  ? 'Regroup. Return north.'
                  : 'Take command of the coast.'}
              </h2>
              <p>
                Power the landing zone, harvest the ore seams, and climb the
                tech tree. Richer ore lies across the fjord under enemy
                outposts.{' '}
                {hostileFlags
                  ? 'Capture every enemy flag and carry it home.'
                  : 'Destroy every enemy building and unit.'}
              </p>
              <div className="tac-briefing-facts">
                <span>
                  <Users size={15} /> 1–8 player co-op
                </span>
                <span>
                  <Radio size={15} /> Shared live sector
                </span>
                <span>
                  <Gem size={15} /> Harvest · build · research
                </span>
              </div>
              <button className="tac-primary" onClick={onOperations}>
                Choose next operation
                <ArrowUpRight size={20} />
              </button>
              <small>
                Start a solo skirmish, create a lobby, or join another task
                force.
              </small>
              {state && state.status !== 'active' && <SponsorRoll />}
            </div>
          </div>
        )
      )}
      <div className="tac-feedback-stack">
        {!armed && !placing && <CommanderCaption />}
        {active && placing && (
          <div
            className={`tac-command-prompt tac-placement-bar ${placementReason ? 'blocked' : ''}`}
          >
            <div className="tac-placement-info">
              <strong>
                <Hammer size={16} /> Place {spec(placing.kind).name}{' '}
                <span>₭ {priceOf(battle, owner, placing.kind)}</span>
              </strong>
              <output>
                {busy
                  ? 'Placing structure…'
                  : (placementReason ??
                    (placing.position
                      ? placing.kind === 'outpost'
                        ? `Clear foundation — opens a ${buildRadius('outpost')}m build radius when complete`
                        : 'Clear foundation — click to build'
                      : placing.kind === 'outpost'
                        ? `Choose land in your build area or in sight of your troops. Opens a new ${buildRadius('outpost')}m build radius.`
                        : `Choose land within ${buildRadius('hq')}m of your command station, ${buildRadius('outpost')}m of an outpost, or ${buildRadius('reactor')}m of other structures`))}
              </output>
              <small>
                {placing.position
                  ? `${placing.position.x} · ${placing.position.z}  /  ${placing.rotation * 90}°`
                  : 'Move over the battlefield or tap a location'}{' '}
                · R rotates · Esc cancels
              </small>
            </div>
            <div className="tac-placement-actions">
              <button disabled={busy} onClick={rotatePlacement}>
                Rotate ↻
              </button>
              <button
                disabled={busy || !placing.position || !!placementReason}
                onClick={() =>
                  placing.position && void placeBuilding(placing.position)
                }
              >
                Build here
              </button>
              <button
                disabled={busy}
                onClick={cancelPlacement}
                aria-label="Cancel building placement"
              >
                <X size={17} />
              </button>
            </div>
          </div>
        )}
        {weaponNotice && battle.tickAt - weaponNotice.at < 7000 && (
          <SuperweaponNoticeBanner
            key={`sw-${weaponNotice.serial}`}
            notice={weaponNotice}
            onJump={look}
          />
        )}
        {alert && (
          <AttackAlertNotice
            key={alert.id}
            alert={alert}
            onJump={jumpToAlert}
          />
        )}
        {message && (
          <div
            role={message.error ? 'alert' : 'status'}
            className={`tac-toast ${message.error ? 'error' : ''}`}
          >
            <Radio size={16} />
            {message.text}
            <button onClick={() => setMessage(null)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        {aimingNow && weapon && (
          <div className="tac-command-prompt tac-sw-prompt">
            <Crosshair size={16} />
            {weapon.kind === 'cannon'
              ? 'Mountain Gun: choose any ground your forces have scouted.'
              : `${weaponName(weapon.kind)}: choose a target your forces can see.`}
            <button onClick={() => setAiming(false)}>Cancel · Esc</button>
          </div>
        )}
        {armed && (
          <div className="tac-command-prompt">
            <Crosshair size={16} />
            {armed === 'attackMove'
              ? 'Choose a position to advance and engage.'
              : 'Choose a destination.'}
            <button onClick={() => setArmed(null)}>Cancel · Esc</button>
          </div>
        )}
      </div>
      {Object.keys(liveGroups).length > 0 && (
        <ControlGroupStrip>
          {GROUP_SLOTS.map((slot) => {
            const members = recallTroops(slot).map((id) => troops.get(id)!);
            if (!members.length) return null;
            const tally = new Map<EntityKind, number>();
            for (const e of members)
              tally.set(e.kind, (tally.get(e.kind) ?? 0) + 1);
            const [kind] = [...tally].sort((a, b) => b[1] - a[1])[0];
            return (
              <ControlGroupChip
                key={slot}
                slot={slot}
                count={members.length}
                active={
                  units.length === members.length &&
                  members.every((e) => selectedIds.includes(e.id))
                }
                label={[...tally]
                  .map(([k, n]) => `${n} ${spec(k).name}`)
                  .join(', ')}
                onRecall={(event) => pressGroup(slot, event.timeStamp)}
                onCentre={() => centreGroup(recallTroops(slot))}
              >
                <Portrait kind={kind} />
              </ControlGroupChip>
            );
          })}
        </ControlGroupStrip>
      )}
      <footer className="tac-command-deck">
        <CommanderRadio culture={commander?.culture ?? player.culture} />
        <section className="tac-selection-panel tac-plate tac-rivets">
          <div className="tac-panel-heading">
            <span>
              {first
                ? isUnit(first.kind)
                  ? 'SELECTED FORCE'
                  : 'STRUCTURE'
                : 'COMMAND STATION'}
            </span>
            <span>{units.length ? `${units.length} selected` : ''}</span>
          </div>
          <div className="tac-unit-detail">
            <div className="tac-portrait-frame">
              <Portrait kind={first?.kind ?? 'hq'} />
            </div>
            <div>
              <h2>
                {units.length > 1
                  ? `${units.length} unit task force`
                  : first
                    ? spec(first.kind).name
                    : player.name}
              </h2>
              <p>
                {first ? spec(first.kind).role : 'Northern expeditionary force'}
              </p>
              {first ? (
                <>
                  <div className="tac-health">
                    <i
                      data-band={healthBand(first.hp / spec(first.kind).hp)}
                      style={{
                        width: `${(first.hp / spec(first.kind).hp) * 100}%`,
                      }}
                    />
                  </div>
                  <small className="tac-hp">
                    {Math.ceil(first.hp)} / {spec(first.kind).hp} HP
                  </small>
                  {isUnit(first.kind) && (
                    <span className="tac-combat-stats">
                      <Crosshair size={12} />
                      {TACTICAL_UNITS[first.kind].damage}/s <Shield size={12} />
                      {TACTICAL_UNITS[first.kind].range}m
                    </span>
                  )}
                  {firstStructure && active && (
                    <span className="tac-structure-actions">
                      {firstStructure.kind === 'outpost' &&
                        !firstStructure.readyAt && (
                          <button
                            className="tac-build-action"
                            onClick={() => {
                              cancelPlacement();
                              setArmed(null);
                              setTab('structures');
                              setSidebar(true);
                              setReports(false);
                              look(firstStructure);
                            }}
                          >
                            <Hammer size={13} />
                            Build around outpost
                          </button>
                        )}
                      {canRally && (
                        <small>
                          {firstStructure.rally
                            ? 'Rally set · click land to move it'
                            : 'Click land to send new troops there'}
                        </small>
                      )}
                      {researchAction && (
                        <button
                          className="tac-research-action"
                          disabled={!!researchAction.reason || busy}
                          title={researchAction.reason ?? researchAction.role}
                          onClick={() => {
                            if (researchAction.openTab) {
                              setTab('research');
                              setSidebar(true);
                              cancelPlacement();
                              return;
                            }
                            void act(
                              () =>
                                startResearch({
                                  key: researchAction.key,
                                }),
                              `${researchAction.name} added to the research queue.`,
                              'queued',
                            );
                          }}
                        >
                          <FlaskConical size={13} />
                          {researchAction.label}
                        </button>
                      )}
                    </span>
                  )}
                </>
              ) : (
                <small>
                  Select troops, then click the ground to move them.{' '}
                  {mode.ore
                    ? 'Harvesters work the ore fields on their own.'
                    : 'Infantry take derricks by standing in their ring.'}
                </small>
              )}
            </div>
          </div>
        </section>
        <section className="tac-orders tac-plate">
          <div className="tac-roster">
            <button
              className="tac-select-all"
              title="Select all field units (F)"
              onClick={() =>
                select(
                  own
                    .filter(
                      (e) =>
                        isUnit(e.kind) && !isHarvester(e.kind) && !e.readyAt,
                    )
                    .map((e) => e.id),
                  false,
                )
              }
            >
              <Users size={18} />
              <span>ALL · F</span>
            </button>
            {own
              .filter(
                (e) => isUnit(e.kind) && !isHarvester(e.kind) && !e.readyAt,
              )
              .map((e) => (
                <button
                  key={e.id}
                  className={`tac-unit-card ${selectedIds.includes(e.id) ? 'selected' : ''}`}
                  title={`${spec(e.kind).name} · ${Math.ceil(e.hp)} HP`}
                  onClick={(event) => {
                    // The second click of a double-click narrows to the card's kind.
                    if (event.detail === 2)
                      select(
                        rosterKindSelection({
                          entities: battle.entities,
                          owner,
                          anchor: e,
                          previous: rosterPrevious.current,
                        }),
                        false,
                      );
                    else {
                      rosterPrevious.current = selectedIds;
                      select([e.id], event.shiftKey);
                    }
                  }}
                >
                  <Portrait kind={e.kind} />
                  <div className="tac-health">
                    <i
                      data-band={healthBand(e.hp / spec(e.kind).hp)}
                      style={{ width: `${(e.hp / spec(e.kind).hp) * 100}%` }}
                    />
                  </div>
                </button>
              ))}
            {!own.some((e) => isUnit(e.kind)) && (
              <span className="tac-roster-empty">
                Your deployed units appear here.
              </span>
            )}
          </div>
          <div
            className="tac-order-buttons"
            data-structure={!!firstStructure && !units.length}
          >
            {firstStructure && !units.length && (
              <button
                className="tac-remove-building"
                disabled={
                  !active || busy || !!placing || firstStructure.kind === 'hq'
                }
                title={
                  firstStructure.kind === 'hq'
                    ? 'The command station cannot be removed'
                    : `Remove ${spec(firstStructure.kind).name}; ${firstStructure.readyAt ? 'full' : '50%'} refund`
                }
                onClick={removeBuilding}
              >
                <Trash2 size={20} />
                <span>
                  {firstStructure.kind === 'hq'
                    ? 'Command station cannot be removed'
                    : firstStructure.readyAt
                      ? 'Cancel construction'
                      : 'Remove building'}
                </span>
                {firstStructure.kind !== 'hq' && (
                  <span>+ ₭ {structureRefund}</span>
                )}
              </button>
            )}
            {(
              [
                { key: 'move', label: 'Move', hotkey: 'M', icon: Move },
                {
                  key: 'attackMove',
                  label: 'Attack move',
                  hotkey: 'Q',
                  icon: Crosshair,
                },
                { key: 'stop', label: 'Stop', hotkey: 'X', icon: Square },
                { key: 'hold', label: 'Hold', hotkey: 'H', icon: Shield },
              ] as const
            )
              .filter(() => !firstStructure || units.length > 0)
              .map((c) => (
                <button
                  key={c.key}
                  disabled={!active || !units.length || !!placing}
                  className={armed === c.key ? 'armed' : ''}
                  onClick={() => {
                    if (c.key === 'move' || c.key === 'attackMove')
                      setArmed(c.key);
                    else void order(c.key);
                  }}
                >
                  <c.icon size={20} />
                  <span>{c.label}</span>
                  <kbd>{c.hotkey}</kbd>
                </button>
              ))}
          </div>
        </section>
      </footer>
      <TechTreeDialog
        open={tech}
        onOpenChange={setTech}
        battle={battle}
        owner={owner}
      />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="tac-help how-to-play">
          <DialogTitle>How to play</DialogTitle>
          <DialogDescription>
            Solo skirmishes pit you against AI armies; in co-op lobbies friends
            fight the AI together. Every commander runs their own base, economy
            and forces.
          </DialogDescription>
          <HowToPlaySteps />
          <button
            className="tac-primary tac-restart-tutorial"
            onClick={() => {
              saveTutorial({
                ...NEW_TUTORIAL,
                status: 'active',
                sector: sectorId,
              });
              setHelp(false);
            }}
          >
            {coaching ? 'Restart tutorial' : 'Start the tutorial'}
          </button>
          <h3 className="tac-help-heading">Field manual</h3>
          <dl>
            <dt>Select</dt>
            <dd>
              Click a troop or drag a box around a group. Shift-click adds
              troops. Double-click (or Ctrl/⌘-click) a troop to select every
              troop of that kind on screen; add Shift to keep the current
              selection. Double-click a roster card to narrow the selection to
              that kind. F selects your whole army. Esc clears your selection.
            </dd>
            <dt>Groups</dt>
            <dd>
              Ctrl + 1–9 (⌘ on Mac) binds the selected troops to a control
              group; Shift adds them to it instead. If your browser keeps Ctrl
              or ⌘ + number for its tabs, Alt + 1–9 binds too. Press the number
              to select the group again, twice quickly to centre the camera on
              it. The group chips above the command bar do the same with a click
              or double-click.
            </dd>
            <dt>Command</dt>
            <dd>
              With troops selected, left-click land to move or click an enemy to
              attack. Right-click works too. Q then click advances while
              engaging enemies; X stops and H holds. Harvesters cannot be
              selected: they mine the nearest ore field and deliver on their
              own.
            </dd>
            <dt>Camera</dt>
            <dd>
              Right-drag, middle-drag or hold Space and drag to pan; the arrow
              keys, WASD and the screen edges scroll. Scroll or pinch to zoom
              towards the pointer. Hold Ctrl, Command (⌘), or Alt and drag to
              rotate and tilt; [ and ] rotate, and backslash resets north. Twist
              two fingers to rotate on touch. Click or drag on the radar to
              jump. Home returns to your HQ. On touch, tap a troop, then tap its
              destination; drag to pan and pinch to zoom.
            </dd>
            <dt>Alerts</dt>
            <dd>
              When your base, harvesters or troops take fire, an orange notice
              names what is under attack, the commander calls it out and the
              radar pings the spot for a few seconds. Tap Space, click the
              notice or click the ping to jump there; holding Space and dragging
              still pans.
            </dd>
            <dt>Economy</dt>
            {!mode.ore ? (
              <dd>
                {skirmishName(battle)}: {startingCredits(battle)} starting
                credits and +1 per second from the command station. There is no
                ore, so no refineries or harvesters. Every seam is an oil
                derrick that pays its holder ₭ {derrickIncome(battle)} every{' '}
                {TECH_SITES.derrick.pulseSeconds} seconds: you start on the one
                beside your landing, and infantry take the rest by standing in
                their ring. The enemy pays for its troops with the derricks it
                holds, so every one you take starves it.
              </dd>
            ) : (
              <dd>
                {difficultyFor(battle).credits} starting credits and +1 per
                second from the command station. Ore fields hold a finite amount
                of ore. A refinery (₭ {TACTICAL_BUILDINGS.refinery.cost}) comes
                with a Malm harvester that loads ₭{' '}
                {TACTICAL_UNITS.harvester.cargo} per trip; build more harvesters
                at the Vehicle works. Each refinery supports {HARVESTER_LIMIT}{' '}
                harvesters counting orders (you have room for{' '}
                {harvesterLimit(battle, owner)}). Home seams are small. The
                shore fields are larger, and the northern seams across the fjord
                are the richest, but enemy outposts guard them.
              </dd>
            )}
            <dt>Army capacity</dt>
            <dd>
              Up to {commandLimit(battle)} combat troops per commander in this
              operation
              {mode.ore
                ? `, plus ${HARVESTER_LIMIT} harvesters per refinery`
                : ''}
              . Troops wait in the queue when the army or battlefield is full.
              Each commander can have {STRUCTURE_LIMIT} structures.
            </dd>
            <dt>Construction</dt>
            <dd>
              Choose a structure, move its preview onto clear land, and click to
              build. Green is valid; red explains what is blocked. R rotates,
              Esc or right-click cancels. Build within {buildRadius('hq')}m of
              your command station, {buildRadius('outpost')}m of a forward
              outpost, or {buildRadius('reactor')}m of any other completed
              structure. A forward outpost can also be placed away from your
              base on land currently in sight of your own troops. Once complete,
              it opens its own build radius; select it and choose Build around
              outpost. Build as many plants, refineries, factories and defenses
              as credits, power and land allow. Select a building and choose
              Remove building in the bottom command bar for a 50% refund, or
              Cancel construction for a full refund. The command station cannot
              be removed.
            </dd>
            <dt>Faction</dt>
            <dd>
              Every faction fields the same roster; its doctrine bends the
              rules. Fjordborn train troops faster and move quicker. Ironclad
              build cheaper structures with harder-hitting defenses. Hearthkin
              harvesters carry more and load faster. Ashwalkers see further and
              field cheaper infantry. Prices and build times in the sidebar
              already include your doctrine.
            </dd>
            <dt>Tech tree</dt>
            <dd>
              Press T. The Jæger hall trains infantry and unlocks the pillbox
              and aid station; the Vehicle works builds vehicles and unlocks the
              flak tower, radar mast and field workshop; the air base builds
              aircraft. The command station researches Tier 2 clearance for
              armor, artillery, the air base, the research station, the thermal
              power station and the Tier 2 emplacements, plus convoy logistics.
              The research station sells drills, turbines, ammunition, plates,
              shells and composite armor, then Tier 3 clearance for Jotun heavy
              tanks, Valkyrie gunships, uranium sabots, avionics and ballistic
              computers. Projects are costly and run one at a time.
            </dd>
            <dt>Counters</dt>
            <dd>
              Rocket Jægers and Bofors sentries punish armor and aircraft.
              Jægers and the Lynx cut down infantry. Tanks trade evenly. Troops
              fire on the move: a plain move keeps walking while the guns work,
              attack-move and hold stop to fight. Howitzers and coastal
              batteries outrange everything and wreck structures but cannot fire
              at close range or at aircraft.
            </dd>
            <dt>Production</dt>
            <dd>
              Every production building trains one unit at a time, so two
              factories build twice the armor. Queue up to{' '}
              {TRAINING_QUEUE_LIMIT} troops in batches. Ready troops wait for
              power, army space and a clear exit. Select a production building
              and left- or right-click land to set its rally point; new troops
              march there.
            </dd>
            <dt>Victory</dt>
            <dd>
              Capture every enemy flag within {OPERATION_MINUTES} minutes. Keep
              a ground troop at an enemy flag for {PICKUP_SECONDS} seconds to
              pick it up, then bring it back into your own flag zone (or an
              ally&apos;s); its whole army then collapses. The carrier moves
              slower and every enemy can see it. If it falls, the flag drops:
              pick it up again, or the enemy returns it with a touch; left
              alone, it returns home after {RETURN_SECONDS} seconds. Guard your
              own flag the same way: if the enemy carries it home, your game
              ends and surviving allies continue. Enemy columns march on your
              flag and grow heavier. Difficulty sets your starting credits,
              garrison strength, and attack frequency. Every new operation
              reshuffles enemy bases, ore, and patrols.
            </dd>
            <dt>Recovery key</dt>
            <dd>
              Your commander lives in this browser. Copy the private key below
              to continue on another device with Returning commander. Never
              share it.
              <button
                className="tac-recovery-key"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(token)
                    .then(() =>
                      setMessage({
                        text: 'Recovery key copied.',
                        error: false,
                      }),
                    )
                    .catch(() =>
                      setMessage({
                        text: 'Select and copy the key manually.',
                        error: true,
                      }),
                    )
                }
              >
                <KeyRound size={14} />
                <code>{token}</code>
              </button>
            </dd>
          </dl>
        </DialogContent>
      </Dialog>
    </main>
  );
}
