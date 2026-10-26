'use node';

import Stripe from 'stripe';
import { v, ConvexError } from 'convex/values';
import { action, internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import {
  LEGACY_SPONSOR_PRODUCT,
  SPONSOR_CURRENCY,
  SPONSOR_MAX_CENTS,
  SPONSOR_PLACEMENTS,
  SPONSOR_PRODUCT,
  SPONSOR_START_CENTS,
  formatUsd,
  isSponsorSlot,
  sponsorDetails,
} from '../lib/sponsorship';

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key)
    throw new ConvexError(
      'Sponsor checkout is not available yet. Please try again later.',
    );
  return new Stripe(key, { maxNetworkRetries: 2 });
}

/** Stripe's shortest checkout window; a short one keeps quoted minimums fresh. */
const CHECKOUT_WINDOW_S = 30 * 60;

export const checkout = action({
  args: {
    name: v.string(),
    website: v.string(),
    slot: v.number(),
    amountCents: v.number(),
    requestId: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    let details;
    try {
      details = sponsorDetails(args.name, args.website);
    } catch (error) {
      throw new ConvexError((error as Error).message);
    }
    if (!/^[0-9a-f-]{36}$/.test(args.requestId) || !isSponsorSlot(args.slot))
      throw new ConvexError('Please reload and try again.');
    const origin = process.env.SPONSOR_SITE_URL;
    if (!origin || !process.env.STRIPE_WEBHOOK_SECRET)
      throw new ConvexError(
        'Sponsor checkout is not available yet. Please try again later.',
      );
    const minimum: number = await ctx.runQuery(internal.sponsors.minimum, {
      slot: args.slot,
    });
    if (
      !Number.isInteger(args.amountCents) ||
      args.amountCents % 100 !== 0 ||
      args.amountCents > SPONSOR_MAX_CENTS
    )
      throw new ConvexError('Enter a whole dollar amount.');
    if (args.amountCents < minimum)
      throw new ConvexError(
        `Someone just took slot ${args.slot}. The minimum is now ${formatUsd(minimum)}.`,
      );
    const stripe = stripeClient();
    const metadata = {
      product: SPONSOR_PRODUCT,
      name: details.name,
      website: details.website,
      slot: String(args.slot),
      amountCents: String(args.amountCents),
    };
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          integration_identifier: 'noordheim-sponsors-krnqvzth',
          customer_creation: 'always',
          billing_address_collection: 'required',
          tax_id_collection: { enabled: true },
          // Stripe finalises an invoice for the payment; its hosted page goes in our receipt email.
          invoice_creation: {
            enabled: true,
            invoice_data: {
              description: `Noordheim ad slot #${args.slot} for ${details.name}`,
              metadata,
            },
          },
          expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_WINDOW_S,
          ...(process.env.STRIPE_AUTOMATIC_TAX === 'true'
            ? { automatic_tax: { enabled: true } }
            : {}),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: SPONSOR_CURRENCY,
                unit_amount: args.amountCents,
                tax_behavior: 'inclusive',
                product_data: {
                  name: `Noordheim ad slot #${args.slot}`,
                  description: `Your brand and website on ${SPONSOR_PLACEMENTS.join(', ')} until someone outbids you. Shared placement. No subscription.`,
                  tax_code: 'txcd_20060002',
                },
              },
            },
          ],
          metadata,
          payment_intent_data: {
            metadata,
            description: `Noordheim · ad slot #${args.slot}`,
          },
          success_url: `${origin}/sponsor?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/sponsor?cancelled=1&slot=${args.slot}#book`,
          custom_text: {
            submit: {
              message: `One-time payment. Your ad stays up until someone pays at least $1 more for slot #${args.slot}; we email you if that happens. If someone outbids you before this payment clears, you are refunded in full.`,
            },
          },
        },
        {
          idempotencyKey: `noordheim-sponsor-${args.requestId}-${args.slot}-${args.amountCents}`,
        },
      );
      if (!session.url) throw new Error('Checkout URL missing');
      return { url: session.url };
    } catch {
      throw new ConvexError(
        'Could not open Stripe checkout. Please try again.',
      );
    }
  },
});

async function fulfill(ctx: ActionCtx, stripe: Stripe, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent.latest_charge', 'invoice'],
  });
  if (session.metadata?.product !== SPONSOR_PRODUCT) return;
  const item = session.line_items?.data[0];
  const slot = Number(session.metadata.slot);
  const amountCents = Number(session.metadata.amountCents);
  if (
    session.mode !== 'payment' ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid' ||
    session.currency !== SPONSOR_CURRENCY ||
    session.line_items?.data.length !== 1 ||
    item?.quantity !== 1 ||
    !isSponsorSlot(slot) ||
    !Number.isInteger(amountCents) ||
    amountCents < SPONSOR_START_CENTS ||
    item.price?.unit_amount !== amountCents ||
    item.price.currency !== SPONSOR_CURRENCY
  )
    return;
  const intent = session.payment_intent as Stripe.PaymentIntent | null;
  if (!intent || typeof intent === 'string') return;
  const charge = intent.latest_charge as Stripe.Charge | null;
  const revoked = Boolean(
    charge &&
    typeof charge !== 'string' &&
    (charge.refunded || charge.disputed),
  );
  const invoice = session.invoice as Stripe.Invoice | string | null;
  const result = await ctx.runMutation(internal.sponsors.claim, {
    sessionId: session.id,
    paymentIntentId: intent.id,
    name: session.metadata.name ?? '',
    website: session.metadata.website ?? '',
    email: session.customer_details?.email ?? undefined,
    slot,
    amountCents,
    invoiceUrl:
      (invoice && typeof invoice !== 'string'
        ? invoice.hosted_invoice_url
        : undefined) ?? undefined,
    revoked,
  });
  if (result.outcome === 'lost') {
    // Someone outbid this buyer while their checkout was open: refund in full.
    // A failure throws, so Stripe redelivers and we try again.
    await stripe.refunds.create(
      {
        payment_intent: intent.id,
        reason: 'requested_by_customer',
        metadata: { product: SPONSOR_PRODUCT, cause: 'outbid-before-payment' },
      },
      { idempotencyKey: `noordheim-sponsor-lost-${session.id}` },
    );
    await ctx.runMutation(internal.sponsors.refunded, { sessionId: session.id });
  }
}

export const webhook = internalAction({
  args: { body: v.string(), signature: v.string() },
  handler: async (ctx, { body, signature }): Promise<boolean> => {
    const stripe = stripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('Webhook is not configured');
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      return false;
    }
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;
      if (session.metadata?.product === SPONSOR_PRODUCT)
        await fulfill(ctx, stripe, session.id);
    } else if (
      event.type === 'charge.refunded' ||
      event.type === 'charge.dispute.created'
    ) {
      const object = event.data.object;
      const intent = object.payment_intent;
      const paymentIntentId = typeof intent === 'string' ? intent : intent?.id;
      if (paymentIntentId) {
        const sessions = await stripe.checkout.sessions.list({
          payment_intent: paymentIntentId,
          limit: 10,
        });
        for (const session of sessions.data)
          if (session.metadata?.product === SPONSOR_PRODUCT)
            await fulfill(ctx, stripe, session.id);
          else if (session.metadata?.product === LEGACY_SPONSOR_PRODUCT)
            await ctx.runMutation(internal.sponsors.revokeLegacy, {
              sessionId: session.id,
            });
      }
    }
    return true;
  },
});
