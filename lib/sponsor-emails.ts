import { formatCount, formatHeld, formatUsd, minimumBid } from './sponsorship';

/** What every sponsor email carries; the `kind` picks the message. */
export type SponsorEmail =
  | {
      kind: 'receipt';
      name: string;
      slot: number;
      amountCents: number;
      /** Stripe's hosted invoice page, when Stripe produced one. */
      invoiceUrl?: string;
      statsUrl: string;
    }
  | {
      kind: 'outbid';
      name: string;
      slot: number;
      amountCents: number;
      /** What the new holder paid. */
      byCents: number;
      heldMs: number;
      views: number;
      clicks: number;
      reclaimUrl: string;
    }
  | {
      kind: 'lost';
      name: string;
      slot: number;
      amountCents: number;
      /** The slot's minimum bid now. */
      nextCents: number;
      reclaimUrl: string;
    };

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

const INK = '#eef3f8',
  MUTED = '#9db0c4',
  PLATE = '#1b2432',
  INSET = '#111823',
  EDGE = '#4d6079',
  ACCENT = '#ff8f3a';

function page(eyebrow: string, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:${INSET};font-family:Barlow,'Helvetica Neue',Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INSET};padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${PLATE};border:1px solid ${EDGE};border-top:3px solid ${ACCENT}">
<tr><td style="padding:28px 28px 8px">
<div style="font-size:12px;letter-spacing:3px;color:${ACCENT};font-weight:700">${eyebrow}</div>
<h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;text-transform:uppercase;letter-spacing:.5px">${title}</h1>
</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55;color:${MUTED}">${body}</td></tr>
</table>
<p style="font-size:12px;color:${MUTED};margin:16px 0 0">Noordheim · noordheim.com · You get this because you bought a sponsor slot.</p>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0 0"><a href="${escape(href)}" style="display:inline-block;background:${ACCENT};color:#1d232b;font-weight:700;text-decoration:none;padding:12px 20px;letter-spacing:1px;text-transform:uppercase">${escape(label)}</a></p>`;

function stats(rows: [string, string][]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;border-collapse:collapse">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 12px;border:1px solid ${EDGE};background:${INSET};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${MUTED}">${label}</td><td align="right" style="padding:9px 12px;border:1px solid ${EDGE};background:${INSET};font-size:18px;font-weight:700;color:${INK}">${value}</td></tr>`,
    )
    .join('')}</table>`;
}

/** Subject, HTML and plain-text bodies for one sponsor email. */
export function sponsorEmail(email: SponsorEmail) {
  const name = escape(email.name);
  const slot = `#${email.slot}`;
  if (email.kind === 'receipt') {
    const next = formatUsd(minimumBid(email.amountCents));
    return {
      subject: `${email.name} holds Noordheim ad slot ${slot}`,
      html: page(
        'PAYMENT CONFIRMED',
        `${name} is on the battlefield`,
        `<p style="margin:0">You paid <b style="color:${INK}">${formatUsd(email.amountCents)}</b> for ad slot <b style="color:${INK}">${slot}</b>. Your poster is up on the billboards in every battle, on the home screen, in the lobby and in the credits.</p>
<p>It stays up until someone outbids you (from ${next}). If that happens we email you how long your spot ran, how many views and clicks it earned, and a link to take it back.</p>
${email.invoiceUrl ? `<p>Your invoice: <a href="${escape(email.invoiceUrl)}" style="color:${ACCENT}">view or download it on Stripe</a>.</p>` : ''}
${button(email.statsUrl, 'Watch your spot live')}`,
      ),
      text: [
        `${email.name} is on the battlefield.`,
        `You paid ${formatUsd(email.amountCents)} for Noordheim ad slot ${slot}. It stays up until someone outbids you (from ${next}); we'll email you the stats if that happens.`,
        email.invoiceUrl ? `Invoice: ${email.invoiceUrl}` : '',
        `Watch your spot: ${email.statsUrl}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }
  if (email.kind === 'outbid') {
    const back = formatUsd(minimumBid(email.byCents));
    const rows: [string, string][] = [
      ['Time on the board', formatHeld(email.heldMs)],
      ['Views', formatCount(email.views)],
      ['Clicks to your site', formatCount(email.clicks)],
      ['You paid', formatUsd(email.amountCents)],
      ['Outbid at', formatUsd(email.byCents)],
    ];
    return {
      subject: `You've been outbid on Noordheim slot ${slot}`,
      html: page(
        'OUTBID',
        `Slot ${slot} has a new holder`,
        `<p style="margin:0">Someone paid <b style="color:${INK}">${formatUsd(email.byCents)}</b> for ad slot ${slot}, so ${name} has come down. Here is what your spot did while it was up:</p>
${stats(rows)}
<p style="margin-top:18px">Want it back? The slot is yours again for ${back} or more.</p>
${button(email.reclaimUrl, `Take slot ${slot} back · ${back}`)}`,
      ),
      text: [
        `Someone paid ${formatUsd(email.byCents)} for Noordheim ad slot ${slot}, so ${email.name} has come down.`,
        rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
        `Take it back for ${back}: ${email.reclaimUrl}`,
      ].join('\n\n'),
    };
  }
  const back = formatUsd(email.nextCents);
  return {
    subject: `Refunded: slot ${slot} was taken before your payment cleared`,
    html: page(
      'REFUNDED',
      `Someone got to slot ${slot} first`,
      `<p style="margin:0">Another sponsor paid the same or more for ad slot ${slot} while your checkout was open, so we refunded your <b style="color:${INK}">${formatUsd(email.amountCents)}</b> in full. Refunds reach your card within 5 to 10 days.</p>
${button(email.reclaimUrl, `Bid again · from ${back}`)}`,
    ),
    text: `Another sponsor paid the same or more for Noordheim ad slot ${slot} while your checkout was open, so we refunded your ${formatUsd(email.amountCents)} in full.\n\nBid again: ${email.reclaimUrl}`,
  };
}
