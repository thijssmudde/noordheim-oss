/**
 * Sponsor slots are an outbid ladder: an empty slot costs $10, and anyone can
 * take a held slot by paying at least $1 more than its holder did. A slot is
 * held until someone outbids it; the previous holder gets an email with the
 * stats their spot earned.
 */
export const SPONSOR_PRODUCT = 'noordheim-sponsor-outbid';
export const SPONSOR_CURRENCY = 'usd';
export const SPONSOR_START_CENTS = 1000;
export const SPONSOR_STEP_CENTS = 100;
/** A sanity cap on custom bids, so a typo cannot open a five-figure checkout. */
export const SPONSOR_MAX_CENTS = 1_000_000;
/** Placements bought before the outbid ladder ran for a fixed 30 days. */
export const LEGACY_SPONSOR_PRODUCT = 'noordheim-sponsor-30-days';
/** Every slot is its own ladder; together they share the billboards. */
export const SPONSOR_SLOTS = 8;
/** Slot numbers as shown to buyers: 1 to SPONSOR_SLOTS. */
export const sponsorSlots = Array.from(
  { length: SPONSOR_SLOTS },
  (_, i) => i + 1,
);
export const isSponsorSlot = (slot: number) =>
  Number.isInteger(slot) && slot >= 1 && slot <= SPONSOR_SLOTS;

/** The least a buyer can pay for a slot whose holder paid `held` (null when the slot is open). */
export const minimumBid = (held: number | null | undefined) =>
  held ? held + SPONSOR_STEP_CENTS : SPONSOR_START_CENTS;

/**
 * A bid in whole dollars, as typed, to cents. Throws a buyer-facing message
 * when it is below `minimum`, fractional or above the cap.
 */
export function bidCents(dollars: string | number, minimum: number) {
  const text = String(dollars).trim().replace(/^\$/, '');
  if (!/^\d{1,7}$/.test(text)) throw new Error('Enter a whole dollar amount.');
  const cents = Number(text) * 100;
  if (cents < minimum)
    throw new Error(`The minimum for this slot is ${formatUsd(minimum)}.`);
  if (cents > SPONSOR_MAX_CENTS)
    throw new Error(`Bids are capped at ${formatUsd(SPONSOR_MAX_CENTS)}.`);
  return cents;
}

/** The cheapest way onto the board right now: $10 while a slot is open, else the lowest outbid. */
export function cheapestBid(paid: readonly PaidSponsor[]) {
  const held = paid.filter((s) => s.slot);
  if (held.length < SPONSOR_SLOTS) return SPONSOR_START_CENTS;
  return Math.min(...held.map((s) => minimumBid(s.amountCents)));
}

export const formatUsd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

/** "3d 4h", "5h 12m", "8m": how long a spot has been up. */
export function formatHeld(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export const formatCount = (n: number) =>
  n.toLocaleString('en-US', {
    notation: n >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  });

/** Where a paid placement appears. The sponsor page and the Stripe line item share this list. */
export const SPONSOR_PLACEMENTS = [
  'in-world billboards on every battlefield',
  'the home screen sponsor wall',
  'the operation lobby',
  'the victory and defeat debrief credits',
] as const;

/** The fixed main sponsor. Its links carry campaign attribution (see `sponsorHref`). */
export const MAIN_SPONSOR = {
  name: 'VerifiedDR',
  site: 'https://verifieddr.com/',
  icon: '/art/sponsors/verifieddr.png',
  campaign: 'main-sponsor',
} as const;

/** The fixed secondary sponsor, second in every rotation and credit. */
export const SECONDARY_SPONSOR = {
  name: 'PromptRadar.nl',
  site: 'https://promptradar.nl/',
  icon: '/art/sponsors/promptradar.png',
  campaign: 'secondary-sponsor',
} as const;

export type FixedSponsor = typeof MAIN_SPONSOR | typeof SECONDARY_SPONSOR;

/** One poster's worth of sponsor: a fixed sponsor, a paid slot, or the open-slot advert. */
export type BillboardSponsor = {
  id: string;
  kind: 'main' | 'secondary' | 'paid' | 'open';
  name: string;
  /** Printed small under the name. */
  domain: string;
  website: string;
  /** Logo drawn in the poster's emblem; the mountain stands in until it loads or when there is none. */
  icon?: string;
  /** The auction slot a paid poster holds. */
  slot?: number;
  /** Printed on the poster's price tag: what it takes to own this spot next. */
  nextBid?: number;
};

/** A live paid placement as the public `sponsors.active` query returns it. */
export type PaidSponsor = {
  id: string;
  name: string;
  website: string;
  slot?: number | null;
  amountCents?: number | null;
};

/** A paid sponsor's site favicon, proxied through our origin so posters can paint it into WebGL textures. */
export const sponsorIcon = (domain: string) =>
  `/api/favicon?domain=${encodeURIComponent(domain.toLowerCase())}`;

export const OPEN_SLOT_POSTER: BillboardSponsor = {
  id: 'open-slot',
  kind: 'open',
  name: 'Your brand here',
  domain: 'noordheim.com/sponsor',
  website: 'https://noordheim.com/sponsor',
  nextBid: SPONSOR_START_CENTS,
};

/** Posters in rotation: the main and secondary sponsors first, then paid slots in slot order, then an open-slot advert while any slot is free. */
export function billboardSponsors(
  paid: readonly PaidSponsor[] = [],
): BillboardSponsor[] {
  const held = [...paid].sort(
    (a, b) => (a.slot ?? SPONSOR_SLOTS + 1) - (b.slot ?? SPONSOR_SLOTS + 1),
  );
  return [
    {
      id: 'main',
      kind: 'main',
      name: MAIN_SPONSOR.name,
      domain: sponsorDomain(MAIN_SPONSOR.site),
      website: MAIN_SPONSOR.site,
      icon: MAIN_SPONSOR.icon,
    },
    {
      id: 'secondary',
      kind: 'secondary',
      name: SECONDARY_SPONSOR.name,
      domain: sponsorDomain(SECONDARY_SPONSOR.site),
      website: SECONDARY_SPONSOR.site,
      icon: SECONDARY_SPONSOR.icon,
    },
    ...held.slice(0, SPONSOR_SLOTS).map((s) => ({
      id: s.id,
      kind: 'paid' as const,
      name: s.name,
      domain: sponsorDomain(s.website),
      website: s.website,
      icon: sponsorIcon(sponsorDomain(s.website)),
      ...(s.slot
        ? { slot: s.slot, nextBid: minimumBid(s.amountCents ?? null) }
        : {}),
    })),
    ...(paid.length < SPONSOR_SLOTS ? [OPEN_SLOT_POSTER] : []),
  ];
}

export const BILLBOARD_ROTATION_MS = 20_000;

/**
 * The poster billboard `index` shows at time `now` (ms). Every client computes
 * the same answer from the clock alone, neighbouring billboards show different
 * posters, and each board steps to the next poster every 20 s.
 */
export function billboardRotation<T>(
  sponsors: readonly T[],
  index: number,
  now: number,
): T {
  const n = sponsors.length;
  if (!n) throw new Error('billboardRotation needs at least one sponsor');
  const step = Math.floor(now / BILLBOARD_ROTATION_MS) + Math.floor(index);
  return sponsors[((step % n) + n) % n];
}

/** When the next rotation happens after `now`: schedule a repaint for then. */
export const nextBillboardChange = (now: number) =>
  (Math.floor(now / BILLBOARD_ROTATION_MS) + 1) * BILLBOARD_ROTATION_MS;

/** The bare domain printed on posters: `https://www.example.com/x` becomes `example.com`. */
export function sponsorDomain(website: string) {
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return website;
  }
}

export function sponsorDetails(name: string, website: string) {
  const title = name.trim();
  if (title.length < 2 || title.length > 60)
    throw new Error('Enter a brand name between 2 and 60 characters.');
  const raw = website.trim();
  if (raw.length > 400) throw new Error('Website URL is too long.');
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new Error('Enter a valid public HTTPS website.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !url.hostname.includes('.') ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    /^[\d.]+$/.test(url.hostname)
  )
    throw new Error('Enter a valid public HTTPS website.');
  return { name: title, website: url.toString() };
}
