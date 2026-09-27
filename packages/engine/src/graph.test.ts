import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@world-player/markdown';
import { buildEntityGraph, relatedEntities, resolvableLinks } from './graph';
import { loadWorld, validateWorld } from './core';

const baseFiles: Record<string, string> = {
  'manifest.yaml': 'schemaVersion: 1\nid: w\nname: W\nversion: 1\nentry: world.yaml',
  'world.yaml': 'id: w\nname: W\nversion: 1\nsummary: s',
  'index/entities.yaml': 'entities:\n - id: character:a\n   type: character\n   name: A\n   markdown: a.md\n   tags: []\n   relations: []\n - id: location:b\n   type: location\n   name: B\n   markdown: b.md\n   tags: []\n   relations: []',
  'a.md': 'A는 [[location:b]] 를 알고 [[location:missing]] 은 모른다.',
  'b.md': 'B 문서',
  'timeline/time-slices.yaml': 'timeSlices:\n - id: now\n   label: 지금\n   position: 0',
  'timeline/states.yaml': 'states: []',
  'assets/media.yaml': 'media: []',
};
const load = async (files: Record<string, string>) => loadWorld({ read: async p => files[p], exists: async p => p in files, listPaths: async () => Object.keys(files) });

describe('entity graph',()=>{it('indexes markdown links and structured relations',()=>{const graph=buildEntityGraph([{id:'a',type:'location',name:'A',tags:[],relations:[{type:'contains',target:'b'}],markdown:'a.md'},{id:'b',type:'character',name:'B',tags:[],relations:[]}],new Map([['a.md',{frontmatter:{},body:'',links:['location:c'],nodes:[]}]])); expect(relatedEntities(graph,'a')).toEqual(['location:c','b']);});});

describe('graph load boundary',()=>{it('exposes internal links from loaded documents and filters unresolvable targets',async()=>{const data=await load(baseFiles); expect(data.links.get('character:a')).toEqual(['location:b','location:missing']); expect(resolvableLinks(buildEntityGraph(data.entities.values(),new Map([...data.documents].map(([p,b])=>[p,parseMarkdown(b)]))),'character:a',data.entities.keys())).toEqual(['location:b']); expect(data.packageFiles.has('a.md')).toBe(true);});});

describe('graph validation',()=>{it('flags internal links that point at missing entities',async()=>{const data=await load(baseFiles); expect(validateWorld(data).map(i=>i.code)).toContain('BROKEN_INTERNAL_LINK');});});
