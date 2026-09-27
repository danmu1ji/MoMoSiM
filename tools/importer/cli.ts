import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { exportWorldPackage } from '../../packages/engine/src/index.ts';
import { importMarkdownFolder, importReport, slugify } from './index.ts';

/**
 * Imports a folder of Markdown files into a `.😭` world package.
 * Usage: tsx tools/importer/cli.ts <folder> [output.😭] --id <id> --name <name>
 */
async function collect(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.md')) files[relative(root, full)] = await readFile(full, 'utf8');
      else if (entry.name.endsWith('.txt')) files[relative(root, full)] = await readFile(full, 'utf8');
    }
  };
  await walk(root);
  return files;
}

const [root, ...rest] = process.argv.slice(2);
if (!root) { console.error('usage: tsx tools/importer/cli.ts <folder> [output.😭] [--id <id>] [--name <name>]'); process.exit(2); }
const flag = (name: string, fallback: string) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] ?? fallback : fallback; };
const positional = rest.filter((value, index) => !value.startsWith('--') && !(rest[index - 1]?.startsWith('--') ?? false));
const output = positional[0] ?? `${slugify(root.split('/').filter(Boolean).pop() ?? 'world')}.😭`;
const id = flag('id', slugify(root.split('/').filter(Boolean).pop() ?? 'world'));
const name = flag('name', id);

const data = importMarkdownFolder(await collect(root), { id, name });
const errors = importReport(data);
if (errors.length) { console.error(`✗ import failed with ${errors.length} error(s)`); for (const error of errors) console.error(`  ${error}`); process.exit(1); }
await writeFile(output, exportWorldPackage(data));
console.log(`✓ imported ${data.entities.size} entities from ${root}`);
console.log(`✓ wrote ${output}`);
console.log(`✓ entities: ${[...data.entities.keys()].join(', ')}`);
