import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { LEGACY_SPONSOR_PRODUCT, SPONSOR_PRODUCT } from '../lib/sponsorship';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
  refund: vi.fn(),
  constructEvent: vi.fn(),
}));
vi.mock('stripe', () => ({
  default: class {
    checkout = {
      sessions: { create: mock.create, retrieve: mock.retrieve, list: mock.list },
    };
    refunds = { create: mock.refund };
    webhooks = { constructEvent: mock.constructEvent };
  },
}));
const modules = import.meta.glob('../convex/**/*.ts');
const paidSession = (over: { id?: string; amountCents?: number; slot?: number } = {}) => {
  const amount = over.amountCents ?? 1000;
  return {
    id: over.id ?? 'cs_test_verified',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    currency: 'usd',
    customer_details: { email: 'buyer@example.com' },
    invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/test' },
    metadata: {
      product: SPONSOR_PRODUCT,
      name: 'Example',
      website: 'https://example.com',
      slot: String(over.slot ?? 1),
      amountCents: String(amount),
    },
    line_items: {
      data: [{ quantity: 1, price: { unit_amount: amount, currency: 'usd' } }],
    },
    payment_intent: {
      id: `pi_${over.id ?? 'test_verified'}`,
      latest_charge: { refunded: false, disputed: false },
    },
  };
};
const deliver = (t: ReturnType<typeof convexTest>, session: object, type = 'checkout.session.completed') => {
  mock.constructEvent.mockReturnValue({ type, data: { object: session } });
  mock.retrieve.mockResolvedValue(session);
  return t.action(internal.sponsorPayments.webhook, { body: '{}', signature: 'valid' });
};
const checkoutArgs = (over: Record<string, unknown> = {}) => ({
  name: 'Example',
  website: 'example.com',
  slot: 1,
  amountCents: 1000,
  requestId: '00000000-0000-4000-8000-000000000000',
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('STRIPE_SECRET_KEY', 'test-placeholder');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test-webhook-placeholder');
  vi.stubEnv('SPONSOR_SITE_URL', 'https://noordheim.com');
  vi.stubEnv('STRIPE_AUTOMATIC_TAX', 'true');
  vi.resetAllMocks();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test('checkout charges the chosen bid in USD, with an invoice and the retry identity', async () => {
  mock.create.mockResolvedValue({ url: 'https://checkout.stripe.com/example' });
  const t = convexTest(schema, modules);
  await t.action(api.sponsorPayments.checkout, checkoutArgs({ slot: 4, amountCents: 1500 }));
  const [params, options] = mock.create.mock.calls[0];
  expect(params.mode).toBe('payment');
  expect(params.line_items[0].price_data).toMatchObject({
    unit_amount: 1500,
    currency: 'usd',
    tax_behavior: 'inclusive',
  });
  expect(params.metadata).toMatchObject({ slot: '4', amountCents: '1500' });
  expect(params.invoice_creation.enabled).toBe(true);
  expect(params.expires_at).toBeGreaterThan(Date.now() / 1000);
  expect(params).not.toHaveProperty('payment_method_types');
  expect(params.success_url).toBe(
    'https://noordheim.com/sponsor?session_id={CHECKOUT_SESSION_ID}',
  );
  expect(options.idempotencyKey).toContain('00000000-0000-4000-8000-000000000000');
  expect(await t.query(api.sponsors.active, {})).toEqual([]);
});

test('checkout refuses bids under the slot minimum, fractions and unknown slots', async () => {
  mock.create.mockResolvedValue({ url: 'https://checkout.stripe.com/example' });
  const t = convexTest(schema, modules);
  await deliver(t, paidSession({ amountCents: 900 }));
  await expect(t.action(api.sponsorPayments.checkout, checkoutArgs({ amountCents: 900 }))).rejects.toThrow('$10');
  await expect(t.action(api.sponsorPayments.checkout, checkoutArgs({ amountCents: 1050 }))).rejects.toThrow('whole dollar');
  await expect(t.action(api.sponsorPayments.checkout, checkoutArgs({ slot: 9 }))).rejects.toThrow('reload');
  expect(mock.create).not.toHaveBeenCalled();
  await t.action(api.sponsorPayments.checkout, checkoutArgs({ amountCents: 1000 }));
  expect(mock.create).toHaveBeenCalledOnce();
});

test('forged webhooks are rejected without activating anything', async () => {
  mock.constructEvent.mockImplementation(() => {
    throw new Error('Invalid signature');
  });
  const t = convexTest(schema, modules);
  expect(
    await t.action(internal.sponsorPayments.webhook, { body: '{}', signature: 'forged' }),
  ).toBe(false);
  expect(mock.retrieve).not.toHaveBeenCalled();
  expect(await t.query(api.sponsors.active, {})).toEqual([]);
});

test('unpaid, mismatched-amount, wrong-currency and unrelated sessions cannot take a slot', async () => {
  const t = convexTest(schema, modules);
  const good = paidSession();
  for (const session of [
    { ...good, payment_status: 'unpaid' },
    { ...good, metadata: { product: 'another-product' } },
    { ...good, currency: 'eur' },
    { ...good, metadata: { ...good.metadata, amountCents: '5000' } },
    { ...good, metadata: { ...good.metadata, slot: '0' } },
    {
      ...good,
      line_items: { data: [{ quantity: 1, price: { unit_amount: 1, currency: 'usd' } }] },
    },
  ]) {
    await deliver(t, session);
    expect(await t.query(api.sponsors.active, {})).toEqual([]);
  }
});

test('a paid session takes the slot with the buyer email and invoice, once', async () => {
  const t = convexTest(schema, modules);
  await deliver(t, paidSession(), 'checkout.session.async_payment_succeeded');
  await deliver(t, paidSession());
  const active = await t.query(api.sponsors.active, {});
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ slot: 1, amountCents: 1000 });
  const row = await t.run((ctx) => ctx.db.query('sponsors').first());
  expect(row).toMatchObject({
    email: 'buyer@example.com',
    invoiceUrl: 'https://invoice.stripe.com/i/test',
  });
  expect(mock.retrieve.mock.calls[0][1].expand).toContain('invoice');
});

test('a buyer outbid while their checkout was open is refunded in full, and a refund retry is idempotent', async () => {
  const t = convexTest(schema, modules);
  await deliver(t, paidSession({ id: 'cs_first', amountCents: 1500 }));
  mock.refund.mockRejectedValueOnce(new Error('Stripe down'));
  await expect(deliver(t, paidSession({ id: 'cs_second', amountCents: 1500 }))).rejects.toThrow();
  mock.refund.mockResolvedValue({ id: 're_test' });
  await deliver(t, paidSession({ id: 'cs_second', amountCents: 1500 }));
  expect(mock.refund).toHaveBeenCalledTimes(2);
  for (const [params, options] of mock.refund.mock.calls) {
    expect(params.payment_intent).toBe('pi_cs_second');
    expect(options.idempotencyKey).toBe('noordheim-sponsor-lost-cs_second');
  }
  const board = await t.query(api.sponsors.board, {});
  expect(board.slots[0].holder?.amountCents).toBe(1500);
  expect((await t.query(api.sponsors.status, { sessionId: 'cs_second' }))?.status).toBe('lost');
});

test('a refunded or disputed holder comes down and cannot come back', async () => {
  const t = convexTest(schema, modules);
  await deliver(t, paidSession());
  mock.list.mockResolvedValue({ data: [paidSession()] });
  const refunded = {
    ...paidSession(),
    payment_intent: { id: 'pi_test_verified', latest_charge: { refunded: true } },
  };
  mock.constructEvent.mockReturnValue({
    type: 'charge.refunded',
    data: { object: { payment_intent: 'pi_test_verified' } },
  });
  mock.retrieve.mockResolvedValue(refunded);
  await t.action(internal.sponsorPayments.webhook, { body: '{}', signature: 'valid' });
  expect(await t.query(api.sponsors.active, {})).toEqual([]);
  await deliver(t, paidSession());
  expect(await t.query(api.sponsors.active, {})).toEqual([]);
});

test('refunds of legacy 30-day purchases still take the placement down', async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert('sponsors', {
      sessionId: 'cs_legacy',
      paymentIntentId: 'pi_legacy',
      name: 'Legacy',
      website: 'https://legacy.example/',
      startsAt: Date.now(),
      expiresAt: Date.now() + 1e9,
      status: 'active',
    }),
  );
  mock.list.mockResolvedValue({
    data: [{ id: 'cs_legacy', metadata: { product: LEGACY_SPONSOR_PRODUCT } }],
  });
  mock.constructEvent.mockReturnValue({
    type: 'charge.dispute.created',
    data: { object: { payment_intent: 'pi_legacy' } },
  });
  await t.action(internal.sponsorPayments.webhook, { body: '{}', signature: 'valid' });
  expect(await t.query(api.sponsors.active, {})).toEqual([]);
});
