import { createFileSource, loadWorld, validateWorld } from '../packages/engine/src/index.ts';
const root = process.argv[2] ?? 'worlds/examples/echo-world';
const data = await loadWorld(createFileSource(root));
const issues = validateWorld(data);
console.log(`✓ ${data.world.name}`); console.log(`✓ manifest ${data.manifest.schemaVersion}`); console.log(`✓ ${data.entities.size} entities`); console.log(`✓ ${data.timeSlices.length} time slices`); console.log(`✓ ${data.media.size} media assets`); for (const i of issues) console.log(`${i.level === 'error' ? '✗' : '⚠'} ${i.message}`); if (issues.some(i => i.level === 'error')) process.exitCode = 1;
