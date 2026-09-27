import type { Character, Entity, KnowledgeRule, TimeSlice } from '@world-player/schema';
import { parseMarkdown } from '@world-player/markdown';
import type { WorldData } from './core.js';
import { buildEntityGraph } from './graph.js';

export interface EditableWorld { name: string; summary: string; tags: string[]; entities: Entity[]; timeSlices: TimeSlice[] }

export function toEditableWorld(data: WorldData): EditableWorld { return {name:data.world.name,summary:data.world.summary,tags:[...data.world.tags],entities:[...data.entities.values()].map(e=>({...e,relations:e.relations.map(r=>({...r})),tags:[...e.tags],categories:e.categories?[...e.categories]:undefined})),timeSlices:data.timeSlices.map(s=>({...s}))}; }

export function applyWorldEdit(data: WorldData, edit: Partial<EditableWorld>): WorldData { if(edit.name!==undefined){data.world.name=edit.name;data.manifest.name=edit.name;} if(edit.summary!==undefined)data.world.summary=edit.summary; if(edit.tags!==undefined)data.world.tags=[...edit.tags]; if(edit.entities){data.entities=new Map(edit.entities.map(e=>[e.id,e]));} if(edit.timeSlices)data.timeSlices=edit.timeSlices; return refreshGraph(data); }

/** Rebuild the internal-link index from the current documents so Entity Graph navigation stays truthful after edits. */
export function refreshGraph(data: WorldData): WorldData { data.links=buildEntityGraph(data.entities.values(),documentGraph(data)).links; return data; }
function documentGraph(data: WorldData) { return new Map([...data.documents].map(([path,body])=>[path,parseMarkdown(body)])); }

/** Write a Markdown document and keep the export payload in sync with the edit. */
export function setDocument(data: WorldData, path: string, body: string): WorldData { data.documents.set(path,body); data.packageFiles.set(path,new TextEncoder().encode(body)); return refreshGraph(data); }
export function documentBody(data: WorldData, path?: string): string { return path ? data.documents.get(path) ?? '' : ''; }

export function upsertEntity(data: WorldData, entity: Entity, document?: string): WorldData {
  const normalized: Entity = { ...entity, tags:[...entity.tags], relations:entity.relations.map(r=>({...r})), categories:entity.categories?[...entity.categories]:undefined, markdown: entity.markdown ?? `entities/${entity.id.replace(/[^a-zA-Z0-9._-]/g,'-')}.md` };
  data.entities.set(normalized.id,normalized);
  setDocument(data, normalized.markdown!, document ?? data.documents.get(normalized.markdown!) ?? `# ${normalized.name}\n\n${normalized.summary ?? ''}\n`);
  if(!data.world.entrypoints.includes(normalized.id) && normalized.type==='character') data.world.entrypoints=[...data.world.entrypoints,normalized.id];
  return refreshGraph(data);
}
export function removeEntity(data: WorldData, id: string): WorldData { const entity=data.entities.get(id); if(entity?.markdown){data.documents.delete(entity.markdown); data.packageFiles.delete(entity.markdown);} data.entities.delete(id); data.world.entrypoints=data.world.entrypoints.filter(x=>x!==id); return refreshGraph(data); }

/** Fog rule editing per character: a rule for a target replaces any existing rule for that target. */
export function setKnowledgeRule(data: WorldData, characterId: string, rule: KnowledgeRule): WorldData { const character=data.entities.get(characterId) as Character | undefined; if(!character) return data; const rest=(character.knowledge ?? []).filter(r=>r.target!==rule.target); character.knowledge=[...rest,{...rule,condition:rule.condition?{...rule.condition}:undefined}]; return data; }
export function removeKnowledgeRule(data: WorldData, characterId: string, target: string): WorldData { const character=data.entities.get(characterId) as Character | undefined; if(character) character.knowledge=(character.knowledge ?? []).filter(r=>r.target!==target); return data; }

export function upsertTimeSlice(data: WorldData, slice: TimeSlice): WorldData { data.timeSlices=[...data.timeSlices.filter(s=>s.id!==slice.id),slice].sort((a,b)=>a.position-b.position); return data; }
export function removeTimeSlice(data: WorldData, id: string): WorldData { data.timeSlices=data.timeSlices.filter(s=>s.id!==id); return data; }

export function createWorldDraft(name='새 세계관', summary='사용자가 직접 만든 세계관'): WorldData { const character: Character={id:'character:guide',type:'character',name:'안내자',summary:'새 세계관의 첫 번째 캐릭터입니다.',markdown:'characters/guide/character.md',tags:[],relations:[],knowledge:[{target:'character:guide',access:'full'}]}; const docs=new Map([['characters/guide/character.md','이 캐릭터의 소개를 Markdown으로 편집하세요.']]); const manifest={schemaVersion:'1.0',id:`world-${Date.now()}`,name,version:'0.1.0',entry:'world.yaml'}; const world={id:manifest.id,name,version:manifest.version,summary,entrypoints:[character.id],tags:[]}; const data: WorldData = {manifest,world,entities:new Map([[character.id,character]]),timeSlices:[{id:'beginning',label:'시작',position:0}],states:[],documents:docs,media:new Map(),assetFiles:new Set(),assetBytes:new Map(),packageFiles:new Map([...docs].map(([p,b])=>[p,new TextEncoder().encode(b)])),links:new Map()}; return refreshGraph(data); }

/* ────────────────────────────── 전문 편집기용 확장 API ──────────────────────────────
 * 편집기 웹(에디터 앱)은 아래 함수들로 세계관의 **모든 부분**을 다룬다:
 * 메타데이터(manifest/world), index(엔티티), 캐릭터, 이벤트, 문서(lore/events),
 * 관계, 상태(states), 타임라인(time slices), 에셋(media), Fog 규칙.
 */

/** 세계관 메타데이터(manifest + world.yaml)를 부분 갱신한다. */
export function setWorldMeta(data: WorldData, patch: {
  id?: string; name?: string; version?: string; summary?: string; tags?: string[];
  entrypoints?: string[]; theme?: WorldData['world']['theme']; banner?: string; knowledge?: KnowledgeRule[];
}): WorldData {
  const next = { ...data.world, ...patch } as WorldData['world'];
  data.world = next;
  data.manifest = {
    ...data.manifest,
    id: patch.id ?? data.manifest.id,
    name: patch.name ?? data.manifest.name,
    version: patch.version ?? data.manifest.version,
  };
  return refreshGraph(data);
}

/** 엔티티 필드를 부분 갱신한다(타입별 필드 포함). */
export function patchEntity(data: WorldData, id: string, patch: Partial<Entity> & Record<string, unknown>): WorldData {
  const entity = data.entities.get(id);
  if (!entity) return data;
  const updated = { ...entity, ...patch } as Entity;
  data.entities.set(id, updated);
  return refreshGraph(data);
}

/** 관계(엣지) 추가/갱신 — 같은 target·type이면 교체한다. */
export function upsertRelation(data: WorldData, entityId: string, relation: { type: string; target: string; label?: string }): WorldData {
  const entity = data.entities.get(entityId);
  if (!entity) return data;
  const rest = (entity.relations ?? []).filter(row => !(row.type === relation.type && row.target === relation.target));
  entity.relations = [...rest, { ...relation } as Entity['relations'][number]];
  return refreshGraph(data);
}

/** 관계(엣지) 삭제. */
export function removeRelation(data: WorldData, entityId: string, target: string, type?: string): WorldData {
  const entity = data.entities.get(entityId);
  if (!entity) return data;
  entity.relations = (entity.relations ?? []).filter(row => !(row.target === target && (!type || row.type === type)));
  return refreshGraph(data);
}

/** 캐릭터 상태(states) 추가/갱신. */
export function upsertState(data: WorldData, state: WorldData['states'][number]): WorldData {
  data.states = [...data.states.filter(row => row.id !== state.id), { ...state }];
  return data;
}
export function removeState(data: WorldData, id: string): WorldData { data.states = data.states.filter(row => row.id !== id); return data; }

/** 미디어 에셋 추가/갱신(+선택적으로 바이너리 등록). */
export function upsertMediaAsset(data: WorldData, asset: WorldData['media'] extends Map<string, infer T> ? T : never, bytes?: Uint8Array): WorldData {
  const next = { ...asset, tags: [...(asset.tags ?? [])] } as Parameters<WorldData['media']['set']>[1];
  data.media.set(next.id, next);
  if (bytes) setAssetBytes(data, next.file, bytes);
  else data.assetFiles.add(next.file);
  return data;
}
export function removeMediaAsset(data: WorldData, id: string): WorldData { data.media.delete(id); return data; }

/** 바이너리 파일 등록(업로드) — 내보내기(packageFiles)에도 함께 담긴다. */
export function setAssetBytes(data: WorldData, file: string, bytes: Uint8Array): WorldData {
  data.assetBytes.set(file, bytes);
  data.assetCache?.set(file, bytes);
  data.assetFiles.add(file);
  data.packageFiles.set(file, bytes);
  return data;
}
export function removeAssetFile(data: WorldData, file: string): WorldData {
  data.assetBytes.delete(file);
  data.assetCache?.delete(file);
  data.assetFiles.delete(file);
  data.packageFiles.delete(file);
  return data;
}

/** 문서(마크다운) 목록 — 편집기의 파일 트리용. */
export function listDocuments(data: WorldData): { path: string; bytes: number }[] {
  return [...data.documents].map(([path, body]) => ({ path, bytes: new TextEncoder().encode(body).length })).sort((a, b) => a.path.localeCompare(b.path));
}
/** 문서 삭제(엔티티가 참조 중이면 그대로 두고 경고는 검증기가 잡는다). */
export function removeDocument(data: WorldData, path: string): WorldData {
  data.documents.delete(path);
  data.packageFiles.delete(path);
  return refreshGraph(data);
}
/** 문서 경로 생성(중복이면 -2, -3 …). */
export function uniqueDocumentPath(data: WorldData, base: string): string {
  if (!data.documents.has(base)) return base;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '.md';
  const stem = base.slice(0, base.length - ext.length);
  let index = 2;
  while (data.documents.has(`${stem}-${index}${ext}`)) index += 1;
  return `${stem}-${index}${ext}`;
}
