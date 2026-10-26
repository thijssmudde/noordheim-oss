'use client';
import { Cross, Fuel, Plane } from 'lucide-react';
import {
  SITE_RULES,
  TECH_SITES,
  captureShare,
  siteBonusText,
  type Battle,
  type Point,
  type TechSite,
  type TechSiteKind,
} from '@/lib/tactics';
import { SITE_CONTESTED, SITE_TAKER, siteColor } from './world/tech-sites';

const ICONS: Record<TechSiteKind, typeof Fuel> = {
  derrick: Fuel,
  fieldHospital: Cross,
  airstrip: Plane,
};
/** Radar colours: the coalition in the player's teal, the garrison in coral, neutral in pale grey. */
const RADAR = { blue: '#87f6de', red: '#fa7c65', neutral: '#c9d1d6' } as const;
const radarColor = (site: TechSite) => RADAR[site.team ?? 'neutral'];

/** Beyond this many sites the rows sort by what is happening and scroll. */
const LONG_LIST = 6;
const rank = (site: TechSite) =>
  site.contested || site.capturing
    ? 0
    : site.team === 'blue'
      ? 1
      : site.team === 'red'
        ? 2
        : 3;

function siteStatus(site: TechSite, commanders: Battle['commanders']) {
  if (site.contested) return 'Contested';
  if (site.capturing === 'blue')
    return `Capturing · ${Math.round(captureShare(site) * 100)}%`;
  if (site.capturing === 'red')
    return `Enemy capturing · ${Math.round(captureShare(site) * 100)}%`;
  if (site.team === 'red') return 'Enemy held';
  if (site.team === 'blue')
    return `Held by ${commanders.find((c) => c.id === site.holder)?.name ?? 'the coalition'}`;
  return 'Neutral';
}

/**
 * The tech sites in the objectives panel: how many the coalition holds, and a
 * row per site with its holder, capture progress and bonus. A row focuses the
 * camera on its site.
 */
export function TechSiteObjectives({
  battle,
  onFocus,
}: {
  battle: Pick<Battle, 'sites' | 'commanders' | 'skirmish'>;
  onFocus: (p: Point) => void;
}) {
  const all = battle.sites ?? [];
  if (!all.length) return null;
  const held = all.filter((s) => s.team === 'blue').length;
  // A map seeded with derricks lists the fights first, then what is held.
  const sites =
    all.length > LONG_LIST ? all.toSorted((a, z) => rank(a) - rank(z)) : all;
  return (
    <div className="tac-site-list" aria-label="Tech sites">
      <div className="tac-site-head">
        <strong>Tech sites</strong>
        <span>
          {held}/{sites.length} held
        </span>
      </div>
      <div className="tac-site-rows">
        {sites.map((site) => {
          const Icon = ICONS[site.kind];
          const color = siteColor(site, battle.commanders);
          const taker = site.contested
            ? SITE_CONTESTED
            : site.capturing
              ? SITE_TAKER[site.capturing]
              : undefined;
          return (
            <button
              key={site.id}
              className={`tac-site-row ${site.team ?? 'neutral'}`}
              onClick={() => onFocus(site)}
              title={`${TECH_SITES[site.kind].name}: ${siteBonusText(battle, site).description}`}
            >
              <span style={{ color, borderColor: color }}>
                <Icon size={13} />
              </span>
              <div>
                <b>{site.name}</b>
                <em style={taker ? { color: taker } : undefined}>
                  {siteStatus(site, battle.commanders)}
                </em>
                {site.progress > 0 && (
                  <div className="tac-progress">
                    <i
                      style={{
                        width: `${captureShare(site) * 100}%`,
                        background: taker,
                      }}
                    />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tech sites on the radar, drawn above the shroud (sites are landmarks): the
 * capture ring in the holder's colour, a progress arc in the taker's, and a
 * diamond for the structure.
 */
export function SiteRadarMarkers({
  battle,
}: {
  battle: Pick<Battle, 'sites'>;
}) {
  const r = SITE_RULES.captureRadius;
  const turn = 2 * Math.PI * r;
  return (
    <>
      {(battle.sites ?? []).map((site) => {
        const color = radarColor(site);
        const taker = site.contested
          ? SITE_CONTESTED
          : site.capturing
            ? SITE_TAKER[site.capturing]
            : color;
        return (
          <g key={site.id} className="tac-map-site">
            <circle
              cx={site.x}
              cy={site.z}
              r={r}
              fill={color}
              fillOpacity={0.16}
              stroke={color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {site.progress > 0 && (
              <circle
                cx={site.x}
                cy={site.z}
                r={r}
                fill="none"
                stroke={taker}
                strokeWidth={3}
                strokeDasharray={`${captureShare(site) * turn} ${turn}`}
                transform={`rotate(-90 ${site.x} ${site.z})`}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <rect
              x={site.x - 7}
              y={site.z - 7}
              width={14}
              height={14}
              transform={`rotate(45 ${site.x} ${site.z})`}
              fill={color}
              stroke="#0c1013"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </>
  );
}
