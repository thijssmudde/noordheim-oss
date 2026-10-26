// Read-only cloud profiling of an exported synthetic battle. Defaults to development.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!process.argv[2]) throw new Error('Supply a synthetic battle JSON file.');
const battle = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const args = { battle };
if (process.argv.includes('--command')) {
  const hq = battle.entities.find((e) => e.team === 'red' && e.kind === 'hq');
  args.command = {
    owner: 'bench0',
    ids: battle.entities
      .filter(
        (e) =>
          e.owner === 'bench0' &&
          ['ranger', 'rocket', 'lynx', 'tank', 'howitzer'].includes(e.kind),
      )
      .map((e) => e.id),
    order: 'attackMove',
    point: { x: hq.x + 15, z: hq.z + 15 },
  };
}
const result = spawnSync(
  'pnpm',
  ['exec', 'convex', 'run', 'performance:probe', JSON.stringify(args)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
