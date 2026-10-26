'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import {
  ConvexProvider,
  ConvexReactClient,
  useAction,
  useQuery,
} from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import {
  MAIN_SPONSOR,
  SECONDARY_SPONSOR,
  OPEN_SLOT_POSTER,
  SPONSOR_SLOTS,
  SPONSOR_START_CENTS,
  SPONSOR_STEP_CENTS,
  bidCents,
  formatCount,
  formatHeld,
  formatUsd,
  isSponsorSlot,
  sponsorDetails,
  sponsorDomain,
  sponsorIcon,
  type BillboardSponsor,
} from '@/lib/sponsorship';
import { mapIds, type MapId } from '@/lib/battlefields';
import { MapArt } from './battlefield-backdrop';
import { SponsorLogo, SponsorName } from './sponsor-logo';
import { SponsorPoster } from './sponsor-wall';

const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
type Props = { sessionId?: string; cancelled: boolean; slot?: number };
type Board = NonNullable<ReturnType<typeof useBoard>>;
type Slot = Board['slots'][number];

export function SponsorCheckout(props: Props) {
  return (
    <ConvexProvider client={client}>
      <SponsorSales {...props} />
    </ConvexProvider>
  );
}

const useBoard = () => useQuery(api.sponsors.board, {});

/** The clock "time on the board" counts against; ticks twice a minute. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const ago = (ms: number) =>
  ms < 60_000 ? 'just now' : `${formatHeld(ms)} ago`;

/** What the buyer's poster will look like, from whatever they have typed so far. */
function previewPoster(
  name: string,
  website: string,
  iconDomain: string,
  slot: number,
  nextBid: number,
): BillboardSponsor {
  const title = name.trim();
  if (!title) return OPEN_SLOT_POSTER;
  const raw = website.trim();
  let domain = 'yourwebsite.com';
  if (raw)
    try {
      domain = sponsorDomain(
        new URL(raw.includes('://') ? raw : `https://${raw}`).toString(),
      );
    } catch {
      domain = raw;
    }
  return {
    id: 'preview',
    kind: 'paid',
    name: title.slice(0, 60),
    domain,
    website: raw,
    icon: iconDomain === domain ? sponsorIcon(domain) : undefined,
    slot,
    nextBid,
  };
}

/** The domain to fetch a favicon for, once the buyer has typed a plausible one. */
function settledDomain(website: string) {
  try {
    return sponsorDomain(sponsorDetails('preview', website).website);
  } catch {
    return '';
  }
}

/** A slot's poster as it hangs on the billboards right now. */
function slotPoster(slot: Slot): BillboardSponsor {
  if (!slot.holder) return OPEN_SLOT_POSTER;
  const domain = sponsorDomain(slot.holder.website);
  return {
    id: `slot-${slot.slot}`,
    kind: 'paid',
    name: slot.holder.name,
    domain,
    website: slot.holder.website,
    icon: sponsorIcon(domain),
    slot: slot.slot,
    nextBid: slot.minimum,
  };
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sp-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SlotCard({
  slot,
  now,
  selected,
  onPick,
}: {
  slot: Slot;
  now: number;
  selected: boolean;
  onPick: (slot: Slot) => void;
}) {
  const poster = useMemo(() => slotPoster(slot), [slot]);
  const holder = slot.holder;
  return (
    <li
      className={`sp-slot ${holder ? 'is-held' : 'is-open'} ${selected ? 'is-selected' : ''}`}
    >
      <header>
        <span>SLOT {String(slot.slot).padStart(2, '0')}</span>
        {holder && <strong>{formatUsd(holder.amountCents)}</strong>}
      </header>
      <SponsorPoster sponsor={poster} />
      {holder ? (
        <>
          <a
            className="sp-slot-name"
            href={holder.website}
            target="_blank"
            rel="sponsored noopener noreferrer"
          >
            <SponsorName name={holder.name} src={poster.icon} />{' '}
            <span aria-hidden="true">↗</span>
          </a>
          <dl>
            <Stat label="Up for" value={formatHeld(now - holder.since)} />
            <Stat label="Views" value={formatCount(holder.views)} />
            <Stat label="Clicks" value={formatCount(holder.clicks)} />
          </dl>
        </>
      ) : (
        <p className="sp-slot-name is-empty">
          Open. Nobody holds this slot yet.
        </p>
      )}
      <button
        type="button"
        onClick={() => onPick(slot)}
        aria-pressed={selected}
      >
        {holder ? 'Outbid' : 'Claim'} · {formatUsd(slot.minimum)}
      </button>
    </li>
  );
}

function OutbidBoard({
  board,
  now,
  selected,
  onPick,
}: {
  board: Board | undefined;
  now: number;
  selected: number;
  onPick: (slot: Slot) => void;
}) {
  return (
    <section id="board" className="sp-board" aria-labelledby="sp-board-title">
      <div className="sp-board-head">
        <div>
          <span className="sp-eyebrow">THE OUTBID BOARD</span>
          <h2 id="sp-board-title">Eight slots. Take any one.</h2>
        </div>
        <p>
          An open slot costs {formatUsd(SPONSOR_START_CENTS)}. A held slot costs{' '}
          {formatUsd(SPONSOR_STEP_CENTS)} more than its holder paid, or whatever
          you want to put down. You keep it until someone outbids you.
        </p>
      </div>
      {board ? (
        <ol className="sp-slot-grid">
          {board.slots.map((slot) => (
            <SlotCard
              key={slot.slot}
              slot={slot}
              now={now}
              selected={selected === slot.slot}
              onPick={onPick}
            />
          ))}
        </ol>
      ) : (
        <p className="sp-board-loading">Loading the board…</p>
      )}
      {board && board.recent.length > 0 && (
        <aside className="sp-feed" aria-label="Latest takeovers">
          <span className="sp-eyebrow">LATEST TAKEOVERS</span>
          <ul>
            {board.recent.map((item) => (
              <li key={`${item.slot}-${item.at}`}>
                <strong>{item.name}</strong> took slot {item.slot} for{' '}
                <b>{formatUsd(item.amountCents)}</b>
                <time dateTime={new Date(item.at).toISOString()}>
                  {ago(now - item.at)}
                </time>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}

/** After Stripe: the buyer's spot, live, or what happened to it. */
function PaymentResult({ sessionId, now }: { sessionId: string; now: number }) {
  const paid = useQuery(api.sponsors.status, { sessionId });
  if (paid === undefined || paid === null)
    return (
      <section className="sp-result is-waiting" aria-live="polite">
        <span className="sp-eyebrow">CHECKING WITH STRIPE</span>
        <h2>Waiting for payment confirmation</h2>
        <p>
          Your poster goes up automatically once Stripe confirms payment. Some
          payment methods take longer. You can close this page; you don’t need
          to pay again. Your receipt and invoice arrive by email.
        </p>
      </section>
    );
  const stats = (
    <dl className="sp-result-stats">
      <Stat label="Slot" value={paid.slot ? `#${paid.slot}` : '—'} />
      <Stat
        label="You paid"
        value={paid.amountCents ? formatUsd(paid.amountCents) : '—'}
      />
      <Stat
        label="Up for"
        value={formatHeld((paid.endedAt ?? now) - paid.startsAt)}
      />
      <Stat label="Views" value={formatCount(paid.views)} />
      <Stat label="Clicks" value={formatCount(paid.clicks)} />
    </dl>
  );
  const reclaim = paid.slot && paid.nextCents && (
    <Link href={`/sponsor?slot=${paid.slot}#book`}>
      Take slot {paid.slot} back · {formatUsd(paid.nextCents)} →
    </Link>
  );
  if (paid.status === 'active')
    return (
      <section className="sp-result" aria-live="polite">
        <span className="sp-eyebrow">PAYMENT CONFIRMED · LIVE</span>
        <h2>{paid.name} is on the battlefield.</h2>
        <p>
          Your poster is up on every billboard rotation, the home screen, the
          lobby and the credits. We sent your receipt and invoice by email, and
          we email you the moment someone outbids you.
        </p>
        {stats}
        <Link href="/">See your billboard in Noordheim →</Link>
      </section>
    );
  if (paid.status === 'outbid')
    return (
      <section className="sp-result is-outbid" aria-live="polite">
        <span className="sp-eyebrow">OUTBID</span>
        <h2>
          Someone took slot {paid.slot} from {paid.name}.
        </h2>
        <p>Here is what your spot did while it was up.</p>
        {stats}
        {reclaim}
      </section>
    );
  if (paid.status === 'lost')
    return (
      <section className="sp-result is-outbid" aria-live="polite">
        <span className="sp-eyebrow">REFUNDED</span>
        <h2>Someone got to slot {paid.slot} first.</h2>
        <p>
          Another sponsor paid the same or more while your checkout was open, so
          your {paid.amountCents ? formatUsd(paid.amountCents) : 'payment'} is
          refunded in full.
        </p>
        {reclaim}
      </section>
    );
  return (
    <section className="sp-result is-outbid" aria-live="polite">
      <h2>
        This placement is {paid.status === 'expired' ? 'finished' : 'inactive'}.
      </h2>
      <Link href="/sponsor#board">See the outbid board →</Link>
    </section>
  );
}

/** The buyer's poster on a hoarding in the field, repainted as they type. */
function BillboardScene({
  mapId,
  poster,
  className = '',
  children,
}: {
  mapId: MapId;
  poster: BillboardSponsor;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className={`sp-hero-visual ${className}`}>
      <MapArt mapId={mapId} className="sp-hero-art" />
      <div className="sp-hoarding">
        <SponsorPoster sponsor={poster} />
        <span className="sp-hoarding-legs" />
      </div>
      <figcaption>{children}</figcaption>
    </figure>
  );
}

function Placement({
  index,
  title,
  body,
  children,
}: {
  index: number;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <article className="sp-placement">
      <div className="sp-placement-visual" aria-hidden="true">
        {children}
      </div>
      <span className="sp-placement-index">
        {String(index).padStart(2, '0')}
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

/**
 * The home screen and lobby sponsor wall in miniature. Drawn in markup rather
 * than painted posters, so it reads at thumbnail size and shows before the
 * page hydrates or the board loads.
 */
function WallMock({
  board,
  poster,
  slot,
}: {
  board: Board | undefined;
  poster: BillboardSponsor;
  slot: number;
}) {
  const yours = poster.kind === 'open' ? 'Your brand' : poster.name;
  const rival = board?.slots.find((s) => s.holder && s.slot !== slot);
  const open = board?.slots.filter((s) => !s.holder).length;
  const from = formatUsd(SPONSOR_START_CENTS);
  return (
    <div className="sp-mock-wall">
      <header>
        <span>BROUGHT TO YOU BY</span>
        <b>
          {open === undefined
            ? `From ${from}`
            : open > 0
              ? `${open} of ${SPONSOR_SLOTS} open`
              : 'Outbid'}{' '}
          →
        </b>
      </header>
      <ul>
        <li className="is-main">
          <i>
            <Image
              src={MAIN_SPONSOR.icon}
              alt=""
              width={14}
              height={14}
              unoptimized
            />
            {MAIN_SPONSOR.name}
          </i>
          <strong>{MAIN_SPONSOR.name}</strong>
          <small>Main sponsor</small>
        </li>
        <li className="is-yours">
          <i>{yours}</i>
          <strong>{yours}</strong>
          <small>
            Slot {slot} ·{' '}
            {poster.kind === 'open' ? 'yoursite.com' : poster.domain}
          </small>
        </li>
        {rival?.holder ? (
          <li className="is-paid">
            <i>{rival.holder.name}</i>
            <strong>{rival.holder.name}</strong>
            <small>
              Slot {rival.slot} · {sponsorDomain(rival.holder.website)}
            </small>
          </li>
        ) : (
          <li className="is-open">
            <i>
              Your brand here<em>{from}</em>
            </i>
            <strong>Your brand here</strong>
            <small>From {from}</small>
          </li>
        )}
      </ul>
      <footer>
        Supported by <SponsorLogo src={MAIN_SPONSOR.icon} />{' '}
        <b>{MAIN_SPONSOR.name}</b> · <em>{yours}</em>
      </footer>
    </div>
  );
}

function SponsorSales({ sessionId, cancelled, slot: requested }: Props) {
  const checkout = useAction(api.sponsorPayments.checkout);
  const board = useBoard();
  const now = useNow();
  const [picked, setPicked] = useState<number | null>(
    requested && isSponsorSlot(requested) ? requested : null,
  );
  // Until the buyer picks, point them at the first open slot (or the cheapest to outbid).
  const suggested = useMemo(() => {
    if (!board) return 1;
    const open = board.slots.find((s) => !s.holder);
    return (
      open ?? board.slots.reduce((a, b) => (b.minimum < a.minimum ? b : a))
    ).slot;
  }, [board]);
  const slot = picked ?? suggested;
  const current = board?.slots.find((s) => s.slot === slot);
  const minimum = current?.minimum ?? SPONSOR_START_CENTS;
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  // Empty means "the minimum", which follows the board as bids land.
  const [amount, setAmount] = useState('');
  const dollars = amount.trim() || String(minimum / 100);
  let bid: number | null = null;
  try {
    bid = bidCents(dollars, minimum);
  } catch {
    bid = null;
  }
  // Fetch the favicon once typing pauses, not for every partial domain.
  const [iconDomain, setIconDomain] = useState('');
  const iconTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ details: string; id: string } | null>(null);
  const poster = useMemo(
    () =>
      previewPoster(
        name,
        website,
        iconDomain,
        slot,
        (bid ?? minimum) + SPONSOR_STEP_CENTS,
      ),
    [name, website, iconDomain, slot, bid, minimum],
  );
  const taken = board?.slots.filter((s) => s.holder).length ?? 0;
  const heroMap = mapIds[0];

  function pick(next: Slot) {
    setPicked(next.slot);
    setAmount('');
    setError('');
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' });
  }

  // The hero preview sits far above the form: bring the brand field (and the
  // preview beside it) into view with the cursor already in it. Scrolling to
  // #book instead would leave the field below the fold on phones.
  function startTyping(event: MouseEvent<HTMLAnchorElement>) {
    const field = document.getElementById('sponsor-name');
    if (!field) return;
    event.preventDefault();
    field.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    let details, amountCents;
    try {
      details = sponsorDetails(name, website);
      amountCents = bidCents(dollars, minimum);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    const fingerprint = JSON.stringify({ ...details, slot, amountCents });
    if (attempt.current?.details !== fingerprint)
      attempt.current = { details: fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await checkout({
        ...details,
        slot,
        amountCents,
        requestId: attempt.current.id,
      });
      window.location.assign(result.url);
    } catch (cause) {
      setError(
        cause instanceof ConvexError
          ? String(cause.data)
          : 'Could not open checkout. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <main className="sponsor-page sp-page">
      <nav className="sp-nav">
        <Link className="sponsor-back" href="/">
          ← Back to Noordheim
        </Link>
        <a href="#board">The outbid board</a>
      </nav>

      {sessionId && <PaymentResult sessionId={sessionId} now={now} />}

      <header className="sp-hero">
        <div>
          <span className="sp-eyebrow">SPONSOR NOORDHEIM</span>
          <h1>
            Your brand on the battlefield from {formatUsd(SPONSOR_START_CENTS)}.
          </h1>
          <p className="sp-lede">
            Noordheim is a free co-op strategy game played in the browser. Your
            name goes up on painted billboards inside every map, next to every
            commander’s base, on the home screen, in the lobby and in the
            credits after each battle. Then someone outbids you, or they don’t.
          </p>
          <div className="sp-offer">
            <strong>{formatUsd(SPONSOR_START_CENTS)}</strong>
            <span>
              to claim an open slot
              <small>
                +{formatUsd(SPONSOR_STEP_CENTS)} to outbid anyone · one-off · no
                account needed
              </small>
            </span>
          </div>
          <div className="sp-slots" aria-live="polite">
            <div className="sp-slot-meter" aria-hidden="true">
              {Array.from({ length: SPONSOR_SLOTS }, (_, i) => (
                <span
                  key={i}
                  className={board && i < taken ? 'is-taken' : ''}
                />
              ))}
            </div>
            <span>
              {!board
                ? 'Checking slots…'
                : taken >= SPONSOR_SLOTS
                  ? `All ${SPONSOR_SLOTS} slots held · outbid from ${formatUsd(minimum)}`
                  : `${SPONSOR_SLOTS - taken} of ${SPONSOR_SLOTS} slots open at ${formatUsd(SPONSOR_START_CENTS)}`}
            </span>
          </div>
          <a className="sp-cta" href="#board">
            See the board →
          </a>
        </div>
        <BillboardScene mapId={heroMap} poster={poster}>
          {poster.kind === 'open' && !sessionId ? (
            <a href="#book" onClick={startTyping}>
              Type your brand to see your billboard →
            </a>
          ) : (
            'Your billboard, painted live'
          )}
        </BillboardScene>
      </header>

      <OutbidBoard board={board} now={now} selected={slot} onPick={pick} />

      <section className="sp-placements" aria-labelledby="sp-where">
        <h2 id="sp-where">Where your brand appears</h2>
        <div className="sp-placement-grid">
          <Placement
            index={1}
            title="Billboards at every base"
            body="A lamp-lit hoarding stands beside every commander’s landing, in view the moment a battle opens, plus hoardings, towers and banners across all five maps. Boards flip to the next poster every 20 seconds."
          >
            <div className="sp-mock-field">
              <MapArt mapId={heroMap} className="sp-mock-art" />
              <SponsorPoster
                sponsor={poster}
                style="tower"
                className="sp-mock-tower"
              />
              <SponsorPoster
                sponsor={poster}
                style="banner"
                className="sp-mock-banner"
              />
            </div>
          </Placement>
          <Placement
            index={2}
            title="The battle HUD"
            body="While the billboards show your poster, your name and link sit in the command panel under the main sponsor."
          >
            <div className="sp-mock-hud">
              <MapArt mapId={heroMap} className="sp-mock-art" />
              <div className="sponsor-badge-stack">
                <span className="sponsor-badge">
                  <Image
                    className="sponsor-credit-icon"
                    src={MAIN_SPONSOR.icon}
                    alt=""
                    width={16}
                    height={16}
                    unoptimized
                  />
                  <span>
                    <small>MAIN SPONSOR</small>
                    {MAIN_SPONSOR.name}
                  </span>
                  <span>↗</span>
                </span>
                <span className="sponsor-badge-rotor">
                  <small>ON THE BILLBOARDS · SLOT {slot}</small>
                  <strong>
                    <SponsorName
                      name={poster.kind === 'open' ? 'Your brand' : poster.name}
                      src={poster.icon}
                    />
                  </strong>
                  <span>↗</span>
                </span>
              </div>
            </div>
          </Placement>
          <Placement
            index={3}
            title="Home screen and lobby"
            body="Every commander passes the sponsor wall before deploying, and co-op squads wait in front of it. Your poster links to your website."
          >
            <WallMock board={board} poster={poster} slot={slot} />
          </Placement>
          <Placement
            index={4}
            title="The debrief credits"
            body="Win or lose, every battle ends with a credits roll: “This operation was brought to you by”, and then your name."
          >
            <div className="sp-mock-credits">
              <small>THIS OPERATION WAS BROUGHT TO YOU BY</small>
              <em>MAIN SPONSOR</em>
              <strong>
                <SponsorName name={MAIN_SPONSOR.name} src={MAIN_SPONSOR.icon} />
              </strong>
              <b>
                <SponsorName
                  name={SECONDARY_SPONSOR.name}
                  src={SECONDARY_SPONSOR.icon}
                />
              </b>
              <b>
                <SponsorName
                  name={poster.kind === 'open' ? 'Your brand' : poster.name}
                  src={poster.icon}
                />
              </b>
            </div>
          </Placement>
        </div>
      </section>

      <section id="book" className="sp-book" aria-labelledby="sp-book-title">
        <div className="sp-book-copy">
          <span className="sp-eyebrow">PLACE YOUR BID</span>
          <h2 id="sp-book-title">Pick a slot, name your price.</h2>
          <ul>
            <li>
              Pay the minimum or any whole-dollar amount above it. A higher bid
              makes the next person pay more to take your slot.
            </li>
            <li>
              Your poster stays up until someone outbids you. There is no end
              date and no subscription.
            </li>
            <li>
              Stripe asks for your email. We send your receipt and invoice
              there, and an alert with your spot’s time up, views and clicks if
              you are outbid.
            </li>
            <li>
              If someone outbids you while your checkout is still open, you are
              refunded in full automatically. {MAIN_SPONSOR.name} stays the main
              sponsor.
            </li>
          </ul>
          {!sessionId && (
            <BillboardScene
              mapId={heroMap}
              poster={poster}
              className="sp-book-scene"
            >
              {poster.kind === 'open'
                ? 'Your billboard appears here as you type'
                : 'Your billboard, painted live'}
            </BillboardScene>
          )}
        </div>
        {sessionId ? null : (
          <form className="sp-form" onSubmit={(event) => void submit(event)}>
            {cancelled && (
              <output>
                Checkout was cancelled. You can try again when you’re ready.
              </output>
            )}
            <label htmlFor="sponsor-slot">Slot</label>
            <select
              id="sponsor-slot"
              value={slot}
              onChange={(event) => {
                setPicked(Number(event.target.value));
                setAmount('');
              }}
              disabled={busy}
            >
              {(board?.slots ?? []).map((s) => (
                <option key={s.slot} value={s.slot}>
                  Slot {s.slot} ·{' '}
                  {s.holder
                    ? `${s.holder.name} holds it at ${formatUsd(s.holder.amountCents)}`
                    : 'open'}{' '}
                  · from {formatUsd(s.minimum)}
                </option>
              ))}
            </select>
            <label htmlFor="sponsor-bid">Your bid (USD)</label>
            <div className="sp-bid">
              <span aria-hidden="true">$</span>
              <input
                id="sponsor-bid"
                name="bid"
                inputMode="numeric"
                value={amount}
                placeholder={String(minimum / 100)}
                onChange={(event) =>
                  setAmount(
                    event.target.value.replace(/[^\d]/g, '').slice(0, 7),
                  )
                }
                aria-describedby="sponsor-bid-hint"
                disabled={busy}
              />
            </div>
            <fieldset className="sp-bid-chips" aria-label="Quick bids">
              {[0, 400, 900, 2400].map((extra) => (
                <button
                  key={extra}
                  type="button"
                  onClick={() => setAmount(String((minimum + extra) / 100))}
                  aria-pressed={bid === minimum + extra}
                  disabled={busy}
                >
                  {formatUsd(minimum + extra)}
                </button>
              ))}
            </fieldset>
            <p id="sponsor-bid-hint" className="sp-bid-hint">
              Minimum {formatUsd(minimum)} for slot {slot}. Whole dollars.
            </p>
            <div className="sp-form-preview">
              <SponsorPoster sponsor={poster} />
            </div>
            <label htmlFor="sponsor-name">Brand name</label>
            <input
              id="sponsor-name"
              name="name"
              required
              minLength={2}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your brand"
              disabled={busy}
            />
            <label htmlFor="sponsor-website">Website</label>
            <input
              id="sponsor-website"
              name="website"
              required
              maxLength={400}
              value={website}
              onChange={(event) => {
                const value = event.target.value;
                setWebsite(value);
                clearTimeout(iconTimer.current);
                iconTimer.current = setTimeout(
                  () => setIconDomain(settledDomain(value)),
                  500,
                );
              }}
              onBlur={() => setIconDomain(settledDomain(website))}
              placeholder="https://yourwebsite.com"
              inputMode="url"
              disabled={busy}
            />
            {error && (
              <p className="sponsor-checkout-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy || !board || bid === null}>
              {busy
                ? 'Opening Stripe…'
                : bid === null
                  ? `Bid at least ${formatUsd(minimum)}`
                  : `Pay ${formatUsd(bid)} · take slot ${slot}`}
            </button>
            <p className="sponsor-checkout-note">
              Pay securely through Stripe. Your brand name and website go public
              once payment clears.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
