import { readFileSync } from 'node:fs';
import { createZipSource, loadWorld, validateWorld } from '../../packages/engine/src/index.ts';

for (const file of process.argv.slice(2)) {
  try {
    const source = createZipSource(new Uint8Array(readFileSync(file)));
    const data = await loadWorld(source);
    const errors = validateWorld(data).filter(issue => issue.level === 'error');
    console.log(`✓ ${file}: ${data.world.name} (${data.world.id}) · ${data.entities.size} entities · ${data.media.size} media · ${data.packageFiles.size} files · errors ${errors.length}`);
    for (const error of errors.slice(0, 5)) console.log(`  ✗ ${error.code}: ${error.message}`);
  } catch (error) {
    console.log(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
