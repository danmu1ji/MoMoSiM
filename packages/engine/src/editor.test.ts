import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { applyWorldEdit, createWorldDraft, documentBody, refreshGraph, removeKnowledgeRule, setDocument, setKnowledgeRule, toEditableWorld, upsertEntity, upsertTimeSlice } from './editor';
import { exportWorldPackageAsync } from './export';
import { validateWorld } from './core';
import type { Character } from '@world-player/schema';

describe('editor model',()=>{it('round-trips editable world metadata',()=>{const data=createWorldDraft('Old'); const edit=toEditableWorld(data); edit.name='New'; applyWorldEdit(data,edit); expect(data.world.name).toBe('New'); expect(data.manifest.name).toBe('New');});});

describe('world creation workflow',()=>{it('creates a valid package with a character, document, and time slice',async()=>{const data=createWorldDraft('새 세계관','요약'); expect(validateWorld(data).filter(x=>x.level==='error')).toEqual([]); expect(data.entities.get('character:guide')?.type).toBe('character'); expect(documentBody(data,'characters/guide/character.md')).toContain('Markdown'); expect((await exportWorldPackageAsync(data)).length).toBeGreaterThan(0);});});

describe('markdown editing',()=>{it('keeps documents, export payload, and entity graph links in sync',async()=>{const data=createWorldDraft(); upsertEntity(data,{id:'character:other',type:'character',name:'동료',tags:[],relations:[]},'동료 문서'); setDocument(data,'characters/guide/character.md','안내자는 [[character:other]] 와 함께 여행한다.'); const files=unzipSync((await exportWorldPackageAsync(data))); expect(strFromU8(files['characters/guide/character.md'])).toContain('[[character:other]]'); expect(data.links.get('character:guide')).toEqual(['character:other']);});});

describe('fog rule editing',()=>{it('replaces and removes per-target rules',()=>{const data=createWorldDraft(); upsertEntity(data,{id:'location:harbor',type:'location',name:'항구',tags:[],relations:[]},'항구 문서'); setKnowledgeRule(data,'character:guide',{target:'location:harbor',access:'partial',condition:{timeSlice:'beginning'}}); setKnowledgeRule(data,'character:guide',{target:'location:harbor',access:'full'}); const guide=data.entities.get('character:guide') as Character; const harbor=guide.knowledge?.filter(r=>r.target==='location:harbor') ?? []; expect(harbor).toHaveLength(1); expect(harbor[0].access).toBe('full'); removeKnowledgeRule(data,'character:guide','location:harbor'); expect(guide.knowledge?.some(r=>r.target==='location:harbor')).toBe(false); expect(guide.knowledge).toHaveLength(1);});});

describe('timeline editing',()=>{it('adds time slices in position order and refreshes the graph',()=>{const data=createWorldDraft(); upsertTimeSlice(data,{id:'later',label:'이후',position:5}); upsertTimeSlice(data,{id:'middle',label:'중간',position:2}); expect(data.timeSlices.map(s=>s.id)).toEqual(['beginning','middle','later']); expect(refreshGraph(data).links).toBe(data.links);});});
