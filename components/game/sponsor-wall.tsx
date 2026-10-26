'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  SECONDARY_SPONSOR,
  SPONSOR_SLOTS,
  billboardSponsors,
  cheapestBid,
  formatUsd,
  type BillboardSponsor,
} from '@/lib/sponsorship';
import {
  paintSponsorBillboard,
  preloadSponsorIcons,
  previewSponsors,
  type BillboardStyle,
} from './sponsor-billboard';
import { sponsorHref, type SponsorPlacement } from './sponsor-credit';
import { SponsorName } from './sponsor-logo';
import {
  countSponsorClick,
  countSponsorView,
  useSponsorStats,
} from './sponsor-stats';

const SIZES: Record<BillboardStyle, [number, number]> = {
  hoarding: [640, 320],
  tower: [320, 640],
  banner: [800, 200],
};

/** The in-world poster, painted into the page: the same art the battlefield billboards carry. */
export function SponsorPoster({
  sponsor,
  style = 'hoarding',
  className = '',
}: {
  sponsor: BillboardSponsor;
  style?: BillboardStyle;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, height] = SIZES[style];
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let live = true;
    const paint = () => {
      if (live) paintSponsorBillboard(el, sponsor, style, paint);
    };
    paint();
    return () => {
      live = false;
    };
  }, [sponsor, style]);
  return (
    <canvas
      ref={canvas}
      className={`sponsor-poster is-${style} ${className}`}
      width={width}
      height={height}
      // Decorative: every poster sits beside or inside text naming the sponsor.
      aria-hidden="true"
    />
  );
}

function hrefFor(sponsor: BillboardSponsor, placement: SponsorPlacement) {
  if (sponsor.kind === 'main') return sponsorHref(placement);
  if (sponsor.kind === 'secondary')
    return sponsorHref(placement, SECONDARY_SPONSOR);
  return sponsor.website;
}

/**
 * Posters in rotation, from the live sponsor list. Mounting a surface that
 * shows them counts one view for each paid sponsor on it.
 */
export function useSponsorPosters(surface?: string) {
  const preview = previewSponsors();
  const live = useQuery(api.sponsors.active, preview ? 'skip' : {});
  const paid = preview ?? live;
  const posters = useMemo(() => billboardSponsors(paid ?? []), [paid]);
  preloadSponsorIcons(posters);
  useSponsorStats();
  const [mount] = useState(() => Math.random().toString(36).slice(2));
  useEffect(() => {
    if (surface)
      for (const s of paid ?? []) countSponsorView(s.id, `${surface}:${mount}`);
  }, [paid, surface, mount]);
  return { posters, paid };
}

/** Link props for a paid sponsor: opens their site and counts the click. */
const paidLink = (id: string, website: string) => ({
  href: website,
  target: '_blank',
  rel: 'sponsored noopener noreferrer',
  onClick: () => countSponsorClick(id),
});

/**
 * The home screen wall: the posters that hang on the battlefield, shown as a
 * row of framed prints. The open slot is an advert for itself.
 */
export function SponsorWall({
  placement = 'entrance',
}: {
  placement?: SponsorPlacement;
}) {
  const { posters, paid } = useSponsorPosters(placement);
  const open =
    SPONSOR_SLOTS -
    Math.min(paid?.filter((s) => s.slot).length ?? 0, SPONSOR_SLOTS);
  const from = formatUsd(cheapestBid(paid ?? []));
  return (
    <section className="sponsor-wall" aria-label="Noordheim sponsors">
      <header>
        <span>OPERATIONS BROUGHT TO YOU BY</span>
        <Link href="/sponsor">
          {open > 0
            ? `${open} of ${SPONSOR_SLOTS} ad slots open · from ${from}`
            : `Outbid a sponsor · from ${from}`}{' '}
          →
        </Link>
      </header>
      <ul>
        {posters.map((poster) =>
          poster.kind === 'open' ? (
            <li key={poster.id} className="is-open">
              <Link
                href="/sponsor"
                aria-label="Put your brand on the battlefield"
              >
                <SponsorPoster sponsor={poster} />
                <span>
                  <strong>Your brand here</strong>
                  <small>On every battlefield · from {from}</small>
                </span>
              </Link>
            </li>
          ) : (
            <li key={poster.id} className={`is-${poster.kind}`}>
              <a
                {...(poster.kind === 'paid'
                  ? paidLink(poster.id, poster.website)
                  : {
                      href: hrefFor(poster, placement),
                      target: '_blank',
                      rel: 'sponsored noopener noreferrer',
                    })}
                data-sponsor={poster.name}
                data-placement={placement}
              >
                <SponsorPoster sponsor={poster} />
                <span>
                  <strong>{poster.name}</strong>
                  <small>
                    {poster.kind === 'main'
                      ? 'Main sponsor'
                      : poster.kind === 'secondary'
                        ? 'Sponsor'
                        : poster.slot
                          ? `Slot ${poster.slot} · ${poster.domain}`
                          : poster.domain}{' '}
                    ↗
                  </small>
                </span>
              </a>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * The debrief credits: a slow roll, like the end of a film, naming everyone
 * who kept this operation free to play.
 */
export function SponsorRoll() {
  const { posters, paid } = useSponsorPosters('debrief');
  const [main, secondary] = posters;
  const names = posters.filter((s) => s.kind === 'paid');
  const from = formatUsd(cheapestBid(paid ?? []));
  return (
    <section className="sponsor-roll" aria-label="Operation sponsors">
      <span className="sponsor-roll-eyebrow">
        THIS OPERATION WAS BROUGHT TO YOU BY
      </span>
      <div
        className="sponsor-roll-reel"
        style={{ '--roll-rows': names.length + 3 } as CSSProperties}
      >
        <div className="sponsor-roll-track">
          <a
            className="sponsor-roll-main"
            href={sponsorHref('debrief')}
            target="_blank"
            rel="sponsored noopener noreferrer"
            data-sponsor={main.name}
            data-placement="debrief"
          >
            <small>MAIN SPONSOR</small>
            <SponsorName name={main.name} src={main.icon} />
          </a>
          <a
            href={sponsorHref('debrief', SECONDARY_SPONSOR)}
            target="_blank"
            rel="sponsored noopener noreferrer"
            data-sponsor={secondary.name}
            data-placement="debrief"
          >
            <SponsorName name={secondary.name} src={secondary.icon} />
          </a>
          {names.map((sponsor) => (
            <a
              key={sponsor.id}
              {...paidLink(sponsor.id, sponsor.website)}
              data-sponsor={sponsor.name}
              data-placement="debrief"
            >
              <SponsorName name={sponsor.name} src={sponsor.icon} />
            </a>
          ))}
          <Link className="sponsor-roll-open" href="/sponsor">
            Your name in these credits · from {from} at noordheim.com/sponsor
          </Link>
        </div>
      </div>
    </section>
  );
}
