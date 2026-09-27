import type { ChatNode, Character, Entity } from '@world-player/schema';
import type { WorldData } from './core.js';

/**
 * 말풍선 상단 영역. 세계관 작성자가 캐릭터에 지정한 `chatImage`/`voice`와,
 * 모델이 응답에 넣은 `[[media:...]]`/`[[audio:...]]` 지시문을 합쳐 하나의 표현으로 만든다.
 */
export interface PresentedMessage {
  /** 말풍선 최상단 사진(미디어 id). 없으면 사진 없이 텍스트만 표시한다. */
  image?: string;
  /** 최상단 재생 버튼으로 표시할 음성(미디어 id 배열). 비어 있으면 음성 없음. */
  audio: string[];
  /** 사진·음성을 걷어낸 나머지 본문 노드. */
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

/** 캐릭터에 지정된 음성 자산(참고용). 답변에 자동으로 붙지는 않는다 — 캐릭터가 고를 때만 재생된다. */
export function defaultVoice(data: WorldData | undefined, character: Character | Entity | undefined): string | undefined {
  const voice = (character as Character | undefined)?.voice;
  return data && voice && data.media.has(voice) ? voice : undefined;
}

/**
 * 메시지 노드를 말풍선 상단(사진·음성)과 본문으로 나눈다.
 * 모델이 지시문을 문장 중간에 넣어도 항상 상단에 고정되도록 여기서 끌어올린다(hoist).
 */
export function presentMessage(input: { data?: WorldData; character?: Character | Entity; speakerId?: string; nodes: ChatNode[] }): PresentedMessage {
  const fromNodes = input.nodes.filter(node => node.type === 'media' && node.asset);
  const audio = input.nodes.filter(node => node.type === 'audio' && node.asset).map(node => node.asset!).filter(asset => !input.data || input.data.media.has(asset));
  const text = input.nodes.filter(node => node.type !== 'media' && node.type !== 'audio');

  const character = input.character ?? lookupSpeaker(input.data, input.speakerId);
  const fromCharacter = resolveChatImage(input.data, character);
  const image = fromNodes[0]?.asset && (!input.data || input.data.media.has(fromNodes[0].asset!)) ? fromNodes[0].asset : fromCharacter;

  // 예전에는 답변에 음성이 없으면 캐릭터의 기본 음성을 자동으로 붙였다. 그 결과 말할 필요가 없는
  // 답변에도 재생 버튼이 항상 따라붙었다. 지금은 **캐릭터가 명시적으로 고른 경우에만** 음성이 붙는다.
  // 상단 재생 버튼은 하나만 — 모델이 여러 지시문을 내도 말풍선이 플레이어로 뒤덮이지 않게 한다.
  return { image, audio: audio.slice(0, 1), text };
}
