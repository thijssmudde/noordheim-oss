import { globSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { assertSameModel, describe as describeModel } from '../scripts/model-structure.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('./fixtures/model-manifest.json', import.meta.url), 'utf8'),
) as Record<string, unknown[]>;
const files = globSync('**/*.glb', { cwd: 'public/models' }).sort();

test('every shipped model is meshopt-compressed and recorded', () => {
  expect(files.length).toBeGreaterThan(50);
  for (const file of files) {
    const bytes = readFileSync(`public/models/${file}`);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    expect(json.extensionsRequired, file).toContain('EXT_meshopt_compression');
    expect(manifest[file], `${file} is missing from tests/fixtures/model-manifest.json`).toBeDefined();
  }
});

// Rig nodes, transforms, materials, userData and bounds match the uncompressed export.
test.each(files)('%s matches its uncompressed source', async (file) => {
  const now = await describeModel(readFileSync(`public/models/${file}`));
  expect(() => assertSameModel(file, manifest[file], now)).not.toThrow();
});
