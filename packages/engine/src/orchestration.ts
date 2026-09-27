/**
 * 순차 대화 실행기 — `dialogue.ts`의 턴 실행기를 감싼 호환 계층.
 * 새 코드는 `runConversationTurn`을 쓴다(발언 계획·샘플링·연속 발언 지원).
 */
import type { Character, ChatMessage, PlayerProfile, TimeSlice } from '@world-player/schema';
import { resolveNextSpeakers, type WorldData } from './core.js';
import { runConversationTurn, type SamplingOptions, type StreamingProvider } from './dialogue.js';

export type { ProviderMessage, SamplingOptions, StreamingProvider } from './dialogue.js';

/** 참가자 중 다음에 말할 캐릭터를 고른 뒤 순서대로 실행한다. */
export async function runSequentialConversation(input: {
  provider: StreamingProvider;
  data: WorldData;
  characters: Character[];
  slice: TimeSlice;
  player: PlayerProfile;
  input: string;
  history: ChatMessage[];
  model: string;
  sampling?: SamplingOptions;
  variation?: boolean;
  onText?: (speaker: Character, text: string) => void;
}): Promise<ChatMessage[]> {
  const speakers = resolveNextSpeakers({ participants: input.characters.map(character => character.id) }, input.characters, input.input);
  const plan = (speakers.length ? speakers : input.characters.slice(0, 1)).map(character => character.id);
  const result = await runConversationTurn({
    provider: input.provider, data: input.data, characters: input.characters, slice: input.slice, player: input.player,
    model: input.model, history: input.history, input: input.input, plan,
    sampling: input.sampling, variation: input.variation, onText: input.onText,
  });
  return result.history;
}
