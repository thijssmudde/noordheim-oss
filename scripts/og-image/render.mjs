// Renders scripts/og-image/card.html to public/og.jpg (1200x630) with headless Chrome.
// Usage: node scripts/og-image/render.mjs
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const card = resolve('scripts/og-image/card.html');
const out = resolve('public/og.jpg');
const profile = mkdtempSync(join(tmpdir(), 'noordheim-og-'));
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const quit = (code) => {
  chrome.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};
setTimeout(() => {
  console.error('Timed out rendering the OG image');
  quit(2);
}, 40_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50 && !page; i++) {
  try {
    page = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(
      (t) => t.type === 'page',
    );
  } catch {}
  if (!page) await sleep(200);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1200,
  height: 630,
  deviceScaleFactor: 2,
  mobile: false,
});
await send('Page.navigate', { url: `file://${card}` });
for (let i = 0; i < 60; i++) {
  const r = await send('Runtime.evaluate', {
    expression: `document.fonts.status === 'loaded' && document.fonts.check('600 20px "Barlow Condensed"') && document.querySelector('img.bg').complete`,
    returnByValue: true,
  });
  if (r.result?.result?.value) break;
  await sleep(250);
}
await sleep(500);
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
});
const png = `${profile}/og@2x.png`;
writeFileSync(png, Buffer.from(shot.result.data, 'base64'));
execFileSync(
  'sips',
  [
    '-z',
    '630',
    '1200',
    png,
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '88',
    '--out',
    out,
  ],
  { stdio: 'ignore' },
);
console.log(`Wrote ${out}`);
quit(0);
