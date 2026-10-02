import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { placeholderBanner, danglingBanner, hasBanner, resolveBanner } from './banner';
import { breadcrumbFor, browseState, categoryRoots, charactersInCategory, charactersUnder, subcategoriesOf } from './navigation';
import { bannerAssetId, createPackageSource, exportWorldPackage, exportWorldPackageAsync, loadWorld, validateWorld } from './index';
import type { Entity } from '@world-player/schema';

const archive = decodeURIComponent(new URL('../../../worlds/examples/echo-world.😭', import.meta.url).pathname);

const entities: Entity[] = [
  { id: 'category:harbor', type: 'category', name: '항구 구역', summary: '중심 구역', tags: [], relations: [] },
  { id: 'category:records', type: 'category', name: '기록 보관소', parent: 'category:harbor', tags: [], relations: [] } as Entity,
  { id: 'category:outer', type: 'category', name: '외곽', tags: [], relations: [] },
  { id: 'character:aria', type: 'character', name: '아리아', categories: ['category:records'], tags: [], relations: [] },
  { id: 'character:borin', type: 'character', name: '보린', categories: ['category:harbor'], tags: [], relations: [] },
];

describe('browse navigation', () => {
  it('keeps package order and exposes roots, subcategories and nested characters', () => {
    expect(categoryRoots(entities).map(entity => entity.id)).toEqual(['category:harbor', 'category:outer']);
    expect(subcategoriesOf(entities, 'category:harbor').map(entity => entity.id)).toEqual(['category:records']);
    expect(charactersInCategory(entities, 'category:harbor').map(entity => entity.id)).toEqual(['character:borin']);
    expect(charactersUnder(entities, 'category:harbor').map(entity => entity.id)).toEqual(['character:borin', 'character:aria']);
    expect(breadcrumbFor(entities, 'category:records').map(entity => entity.id)).toEqual(['category:harbor', 'category:records']);
  });

  it('never exposes a character twice when nested categories overlap', () => {
    const overlapping = [...entities, { id: 'character:both', type: 'character', name: '둘 다', categories: ['category:harbor', 'category:records'], tags: [], relations: [] } as Entity];
    const ids = charactersUnder(overlapping, 'category:harbor').map(entity => entity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('placeholder banners',()=>{it('uses only the three monochrome colours and is deterministic',()=>{const first=placeholderBanner('항구 구역','category'); const second=placeholderBanner('항구 구역','category'); expect(first).toBe(second); expect(first.startsWith('data:image/svg+xml;utf8,')).toBe(true); const svg=decodeURIComponent(first.split(',')[1]); for(const colour of ['#000000','#808080','#ffffff']) expect(svg).toContain(colour); expect(svg).not.toMatch(/#(?!000000|808080|ffffff)[0-9a-fA-F]{3,6}/); expect(svg).toContain('PLACEHOLDER');});it('gives characters colorful, name-specific illustrated portrait fallbacks',()=>{const first=placeholderBanner('유우카','character'); const second=placeholderBanner('유우카','character'); expect(first).toBe(second); const svg=decodeURIComponent(first.split(',')[1]); expect(svg).toContain('<linearGradient'); expect(svg).toContain('유우카'); expect(svg).not.toContain('PLACEHOLDER'); expect(placeholderBanner('아리스','character')).not.toBe(first);});});

describe('banner resolution',()=>{it('prefers a packaged asset and falls back to a placeholder',async()=>{// 지연 로딩이 기본이므로 동기 resolveBanner는 플레이스홀더를 돌려주고, 실제 자산은 bannerAssetId로 알린다.
    const lazy=await loadWorld(await createPackageSource(archive)); expect(bannerAssetId(lazy,lazy.world)).toBeTruthy();
    // 자산을 즉시 올린(eager) 경우에는 기존처럼 실제 URL을 돌려준다.
    const data=await loadWorld(await createPackageSource(archive),{eagerAssets:true}); const world=resolveBanner(data,data.world,'world'); expect(world.placeholder).toBe(false); const fallback=resolveBanner(data,{name:'없는 배너',banner:'missing-asset'},'category'); expect(fallback.placeholder).toBe(true); expect(danglingBanner(data,{banner:'missing-asset'})).toBe('missing-asset'); expect(danglingBanner(data,data.world)).toBeUndefined(); expect(hasBanner(data.entities.values())).toBe(true);});});

describe('example world browse flow',()=>{it('every category and character has a usable banner and appears in the tree',async()=>{const data=await loadWorld(await createPackageSource(archive)); const state=browseState(data); expect(state.roots.length).toBeGreaterThan(0); for(const root of state.roots){expect(resolveBanner(data,root,'category').url.length).toBeGreaterThan(0); const sub=browseState(data,root.id); expect(sub.trail.map(entity=>entity.id)).toEqual([root.id]);} for(const character of [...data.entities.values()].filter(entity=>entity.type==='character')) expect(resolveBanner(data,character,'character').url.length).toBeGreaterThan(0); expect(validateWorld(data).filter(issue=>issue.code==='MISSING_BANNER')).toEqual([]);});});

describe('banner round trip',()=>{it('keeps banner references through export',async()=>{const data=await loadWorld(await createPackageSource(archive)); const files=unzipSync((await exportWorldPackageAsync(data))); expect(strFromU8(files['index/entities.yaml'])).toContain('banner:'); expect(strFromU8(files['world.yaml'])).toContain('banner:');});});
