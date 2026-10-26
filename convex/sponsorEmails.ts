import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { sponsorEmail, type SponsorEmail } from '../lib/sponsor-emails';

const RETRY_MS = [60_000, 10 * 60_000, 60 * 60_000];

/**
 * Sends one sponsor email through Cloudflare Email Service. Scheduled by the
 * mutations that change a slot, so a payment is never held up by the mailer;
 * a failed send retries a few times and then gives up with a log line.
 */
export const send = internalAction({
  args: { to: v.string(), email: v.any(), attempt: v.optional(v.number()) },
  handler: async (ctx, { to, email, attempt = 0 }) => {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_EMAIL_API_TOKEN;
    if (!account || !token) {
      console.warn(
        'Sponsor email skipped: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN on this deployment.',
      );
      return false;
    }
    const message = sponsorEmail(email as SponsorEmail);
    let failure = '';
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to,
            from: process.env.SPONSOR_EMAIL_FROM ?? 'mail@thijssmudde.nl',
            ...message,
          }),
        },
      );
      if (response.ok) return true;
      failure = `${response.status} ${(await response.text()).slice(0, 300)}`;
    } catch (error) {
      failure = (error as Error).message;
    }
    const delay = RETRY_MS[attempt];
    console.error(
      `Sponsor ${(email as SponsorEmail).kind} email failed (attempt ${attempt + 1}): ${failure}`,
    );
    if (delay !== undefined)
      await ctx.scheduler.runAfter(delay, internal.sponsorEmails.send, {
        to,
        email,
        attempt: attempt + 1,
      });
    return false;
  },
});
