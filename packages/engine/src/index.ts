import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
export * from './core.js';
export { createLazyZipSource, listZipPaths, readZipEntry, readZipDirectory } from './zip-lazy.js';
export * from './export.js';
export * from './sqlite-index.js';
export * from './asset-url.js';
export * from './fts-runtime.js';
export * from './graph.js';
export * from './presentation.js';
export * from './banner.js';
export * from './navigation.js';
export * from './orchestration.js';
export * from './editor.js';
export * from './history.js';
import type { WorldSource } from './core.js';
import { createArchiveSource } from './core.js';
export function createFileSource(root: string): WorldSource { return { read: async p => readFile(join(root, p), 'utf8'), exists: async p => { try { await readFile(join(root, p)); return true; } catch { return false; } }, listPaths: async () => { const { readdir } = await import('node:fs/promises'); const walk = async (dir: string): Promise<string[]> => { const out: string[] = []; for (const entry of await readdir(dir,{withFileTypes:true})) { const full=join(dir,entry.name); if(entry.isDirectory()) out.push(...(await walk(full)).map(p=>`${entry.name}/${p}`)); else out.push(entry.name); } return out; }; return walk(root); }, readBytes: async p => new Uint8Array(await readFile(join(root,p))) }; }
export async function createPackageSource(file: string): Promise<WorldSource> { const archive = unzipSync(new Uint8Array(await readFile(file))); return createArchiveSource(archive); }
export async function exportPackage(files: Record<string, string>, output: string): Promise<void> { const archive = zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)]))); await import('node:fs/promises').then(fs => fs.writeFile(output, archive)); }
