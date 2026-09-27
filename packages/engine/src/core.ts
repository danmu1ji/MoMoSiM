import { parse as parseYaml } from 'yaml';
import { unzipSync, strFromU8 } from 'fflate';
import { parseMarkdown } from '@world-player/markdown';
import { buildEntityGraph } from './graph.js';
import { createLazyZipSource } from './zip-lazy.js';
import type { Character, CharacterState, Entity, KnowledgeCondition, KnowledgeLevel, KnowledgeRule, MediaAsset, TimeSlice, ValidationIssue, World, WorldManifest } from '@world-player/schema';

export interface WorldSource { read(path: string): Promise<string>; exists(path: string): Promise<boolean>; listPaths?: () => Promise<string[]>; readBytes?: (path: string) => Promise<Uint8Array>; clearCache?: () => void }
/** Adds a small separately distributed locale overlay without copying the large binary world archive. */
export function withLocaleOverlay(base: WorldSource, overlay: WorldSource, overlayPaths: Iterable<string>): WorldSource {
  const paths = new Set(overlayPaths);
  return {
    read: async path => paths.has(path) ? overlay.read(path) : base.read(path),
    exists: async path => paths.has(path) || base.exists(path),
    listPaths: async () => [...new Set([...(base.listPaths ? await base.listPaths() : []), ...paths])],
    readBytes: async path => paths.has(path) && overlay.readBytes ? overlay.readBytes(path) : base.readBytes ? base.readBytes(path) : new TextEncoder().encode(await base.read(path)),
    clearCache: () => { base.clearCache?.(); overlay.clearCache?.(); },
  };
}
export interface WorldData {
  manifest: WorldManifest;
  world: World;
  entities: Map<string, Entity>;
  timeSlices: TimeSlice[];
  states: CharacterState[];
  documents: Map<string, string>;
  media: Map<string, MediaAsset>;
  assetFiles: Set<string>;
  /** 자산 바이트 캐시. 지연 모드에서는 비어 있고 `readAssetBytes`가 그때 읽는다. */
  assetBytes: Map<string, Uint8Array>;
  packageFiles: Map<string, Uint8Array>;
  links: Map<string, string[]>;
  /** 지연 로딩용 소스(있으면 자산을 요청 시점에 읽는다). */
  source?: WorldSource;
  /** Tracks documents loaded from a source when the caller opts into lazy loading. */
  loadedDocuments?: Set<string>;
  /** 지연 로딩된 자산 캐시(경로 → 바이트). */
  assetCache?: Map<string, Uint8Array>;
}
export function createMemorySource(files: Record<string, string>): WorldSource { return { read: async p => { if (!(p in files)) throw new Error(`Missing file: ${p}`); return files[p]; }, exists: async p => p in files, listPaths: async () => Object.keys(files) }; }
export function createBinaryMemorySource(textFiles: Record<string, string>, binaryFiles: Record<string, Uint8Array>): WorldSource { return { read: async p => { if (!(p in textFiles)) throw new Error(`Missing file: ${p}`); return textFiles[p]; }, exists: async p => p in textFiles || p in binaryFiles, listPaths: async () => [...new Set([...Object.keys(textFiles),...Object.keys(binaryFiles)])], readBytes: async p => binaryFiles[p] ?? new TextEncoder().encode(textFiles[p] ?? '') }; }
/**
 * Normalises archive keys: drops directory entries, converts separators, and unwraps a single
 * top-level folder. Zipping the world folder itself (`zip -r world.😭 world/`) is a very common
 * mistake — without this, `manifest.yaml` would live at `world/manifest.yaml` and the package
 * would look empty.
 */
export function normalizeArchiveEntries(archive: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const entries: [string, Uint8Array][] = [];
  for (const [rawPath, bytes] of Object.entries(archive)) {
    const path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!path || path.endsWith('/')) continue; // directory entry
    entries.push([path, bytes]);
  }
  const hasRootManifest = entries.some(([path]) => path === 'manifest.yaml');
  if (!hasRootManifest && entries.length > 0) {
    const roots = new Set(entries.map(([path]) => path.split('/')[0]));
    if (roots.size === 1) {
      const prefix = `${[...roots][0]}/`;
      if (entries.every(([path]) => path.startsWith(prefix))) return Object.fromEntries(entries.map(([path, bytes]) => [path.slice(prefix.length), bytes]));
    }
  }
  return Object.fromEntries(entries);
}
export function createArchiveSource(archive: Record<string, Uint8Array>): WorldSource { const files = normalizeArchiveEntries(archive); return { read: async (p: string) => { const bytes = files[p]; if (!bytes) throw new Error(`패키지에 ${p} 파일이 없습니다. .😭 최상위에 manifest.yaml이 있어야 합니다.`); return new TextDecoder().decode(bytes); }, readBytes: async (p: string) => { const bytes = files[p]; if (!bytes) throw new Error(`패키지에 ${p} 파일이 없습니다.`); return bytes; }, exists: async (p: string) => p in files, listPaths: async () => Object.keys(files) } as WorldSource; }
export function createZipSource(bytes: Uint8Array): WorldSource {
  return createLazyZipSource(bytes);
}
export function decodeZipTextFiles(bytes: Uint8Array): Record<string, string> { return Object.fromEntries(Object.entries(normalizeArchiveEntries(unzipSync(bytes))).map(([path, value]) => [path, strFromU8(value)])); }
export function decodeZipSource(bytes: Uint8Array): WorldSource { return createZipSource(bytes); }
export function resolveNextSpeakers(conversation: { participants: string[]; recentSpeakers?: string[]; location?: string; currentEvent?: string }, characters: Character[], input: string): Character[] { const participants=characters.filter(c=>conversation.participants.includes(c.id)||conversation.participants.includes(`character:${c.id}`)); const lower=input.toLocaleLowerCase(); const mentioned=participants.filter(c=>lower.includes(c.name.toLocaleLowerCase())||lower.includes(c.id.toLocaleLowerCase())); if(mentioned.length)return mentioned; const relationTargets=new Set(participants.flatMap(c=>c.relations.map(r=>r.target))); const related=participants.filter(c=>c.relations.some(r=>relationTargets.has(r.target))); const recent=conversation.recentSpeakers?participants.filter(c=>conversation.recentSpeakers?.includes(c.id)):[]; return [...new Set([...recent,...related,...participants])].slice(0,Math.min(2,participants.length)); }
/** 경로 하나를 그때 읽는다(지연 모드). 이미 읽은 것은 캐시한다. */
export async function readAssetBytes(data: WorldData, path: string): Promise<Uint8Array | undefined> {
  const cache = data.assetCache ?? data.assetBytes;
  const cached = cache.get(path);
  if (cached) {
    cache.delete(path);
    cache.set(path, cached);
    return cached;
  }
  if (!data.source?.readBytes) return undefined;
  try {
    const bytes = await data.source.readBytes(path);
    if (bytes.byteLength <= 64 * 1024 * 1024) {
      cache.set(path, bytes);
      let total = 0;
      for (const value of cache.values()) total += value.byteLength;
      while (total > 64 * 1024 * 1024) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        total -= cache.get(oldest)!.byteLength;
        cache.delete(oldest);
      }
    }
    return bytes;
  } catch {
    return undefined;
  }
}

const ASSET_URL_CACHE = new WeakMap<WorldData, Map<string, { url: string; bytes: number }>>();
const ASSET_URL_PENDING = new WeakMap<WorldData, Map<string, Promise<string | undefined>>>();
const ASSET_URL_GENERATIONS = new WeakMap<WorldData, number>();
const ASSET_URL_BUDGET = 64 * 1024 * 1024; // 캐시 상한 64MB(초과 시 오래된 것부터 해제)

function createCachedAssetUrl(data: WorldData, file: string, kind: string | undefined, bytes: Uint8Array): string {
  const cache = ASSET_URL_CACHE.get(data) ?? new Map<string, { url: string; bytes: number }>();
  ASSET_URL_CACHE.set(data, cache);
  const current = cache.get(file);
  if (current) { cache.delete(file); cache.set(file, current); return current.url; }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeFor(file, kind) }));
  cache.set(file, { url, bytes: bytes.byteLength });
  let total = 0;
  for (const entry of cache.values()) total += entry.bytes;
  if (total > ASSET_URL_BUDGET) {
    for (const [key, entry] of cache) {
      if (key === file) continue;
      URL.revokeObjectURL(entry.url);
      cache.delete(key);
      total -= entry.bytes;
      if (total <= ASSET_URL_BUDGET) break;
    }
  }
  return url;
}

export function mimeFor(file: string, kind?: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (kind === 'audio') return lower.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg';
  return 'application/octet-stream';
}

/**
 * 지연 자산 URL. 화면에 보이는 자산만 호출하면 되고, LRU 상한을 넘으면 objectURL을 해제한다.
 * (기존 동기 `assetUrl`은 eager 모드 전용으로 남겨 둔다.)
 */
export async function assetUrlAsync(data: WorldData, assetId: string): Promise<string | undefined> {
  const asset = data.media.get(assetId);
  if (!asset) return undefined;
  const cache = ASSET_URL_CACHE.get(data);
  const hit = cache?.get(asset.file);
  if (hit && cache) { cache.delete(asset.file); cache.set(asset.file, hit); return hit.url; }
  const pending = ASSET_URL_PENDING.get(data) ?? new Map<string, Promise<string | undefined>>();
  ASSET_URL_PENDING.set(data, pending);
  const inflight = pending.get(asset.file);
  if (inflight) return inflight;
  const generation = ASSET_URL_GENERATIONS.get(data) ?? 0;
  const promise = (async () => {
    const bytes = await readAssetBytes(data, asset.file);
    if (!bytes || (ASSET_URL_GENERATIONS.get(data) ?? 0) !== generation) return undefined;
    return createCachedAssetUrl(data, asset.file, asset.kind, bytes);
  })();
  pending.set(asset.file, promise);
  try {
    return await promise;
  } finally {
    if (pending.get(asset.file) === promise) pending.delete(asset.file);
  }
}

/** 메모리에서 자산 캐시를 비우고 objectURL을 해제한다(세계관 전환 시). */
export function releaseAssetUrls(data: WorldData): void {
  ASSET_URL_GENERATIONS.set(data, (ASSET_URL_GENERATIONS.get(data) ?? 0) + 1);
  ASSET_URL_PENDING.get(data)?.clear();
  const cache = ASSET_URL_CACHE.get(data);
  if (cache) {
    for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
    cache.clear();
  }
  data.assetCache?.clear();
  data.source?.clearCache?.();
}

export function assetUrl(data: WorldData, assetId: string): string | undefined { const asset=data.media.get(assetId); if(!asset) return undefined; const bytes=data.assetBytes.get(asset.file); if(!bytes) return undefined; return createCachedAssetUrl(data, asset.file, asset.kind, bytes); }
export function resolveMedia(data: WorldData, nodes: import('@world-player/schema').ChatNode[], state?: string, situation?: string): import('@world-player/schema').ChatNode[] { return nodes.map(node => { if(node.type!=='media' && node.type!=='audio') return node; const asset=node.asset?data.media.get(node.asset):undefined; const stateAllowed=!asset?.validStates?.length || (!!state && asset.validStates.includes(state)); const situationAllowed=!asset?.validSituations?.length || (!!situation && asset.validSituations.includes(situation)); return asset && data.assetFiles.has(asset.file) && stateAllowed && situationAllowed ? node : {type:'text',text:`[unavailable ${node.type}: ${node.asset ?? 'missing'}]`}; }); }
function arr(v: unknown): string[] { return Array.isArray(v) ? v.map(String) : []; }
function ref(v: unknown) { return typeof v === 'string' ? { markdown: v } : undefined; }
function asRules(v: unknown): KnowledgeRule[] { return Array.isArray(v) ? v.map(x => x as KnowledgeRule) : []; }

export interface LoadWorldOptions {
  /** true면 모든 자산 바이트를 메모리에 올린다(작은 패키지·테스트용). 기본 false(지연 로딩). */
  eagerAssets?: boolean;
  /** Keep the UI responsive by loading referenced Markdown only when a chat/profile needs it. */
  lazyDocuments?: boolean;
  language?: 'ko' | 'en';
}

export async function loadWorld(source: WorldSource, options: LoadWorldOptions = {}): Promise<WorldData> {
  const manifest = parseYaml(await source.read('manifest.yaml')) as WorldManifest;
  const raw = parseYaml(await source.read(manifest.entry || 'world.yaml')) as Record<string, unknown>;
  const enWorld = options.language === 'en' ? parseYaml(await source.read('locales/en/world.yaml').catch(() => '{}')) as Record<string, unknown> : {};
  const world: World = { id: String(raw.id), name: String((options.language === 'en' ? enWorld.name : undefined) ?? raw.name), nameEn: raw.nameEn ? String(raw.nameEn) : undefined, version: String(raw.version ?? '0.0.0'), summary: String((options.language === 'en' ? enWorld.summary : undefined) ?? raw.summary ?? ''), summaryEn: raw.summaryEn ? String(raw.summaryEn) : undefined, theme: raw.theme as World['theme'], banner: raw.banner ? String(raw.banner) : undefined, entrypoints: arr(raw.entrypoints), tags: arr(raw.tags), knowledge: asRules(raw.knowledge) }
  const entities = new Map<string, Entity>();
  const index = parseYaml(await source.read('index/entities.yaml').catch(() => 'entities: []')) as { entities?: Record<string, unknown>[] };
  for (const item of index.entities ?? []) {
    const e = item as Record<string, unknown>;
    const entity = { id: String(e.id), type: (e.type ?? 'world') as Entity['type'], name: String(options.language === 'en' ? e.nameEn ?? e.name ?? e.id : e.name ?? e.id), nameEn: e.nameEn ? String(e.nameEn) : undefined, summary: String(options.language === 'en' ? e.summaryEn ?? e.summary ?? '' : e.summary ?? ''), summaryEn: e.summaryEn ? String(e.summaryEn) : undefined, markdown: e.markdown ? String(e.markdown) : undefined, markdownEn: e.markdownEn ? String(e.markdownEn) : undefined, banner: e.banner ? String(e.banner) : undefined, chatImage: e.chatImage ? String(e.chatImage) : undefined, voice: e.voice ? String(e.voice) : undefined, parent: e.parent ? String(e.parent) : undefined, tags: arr(e.tags), categories: arr(e.categories), relations: Array.isArray(e.relations) ? e.relations as {type:string;target:string}[] : [], personality: ref(e.personality), speech: ref(e.speech), prompt: ref(e.prompt), personalityEn: ref(e.personalityEn), speechEn: ref(e.speechEn), promptEn: ref(e.promptEn), knowledge: asRules(e.knowledge), states: arr(e.states) } as Entity;
    entities.set(entity.id, entity);
  }
  const timesKoText = await source.read('timeline/time-slices.yaml').catch(() => 'timeSlices: []');
  const localized = options.language === 'en';
  const timesKo = (parseYaml(timesKoText || 'timeSlices: []') ?? { timeSlices: [] }) as { timeSlices?: TimeSlice[] };
  const timesEnText = options.language === 'en' ? await source.read('locales/en/timeline/time-slices.yaml').catch(() => 'timeSlices: []') : 'timeSlices: []';
  const timesEn = (parseYaml(timesEnText || 'timeSlices: []') ?? { timeSlices: [] }) as { timeSlices?: TimeSlice[] };
  const translatedSlices = new Map((timesEn.timeSlices ?? []).map(item => [item.id, item]));
  const times = { timeSlices: (timesKo.timeSlices ?? []).map(item => {
    const translated = translatedSlices.get(item.id);
    if (options.language === 'en' && !translated?.labelEn && !translated?.label) throw new Error(`Missing official English time-slice label: ${item.id}`);
    return { ...item, label: options.language === 'en' ? translated?.labelEn ?? translated?.label ?? item.id : item.label, labelEn: translated?.labelEn };
  }) };
  const statesText = await source.read('timeline/states.yaml').catch(() => 'states: []');
  const states = (parseYaml(statesText || 'states: []') ?? { states: [] }) as { states?: CharacterState[] };
  const documents = new Map<string, string>();
  const knownPaths = source.listPaths ? new Set(await source.listPaths()) : undefined;
  const documentPaths = new Set<string>();
  const localePath = (path: string, language: 'ko' | 'en') => language === 'en' ? `locales/en/${path}` : path;
  const localizedMarkdown = (path: string | undefined) => path ? localePath(path, options.language ?? 'ko') : undefined;
  const enIdentityText = options.language === 'en' ? await source.read('locales/en/index/entities.yaml').catch(() => 'entities: []') : 'entities: []';
  const enIdentities = (parseYaml(enIdentityText || 'entities: []') ?? { entities: [] }) as { entities?: Record<string, unknown>[] };
  const enById = new Map((enIdentities.entities ?? []).map(item => [String(item.id), item]));
  for (const e of entities.values()) {
    const en = enById.get(e.id);
    if (en) {
      if (options.language === 'en') {
        const translatedName = typeof en.nameEn === 'string' ? en.nameEn : typeof en.name === 'string' ? en.name : undefined;
        const translatedSummary = typeof en.summaryEn === 'string' ? en.summaryEn : typeof en.summary === 'string' ? en.summary : undefined;
        if (translatedName) e.name = translatedName;
        if (translatedSummary !== undefined) e.summary = translatedSummary;
      }
      if (en.nameEn) e.nameEn = String(en.nameEn);
      if (en.summaryEn) e.summaryEn = String(en.summaryEn);
      if (en.personalityEn) (e as Character).personalityEn = ref(en.personalityEn);
      if (en.speechEn) (e as Character).speechEn = ref(en.speechEn);
      if (en.promptEn) (e as Character).promptEn = ref(en.promptEn);
    }
    const slug = e.id.replace(/^character:/, '');
    const extractedPersona = options.language === 'en' && e.type === 'character' ? `locales/en/characters/${slug}/personality.md` : undefined;
    for (const candidate of [localizedMarkdown(e.markdown), localizedMarkdown((e as Character).personality?.markdown), localizedMarkdown((e as Character).speech?.markdown), localizedMarkdown((e as Character).prompt?.markdown), localizedMarkdown((e as Character).personalityEn?.markdown), localizedMarkdown((e as Character).speechEn?.markdown), localizedMarkdown((e as Character).promptEn?.markdown), extractedPersona]) if (candidate) documentPaths.add(candidate);
  }
  const statesSource = options.language === 'en' ? 'locales/en/timeline/states.yaml' : 'timeline/states.yaml';
  const localizedStates = parseYaml(await source.read(statesSource).catch(() => 'states: []')) as { states?: CharacterState[] };
  if (options.language === 'en') { states.states = localizedStates.states ?? []; }
  for (const state of states.states ?? []) for (const candidate of [localizedMarkdown(state.personality?.markdown), localizedMarkdown(state.speech?.markdown)]) if (candidate) documentPaths.add(candidate);
  // Ranged package sources otherwise turn this loop into hundreds of serial network round trips.
  const pendingDocumentPaths = [...documentPaths].filter(path => knownPaths ? knownPaths.has(path) : true);
  const loadedDocuments = new Set<string>();
  if (options.lazyDocuments) {
    for (const path of pendingDocumentPaths) documents.set(path, '');
  } else {
    let nextDocument = 0;
    const documentWorkers = Array.from({ length: Math.min(8, pendingDocumentPaths.length) }, async () => {
      while (nextDocument < pendingDocumentPaths.length) {
        const path = pendingDocumentPaths[nextDocument++];
        if (knownPaths || await source.exists(path)) {
          documents.set(path, await source.read(path));
          loadedDocuments.add(path);
        }
      }
    });
    await Promise.all(documentWorkers);
  }
  // Packages built by current tooling include a JSON mirror of this large index. JSON.parse is
  // dramatically faster than parsing hundreds of thousands of YAML nodes during player startup.
  const mediaIndexJson = await source.read('assets/media-index.json').catch(() => undefined);
  const mediaRaw = (mediaIndexJson ? JSON.parse(mediaIndexJson) : parseYaml(await source.read('assets/media.yaml').catch(() => 'media: []'))) as { media?: MediaAsset[] };
  const media = new Map((mediaRaw.media ?? []).map(asset => [asset.id, asset]));
  const assetFiles = new Set<string>();
  const assetBytes = new Map<string, Uint8Array>();
  // 지연 모드(기본): 자산의 **존재 여부만** 확인하고 바이트는 읽지 않는다. 772MB 패키지에서
  // 전체 압축 해제 + 사본 2벌을 메모리에 올리던 문제를 없앤다.
  for (const asset of media.values()) {
    const exists = knownPaths ? knownPaths.has(asset.file) : await source.exists(asset.file);
    if (!exists) continue;
    assetFiles.add(asset.file);
    if (!options.eagerAssets) continue;
    try {
      const value = await source.readBytes?.(asset.file);
      if (value) assetBytes.set(asset.file, value);
    } catch { /* text-only sources may not expose binary bytes */ }
  }
  // packageFiles는 **문서/메타데이터**만 담는다(자산 바이트는 지연 로딩으로 필요할 때 읽는다).
  const packageFiles = new Map<string, Uint8Array>();
  if (options.eagerAssets && source.listPaths) for (const path of await source.listPaths()) { try { const bytes = await source.readBytes?.(path) ?? new TextEncoder().encode(await source.read(path)); packageFiles.set(path, bytes); } catch { /* directories and unreadable optional entries are ignored */ } }
  const graphDocs = new Map<string, ReturnType<typeof parseMarkdown>>();
  if (!options.lazyDocuments) for (const [path, body] of documents) graphDocs.set(path, parseMarkdown(body));
  const graph = buildEntityGraph(entities.values(), graphDocs);
  for (const entity of entities.values()) if(entity.markdown) { const path = localizedMarkdown(entity.markdown); if (path && loadedDocuments.has(path)) packageFiles.set(path, new TextEncoder().encode(documents.get(path) ?? '')); }
  for (const [path, bytes] of assetBytes) packageFiles.set(path, bytes);
  return { manifest, world, entities, timeSlices: times.timeSlices ?? [], states: states.states ?? [], documents, loadedDocuments, media, assetFiles, assetBytes, packageFiles, links: graph.links, source, assetCache: assetBytes };
}

/** Load selected source documents into an already-open world. Repeated paths are deduplicated. */
export async function loadWorldDocuments(data: WorldData, paths: Iterable<string>): Promise<void> {
  const source = data.source;
  if (!source) return;
  const pending = [...new Set(paths)].filter(path => data.documents.has(path) && !data.loadedDocuments?.has(path));
  await Promise.all(pending.map(async path => {
    if (!data.loadedDocuments && data.documents.get(path)) return;
    if (!await source.exists(path)) return;
    const body = await source.read(path);
    data.documents.set(path, body);
    data.loadedDocuments?.add(path);
    const markdown = parseMarkdown(body);
    const normalizedPath = path.replace(/^locales\/en\//, '');
    for (const entity of data.entities.values()) {
      if (entity.markdown === normalizedPath) data.links.set(entity.id, markdown.links.filter(link => link.includes(':')));
    }
  }));
}

export interface FogContext { timeSlice?: string; slicePosition?: number; location?: string; relation?: string; faction?: string; role?: string; event?: string; visibility?: string }
/** A Fog grant that can be re-validated outside the UI (Tauri search boundary). */
export interface FogGrant { target: string; access: KnowledgeLevel; timeSlice?: string }
/**
 * Projects knowledge rules into boundary grants for one time slice. Rules whose conditions cannot be
 * evaluated at the boundary, or that belong to another slice, are dropped so the boundary stays deny-by-default.
 */
/** 시간창 밖이면 false — 스토리는 자기 장 구간에서만 보인다. */
function insideWindow(condition: KnowledgeCondition | undefined, context: FogContext): boolean {
  if (!condition) return true;
  if (condition.fromPosition !== undefined || condition.untilPosition !== undefined) {
    const position = context.slicePosition;
    if (position === undefined || !Number.isFinite(position)) return false; // 위치를 모르면 시간창 조건은 만족할 수 없다
    if (condition.fromPosition !== undefined && position < condition.fromPosition) return false;
    if (condition.untilPosition !== undefined && position >= condition.untilPosition) return false;
  }
  return true;
}

export function fogGrants(rules: KnowledgeRule[], sliceId: string, slicePosition?: number): FogGrant[] { return rules.flatMap(rule => { const condition=rule.condition; if(!insideWindow(condition, { timeSlice: sliceId, slicePosition })) return []; if(condition && Object.keys(condition).some(key=>key!=='timeSlice' && key!=='fromPosition' && key!=='untilPosition' && (condition as Record<string, unknown>)[key]!==undefined)) return []; if(condition?.timeSlice && condition.timeSlice!==sliceId) return []; return [{target:rule.target,access:rule.access,timeSlice:condition?.timeSlice ?? sliceId}]; }); }
export function knowledgeLevel(rule: KnowledgeRule | undefined, context: FogContext = {}): KnowledgeLevel { if (!rule) return 'unknown'; if (!insideWindow(rule.condition, context)) return 'hidden'; const c = rule.condition as (FogContext & { timeSlice?: string }) | undefined; if (c && Object.entries(c).some(([key, value]) => value !== undefined && key !== 'fromPosition' && key !== 'untilPosition' && value !== context[key as keyof FogContext])) return 'unknown'; return rule.access; }
export function canAccess(rule: KnowledgeRule | undefined, context: FogContext = {}): boolean { return rule !== undefined && knowledgeLevel(rule, context) !== 'hidden'; }
/** 세계관 수준 규칙 + 캐릭터/상태 규칙을 합친다(시간창 규칙 포함). */
export function worldKnowledge(data: WorldData): KnowledgeRule[] { return data.world.knowledge ?? []; }
export function filterKnowledge(entities: Iterable<Entity>, rules: KnowledgeRule[], context: FogContext = {}): Entity[] { return [...entities].filter(e => canAccess(rules.filter(r => r.target === e.id).at(-1), context)); }
export function resolveState(character: Character, states: CharacterState[], slice: TimeSlice, situation?: string, slices: TimeSlice[] = [slice]): CharacterState | undefined { const positionOf = (id: string | undefined, fallback: number) => slices.find(x => x.id === id)?.position ?? fallback; return states.filter(s => s.character === character.id && slice.position >= positionOf(s.validFrom, Number.MIN_SAFE_INTEGER) && slice.position <= positionOf(s.validUntil, Number.MAX_SAFE_INTEGER) && (!s.conditions?.situation || s.conditions.situation === situation)).sort((a,b) => b.priority - a.priority)[0]; }
export function searchWorld(data: WorldData, query: string, rules: KnowledgeRule[] = [], context: FogContext = {}): Entity[] { const q = query.toLocaleLowerCase(); return filterKnowledge(data.entities.values(), rules, context).filter(e => [e.id,e.name,e.summary,...e.tags, e.markdown ? data.documents.get(e.markdown) : ''].join(' ').toLocaleLowerCase().includes(q)); }
export function searchProjected(data: WorldData, query: string, rules: KnowledgeRule[], context: FogContext = {}): import('@world-player/schema').KnowledgeProjection[] { return searchWorld(data,query,rules,context).map(entity=>projectKnowledge(entity,rules.find(rule=>rule.target===entity.id),data,context)).filter((value): value is import('@world-player/schema').KnowledgeProjection=>Boolean(value)); }
export function projectKnowledge(entity: Entity, rule: KnowledgeRule | undefined, data: WorldData, context: FogContext = {}): import('@world-player/schema').KnowledgeProjection | undefined { const level=knowledgeLevel(rule,context); if(level==='hidden'||level==='unknown') return undefined; const document=entity.markdown?data.documents.get(entity.markdown):undefined; if(level==='full') return {entity,level,summary:entity.summary,document}; if(level==='public') return {entity:{...entity,relations:[],categories:[]},level,summary:entity.summary}; return {entity:{...entity,relations:[],categories:[],tags:[]},level,summary:entity.summary}; }
export function readDocument(data: WorldData, id: string, rules: KnowledgeRule[] = [], context: FogContext = {}): string | undefined { const entity = data.entities.get(id); if (!entity) return undefined; return projectKnowledge(entity,rules.find(r=>r.target===id),data,context)?.document; }
export function documentNodes(body: string): import('@world-player/schema').ChatNode[] { return parseMarkdown(body).nodes; }
function englishIdLabel(id: string): string | undefined {
  const label = id.replace(/^(character|category|event|location):/, '').replace(/[-_]+/g, ' ').trim();
  return label && !/[가-힣]/.test(label) ? label : undefined;
}
/**
 * 캐릭터가 실제로 "기억"하는 사건 상세. Fog를 통과해 보이는 이벤트/장소 문서의 앞부분을
 * 예산 안에서 주입한다(요약만 주면 캐릭터가 사건을 기억하지 못해 몰입이 깨진다).
 */
export function eventMemory(data: WorldData | undefined, visible: Entity[], options: { budget?: number; perEvent?: number; language?: 'ko' | 'en' } = {}): string {
  if (!data) return '';
  const budget = options.budget ?? 6000;
  const perEvent = options.perEvent ?? 1200;
  const lines: string[] = [];
  let used = 0;
  // 사건 기억이 몰입도에 직결되므로 이벤트를 먼저 넣고, 예산이 남을 때만 장소/분류를 보탠다.
  const ordered = [...visible].sort((a, b) => Number(b.type === 'event') - Number(a.type === 'event'));
  for (const entity of ordered) {
    if (entity.type !== 'event' && entity.type !== 'location' && entity.type !== 'category') continue;
    const body = entity.markdown ? data.documents.get(options.language === 'en' ? `locales/en/${entity.markdown}` : entity.markdown) : undefined;
    if (!body) continue;
    const limit = entity.type === 'event' ? perEvent : Math.min(perEvent, 400);
    const excerpt = body
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);
    if (excerpt.length < 40) continue;
    if (used + excerpt.length > budget) continue;
    used += excerpt.length;
    const name = options.language === 'en' ? entity.nameEn ?? englishIdLabel(entity.id) ?? 'Untranslated entry' : entity.name;
    lines.push(`- ${name}: ${excerpt}`);
  }
  if (lines.length === 0) return '';
  return ['Events you remember (use these details precisely; do not invent beyond them):', ...lines].join('\n');
}

/** 캐릭터가 응답에 쓸 수 있는 미디어 지시문 안내(사진 1개 + 선택적 음성). */
export function mediaDirectives(data: WorldData | undefined, character: Character, language: 'ko' | 'en' = 'ko'): string {
  if (!data) return '';
  const slug = character.id.split(':')[1] ?? character.id;
  const image = character.chatImage && data.media.has(character.chatImage) ? character.chatImage : undefined;
  const voiceIds = [...data.media.values()].filter(asset => asset.kind === 'audio' && asset.id.startsWith(`voice-${slug}-`)).map(asset => asset.id);
  const preferred = voiceIds.filter(id => id.startsWith(`voice-${slug}-base-`));
  const lines = [...new Set([...(character.voice ? [character.voice] : []), ...preferred.slice(0, 3)])].filter(id => data.media.has(id));
  if (!image && lines.length === 0) return '';
  const parts = [language === 'en' ? 'Optional media directives (place only at the start of a reply):' : '선택적 미디어 지시(응답 맨 앞에만 표시):'];
  if (image) parts.push(language === 'en' ? `- [[media:${image}]] — your portrait appears automatically. Use this only when you deliberately want to show a different picture.` : `- [[media:${image}]] — 기본 초상화는 자동 표시되므로 다른 이미지를 의도적으로 보여 줄 때만 사용한다.`);
  if (lines.length) {
    // 음성은 "기본 없음"이다. 목록이 있다는 이유만으로 붙이는 일이 없도록, 붙일 조건을 좁게 적는다.
    parts.push(language === 'en' ? '- [[audio:<id>]] is optional. Keep voice usage rare.' : '- [[audio:<id>]] 음성은 선택 사항이며 드물게만 사용한다.');
    parts.push(language === 'en' ? '- Use voice only if requested or a short spoken reaction fits the moment.' : '- 음성은 요청받았거나 짧은 반응에 꼭 필요할 때만 사용한다.');
    parts.push(language === 'en' ? '- Never add voice just to greet or end a reply, and never use more than one.' : '- 인사나 대화 종료를 위해 음성을 붙이지 말고, 한 번에 하나만 사용한다.');
    parts.push(language === 'en' ? 'Allowed voice clips:' : '사용 가능한 음성:');
    for (const id of lines.slice(0, 4)) {
      const description = data.media.get(id)?.description ?? '';
      const transcript = description.split(/[—–]/).slice(1).join(' — ').trim();
      const englishTranscript = transcript && !/[가-힣]/.test(transcript) ? transcript : 'voice clip';
      parts.push(`  [[audio:${id}]] — "${englishTranscript.slice(0, 120)}"`);
    }
  }
  parts.push(language === 'en' ? 'Use English for all original dialogue. Place any directive before the dialogue; plain text is the normal case.' : '지시문은 먼저 쓰고, 대사는 자연스러운 한국어로 작성한다. 보통은 텍스트만 쓴다.');
  return parts.join('\n');
}
export function knowledgeLevels(entities: Iterable<Entity>, rules: KnowledgeRule[], context: FogContext = {}): Map<string, KnowledgeLevel> { const levels = new Map<string, KnowledgeLevel>(); for (const entity of entities) { const level = knowledgeLevel(rules.filter(rule => rule.target === entity.id).at(-1), context); if (level !== 'hidden' && level !== 'unknown') levels.set(entity.id, level); } return levels; }
export function buildPrompt(input: { data?: WorldData; world: World; character: Character; state?: CharacterState; slice: TimeSlice; player: {name:string;description:string}; visible: Entity[]; levels?: Map<string, KnowledgeLevel>; location?: string; situation?: string; language?: 'ko' | 'en'; eventMemoryBudget?: number; perEventMemoryBudget?: number }): string {
  const d = input.data; const doc = (path?: string) => path && d?.documents.get(path) || '';
  const language = input.language ?? 'ko';
  const knowledge = input.visible.flatMap(e => {
    const level = input.levels?.get(e.id);
    const summary = language === 'en' ? e.summaryEn ?? '' : e.summary ?? '';
    const name = language === 'en' ? e.nameEn ?? englishIdLabel(e.id) ?? (summary ? 'Untranslated entry' : undefined) : e.name;
    // A Korean-only name with no reviewed English summary contributes no usable
    // English knowledge. Omit it instead of leaking Korean from the source ID.
    if (!name) return [];
    return [`- ${name}${level && level !== 'full' ? ` (Fog: ${level} — speak with matching uncertainty)` : ''}: ${summary}`];
  }).join('\n');
  const worldName = language === 'en' ? input.world.nameEn ?? 'Blue Archive' : input.world.name;
  // loadWorld stores the selected locale's label in `label`; falling back to
  // the Korean ID here reintroduced Korean into otherwise translated prompts.
  const sliceLabel = language === 'en' ? input.slice.labelEn ?? (!/[가-힣]/.test(input.slice.label) ? input.slice.label : undefined) ?? englishIdLabel(input.slice.id) ?? 'Selected timeline' : input.slice.label;
  const characterName = language === 'en' ? input.character.nameEn ?? englishIdLabel(input.character.id) ?? 'Student' : input.character.name;
  const media = mediaDirectives(input.data, input.character, language);
  const memory = eventMemory(input.data, input.visible, { language, budget: input.eventMemoryBudget, perEvent: input.perEventMemoryBudget });
  const personaBase = input.character.personality?.markdown;
  const personaFile = input.character.id.startsWith('character:') ? `locales/en/characters/${input.character.id.replace(/^character:/, '')}/personality.md` : undefined;
  const personality = doc(language === 'en' ? input.character.personalityEn?.markdown ?? (personaFile && d?.documents.has(personaFile) ? personaFile : undefined) : personaBase);
  const speech = doc(language === 'en' ? input.character.speechEn?.markdown : input.character.speech?.markdown);
  const instructions = doc(language === 'en' ? input.character.promptEn?.markdown : input.character.prompt?.markdown);
  if (language === 'en') {
    // Check the text that the English prompt will actually contain. The source
    // entity's Korean summary is intentionally not used when summaryEn is
    // missing, so scanning e.summary here incorrectly rejected untranslated
    // visible knowledge even though it was omitted from the prompt.
    const koreanText = [
      worldName, sliceLabel, characterName, personality, speech, instructions,
      input.state?.personality ? doc(input.state.personality.markdown) : '',
      input.state?.speech ? doc(input.state.speech.markdown) : '',
      knowledge, memory, media,
    ].join('\n');
    if (/[가-힣]/.test(koreanText)) throw new Error('English source text is incomplete for this student or visible knowledge. Korean fallback is disabled; add reviewed English source files first.');
  }
  return [`You are ${characterName}.`, `World: ${worldName}.`, `Time: ${sliceLabel}.`, input.location ? `Location: ${input.location}.` : '', input.situation ? `Situation: ${input.situation}.` : '', `${language === 'en' ? 'Personality' : 'Personality'}:\n${personality}`, `Speech:\n${speech}`, `Character instructions:\n${instructions}`, input.state?.personality ? `Current state personality:\n${doc(input.state.personality.markdown)}` : '', input.state?.speech ? `Current state speech:\n${doc(input.state.speech.markdown)}` : '', `Player: ${input.player.name} — ${input.player.description}`, language === 'en' ? 'Visible world knowledge:' : 'Visible world knowledge:', knowledge || '- none',
    language === 'en' && input.visible.some(e => e.markdown && !input.data?.documents.has(`locales/en/${e.markdown}`)) ? 'Some visible story source has no reviewed English version; do not guess, paraphrase Korean, or claim knowledge of unavailable details.' : memory,
    media, language === 'en' ? 'Knowledge boundary: Never claim hidden information as known; express uncertainty naturally in character voice. Speak only English.' : 'Knowledge boundary: Never claim hidden information as known; express uncertainty naturally in character voice. 한국어로 대답한다.'].filter(Boolean).join('\n');
}
export function validateWorld(data: WorldData): ValidationIssue[] { const issues: ValidationIssue[] = []; if (!data.manifest.schemaVersion || !data.manifest.id || !data.manifest.entry) issues.push({level:'error',code:'INVALID_MANIFEST',message:'manifest.yaml requires schemaVersion, id, and entry'}); if (data.manifest.id !== data.world.id) issues.push({level:'error',code:'MANIFEST_ID_MISMATCH',message:'Manifest and world IDs differ'}); const ids = new Set(data.entities.keys()); for (const [entityId, targets] of data.links) for (const target of targets) if (!ids.has(target)) issues.push({level:'error',code:'BROKEN_INTERNAL_LINK',message:`${entityId} links to missing ${target}`,entity:entityId}); for (const e of data.entities.values()) { for (const r of e.relations) if (!ids.has(r.target)) issues.push({level:'error',code:'BROKEN_RELATION',message:`${e.id} references missing ${r.target}`,entity:e.id}); if (e.markdown && !data.documents.has(e.markdown)) issues.push({level:'error',code:'MISSING_MARKDOWN',message:`${e.id} references missing ${e.markdown}`,entity:e.id}); for (const r of (e as Character).knowledge ?? []) if (!ids.has(r.target)) issues.push({level:'error',code:'BROKEN_FOG_TARGET',message:`${e.id} fog rule references missing ${r.target}`,entity:e.id}); } const slices = new Set(data.timeSlices.map(x => x.id)); if (data.timeSlices.some((x,i) => data.timeSlices.slice(i+1).some(y => y.position === x.position))) issues.push({level:'error',code:'DUPLICATE_TIME_POSITION',message:'Time slices must have unique positions'}); for (const s of data.states) { if (!ids.has(s.character)) issues.push({level:'error',code:'BROKEN_STATE_CHARACTER',message:`${s.id} references missing ${s.character}`}); if (s.validFrom && !slices.has(s.validFrom)) issues.push({level:'error',code:'BROKEN_STATE_START',message:`${s.id} references missing time slice ${s.validFrom}`}); if (s.validUntil && !slices.has(s.validUntil)) issues.push({level:'error',code:'BROKEN_STATE_END',message:`${s.id} references missing time slice ${s.validUntil}`}); if (s.personality?.markdown && !data.documents.has(s.personality.markdown)) issues.push({level:'error',code:'MISSING_STATE_DOCUMENT',message:`${s.id} references missing personality document`}); if (s.speech?.markdown && !data.documents.has(s.speech.markdown)) issues.push({level:'error',code:'MISSING_STATE_DOCUMENT',message:`${s.id} references missing speech document`}); for (const rule of s.knowledge ?? []) if (!ids.has(rule.target)) issues.push({level:'error',code:'BROKEN_STATE_FOG_TARGET',message:`${s.id} fog rule references missing ${rule.target}`}); } if (data.world.banner && !data.media.has(data.world.banner)) issues.push({level:'warning',code:'MISSING_BANNER',message:`world banner ${data.world.banner} is not a media asset`}); for (const e of data.entities.values()) if (e.banner && !data.media.has(e.banner)) issues.push({level:'warning',code:'MISSING_BANNER',message:`${e.id} banner ${e.banner} is not a media asset`,entity:e.id}); for (const e of data.entities.values()) { const c = e as Character; if (c.chatImage && !data.media.has(c.chatImage)) issues.push({level:'warning',code:'MISSING_CHAT_IMAGE',message:`${e.id} chatImage ${c.chatImage} is not a media asset`,entity:e.id}); if (c.voice && !data.media.has(c.voice)) issues.push({level:'warning',code:'MISSING_VOICE',message:`${e.id} voice ${c.voice} is not a media asset`,entity:e.id}); } for (const [id, asset] of data.media) { if (!asset.file || !asset.description || !['profile','portrait','sprite','background','expression','illustration','audio'].includes(asset.kind)) issues.push({level:'error',code:'INVALID_MEDIA',message:`${id} requires valid file, kind, and description`}); else if (!data.assetFiles.has(asset.file)) issues.push({level:'error',code:'MISSING_MEDIA_FILE',message:`${id} references missing ${asset.file}`}); } for (const [path, body] of data.documents) for (const node of parseMarkdown(body).nodes) if ((node.type === 'media' || node.type === 'audio') && !data.media.has(node.asset ?? '')) issues.push({level:'error',code:'BROKEN_MEDIA_DIRECTIVE',message:`${path} references missing media ${node.asset}`}); return issues; }
