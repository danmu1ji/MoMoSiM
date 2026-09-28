import { describe, expect, it } from 'vitest';
import { eventMemory, mediaDirectives, buildPrompt } from './core';
import { presentMessage, resolveChatImage } from './presentation';
import type { Character, ChatNode, Entity } from '@world-player/schema';
import type { WorldData } from './core';

const media = new Map([
  ['banner-aria', { id: 'banner-aria', file: 'assets/images/banner-aria.png', kind: 'profile' as const, description: '아리아 프로필', tags: [] }],
  ['lobby-aria', { id: 'lobby-aria', file: 'assets/images/lobby-aria.jpg', kind: 'illustration' as const, description: '아리아 로비', tags: [] }],
  ['lobby-aria_night', { id: 'lobby-aria_night', file: 'assets/images/lobby-aria_night.jpg', kind: 'illustration' as const, description: '아리아(야간) 로비', tags: [] }],
]);

const character: Character = {
  id: 'character:aria', type: 'character', name: '아리아', tags: [], relations: [],
  banner: 'banner-aria', chatImage: 'lobby-aria',
};
const data = { media, entities: new Map<string, Entity>([[character.id, character]]) } as unknown as WorldData;

describe('chat presentation', () => {
  it('keeps the profile image and the chat image separate', () => {
    expect(character.banner).toBe('banner-aria');
    expect(resolveChatImage(data, character)).toBe('lobby-aria');
    // chatImage가 없으면 같은 캐릭터의 메모리얼 로비로, 로비도 없으면 프로필로 대체된다
    const noChatImage: Character = { ...character, chatImage: undefined };
    expect(resolveChatImage(data, noChatImage)).toBe('lobby-aria');
    const noLobby = new Map([...media].filter(([id]) => !id.startsWith('lobby-')));
    expect(resolveChatImage({ media: noLobby, entities: data.entities } as unknown as WorldData, noChatImage)).toBe('banner-aria');
  });

  it('falls back to any variant lobby when the base lobby is missing', () => {
    const onlyVariant: Character = { ...character, chatImage: undefined, banner: undefined };
    expect(resolveChatImage({ media: new Map([...media].filter(([id]) => id !== 'lobby-aria')) as WorldData['media'], entities: data.entities } as unknown as WorldData, onlyVariant)).toBe('lobby-aria_night');
  });

  it('hoists the image to the top and keeps the dialogue text', () => {
    const nodes: ChatNode[] = [
      { type: 'text', text: '안녕.' },
      { type: 'lineBreak' },
      { type: 'media', asset: 'lobby-aria_night' },
      { type: 'strong', text: '중요한 말' },
    ];
    const presented = presentMessage({ data, character, nodes });
    expect(presented.image).toBe('lobby-aria_night');       // 응답에 든 사진이 캐릭터 기본 사진을 이긴다
    expect(presented.text.map(node => node.type)).toEqual(['text', 'lineBreak', 'strong']);
  });

  it('finds the speaker by display name as well as by entity id', () => {
    const byName = presentMessage({ data, speakerId: '아리아', nodes: [{ type: 'text', text: '…' }] });
    expect(byName.image).toBe('lobby-aria');
    const byId = presentMessage({ data, speakerId: 'character:aria', nodes: [{ type: 'text', text: '…' }] });
    expect(byId.image).toBe('lobby-aria');
  });

  it('never attaches media to a player message', () => {
    const presented = presentMessage({ data, nodes: [{ type: 'text', text: '플레이어 발화' }] });
    expect(presented.image).toBeUndefined();
  });
});

describe('prompt media directives', () => {
  it('offers the chat image without audio directives', () => {
    const section = mediaDirectives(data, character);
    expect(section).toContain('[[media:lobby-aria]]');
    expect(section).not.toContain('audio');
    const prompt = buildPrompt({ data, world: { id: 'w', name: 'W', version: '1', summary: '', entrypoints: [], tags: [] }, character, slice: { id: 'now', label: '지금', position: 0 }, player: { name: 'P', description: 'd' }, visible: [] });
    expect(prompt).toContain('[[media:lobby-aria]]');
  });

  it('injects the remembered event detail into the prompt', () => {
    const event: Entity = { id: 'event:c1', type: 'event', name: '1장 — 항구의 첫 날', markdown: 'events/c1.md', tags: [], relations: [] };
    const withEvent = { media, entities: data.entities, documents: new Map([['events/c1.md', '플레이어가 항구 구역에서 길을 잃고, 아리아가 그를 구해 기록 보존소로 데려간다. 보린이 조사를 마치고 돌아오는 길에 밀수업자에게 붙잡히고, 플레이어와 두 사람이 함께 그를 구출한다. 이후 외부 용병의 개입이 드러난다.']]) } as unknown as WorldData;
    const memory = eventMemory(withEvent, [event]);
    expect(memory).toContain('1장 — 항구의 첫 날');
    expect(memory).toContain('밀수업자에게 붙잡히고');
    const prompt = buildPrompt({ data: withEvent, world: { id: 'w', name: 'W', version: '1', summary: '', entrypoints: [], tags: [] }, character, slice: { id: 'now', label: '지금', position: 0 }, player: { name: 'P', description: 'd' }, visible: [event] });
    expect(prompt).toContain('Events you remember');
    // 예산을 넘으면 더 넣지 않는다
    expect(eventMemory(withEvent, [event], { budget: 10 })).toBe('');
  });

  it('puts events before lore documents in the memory budget', () => {
    const lore: Entity = { id: 'category:harbor', type: 'category', name: '항구 구역', markdown: 'lore/harbor.md', tags: [], relations: [] };
    const event: Entity = { id: 'event:c1', type: 'event', name: '1장 — 항구의 첫 날', markdown: 'events/c1.md', tags: [], relations: [] };
    const world = {
      media, entities: data.entities,
      documents: new Map([
        ['lore/harbor.md', '항구 구역은 조사 기지다. '.repeat(40)],
        ['events/c1.md', '아리아의 보고를 받은 플레이어가 항구 구역으로 향하고, 아리아가 조난당한 플레이어를 구한다. 밀수업자가 기지를 습격한다.'],
      ]),
    } as unknown as WorldData;
    const memory = eventMemory(world, [lore, event]);
    expect(memory.indexOf('1장 — 항구의 첫 날')).toBeLessThan(memory.indexOf('항구 구역:'));
  });

  it('omits the section for worlds without media', () => {
    expect(mediaDirectives(undefined, character)).toBe('');
  });
});
