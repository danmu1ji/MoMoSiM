import { writeFile } from 'node:fs/promises';
import { createFileSource, exportWorldPackage, exportWorldPackageAsync, loadWorld, validateWorld } from '../packages/engine/src/index.ts';

/** Rebuilds the checked-in example `.😭` archives from their source directory so the sample never drifts. */
const args = process.argv.slice(2);
const root = args[0] ?? 'worlds/examples/echo-world';
const outputs = args.slice(1);
const source = createFileSource(root);
const data = await loadWorld(source);
const errors = validateWorld(data).filter(issue => issue.level === 'error');
for (const issue of validateWorld(data)) console.log(`${issue.level === 'error' ? '✗' : '⚠'} ${issue.code}: ${issue.message}`);
if (errors.length) { console.error(`✗ refusing to write a package with ${errors.length} error(s)`); process.exit(1); }
// 자산이 있는 세계관은 소스에서 그때 읽어 담는 비동기 export를 쓴다(지연 로딩과 짝).
const hasAssets = data.assetFiles.size > 0;
const bytes = hasAssets ? await exportWorldPackageAsync(data) : exportWorldPackage(data);
console.log(`export: ${hasAssets ? 'assets included (async)' : 'metadata only (sync)'}`);
for (const output of outputs) { await writeFile(output, bytes); console.log(`✓ wrote ${output} (${bytes.length} bytes)`); }
console.log(`✓ ${data.world.name}: ${data.entities.size} entities, ${data.timeSlices.length} time slices, ${data.media.size} media assets, ${data.packageFiles.size} package files`);
