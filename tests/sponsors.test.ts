import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import {
  BILLBOARD_ROTATION_MS,
  OPEN_SLOT_POSTER,
  SPONSOR_SLOTS,
  bidCents,
  billboardRotation,
  billboardSponsors,
  cheapestBid,
  formatHeld,
  minimumBid,
  nextBillboardChange,
  sponsorDetails,
} from '../lib/sponsorship';
import { sponsorEmail } from '../lib/sponsor-emails';

const modules = import.meta.glob('../convex/**/*.ts');
const bid = (n: number, over: Record<string, unknown> = {}) => ({
  sessionId: `cs_test_${n}`,
  paymentIntentId: `pi_test_${n}`,
  name: `Brand ${n}`,
  website: `https://brand${n}.example`,
  email: `buyer${n}@example.com`,
  slot: 1,
  amountCents: 1000,
  revoked: false,
  ...over,
});

/** Mail the scheduler handed to Cloudflare, as [to, subject, text]. */
function mailbox() {
  const sent: { to: string; subject: string; text: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response('{"success":true}', { status: 200 });
    }),
  );
  return sent;
}

describe('Outbid ladder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_EMAIL_API_TOKEN', 'token');
    vi.stubEnv('SPONSOR_SITE_URL', 'https://noordheim.com');
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('an open slot starts at $10 and each takeover raises the minimum by $1', async () => {
    const t = convexTest(schema, modules);
    const board = await t.query(api.sponsors.board, {});
    expect(board.slots).toHaveLength(SPONSOR_SLOTS);
    expect(board.slots.every((s) => s.minimum === 1000 && !s.holder)).toBe(true);
    await t.mutation(internal.sponsors.claim, bid(1));
    expect(await t.query(internal.sponsors.minimum, { slot: 1 })).toBe(1100);
    await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 2500 }));
    expect(await t.query(internal.sponsors.minimum, { slot: 1 })).toBe(2600);
    const after = await t.query(api.sponsors.board, {});
    expect(after.slots[0].holder).toMatchObject({ name: 'Brand 2', amountCents: 2500 });
    expect(after.recent.map((r) => r.name)).toEqual(['Brand 2', 'Brand 1']);
    // Public reads never expose the buyer's email or payment ids.
    expect(JSON.stringify(after)).not.toContain('@example.com');
    expect(JSON.stringify(await t.query(api.sponsors.active, {}))).not.toMatch(
      /@example.com|pi_test|cs_test/,
    );
  });

  test('the buyer gets a receipt with the invoice, and the outbid holder gets their stats', async () => {
    const sent = mailbox();
    const t = convexTest(schema, modules);
    await t.mutation(internal.sponsors.claim, {
      ...bid(1),
      invoiceUrl: 'https://invoice.stripe.com/i/test',
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('buyer1@example.com');
    expect(sent[0].subject).toContain('slot #1');
    expect(sent[0].text).toContain('https://invoice.stripe.com/i/test');

    const [holder] = await t.query(api.sponsors.active, {});
    await t.mutation(api.sponsors.record, {
      views: [{ id: holder.id, n: 40 }],
      clicks: [{ id: holder.id, n: 2 }],
    });
    vi.setSystemTime(1_000_000 + 3 * 86_400_000 + 4 * 3_600_000);
    await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 1700 }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const alert = sent.find((m) => m.to === 'buyer1@example.com' && m.subject.includes('outbid'));
    expect(alert?.text).toContain('Time on the board: 3d 4h');
    expect(alert?.text).toContain('Views: 40');
    expect(alert?.text).toContain('Clicks to your site: 2');
    expect(alert?.text).toContain('Outbid at: $17');
    expect(alert?.text).toContain('Take it back for $18: https://noordheim.com/sponsor?slot=1#book');
    const outbid = await t.query(api.sponsors.status, { sessionId: 'cs_test_1' });
    expect(outbid).toMatchObject({ status: 'outbid', views: 40, clicks: 2, nextCents: 1800 });
  });

  test('a bid that no longer beats the holder is recorded as lost, once', async () => {
    const sent = mailbox();
    const t = convexTest(schema, modules);
    await t.mutation(internal.sponsors.claim, bid(1, { amountCents: 500, email: undefined }));
    const lost = await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 500 }));
    expect(lost).toEqual({ outcome: 'lost', minimum: 600 });
    expect((await t.query(api.sponsors.board, {})).slots[0].holder?.name).toBe('Brand 1');
    // Redelivery repeats the verdict so the caller retries its refund.
    expect((await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 500 }))).outcome).toBe('lost');
    await t.mutation(internal.sponsors.refunded, { sessionId: 'cs_test_2' });
    await t.mutation(internal.sponsors.refunded, { sessionId: 'cs_test_2' });
    // The refund's own charge.refunded event must not relabel it.
    await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 500, revoked: true }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent.map((m) => m.subject)).toEqual([
      'Refunded: slot #1 was taken before your payment cleared',
    ]);
    expect((await t.query(api.sponsors.status, { sessionId: 'cs_test_2' }))?.status).toBe('lost');
  });

  test('duplicate deliveries never move a slot twice; a refund takes the holder down', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sponsors.claim, bid(1));
    await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 1100 }));
    expect((await t.mutation(internal.sponsors.claim, bid(1))).outcome).toBe('duplicate');
    expect((await t.query(api.sponsors.board, {})).slots[0].holder?.name).toBe('Brand 2');
    await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 1100, revoked: true }));
    const board = await t.query(api.sponsors.board, {});
    expect(board.slots[0].holder).toBeNull();
    expect(board.slots[0].minimum).toBe(1000);
    expect(await t.query(api.sponsors.active, {})).toEqual([]);
  });

  test('stats only count for live placements and are capped per batch', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.sponsors.claim, bid(1));
    const [holder] = await t.query(api.sponsors.active, {});
    await t.mutation(api.sponsors.record, {
      views: [{ id: holder.id, n: 1e9 }, { id: 'not-an-id', n: 5 }],
      clicks: [{ id: holder.id, n: 1e9 }],
    });
    expect((await t.query(api.sponsors.board, {})).slots[0].holder).toMatchObject({
      views: 120,
      clicks: 3,
    });
    await t.mutation(internal.sponsors.claim, bid(2, { amountCents: 1100 }));
    await t.mutation(api.sponsors.record, { views: [{ id: holder.id, n: 10 }], clicks: [] });
    expect((await t.query(api.sponsors.status, { sessionId: 'cs_test_1' }))?.views).toBe(120);
  });

  test('legacy 30-day placements still show until they expire and can be revoked', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert('sponsors', {
        sessionId: 'cs_legacy',
        paymentIntentId: 'pi_legacy',
        name: 'Legacy',
        website: 'https://legacy.example/',
        startsAt: 1_000_000,
        expiresAt: 2_000_000,
        status: 'active',
      }),
    );
    expect((await t.query(api.sponsors.active, {})).map((s) => s.name)).toEqual(['Legacy']);
    // They do not occupy an auction slot.
    expect((await t.query(api.sponsors.board, {})).slots.every((s) => !s.holder)).toBe(true);
    await t.mutation(internal.sponsors.revokeLegacy, { sessionId: 'cs_legacy' });
    expect(await t.query(api.sponsors.active, {})).toEqual([]);
    vi.setSystemTime(2_000_001);
    await t.mutation(internal.sponsors.expire, { id });
    expect((await t.query(api.sponsors.status, { sessionId: 'cs_legacy' }))?.status).toBe('revoked');
  });
});

test('bids are whole dollars at or above the minimum and under the cap', () => {
  expect(bidCents('5', 200)).toBe(500);
  expect(bidCents('$12', 200)).toBe(1200);
  expect(() => bidCents('1', 200)).toThrow('$2');
  expect(() => bidCents('2.50', 200)).toThrow('whole dollar');
  expect(() => bidCents('20000', 200)).toThrow('capped');
  expect(minimumBid(null)).toBe(1000);
  expect(minimumBid(1200)).toBe(1300);
  expect(cheapestBid([])).toBe(1000);
  const full = Array.from({ length: SPONSOR_SLOTS }, (_, i) => ({
    id: `s${i}`,
    name: 'x',
    website: 'https://x.example',
    slot: i + 1,
    amountCents: (i + 3) * 100,
  }));
  expect(cheapestBid(full)).toBe(400);
  expect(formatHeld(90 * 60_000)).toBe('1h 30m');
});

test('sponsor emails escape the brand name and carry the reclaim link', () => {
  const mail = sponsorEmail({
    kind: 'outbid',
    name: '<script>Evil</script>',
    slot: 3,
    amountCents: 100,
    byCents: 900,
    heldMs: 60_000,
    views: 12,
    clicks: 1,
    reclaimUrl: 'https://noordheim.com/sponsor?slot=3#book',
  });
  expect(mail.html).not.toContain('<script>');
  expect(mail.html).toContain('&lt;script&gt;');
  expect(mail.html).toContain('Take slot #3 back · $10');
});

test('sponsor links reject script URLs, credentials and non-public destinations', () => {
  for (const website of [
    'javascript:alert(1)',
    'http://example.com',
    'https://user:pass@example.com',
    'https://localhost',
    'https://127.0.0.1',
  ])
    expect(() => sponsorDetails('Example', website)).toThrow();
  expect(sponsorDetails(' Example ', 'example.com')).toEqual({
    name: 'Example',
    website: 'https://example.com/',
  });
});

describe('Billboard rotation', () => {
  const paid = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      name: `Brand ${i}`,
      website: `https://www.brand${i}.example/`,
      slot: n - i,
      amountCents: 100 * (i + 1),
    }));

  test('the main and secondary sponsors lead, paid slots follow in slot order with their outbid price, and the open advert shows while a slot is free', () => {
    const list = billboardSponsors(paid(2));
    expect(list.map((s) => s.kind)).toEqual([
      'main',
      'secondary',
      'paid',
      'paid',
      'open',
    ]);
    expect(list[0].name).toBe('VerifiedDR');
    expect(list[1].name).toBe('PromptRadar.nl');
    expect(list.slice(2, 4).map((s) => s.slot)).toEqual([1, 2]);
    expect(list[2]).toMatchObject({ domain: 'brand1.example', nextBid: 300 });
    expect(list.at(-1)).toEqual(OPEN_SLOT_POSTER);
    expect(OPEN_SLOT_POSTER.nextBid).toBe(1000);
    const full = billboardSponsors(paid(SPONSOR_SLOTS));
    expect(full).toHaveLength(SPONSOR_SLOTS + 2);
    expect(full.some((s) => s.kind === 'open')).toBe(false);
  });

  test('every client shows the same poster, neighbours differ, and boards step every 20 s', () => {
    const list = billboardSponsors(paid(3));
    const t = 1_000_000_000;
    expect(billboardRotation(list, 0, t)).toBe(billboardRotation(list, 0, t));
    expect(billboardRotation(list, 0, t)).not.toBe(billboardRotation(list, 1, t));
    const start = Math.floor(t / BILLBOARD_ROTATION_MS) * BILLBOARD_ROTATION_MS;
    expect(billboardRotation(list, 2, start)).toBe(
      billboardRotation(list, 2, start + BILLBOARD_ROTATION_MS - 1),
    );
    expect(billboardRotation(list, 2, start + BILLBOARD_ROTATION_MS)).toBe(
      billboardRotation(list, 3, start),
    );
    expect(nextBillboardChange(start + 5)).toBe(start + BILLBOARD_ROTATION_MS);
    // Over one full cycle every poster gets airtime on a single board.
    const seen = new Set(
      list.map((_, i) => billboardRotation(list, 0, start + i * BILLBOARD_ROTATION_MS).id),
    );
    expect(seen.size).toBe(list.length);
  });
});
