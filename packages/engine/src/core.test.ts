import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildPrompt, createMemorySource, filterKnowledge, loadWorld, mediaDirectives, readDocument, validateWorld, withLocaleOverlay } from './core';
const files = {'manifest.yaml':'schemaVersion: "1.0"\nid: w\nname: W\nversion: 1\nentry: world.yaml','world.yaml':'id: w\nname: Demo\nversion: 1\nsummary: demo','index/entities.yaml':'entities:\n - id: category:harbor\n   type: category\n   name: Harbor\n   markdown: harbor.md\n   relations: []\n - id: secret\n   type: event\n   name: Secret\n   markdown: secret.md\n   relations: []\n - id: character:aria\n   type: character\n   name: Aria\n   markdown: aria.md\n   personality: aria-personality.md\n   speech: aria-speech.md\n   knowledge: [{target: secret, access: hidden}]\n   relations: []','harbor.md':'open harbor','secret.md':'secret','aria.md':'aria','aria-personality.md':'bright','aria-speech.md':'warm','timeline/time-slices.yaml':'timeSlices:\n - id: now\n   label: Now\n   position: 1','timeline/states.yaml':'states: []','assets/media.yaml':'media: []','locales/en/timeline/time-slices.yaml':'timeSlices: []'};
describe('locale overlays',()=>{it('reads English overlays independently while keeping archive assets in the base source',async()=>{const base=createMemorySource({'base.md':'한국어'}); const overlay=createMemorySource({'locales/en/base.md':'source English'}); const merged=withLocaleOverlay(base,overlay,['locales/en/base.md']); expect(await merged.read('base.md')).toBe('한국어'); expect(await merged.read('locales/en/base.md')).toBe('source English'); expect((await merged.listPaths?.()) ?? []).toContain('locales/en/base.md');});});

it('builds Arisu English prompts without rejecting Korean source metadata that is not shown', () => {
  const arisu = {
    id: 'character:arisu', type: 'character', name: '아리스', nameEn: 'Arisu',
    summary: '밀레니엄 게임개발부의 안드로이드.', summaryEn: 'A Millennium student.',
    tags: [], relations: [],
  } as import('@world-player/schema').Character;
  const visible = {
    id: 'event:prologue', type: 'event', name: '프롤로그',
    summary: '선생이 키보토스에 도착한다.', tags: [], relations: [],
  } as import('@world-player/schema').Entity;
  const koreanOnlyEntry = {
    id: 'category:millennium-(미분류)', type: 'category', name: '밀레니엄 (미분류)',
    summary: '분류되지 않은 밀레니엄 정보.', tags: [], relations: [],
  } as import('@world-player/schema').Entity;
  const data = {
    documents: new Map<string, string>(),
    media: new Map(),
  } as unknown as import('./core').WorldData;
  const prompt = buildPrompt({
    data,
    world: { id: 'ba', name: '블루 아카이브', nameEn: 'Blue Archive', version: '1', summary: '', entrypoints: [], tags: [] },
    character: arisu,
    slice: { id: '프롤로그-1-4', label: 'Chapter 1: Prologue', position: 1200 },
    player: { name: 'Sensei', description: '' },
    visible: [visible, koreanOnlyEntry],
    language: 'en',
  });
  expect(prompt).toContain('Time: Chapter 1: Prologue.');
  expect(prompt).not.toMatch(/[가-힣]/);
  expect(mediaDirectives(data, arisu, 'en')).toBe('');
});

it('loads official English labels for every slice currently in the Blue Archive package', async () => {
  const slices = [
    ['ex-데카그라마톤-편-1장-지혜의-뱀', 'Ex. 데카그라마톤 편 1장 지혜의 뱀'],
    ['ex-데카그라마톤-편-2장-불타는-검', 'Ex. 데카그라마톤 편 2장 불타는 검'],
    ['ex-데카그라마톤-편-3장-합일의-하늘', 'Ex. 데카그라마톤 편 3장 합일의 하늘'],
    ['vol-0-총학생회-편-1장-살구꽃이-피는-어느-봄날에', 'Vol.0 총학생회 편 1장 살구꽃이 피는 어느 봄날에'],
    ['ex-로어추적-편-1장-정오의-아지랑이', 'Ex. 로어추적 편 1장 정오의 아지랑이'],
    ['ex-로어추적-편-2장-드럼통-속에-있는-것', 'Ex. 로어추적 편 2장 드럼통 속에 있는 것'],
  ] as const;
  const koSlices = `timeSlices:\n${slices.map(([id, label], index) => ` - id: ${id}\n   label: ${label}\n   position: ${index + 1}`).join('\n')}`;
  const englishSlices = await readFile(new URL('../../../apps/desktop/public/locales/en/timeline/time-slices.yaml', import.meta.url), 'utf8');
  const data = await loadWorld(createMemorySource({
    ...files,
    'timeline/time-slices.yaml': koSlices,
    'locales/en/timeline/time-slices.yaml': englishSlices,
  }), { language: 'en' });

  expect(data.timeSlices.map(slice => slice.label)).toEqual([
    'Volume EX: Decagrammaton — Chapter 1: Snake of Wisdom',
    'Volume EX: Decagrammaton — Chapter 2: Flaming Sword',
    'Volume EX: Decagrammaton — Chapter 3: The Sky of Unity',
    'Vol. 0: General Student Council — Chapter 1: A Spring Day Full of Apricot Blossoms',
    'Volume EX: Lore Pursuit — Chapter 1: High Noon Haze',
    "Volume EX: Lore Pursuit — Chapter 2: What's Inside the Drum Barrel",
  ]);
});

describe('world runtime',()=>{it('loads documents and validates package metadata',async()=>{const d=await loadWorld(createMemorySource(files)); expect(d.documents.get('aria-personality.md')).toBe('bright'); expect(validateWorld(d)).toEqual([]);}); it('protects hidden retrieval and builds character prompt',async()=>{const d=await loadWorld(createMemorySource(files)); const aria=d.entities.get('character:aria')! as import('@world-player/schema').Character; expect(filterKnowledge(d.entities.values(), aria.knowledge ?? []) .some(x=>x.id==='secret')).toBe(false); expect(filterKnowledge(d.entities.values(), []).length).toBe(0); expect(readDocument(d,'secret',[{target:'secret',access:'partial'}])).toBeUndefined(); expect(readDocument(d,'secret',aria.knowledge)).toBeUndefined(); expect(buildPrompt({data:d,world:d.world,character:aria as never,slice:d.timeSlices[0],player:{name:'P',description:'visitor'},visible:[] })).toContain('bright');});});
