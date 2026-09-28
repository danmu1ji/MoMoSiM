import type { ChatNode, Character, Entity } from '@world-player/schema';
import type { WorldData } from './core.js';

/**
 * 말풍선 상단 영역. 세계관 작성자가 캐릭터에 지정한 `chatImage`와
 * 모델이 응답에 넣은 `[[media:...]]` 지시문을 합쳐 하나의 표현으로 만든다.
 */
export interface PresentedMessage {
  /** 말풍선 최상단 사진(미디어 id). 없으면 사진 없이 텍스트만 표시한다. */
  image?: string;
  /** 이미지를 걷어낸 나머지 본문 노드. */
  text: ChatNode[];
}

function characterId(speakerId: string | undefined): string | undefined {
  if (!speakerId) return undefined;
  return speakerId.startsWith('character:') ? speakerId : `character:${speakerId}`;
}

/**
 * 발화자 표기에서 캐릭터를 찾는다. UI는 표시 이름('아리아')을 쓰고 저장 기록은 id('character:aria')를
 * 쓰므로 둘 다 받아준다.
 */
export function lookupSpeaker(data: WorldData | undefined, speaker: string | undefined): Character | undefined {
  if (!data || !speaker) return undefined;
  const direct = data.entities.get(characterId(speaker)!);
  if (direct) return direct as Character;
  return [...data.entities.values()].find(entity => entity.type === 'character' && (entity.name === speaker || entity.id === speaker)) as Character | undefined;
}

/**
 * 캐릭터의 말풍선 사진을 정한다.
 * 우선순위: 캐릭터에 지정한 `chatImage` → 같은 캐릭터의 메모리얼 로비 이미지 → 프로필(`banner`).
 * (`chatImage`를 지정하지 않아도 로비/프로필로 자연스럽게 대체된다.)
 */
export function resolveChatImage(data: WorldData | undefined, character: Character | Entity | undefined): string | undefined {
  if (!data || !character) return undefined;
  const chatImage = (character as Character).chatImage;
  if (chatImage && data.media.has(chatImage)) return chatImage;
  const slug = character.id.split(':')[1] ?? character.id;
  // 로비 id는 `lobby-shiroko`, `lobby-shiroko_swimsuit`, `lobby-shiroko-2` 처럼 접두/구분자가 섞인다.
  const candidates = [...data.media.values()]
    .map(asset => asset.id)
    .filter(id => id.startsWith('lobby-') && id.slice('lobby-'.length).match(new RegExp(`^${slug}([-_]|$)`)));
  const lobby = candidates.find(id => id.slice('lobby-'.length) === slug) ?? candidates[0];
  if (lobby) return lobby;
  return character.banner && data.media.has(character.banner) ? character.banner : undefined;
}

/**
 * 메시지 노드를 말풍선 상단 이미지와 본문으로 나눈다.
 * 모델이 이미지 지시문을 문장 중간에 넣어도 항상 상단에 고정되도록 여기서 끌어올린다.
 */
export function presentMessage(input: { data?: WorldData; character?: Character | Entity; speakerId?: string; nodes: ChatNode[] }): PresentedMessage {
  const fromNodes = input.nodes.filter(node => node.type === 'media' && node.asset);
  const text = input.nodes.filter(node => node.type !== 'media');

  const character = input.character ?? lookupSpeaker(input.data, input.speakerId);
  const fromCharacter = resolveChatImage(input.data, character);
  const image = fromNodes[0]?.asset && (!input.data || input.data.media.has(fromNodes[0].asset!)) ? fromNodes[0].asset : fromCharacter;

  return { image, text };
}
