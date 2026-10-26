'use client';

import { memo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  BILLBOARD_ROTATION_MS,
  billboardRotation,
  formatUsd,
  SPONSOR_START_CENTS,
} from '@/lib/sponsorship';
import { useBillboardClock, useBillboardSponsors } from './sponsor-billboard';
import { SECOND_SPONSOR, SPONSOR, sponsorHref } from './sponsor-credit';
import { SponsorName } from './sponsor-logo';
import { countSponsorClick, countSponsorView } from './sponsor-stats';

/**
 * In-battle credit: the main sponsor, and under it whichever paid sponsor (or
 * open slot) the billboards are showing, changing with them every 20 s. It
 * has its own clock, so the per-tick HUD re-render never touches it.
 */
export const SponsorBadge = memo(function SponsorBadge() {
  const sponsors = useBillboardSponsors();
  const now = useBillboardClock();
  const others = sponsors.filter((s) => s.kind !== 'main');
  const secondaryHref = sponsorHref('battle', SECOND_SPONSOR);
  const current = others.length ? billboardRotation(others, 0, now) : null;
  const step = Math.floor(now / BILLBOARD_ROTATION_MS);
  // Shares the billboards' key: a sponsor on screen in one step is one view.
  useEffect(() => {
    if (current?.kind === 'paid') countSponsorView(current.id, `board:${step}`);
  }, [current, step]);
  return (
    <div className="sponsor-badge-stack">
      <a
        className="sponsor-badge"
        href={sponsorHref('battle')}
        target="_blank"
        rel="sponsored noopener noreferrer"
        data-sponsor={SPONSOR.name}
        data-placement="battle"
      >
        <Image
          className="sponsor-credit-icon"
          src={SPONSOR.icon}
          alt=""
          width={16}
          height={16}
          unoptimized
        />
        <span>
          <small>MAIN SPONSOR</small>
          {SPONSOR.name}
        </span>
        <span aria-hidden="true">↗</span>
      </a>
      {current?.kind === 'secondary' ? (
        <a
          key={current.id}
          className="sponsor-badge-rotor"
          href={secondaryHref}
          target="_blank"
          rel="sponsored noopener noreferrer"
          data-sponsor={current.name}
          data-placement="battle"
        >
          <small>SPONSOR</small>
          <strong>
            <SponsorName name={current.name} src={current.icon} size={15} />
          </strong>
          <span aria-hidden="true">↗</span>
        </a>
      ) : current?.kind === 'paid' ? (
        <a
          key={current.id}
          className="sponsor-badge-rotor"
          href={current.website}
          target="_blank"
          rel="sponsored noopener noreferrer"
          onClick={() => countSponsorClick(current.id)}
          data-sponsor={current.name}
          data-placement="battle"
        >
          <small>
            ON THE BILLBOARDS{current.slot ? ` · SLOT ${current.slot}` : ''}
          </small>
          <strong>
            <SponsorName name={current.name} src={current.icon} size={15} />
          </strong>
          <span aria-hidden="true">↗</span>
        </a>
      ) : current ? (
        <Link
          key="open"
          className="sponsor-badge-rotor is-open"
          href="/sponsor"
        >
          <small>AD SLOT OPEN</small>
          <strong>
            Your brand here ·{' '}
            {formatUsd(current.nextBid ?? SPONSOR_START_CENTS)}
          </strong>
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
});
