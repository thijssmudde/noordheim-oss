#!/usr/bin/env node
/**
 * Connect a Convex deployment to Stripe for paid sponsor slots.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs          # dev deployment
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe.mjs --prod   # production
 *
 * 1. Finds the deployment's `https://<name>.convex.site` (from .env.local, or
 *    .env.production with --prod).
 * 2. Creates the Stripe webhook endpoint `<site>/stripe/sponsors` for exactly
 *    the four sponsor events, or reuses an endpoint with that URL (its events
 *    are reset to the four).
 * 3. Sets STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and SPONSOR_SITE_URL on
 *    that Convex deployment. Values go to `convex env set` over stdin, never
 *    on a command line, and are never printed.
 *
 * Options:
 *   --prod               target production (CONVEX_DEPLOY_KEY from .env.production)
 *   --site <origin>      override SPONSOR_SITE_URL (dev default http://localhost:3111,
 *                        prod https://noordheim.com)
 *   --convex-site <url>  override the deployment's .convex.site URL
 *   --recreate           delete and recreate an existing endpoint to get a fresh
 *                        signing secret (only needed when the secret is lost)
 *   --allow-mode-mismatch  allow a live key on dev or a test key on prod
 *
 * Stripe only reveals a webhook signing secret when the endpoint is created.
 * When the endpoint already exists, the script keeps the secret the Convex
 * deployment already has, or uses STRIPE_WEBHOOK_SECRET from the environment;
 * otherwise it asks for --recreate.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Stripe from 'stripe';

const EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'charge.refunded',
  'charge.dispute.created',
];
const ROOT = resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prod = flag('--prod');
process.on('uncaughtException', (error) => fail(error?.message ?? error));
process.on('unhandledRejection', (error) => fail(error?.message ?? error));
// Never echo credentials, even inside an error message from Stripe.
const redact = (text) =>
  String(text).replace(/\b(sk|rk|whsec)_[A-Za-z0-9_*]+/g, '$1_[redacted]');
const fail = (message) => {
  console.error(`\n✖ ${redact(message)}`);
  process.exit(1);
};

function readEnvFile(file) {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

// 1. Key and mode.
const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key)
  fail(
    'Set STRIPE_SECRET_KEY in the environment (a secret sk_ or restricted rk_ key).',
  );
const mode = /^(sk|rk)_test_/.test(key)
  ? 'test'
  : /^(sk|rk)_live_/.test(key)
    ? 'live'
    : null;
if (!mode) fail('STRIPE_SECRET_KEY is not a Stripe secret or restricted key.');
console.log(`Stripe key mode: ${mode}`);
console.log(`Convex deployment: ${prod ? 'production' : 'development'}`);
if (
  !flag('--allow-mode-mismatch') &&
  ((prod && mode === 'test') || (!prod && mode === 'live'))
)
  fail(
    `Refusing a ${mode} key on the ${prod ? 'production' : 'development'} deployment. Keep test and live on separate deployments, or pass --allow-mode-mismatch.`,
  );

// 2. Deployment URLs.
const envFile = readEnvFile(prod ? '.env.production' : '.env.local');
const cloud = envFile.NEXT_PUBLIC_CONVEX_URL ?? envFile.VITE_CONVEX_URL;
const convexSite = (
  option('--convex-site') ??
  (!prod ? envFile.VITE_CONVEX_SITE_URL : undefined) ??
  cloud?.replace(/\.convex\.cloud\/?$/, '.convex.site')
)?.replace(/\/$/, '');
if (!convexSite || !/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(convexSite))
  fail(
    `Could not find the deployment's .convex.site URL in ${prod ? '.env.production' : '.env.local'}; pass --convex-site https://<deployment>.convex.site`,
  );
const siteUrl = (
  option('--site') ?? (prod ? 'https://noordheim.com' : 'http://localhost:3111')
).replace(/\/$/, '');
if (!/^https?:\/\/[^/]+$/.test(siteUrl))
  fail('--site must be an origin such as https://noordheim.com');
const endpointUrl = `${convexSite}/stripe/sponsors`;
console.log(`Webhook endpoint: ${endpointUrl}`);
console.log(`Return origin (SPONSOR_SITE_URL): ${siteUrl}`);

// Convex CLI for the chosen deployment; secrets travel over stdin only.
const convexEnv = { ...process.env };
delete convexEnv.STRIPE_SECRET_KEY;
delete convexEnv.STRIPE_WEBHOOK_SECRET;
const convexArgs = [];
if (prod) {
  if (envFile.CONVEX_DEPLOY_KEY) {
    convexEnv.CONVEX_DEPLOY_KEY = envFile.CONVEX_DEPLOY_KEY;
    delete convexEnv.CONVEX_DEPLOYMENT;
  } else convexArgs.push('--prod');
}
function convex(subcommand, input) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'convex', 'env', ...subcommand, ...convexArgs],
    {
      cwd: ROOT,
      env: convexEnv,
      input: input ?? '',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    // Error output never contains the piped value; show it for diagnosis.
    stderr: result.stderr ?? '',
  };
}
function setVar(name, value) {
  const r = convex(['set', name], value);
  if (!r.ok) fail(`convex env set ${name} failed:\n${r.stderr.trim()}`);
  console.log(`✔ ${name} set on the Convex deployment`);
}

// 3. Stripe webhook endpoint.
const stripe = new Stripe(key, { maxNetworkRetries: 2 });
let account;
try {
  account = await stripe.accounts.retrieveCurrent();
} catch {
  account = null; // Restricted keys may not read the account; that's fine.
}
if (account)
  console.log(
    `Stripe account: ${account.settings?.dashboard?.display_name ?? account.id}`,
  );

let existing = null;
try {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 }))
    if (endpoint.url === endpointUrl) {
      existing = endpoint;
      break;
    }
} catch (error) {
  fail(
    `Could not list webhook endpoints (${error?.message ?? 'Stripe error'}). A restricted key needs Webhook Endpoints write permission.`,
  );
}

let secret = null;
if (existing && flag('--recreate')) {
  await stripe.webhookEndpoints.del(existing.id);
  console.log('Deleted the existing endpoint to issue a fresh signing secret.');
  existing = null;
}
if (existing) {
  await stripe.webhookEndpoints.update(existing.id, {
    enabled_events: EVENTS,
    disabled: false,
  });
  console.log(`✔ Reused webhook endpoint ${existing.id} (events reset to the four sponsor events)`);
  const current = convex(['get', 'STRIPE_WEBHOOK_SECRET']).stdout.trim();
  secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || (current.startsWith('whsec_') ? current : null);
  if (!secret)
    fail(
      'This endpoint exists but its signing secret is unknown here. Pass STRIPE_WEBHOOK_SECRET=whsec_... from the Stripe dashboard, or rerun with --recreate.',
    );
} else {
  const created = await stripe.webhookEndpoints.create({
    url: endpointUrl,
    enabled_events: EVENTS,
    description: `Noordheim sponsor slots (${prod ? 'production' : 'development'})`,
    metadata: { project: 'noordheim', purpose: 'sponsor-slots' },
  });
  secret = created.secret;
  console.log(`✔ Created webhook endpoint ${created.id}`);
}
if (!secret?.startsWith('whsec_')) fail('Stripe returned no signing secret.');

// 4. Convex environment.
setVar('STRIPE_SECRET_KEY', key);
setVar('STRIPE_WEBHOOK_SECRET', secret);
setVar('SPONSOR_SITE_URL', siteUrl);
console.log(
  `\nDone. Checkout is live on the ${prod ? 'production' : 'development'} deployment in ${mode} mode.`,
);
if (mode === 'test')
  console.log('Test with card 4242 4242 4242 4242, any future date and CVC.');
