import { writeFile } from 'node:fs/promises';
import { createFileSource, exportWorldPackage, exportWorldPackageAsync, loadWorld, validateWorld } from '../packages/engine/src/index.ts';

/** Rebuilds the checked-in example `.😭` archives from their source directory so the sample never drifts. */
const args = process.argv.slice(2);
const includeTtsReferences = !args.includes('--without-tts-references');
const positional = args.filter(argument => argument !== '--include-tts-references' && argument !== '--without-tts-references');
const root = positional[0] ?? 'worlds/examples/echo-world';
const outputs = positional.slice(1);
const source = createFileSource(root);
const packageSource = !includeTtsReferences && source.listPaths ? {
  ...source,
  listPaths: async () => (await source.listPaths!()).filter(path => !path.startsWith('tts-references/')),
} : source;
const data = await loadWorld(packageSource);
const errors = validateWorld(data).filter(issue => issue.level === 'error');
for (const issue of validateWorld(data)) console.log(`${issue.level === 'error' ? '✗' : '⚠'} ${issue.code}: ${issue.message}`);
if (errors.length) { console.error(`✗ refusing to write a package with ${errors.length} error(s)`); process.exit(1); }
// 자산이 있는 세계관은 소스에서 그때 읽어 담는 비동기 export를 쓴다(지연 로딩과 짝).
const hasAssets = data.assetFiles.size > 0;
const bytes = hasAssets ? await exportWorldPackageAsync(data) : exportWorldPackage(data);
console.log(`export: ${hasAssets ? 'assets included (async)' : 'metadata only (sync)'}${includeTtsReferences ? ', TTS references included' : ', TTS references excluded (pass --without-tts-references to exclude)'}`);
for (const output of outputs) { await writeFile(output, bytes); console.log(`✓ wrote ${output} (${bytes.length} bytes)`); }
console.log(`✓ ${data.world.name}: ${data.entities.size} entities, ${data.timeSlices.length} time slices, ${data.media.size} media assets, ${data.packageFiles.size} package files`);
