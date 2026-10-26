import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
// Regenerates art/tactical.blend, the tactical GLBs and their portraits from the authored scripts.
const project = resolve(import.meta.dirname, '..');
const candidates = [
  process.env.BLENDER_BIN,
  '/Applications/Blender.app/Contents/MacOS/Blender',
  `${homedir()}/Applications/Blender.app/Contents/MacOS/Blender`,
].filter(Boolean);
const blender = candidates.find(existsSync) ?? 'blender';
const cards = process.argv[2] === 'biome-cards';
if (cards) {
  const data = spawnSync(
    process.execPath,
    [resolve(project, 'scripts/export-biome-scenes.mjs')],
    { cwd: project, stdio: 'inherit' },
  );
  if (data.status !== 0) process.exit(data.status ?? 1);
}
const script =
  {
    environment: 'create_environment.py',
    landscape: 'create_landscape.py',
    biomes: 'create_biomes.py',
    'biome-cards': 'render_biome_cards.py',
    architecture: 'create_architecture.py',
    menu: 'create_menu.py',
    home: 'create_home.py',
    factions: 'create_factions.py',
    'diorama-troops': 'diorama_troops.py',
    expansion: 'create_expansion.py',
    buildings: 'diorama_buildings.py',
    'tech-sites': 'tech_sites.py',
    landing: 'refine_landing.py',
    export: 'export_landing.py',
    ore: 'create_ore.py',
    harvester: 'refine_harvester.py',
  }[process.argv[2]] ?? 'create_tactical.py';
// Some passes import shipped GLBs, and Blender cannot read meshopt: work on plain files.
const models = (flag) =>
  spawnSync(process.execPath, [resolve(project, 'scripts/compress-models.mjs'), ...flag], {
    cwd: project,
    stdio: 'inherit',
  });
if (models(['--decompress']).status !== 0) process.exit(1);
const result = spawnSync(
  blender,
  [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    resolve(project, 'art/blender', script),
  ],
  { cwd: project, stdio: 'inherit' },
);
// Ship every model meshopt-compressed again, fresh exports included.
const compress = models([]);
if (result.error)
  throw new Error(
    'Install Blender 4.5 LTS or set BLENDER_BIN to its executable.',
    { cause: result.error },
  );
if (compress.status !== 0) process.exit(compress.status ?? 1);
if (cards && result.status === 0) {
  const encode = spawnSync(
    'python3',
    [resolve(project, 'scripts/encode-biome-cards.py')],
    { cwd: project, stdio: 'inherit' },
  );
  process.exit(encode.status ?? 1);
}
process.exit(result.status ?? 1);
