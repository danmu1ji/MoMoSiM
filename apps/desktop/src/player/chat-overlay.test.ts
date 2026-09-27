import { describe, expect, it } from 'vitest';
import type { Character } from '@world-player/schema';

/** Mirrors the picker filter: name, id, summary and tags all match. */
function matches(character: Character, query: string): boolean {
  if (!query.trim()) return true;
  return [character.name, character.nameEn, character.id, character.summary, character.summaryEn, character.tags.join(' ')].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

const aria: Character = { id: 'character:aria', type: 'character', name: '아리아', nameEn: 'Aria', summary: '기억을 기록하는 기록관', summaryEn: 'Archivist at the harbor', tags: ['archivist'], relations: [] };
const borin: Character = { id: 'character:borin', type: 'character', name: '보린', summary: '항구를 지키는 파수꾼', tags: ['guard'], relations: [] };

describe('character picker search', () => {
  it('matches by name, id, summary and tag, and ignores case', () => {
    expect(matches(aria, '아리')).toBe(true);
    expect(matches(aria, 'Aria')).toBe(true);
    expect(matches(aria, 'Archivist at the harbor')).toBe(true);
    expect(matches(aria, 'ARCHIVIST')).toBe(true);
    expect(matches(aria, 'character:borin')).toBe(false);
    expect(matches(borin, '파수꾼')).toBe(true);
    expect(matches(borin, '기록관')).toBe(false);
  });

  it('treats an empty query as no filter', () => {
    expect(matches(aria, '')).toBe(true);
    expect(matches(borin, '   ')).toBe(true);
  });
});
