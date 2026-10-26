import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';

const http = httpRouter();
http.route({
  path: '/stripe/sponsors',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get('stripe-signature');
    if (!signature) return new Response('Missing signature', { status: 400 });
    const body = await request.text();
    if (body.length > 1_000_000)
      return new Response('Payload too large', { status: 413 });
    try {
      const valid = await ctx.runAction(internal.sponsorPayments.webhook, {
        body,
        signature,
      });
      return new Response(valid ? 'OK' : 'Invalid signature', {
        status: valid ? 200 : 400,
      });
    } catch {
      // A failed database write must remain retryable by Stripe.
      return new Response('Please retry', { status: 500 });
    }
  }),
});
export default http;
