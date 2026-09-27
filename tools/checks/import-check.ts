import { createPackageSource, loadWorld, validateWorld } from '../../packages/engine/src/index.ts';

/** Verifies a `.😭` produced by the importer loads, validates, and keeps its link graph. */
const target = process.argv[2];
if (!target) { console.error('usage: tsx tools/checks/import-check.ts <package.😭>'); process.exit(2); }
const data = await loadWorld(await createPackageSource(target));
const errors = validateWorld(data).filter(issue => issue.level === 'error');
console.log(`✓ loaded ${data.world.name} (${data.world.id})`);
console.log(`✓ ${data.entities.size} entities: ${[...data.entities.keys()].sort().join(', ')}`);
for (const [id, targets] of data.links) console.log(`✓ graph ${id} → ${targets.join(', ') || 'none'}`);
console.log(`✓ validation errors: ${errors.length}`);
for (const error of errors) console.log(`✗ ${error.code}: ${error.message}`);
if (errors.length) process.exitCode = 1;
