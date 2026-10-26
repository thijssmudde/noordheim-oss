// Compresses the exported GLBs in public/models in place with EXT_meshopt_compression.
//
//   node scripts/compress-models.mjs                 # every uncompressed GLB under public/models
//   node scripts/compress-models.mjs path/to/a.glb   # just these files
//   node scripts/compress-models.mjs --decompress    # undo, in place (Blender's glTF
//                                                    # importer cannot read meshopt)
//
// Run it after any Blender export (`pnpm art:tactical ...` runs it for you).
// Files that are already compressed are skipped, so it is safe to re-run.
//
// What changes, and what deliberately does not:
// - Scene graph, node names, node transforms, extras (userData), material names
//   and materials are untouched. No position quantisation moves a dequantisation
//   transform onto a node, so rigs (turret, barrel, cargo_fill, leg_*, ...) keep
//   their exact pivots and scales.
// - Positions stay float32, snapped to a 1/4096 m grid so meshopt packs them well.
// - Normals are stored octahedral 8-bit (meshopt filter; decoded to int8 normals).
// - COLOR_0 is stored as normalised uint8 (the props already were). COLOR_1 and
//   other attributes are kept as they are.
// - Texture coordinates are dropped from files without textures: the materials
//   have no maps, and the surface detail shader works in object space.
// Before writing, the result is parsed with three.js and compared with the source:
// same object names, types and local transforms, same materials and userData,
// same per-mesh bounds (within 1 mm). The source's structure is recorded in
// tests/fixtures/model-manifest.json so tests/model-compression.test.ts can check
// the shipped files against it.
import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { NodeIO, Accessor, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { assertSameModel, describe } from './model-structure.mjs';

const project = resolve(import.meta.dirname, '..');
const manifestPath = resolve(project, 'tests/fixtures/model-manifest.json');
const POSITION_GRID = 2 ** -12;

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const json = (bytes) => JSON.parse(Buffer.from(bytes).toString('utf8', 20, 20 + Buffer.from(bytes).readUInt32LE(12)));
const isCompressed = (bytes) => (json(bytes).extensionsUsed ?? []).includes('EXT_meshopt_compression');

async function prepare(bytes) {
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  const textured = root.listTextures().length > 0;
  const done = new Set();
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const semantic of prim.listSemantics()) {
        const attribute = prim.getAttribute(semantic);
        if (semantic.startsWith('TEXCOORD_') && !textured) {
          prim.setAttribute(semantic, null);
          continue;
        }
        if (done.has(attribute)) continue;
        done.add(attribute);
        const type = attribute.getComponentType();
        if (semantic === 'POSITION' && type === Accessor.ComponentType.FLOAT) {
          const array = attribute.getArray().slice();
          for (let i = 0; i < array.length; i++) array[i] = Math.round(array[i] / POSITION_GRID) * POSITION_GRID;
          attribute.setArray(array);
        } else if (semantic === 'COLOR_0' && type !== Accessor.ComponentType.UNSIGNED_BYTE) {
          const values = [];
          for (let i = 0, el = []; i < attribute.getCount(); i++) values.push(...attribute.getElement(i, el));
          if (values.some((v) => v > 1.0005 || v < -0.0005)) continue; // HDR paint: leave it alone
          attribute
            .setArray(Uint8Array.from(values, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)))
            .setNormalized(true);
        }
      }
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true, keepLeaves: true }));
  return doc;
}

async function encode(bytes, optimiseOrder) {
  const doc = await prepare(bytes);
  if (optimiseOrder) await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  return Buffer.from(await io.writeBinary(doc));
}

const decompress = process.argv.includes('--decompress');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = (args.length ? args : globSync('public/models/**/*.glb', { cwd: project }))
  .map((f) => resolve(project, f))
  .sort();
if (decompress) {
  // Plain glTF again (the lossy steps stay applied), for Blender scripts that import shipped models.
  let count = 0;
  for (const file of files) {
    const source = readFileSync(file);
    if (!isCompressed(source)) continue;
    const doc = await io.readBinary(source);
    for (const extension of doc.getRoot().listExtensionsUsed())
      if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
    writeFileSync(file, Buffer.from(await io.writeBinary(doc)));
    count++;
  }
  console.log(`decompressed ${count} models; run this script without --decompress to ship them again`);
  process.exit(0);
}
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
let saved = 0;
for (const file of files) {
  const name = relative(resolve(project, 'public/models'), file);
  const source = readFileSync(file);
  if (isCompressed(source)) continue;
  const before = await describe(source);
  const candidates = [await encode(source, false), await encode(source, true)];
  const output = candidates.sort((a, b) => a.length - b.length)[0];
  assertSameModel(name, before, await describe(output));
  writeFileSync(file, output);
  manifest[name] = before;
  saved += source.length - output.length;
  console.log(`${name}: ${(source.length / 1e3).toFixed(0)} KB -> ${(output.length / 1e3).toFixed(0)} KB`);
}
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(
  manifestPath,
  JSON.stringify(Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))), null, 0).replace(/\],"/g, '],\n"') + '\n',
);
console.log(`compressed ${files.length} candidates, saved ${(saved / 1e6).toFixed(2)} MB`);
