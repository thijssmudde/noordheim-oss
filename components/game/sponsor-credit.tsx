'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  type FixedSponsor,
  MAIN_SPONSOR,
  SECONDARY_SPONSOR,
  sponsorDomain,
  sponsorIcon,
} from '@/lib/sponsorship';
import { SponsorName } from './sponsor-logo';

/** Sponsor links carry campaign attribution so the sponsor can see which screen sent a visit. */
export const SPONSOR = MAIN_SPONSOR;
export const SECOND_SPONSOR = SECONDARY_SPONSOR;

export type SponsorPlacement = 'entrance' | 'operations' | 'battle' | 'debrief';

export function sponsorHref(
  placement: SponsorPlacement,
  sponsor: FixedSponsor = SPONSOR,
) {
  const url = new URL(sponsor.site);
  url.searchParams.set('utm_source', 'noordheim');
  url.searchParams.set('utm_medium', 'sponsor');
  url.searchParams.set('utm_campaign', sponsor.campaign);
  url.searchParams.set('utm_content', placement);
  url.searchParams.set('ref', 'noordheim');
  return url.toString();
}

export function SponsorCredit({
  placement = 'entrance',
  compact = false,
}: {
  placement?: SponsorPlacement;
  compact?: boolean;
}) {
  const sponsors = useQuery(api.sponsors.active, {});
  return (
    <aside
      className={`sponsor-credit ${compact ? 'is-compact' : ''}`}
      aria-label="Noordheim sponsors"
    >
      <div className="sponsor-credit-main">
        <span className="sponsor-credit-label">MAIN SPONSOR</span>
        <a
          className="sponsor-credit-name"
          href={sponsorHref(placement)}
          target="_blank"
          rel="sponsored noopener noreferrer"
          data-sponsor={SPONSOR.name}
          data-placement={placement}
        >
          <Image
            className="sponsor-credit-icon"
            src={SPONSOR.icon}
            alt=""
            width={24}
            height={24}
            unoptimized
          />
          {SPONSOR.name} <span aria-hidden="true">↗</span>
        </a>
        <a
          className="sponsor-credit-name is-secondary"
          href={sponsorHref(placement, SECOND_SPONSOR)}
          target="_blank"
          rel="sponsored noopener noreferrer"
          data-sponsor={SECOND_SPONSOR.name}
          data-placement={placement}
        >
          <Image
            className="sponsor-credit-icon"
            src={SECOND_SPONSOR.icon}
            alt=""
            width={18}
            height={18}
            unoptimized
          />
          {SECOND_SPONSOR.name} <span aria-hidden="true">↗</span>
        </a>
        {!compact && <p>Helping keep Noordheim free to play.</p>}
      </div>
      {sponsors && sponsors.length > 0 && (
        <div className="sponsor-credit-partners">
          <span className="sponsor-credit-label">SPONSORS</span>
          <div>
            {sponsors.map((sponsor) => (
              <a
                key={sponsor.id}
                href={sponsor.website}
                target="_blank"
                rel="sponsored noopener noreferrer"
              >
                <SponsorName
                  name={sponsor.name}
                  src={sponsorIcon(sponsorDomain(sponsor.website))}
                />{' '}
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="sponsor-credit-invite">
        <strong>Your sponsor spot</strong>
        {!compact && (
          <p>Your brand and website link alongside our main sponsor.</p>
        )}
        <Link className="sponsor-credit-join" href="/sponsor">
          Become a sponsor →
        </Link>
      </div>
    </aside>
  );
}
