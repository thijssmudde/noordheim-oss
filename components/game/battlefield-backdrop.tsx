'use client';

import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
} from 'react';
import { preload } from 'react-dom';
import { mapIds, type MapId } from '@/lib/battlefields';
import { MAPS } from '@/lib/maps';
import { SilentAudio } from './game-audio';

/** Rendered card art for a map (track B paints `/art/maps/<id>-card.webp`); callers hide it if missing. */
export const mapCardArt = (id: MapId) => `/art/maps/${id}-card.webp`;

/** The map's own sky: its atmosphere colours, so there is never an empty or foreign backdrop. */
export function mapSky(id: MapId): CSSProperties {
  const a = MAPS[id].atmosphere;
  return {
    background: `radial-gradient(ellipse 90% 70% at 50% 72%, ${a.horizon} 0%, ${a.fog} 30%, ${a.sky} 62%, #0a121c 100%)`,
  };
}

/** Pre-rendered 1600×900 hero still of a map: what the live attract scene looks like. */
export const mapHeroArt = (id: MapId) => `/art/maps/${id}.webp`;

/**
 * The chosen battlefield behind the menus: the map's sky gradient, with its
 * rendered art over it. Battlefields stay mounted once shown, and a newly
 * chosen one only replaces the previous one once its image has loaded, so
 * switching cross-fades instead of flashing an empty sky.
 */
export function BattlefieldBackdrop({
  mapId,
  className = '',
  hero = false,
}: {
  mapId: MapId;
  className?: string;
  /** Use the full-size hero still instead of the map card (home and lobby). */
  hero?: boolean;
}) {
  const [shown, setShown] = useState<MapId[]>([mapId]);
  const [missing, setMissing] = useState<MapId[]>([]);
  const [visible, setVisible] = useState<MapId>(mapId);
  if (!shown.includes(mapId))
    setShown((seen) => (seen.includes(mapId) ? seen : [...seen, mapId]));
  const art = hero ? mapHeroArt : mapCardArt;
  const arrived = (id: MapId) => {
    if (id === mapId) setVisible(id);
  };
  // The first battlefield shows at once; a switch waits for its art (or its absence).
  const current = missing.includes(mapId) ? mapId : visible;
  return (
    <div className={`battlefield-backdrop ${className}`} aria-hidden="true">
      {mapIds
        .filter((id) => shown.includes(id))
        .map((id) => (
          <div
            key={id}
            className={`battlefield-sky ${id === current ? 'is-active' : ''}`}
            style={mapSky(id)}
          >
            {!missing.includes(id) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                // A cached or server-rendered image can finish before hydration.
                ref={(img) => {
                  if (img?.complete && img.naturalWidth > 0) arrived(id);
                }}
                className={`${hero ? 'attract-hero' : ''} ${id === current ? 'is-active' : ''}`}
                src={art(id)}
                alt=""
                draggable={false}
                decoding="async"
                fetchPriority={id === mapId ? 'high' : 'low'}
                onLoad={() => arrived(id)}
                onError={() => setMissing((m) => [...m, id])}
              />
            )}
          </div>
        ))}
    </div>
  );
}

type AttractProps = { mapId: MapId; onReady?: (mapId: string) => void };
type AttractModule = {
  AttractScene?: ComponentType<AttractProps>;
  default?: ComponentType<AttractProps>;
};
// Track B's live attract render. The glob resolves to nothing until the file
// exists, so the home screen never breaks while the renderer is in flux.
const attractModules = import.meta.glob<AttractModule>(
  './world/attract-scene.tsx',
);
const loadAttract = attractModules['./world/attract-scene.tsx'];
const AttractScene = loadAttract
  ? lazy(async () => {
      const mod = await loadAttract();
      const Scene = mod.AttractScene ?? mod.default;
      if (!Scene) throw new Error('attract-scene has no AttractScene export');
      return { default: Scene };
    })
  : null;

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const noSubscription = () => () => {};
/** Live 3D only with WebGL2, without reduced motion, and without `?still`. */
function liveSceneAllowed() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return false;
  if (new URLSearchParams(window.location.search).has('still')) return false;
  // Creating a throwaway context to probe costs ~50 ms on the main thread; a
  // context that still fails later is caught by SceneBoundary.
  return typeof WebGL2RenderingContext !== 'undefined';
}
let liveScene: boolean | undefined;
function useLiveScene() {
  return useSyncExternalStore(
    noSubscription,
    () => (liveScene ??= liveSceneAllowed()),
    () => false,
  );
}

/**
 * Starts the live scene only after the page has loaded (so the hero still,
 * fonts and the menu's own code come first) and the main thread is idle.
 */
function useAfterLoad() {
  const [go, setGo] = useState(false);
  useEffect(() => {
    let idle = 0;
    const start = () => {
      idle =
        typeof window.requestIdleCallback === 'function'
          ? window.requestIdleCallback(() => setGo(true), { timeout: 1200 })
          : window.setTimeout(() => setGo(true), 200);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      window.clearTimeout(idle);
    };
  }, []);
  return go;
}

/**
 * The home screen's cinematic: the map's pre-rendered hero still at once
 * (preloaded with high priority), then the live attract-mode skirmish, loaded
 * after the page and cross-faded in over the still only once its first frame
 * is complete. Switching maps swaps the still immediately and fades the live
 * scene back in when the new map is ready.
 */
export function AttractBackdrop({ mapId }: { mapId: MapId }) {
  preload(mapHeroArt(mapId), { as: 'image', fetchPriority: 'high' });
  const live = useLiveScene();
  const started = useAfterLoad();
  const [readyMap, setReadyMap] = useState<string | null>(null);
  const onReady = useCallback((id: string) => setReadyMap(id), []);
  const ready = readyMap === mapId;
  return (
    // Inline stacking so the live canvas can never cover the menus, even
    // before (or without) the stylesheet: always below the page content.
    <div
      className="attract-backdrop"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <BattlefieldBackdrop mapId={mapId} className="is-home" hero />
      {live && started && AttractScene && (
        <SceneBoundary>
          <Suspense fallback={null}>
            <div
              className={`attract-live ${ready ? 'is-ready' : ''}`}
              style={{ position: 'absolute', inset: 0 }}
            >
              <SilentAudio>
                <AttractScene mapId={mapId} onReady={onReady} />
              </SilentAudio>
            </div>
          </Suspense>
        </SceneBoundary>
      )}
      <div className="attract-grade" />
    </div>
  );
}

/** A map's card art on its own sky; the sky alone until the art exists. */
export function MapArt({
  mapId,
  className = '',
}: {
  mapId: MapId;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <div className={`map-art ${className}`} style={mapSky(mapId)} aria-hidden="true">
      {!missing && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mapCardArt(mapId)}
          alt=""
          draggable={false}
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}
