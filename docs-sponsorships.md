# Paid sponsor spots: the outbid board

VerifiedDR is the fixed main sponsor and PromptRadar.nl the fixed secondary
sponsor. Next to them are eight paid ad
slots (`SPONSOR_SLOTS`), each its own outbid ladder, in the spirit of
outbid.lol:

- An open slot costs **$10** (`SPONSOR_START_CENTS`).
- A held slot costs **$1 more than its holder paid** (`minimumBid`), or any
  whole-dollar amount above that, capped at $10,000 (`bidCents`).
- A slot is held **until someone outbids it**. There is no end date and no
  subscription.

Stripe Checkout collects the buyer's email. The buyer gets a receipt email with
Stripe's hosted invoice; the holder who is outbid gets an alert with the stats
their spot earned (time on the board, views, clicks, what they paid, the new
price) and a link to take the slot back. Emails go out through Cloudflare Email
Service (`convex/sponsorEmails.ts`, templates in `lib/sponsor-emails.ts`).

A paid slot appears in:

- **In-world billboards** (`components/game/world/billboards.tsx`). Besides the
  authored boards on every map, each landing gets a lamp-lit **home billboard**
  that the opening camera sees (`lib/sponsor-placement.ts`). Before, no
  billboard stood in the uncovered playfield of the opening camera at any of
  the 22 landings; now every one shows one (`tests/sponsor-placement.test.ts`). Billboards never block
  construction: when a commander builds on the board's ground it moves to the
  next spot in view, and comes down only when every spot is built over.
  Posters carry an **outbid price tag** ("OUTBID ME · $13", or "THIS SPOT · $1"
  on the open-slot advert), glow faintly so they read at dusk, and change with
  a tri-vision **slat flip** done in the poster's fragment shader (no extra
  meshes or draw calls). The rotation is the main sponsor, the secondary sponsor, the paid slots in
  slot order, then the open-slot advert while a slot is free; each board steps
  every 20 s, derived from the clock, so every player sees the same poster.
- **The battle HUD** (`components/game/sponsor-badge.tsx`): under the main
  sponsor, the paid sponsor the billboards show, changing with them.
- **The lobby sponsor wall** (`sponsor-wall.tsx`) with slot and price.
- **The debrief credits** after defeat and victory.

## Stats

Views and clicks are counted in the browser and sent in batches every 15 s
(`components/game/sponsor-stats.ts` → `sponsors.record`). A view is a poster on
screen: once per mount of the wall or credits, and once per 20-second billboard
step per battle, however many boards or the badge show it in that step.
Counts are capped per batch and only land on live placements, so they are
indicative figures, not billing data. They live in `sponsorStats`, apart from
`sponsors`, so recording one never re-runs the query every billboard
subscribes to.

## Races and refunds

Checkout re-checks the minimum and sessions expire after 30 minutes. If two
buyers pay for the same slot, fulfillment is serialized: the first valid bid
takes the slot, and a later payment that no longer beats the holder is
recorded as `lost`, **refunded in full** (idempotency key per session) and the
buyer is emailed. A refund that fails throws, so Stripe redelivers the webhook
and the refund is retried. Full refunds and disputes of a holder take the
poster down and reopen the slot at $10.

Placements sold before the ladder (€499 for 30 days) keep showing until their
`expiresAt`, outside the eight slots, and a refund or dispute still takes them
down.

## Enable checkout (3 steps)

1. In the Stripe account you want to use, create a secret key (or a restricted
   key with Checkout Sessions write, Charges/Payment Intents read, Refunds
   write, Invoices read and Webhook Endpoints write). Use a test key for development and a live key for production.
2. Development: `STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs`.
   The script creates (or reuses) the webhook endpoint
   `https://<dev deployment>.convex.site/stripe/sponsors` with the four events
   below and sets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
   `SPONSOR_SITE_URL=http://localhost:3111` on the dev deployment (override with
   `--site <origin>`). Secrets pass to `convex env set` over stdin and are never
   printed; the script prints only the key mode.
3. Production: deploy the Convex functions first, then
   `STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe.mjs --prod`. It
   reads `CONVEX_DEPLOY_KEY` from `.env.production` and sets
   `SPONSOR_SITE_URL=https://noordheim.com`.

The script refuses a live key on dev and a test key on prod unless
`--allow-mode-mismatch`. Stripe reveals a signing secret only when an endpoint
is created, so a rerun keeps the secret already on the deployment; pass
`--recreate` to replace a lost one.

## Configuration

Set these on the corresponding Convex deployment, not in browser variables:

- `STRIPE_SECRET_KEY`: the selected Stripe account's server credential. Prefer
  a restricted key with the permissions needed for Checkout Sessions and payment
  retrieval. Keep test and live credentials on separate deployments.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this deployment's own endpoint.
  Do not reuse another project's webhook signing secret.
- `SPONSOR_SITE_URL`: the website origin for Stripe return links (no trailing
  slash), such as `https://noordheim.com` in production.
- `STRIPE_AUTOMATIC_TAX`: set to `true` only after verifying active tax
  registrations on the selected account. Bids use inclusive tax behavior. The Advertising Services tax code was checked against Stripe's
  Tax Codes API: `txcd_20060002`.

Register `https://<deployment>.convex.site/stripe/sponsors` in the same Stripe
account and mode with these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN`: Cloudflare Email
  Service credentials (token with email-sending permission). Without them
  payments still work; emails are skipped with a log line.
- `SPONSOR_EMAIL_FROM`: sender address on a domain onboarded to Cloudflare
  Email Service; defaults to `mail@thijssmudde.nl`.

Checkout stays unavailable until its key, webhook secret and return origin are
configured. Deploy the Convex functions before publishing the client.

## Fulfillment

The webhook verifies the raw request signature and retrieves the current session
from Stripe. Only paid, completed Noordheim purchases in USD with one line item
whose amount matches the bid in the session metadata claim a slot. Unpaid and
unrelated purchases are ignored. `sponsors.claim` handles one Checkout Session
once, including concurrent or repeated deliveries; repeated payment events
never move a slot twice or revive a refunded placement.

Public queries return brand details, slot, price and stats, never the buyer's
email, payment credentials or payment-intent IDs. Names render as text (and are
escaped in emails) and website links use `rel="sponsored noopener noreferrer"`.

## Validation

`pnpm exec vitest run tests/sponsors.test.ts tests/sponsor-payments.test.ts tests/sponsor-placement.test.ts`
checks the ladder ($10 start, +$1 minimum, custom bids), receipt and outbid
emails with stats, lost-race refunds and their retry, forged signatures,
unpaid/mismatched purchases, duplicate fulfillment, refunds, legacy
placements, stat caps, unsafe website URLs, the deterministic billboard
rotation, and that every landing's opening camera sees a billboard.

Review pages (dev only): `/?uiReview=posters` paints every poster variant;
`/?uiReview=hud&sponsors=demo` and `/?artReview=1&sponsors=demo` show paid
fixture sponsors on the battlefield.
Stripe calls are mocked; these tests do not charge a real payment method.
