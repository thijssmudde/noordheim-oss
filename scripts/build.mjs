import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

// Vinext gives .env.local precedence over .env.production. Set public build
// values before starting it so a local production build uses production data.
// Explicit environment variables (including GitHub Actions) still take priority.
const env = { ...process.env };
if (existsSync('.env.production')) {
  for (const [key, value] of Object.entries(
    parseEnv(readFileSync('.env.production', 'utf8')),
  )) {
    if (key.startsWith('NEXT_PUBLIC_')) env[key] ??= value;
  }
}
if (!env.NEXT_PUBLIC_CONVEX_URL) {
  throw new Error(
    'Set NEXT_PUBLIC_CONVEX_URL in .env.production or the build environment.',
  );
}

const build = spawnSync('vinext', ['build', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
if (build.error) throw build.error;
process.exit(build.status ?? 1);
