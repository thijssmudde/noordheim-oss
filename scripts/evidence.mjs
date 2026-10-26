// Screenshot evidence for a PR: drives the running app to a state and captures it.
//
//   node scripts/evidence.mjs --state operation-sheet --out before.png
//   node scripts/evidence.mjs --url http://localhost:3127/ --viewport 390x1400 \
//     --steps '[{"click":"role=button[name=\"Play\"]"}]' --selector body --out a.png
//
// Flags: --url (default http://localhost:3127/), --viewport WxH (default 1440x900),
// --scale (deviceScaleFactor, default 2), --state (a named step list below),
// --steps (JSON step list, appended after the state's), --wait (ms after the
// steps, default 800), --selector (element to capture, default the page),
// --mode / --difficulty (the operation-sheet choices), --out (PNG path),
// --mock-convex (answer Convex over a stubbed socket where WebSockets are
// blocked, as in cloud sessions: every query resolves to null).
// A step is one of {goto}, {button} (exact name), {click}, {fill, value}, {wait} or {waitFor}; selectors
// are Playwright selectors. Clicks are dispatched events: the software-rendered
// scene behind the launcher starves animation frames, so pointer clicks wait on
// stability checks that never settle or land beside a sheet still sliding in.
// Playwright resolves locally or from the global install.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const url = args.url ?? 'http://localhost:3127/';
const [width, height] = (args.viewport ?? '1440x900').split('x').map(Number);
const out = args.out ?? 'evidence.png';

const STATES = {
  'operation-sheet': (o) => [
    { button: 'Play', timeout: 60000 },
    { fill: '#ruler-name', value: 'Commander' },
    { button: 'Continue' },
    { waitFor: '.tac-mode-option', timeout: 30000 },
    { click: `.tac-mode-option:has-text("${o.mode ?? 'Megawealth'}")` },
    { click: `.tac-difficulty-option:has-text("${o.difficulty ?? 'Hard'}")` },
    { selector: '.launcher-sheet' },
  ],
};

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  }
}

/** A Convex sync server stub: queries resolve to null, mutations to null. */
async function mockConvex(page) {
  const ts = Buffer.alloc(8).toString('base64');
  await page.routeWebSocket(/convex\.cloud\/api\/.*\/sync/, (ws) => {
    let version = { querySet: 0, ts, identity: 0 };
    const transition = (end, modifications) => {
      ws.send(
        JSON.stringify({
          type: 'Transition',
          startVersion: version,
          endVersion: end,
          modifications,
        }),
      );
      version = end;
    };
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'ModifyQuerySet')
        transition(
          { ...version, querySet: message.newVersion },
          message.modifications.map((m) =>
            m.type === 'Add'
              ? {
                  type: 'QueryUpdated',
                  queryId: m.queryId,
                  value: null,
                  logLines: [],
                }
              : { type: 'QueryRemoved', queryId: m.queryId },
          ),
        );
      else if (message.type === 'Authenticate')
        transition({ ...version, identity: message.baseVersion + 1 }, []);
      else if (message.type === 'Mutation' || message.type === 'Action')
        ws.send(
          JSON.stringify({
            type: `${message.type}Response`,
            requestId: message.requestId,
            success: true,
            result: null,
            ts,
            logLines: [],
          }),
        );
    });
  });
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: Number(args.scale ?? 2),
});
if (args['mock-convex'] !== undefined) await mockConvex(page);
page.on('pageerror', (error) => console.error('page error:', error.message));

let selector = args.selector;
const steps = [
  ...(args.state ? STATES[args.state](args) : []),
  ...(args.steps ? JSON.parse(args.steps) : []),
];
/** A dispatched click skips the enabled check, so wait for that by hand. */
async function click(locator, timeout) {
  const deadline = Date.now() + timeout;
  while (!(await locator.isEnabled({ timeout }).catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`${locator} never enabled`);
    await page.waitForTimeout(250);
  }
  await locator.dispatchEvent('click', undefined, { timeout });
}

await page.goto(url, { waitUntil: 'domcontentloaded' });
for (const [i, step] of steps.entries()) {
  const timeout = step.timeout ?? 15000;
  console.log(`step ${i + 1}/${steps.length}`, JSON.stringify(step));
  if (step.goto) await page.goto(step.goto, { waitUntil: 'domcontentloaded' });
  else if (step.button)
    await click(
      page.getByRole('button', { name: step.button, exact: true }),
      timeout,
    );
  else if (step.click) await click(page.locator(step.click).first(), timeout);
  else if (step.fill)
    await page.locator(step.fill).fill(step.value, { timeout });
  else if (step.waitFor)
    await page.locator(step.waitFor).first().waitFor({ timeout });
  else if (step.wait) await page.waitForTimeout(step.wait);
  else if (step.selector) selector ??= step.selector;
}
await page.waitForTimeout(Number(args.wait ?? 800));
// Clip to the element's box rather than an element screenshot, which waits on
// the same stability check as a click.
const clip = selector
  ? await page.locator(selector).first().boundingBox()
  : undefined;
await page.screenshot({ path: out, clip, fullPage: !selector });
console.log(`saved ${out}`);
await browser.close();
