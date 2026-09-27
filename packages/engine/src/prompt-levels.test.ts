import { describe, expect, it } from 'vitest';
import { buildPrompt, knowledgeLevels } from './core';
import type { Character, Entity, KnowledgeRule, TimeSlice } from '@world-player/schema';

const entities: Entity[] = [
  { id: 'character:aria', type: 'character', name: '아리아', summary: '기록관', tags: [], relations: [] },
  { id: 'category:harbor', type: 'category', name: '항구 구역', summary: '중심 구역', tags: [], relations: [] },
  { id: 'location:secret-vault', type: 'location', name: '비밀 금고', summary: '지하', tags: [], relations: [] },
];
const slice: TimeSlice = { id: 'now', label: '지금', position: 0 };

describe('prompt fog levels', () => {
  it('labels partial and public knowledge so the character can hedge', () => {
    const rules: KnowledgeRule[] = [
      { target: 'character:aria', access: 'full' },
      { target: 'category:harbor', access: 'partial' },
      { target: 'location:secret-vault', access: 'hidden' },
    ];
    const levels = knowledgeLevels(entities, rules, { timeSlice: 'now' });
    expect(levels.get('character:aria')).toBe('full');
    expect(levels.get('category:harbor')).toBe('partial');
    expect(levels.has('location:secret-vault')).toBe(false);
    const prompt = buildPrompt({ world: { id: 'w', name: 'W', version: '1', summary: '', entrypoints: [], tags: [] }, character: entities[0] as Character, slice, player: { name: 'P', description: 'd' }, visible: entities.slice(0, 2), levels });
    expect(prompt).toContain('- 아리아: 기록관');
    expect(prompt).toContain('- 항구 구역 (Fog: partial');
    expect(prompt).not.toContain('비밀 금고');
  });

  it('does not label entities without a level', () => {
    const prompt = buildPrompt({ world: { id: 'w', name: 'W', version: '1', summary: '', entrypoints: [], tags: [] }, character: entities[0] as Character, slice, player: { name: 'P', description: 'd' }, visible: [entities[0]] });
    expect(prompt).toContain('- 아리아: 기록관');
    expect(prompt).not.toContain('Fog: partial');
  });
});
