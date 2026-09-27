import type { Entity, EntityType, KnowledgeRule, WorldData } from '../../packages/engine/src/index.ts';
import { refreshGraph, validateWorld } from '../../packages/engine/src/index.ts';

export interface ImportOptions { id: string; name: string; version?: string; summary?: string; defaultType?: EntityType; sliceLabel?: string }

const KNOWN_TYPES: EntityType[] = ['world', 'category', 'character', 'location', 'event'];

/** Deterministic slug for files that do not declare an explicit `id` in frontmatter. */
export function slugify(value: string): string { return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'entity'; }

function frontmatter(source: string): { meta: Record<string, unknown>; body: string } {
  if (!source.startsWith('---')) return { meta: {}, body: source };
  const end = source.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: source };
  const block = source.slice(3, end);
  const meta: Record<string, unknown> = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.trim().replace(/^["']|["']$/g, '');
    if (value.startsWith('[') && value.endsWith(']')) meta[key] = value.slice(1, -1).split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else meta[key] = value;
  }
  return { meta, body: source.slice(end + 4).replace(/^\n/, '') };
}

function stringList(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? [value] : []; }

function linksIn(body: string): string[] { return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1]).filter(target => !target.startsWith('media:') && !target.startsWith('audio:')); }
function typeOfReference(target: string, fallback: EntityType): EntityType { const [prefix] = target.split(':'); return KNOWN_TYPES.includes(prefix as EntityType) ? prefix as EntityType : fallback; }
function firstHeading(body: string): string | undefined { return body.split('\n').find(line => line.startsWith('# '))?.slice(2).trim(); }
function firstParagraph(body: string): string | undefined { return body.split('\n').map(line => line.trim()).find(line => line && !line.startsWith('#') && !line.startsWith('[[')); }

/**
 * Imports a folder of Markdown files as a World Package.
 * Each `*.md` becomes one entity (`frontmatter.id` wins, otherwise `<type>:<slug>`), `[[target]]`
 * references become entity relations, and the original body is kept as the entity document so the
 * result validates and exports as a normal `.😭` package.
 */
export function importMarkdownFolder(files: Record<string, string>, options: ImportOptions): WorldData {
  const defaultType = options.defaultType ?? 'world';
  const entities = new Map<string, Entity>();
  const documents = new Map<string, string>();
  const packageFiles = new Map<string, Uint8Array>();

  const paths = Object.keys(files).filter(path => path.endsWith('.md')).sort();
  // First pass: learn entity types from links used elsewhere in the folder, so a file without
  // frontmatter still becomes the `character:`/`location:` entity its neighbours refer to.
  const referenced = new Map<string, EntityType>();
  for (const path of paths) for (const target of linksIn(frontmatter(files[path]).body)) referenced.set(slugify(target.split(':').slice(1).join(':')), typeOfReference(target, defaultType));

  for (const path of paths) {
    const { meta, body } = frontmatter(files[path]);
    const declaredType = typeof meta.type === 'string' && KNOWN_TYPES.includes(meta.type as EntityType) ? meta.type as EntityType : undefined;
    const slug = slugify(path.replace(/\.md$/, '').split('/').pop() ?? path);
    const inferredType = declaredType ?? referenced.get(slug) ?? defaultType;
    const id = typeof meta.id === 'string' && meta.id ? meta.id : `${inferredType}:${slug}`;
    const name = (typeof meta.title === 'string' && meta.title) || firstHeading(body) || slug;
    const links = linksIn(body);
    const knowledge = Array.isArray(meta.knowledge) ? meta.knowledge as KnowledgeRule[] : undefined;
    const entity: Entity = {
      id,
      type: inferredType,
      name,
      summary: (typeof meta.summary === 'string' && meta.summary) || firstParagraph(body) || undefined,
      markdown: path,
      tags: stringList(meta.tags),
      relations: [...new Set(links)].map(target => ({ type: 'references', target })),
      ...(knowledge ? { knowledge } : {}),
    } as Entity;
    entities.set(id, entity);
    documents.set(path, body);
    packageFiles.set(path, new TextEncoder().encode(body));
  }

  const manifest = { schemaVersion: '1.0', id: options.id, name: options.name, version: options.version ?? '0.1.0', entry: 'world.yaml' };
  const world = { id: options.id, name: options.name, version: manifest.version, summary: options.summary ?? `${paths.length}개 문서에서 가져온 세계관`, entrypoints: [...entities.values()].filter(entity => entity.type === 'character').map(entity => entity.id), tags: ['imported'] };
  const data: WorldData = {
    manifest, world, entities,
    timeSlices: [{ id: 'imported', label: options.sliceLabel ?? '가져온 시점', position: 0 }],
    states: [], documents, media: new Map(), assetFiles: new Set(), assetBytes: new Map(), packageFiles, links: new Map(),
  } as WorldData;
  return refreshGraph(data);
}

/** Import issues reported for humans; errors mean the produced package must not be written. */
export function importReport(data: WorldData): string[] {
  const issues = validateWorld(data).filter(issue => issue.level === 'error');
  return issues.map(issue => `${issue.code}: ${issue.message}`);
}
