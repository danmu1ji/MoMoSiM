import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exportWorldPackage, validateWorld } from '../../packages/engine/src/index.ts';
import { importMarkdownFolder, importReport, slugify } from './index';

const folder: Record<string, string> = {
  'characters/aria.md': '---\ntitle: 아리아\ntype: character\ntags: [기록관, 항구]\n---\n\n기억을 기록하는 낙천적인 기록관.\n\n[[location:harbor]] 와 [[character:borin]] 를 안다.\n',
  'locations/harbor.md': '---\ntype: location\nsummary: 배가 드나드는 항구\n---\n\n항구 문서 본문.\n',
  'characters/borin.md': '# 보린\n\n항구를 지키는 파수꾼.\n',
  'notes.txt': 'not markdown, ignored',
};

describe('markdown importer', () => {
  it('turns a markdown folder into a valid world package', () => {
    const data = importMarkdownFolder(folder, { id: 'imported-world', name: '가져온 세계관' });
    expect(importReport(data)).toEqual([]);
    expect(validateWorld(data).filter(issue => issue.level === 'error')).toEqual([]);
    expect(data.entities.get('character:aria')?.tags).toEqual(['기록관', '항구']);
    expect(data.entities.get('location:harbor')?.type).toBe('location');
    expect(data.entities.get('character:borin')?.name).toBe('보린');
    expect(data.entities.get('character:aria')?.relations.map(relation => relation.target)).toEqual(['location:harbor', 'character:borin']);
    expect(data.world.entrypoints).toContain('character:aria');
    expect(data.links.get('character:aria')).toEqual(['location:harbor', 'character:borin']);
    expect(data.documents.has('notes.txt')).toBe(false);
  });

  it('exports the imported documents unchanged', () => {
    const data = importMarkdownFolder(folder, { id: 'imported-world', name: '가져온 세계관' });
    const archive = unzipSync(exportWorldPackage(data));
    expect(strFromU8(archive['characters/aria.md'])).toContain('[[location:harbor]]');
    expect(strFromU8(archive['index/entities.yaml'])).toContain('location:harbor');
    expect(strFromU8(archive['world.yaml'])).toContain('imported-world');
  });

  it('removes unsupported audio directives without turning them into entity links', () => {
    const data = importMarkdownFolder({ 'characters/aria.md': '---\ntype: character\n---\n# Aria\n\nHello. [[audio:old-voice-id]]\n' }, { id: 'audio-free', name: 'Audio free' });
    expect(data.documents.get('characters/aria.md')).not.toContain('[[audio:');
    expect(data.entities.get('character:aria')?.relations).toEqual([]);
  });

  it('declares the link target ids it expects and slugs non-Latin names', () => {
    expect(slugify('항구 기록')).toBe('항구-기록');
    expect(slugify('  A/B  ')).toBe('a-b');
  });
});
