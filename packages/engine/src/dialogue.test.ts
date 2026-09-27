import { describe, expect, it } from 'vitest';
import type { Character, ChatMessage } from '@world-player/schema';
import { chooseSpeaker, inferMessageStyle, nextRoundPlan, parseNextDirective, planSpeakers, providerMessages, samplingFor, visibleText, runConversationTurn, runConversationCycle } from './dialogue';
import type { ProviderMessage, SamplingOptions } from './dialogue';
import type { WorldData } from './core';

const character = (id: string, name: string): Character => ({ id, type: 'character', name, tags: [], relations: [] });
const aria = character('character:aria', '아리아');
const borin = character('character:borin', '보린');
const cey = character('character:cey', '세이');
const names = new Map([[aria.id, aria.name], [borin.id, borin.name], [cey.id, cey.name]]);

/** 진행자 호출(시스템 프롬프트가 turn director)에는 이름/end를, 캐릭터 호출에는 대본을 돌려주는 스텁. */
function scriptedProvider(script: { director?: string; replies?: string[]; calls?: { system: string; messages: ProviderMessage[] }[] }) {
  let replyIndex = 0;
  return {
    createStream: async function* (request: { system: string; messages: ProviderMessage[] }) {
      script.calls?.push({ system: request.system, messages: [...request.messages] });
      if (request.system.toLowerCase().includes('turn director') || request.system.includes('진행 담당')) { yield { type: 'text' as const, text: script.director ?? 'end' }; return; }
      const reply = script.replies?.[replyIndex] ?? '끝';
      replyIndex += 1;
      yield { type: 'text' as const, text: reply };
    },
  };
}

const turn = (id: string, speaker: Character, text: string): ChatMessage => ({
  id, speaker: { type: 'character', id: speaker.id }, content: [{ type: 'text', text }], timestamp: '2026-01-01T00:00:00.000Z',
});
const playerTurn: ChatMessage = { id: 'u1', speaker: { type: 'player', id: '방문자' }, content: [{ type: 'text', text: '다들 안녕' }], timestamp: '2026-01-01T00:00:00.000Z' };

describe('대화 기록의 화자 표시', () => {
  it('플레이어 이미지 첨부를 OpenAI-compatible image_url parts로 전달한다', () => {
    const image: ChatMessage = { ...playerTurn, content: [{ type: 'text', text: '이 사진 봐' }, { type: 'image', imageDataUrl: 'data:image/png;base64,AAAA', alt: 'test.png' }] };
    const messages = providerMessages([image], aria, '방문자', names);
    expect(messages.at(-1)?.content).toEqual([{ type: 'text', text: '방문자: 이 사진 봐[이미지 첨부: test.png]' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' } }]);
  });

  it('다른 캐릭터의 발언은 이름이 붙은 user 메시지, 자기 발언은 assistant 로 보낸다', () => {
    const history = [playerTurn, turn('t1', aria, '안녕!'), turn('t2', borin, '어머, 반가워')];
    const forBorin = providerMessages(history, borin, '방문자', names);
    // 자기 말은 assistant 로 그대로
    expect(forBorin.filter(message => message.role === 'assistant').map(message => message.content)).toEqual(['어머, 반가워']);
    // 남의 말과 플레이어 말은 user 이고 누가 한 말인지 이름이 붙는다
    // 남의 말은 이어 붙여 한 덩어리(user)로 가되 발화자 이름은 유지한다
    expect(forBorin.filter(message => message.role === 'user').map(message => message.content)).toEqual(['방문자: 다들 안녕\n아리아: 안녕!']);
  });

  it('연속된 같은 역할은 한 덩어리로 합쳐 역할 교대를 지킨다', () => {
    const history = [playerTurn, turn('t1', aria, '안녕!'), turn('t2', borin, '반가워')];
    const messages = providerMessages(history, cey, '방문자', names);
    expect(messages.map(message => message.role)).toEqual(['user']);
    // 병합해도 각 발언의 이름은 남는다(누가 한 말인지 잃지 않는다)
    expect(messages[0].content).toContain('방문자: 다들 안녕');
    expect(messages[0].content).toContain('아리아: 안녕!');
    expect(messages.at(-1)?.content).toContain('보린: 반가워');
  });

  it('미디어 지시문은 지시문 형태로 남긴다', () => {
    const withMedia: ChatMessage = { id: 'm1', speaker: { type: 'character', id: aria.id }, content: [{ type: 'media', asset: 'lobby-aria' }, { type: 'text', text: '이 사진 봐' }], timestamp: '2026-01-01T00:00:00.000Z' };
    const messages = providerMessages([withMedia], aria, '방문자', names);
    expect(messages[0].content).toContain('[[media:lobby-aria]]');
  });
});

describe('캐릭터별 샘플링 값', () => {
  it('캐릭터마다 다르되 같은 캐릭터는 항상 같은 값을 받는다', () => {
    const base: SamplingOptions = { temperature: 1, frequencyPenalty: 0.35, presencePenalty: 0.15 };
    const first = samplingFor(aria.id, base);
    const again = samplingFor(aria.id, base);
    const other = samplingFor(borin.id, base);
    const third = samplingFor(cey.id, base);
    expect(first).toEqual(again);
    expect(new Set([first.temperature, other.temperature, third.temperature]).size).toBeGreaterThan(1);
    for (const value of [first, other, third]) {
      expect(value.temperature).toBeGreaterThanOrEqual(0.1);
      expect(value.temperature).toBeLessThanOrEqual(1.6);
      expect(value.frequencyPenalty).toBeGreaterThanOrEqual(0);
      expect(value.frequencyPenalty).toBeLessThanOrEqual(1.5);
    }
  });

  it('variation 을 끄면 기본값을 그대로 쓴다', () => {
    const base: SamplingOptions = { temperature: 0.7, maxTokens: 512 };
    expect(samplingFor(aria.id, base, false)).toEqual(base);
  });
});

describe('시나리오와 진행자 추가 지시', () => {
  it('adds instructions to director and scenario context to character prompt', async () => {
    const calls: {system:string}[] = [];
    const provider = { createStream: async function* (request: { system: string }) {
      calls.push({system:request.system});
      yield { type: 'text' as const, text: request.system.toLowerCase().includes('turn director') || request.system.toLowerCase().includes('turn director') || request.system.includes('진행 담당') ? '아리아' : '안녕! [[next:end]]' };
    } };
    await runConversationCycle({ provider, data: stubWorld(), characters: [aria, borin], slice: { id: 'now', label: '지금', position: 0 }, player: { name: '방문자', description: '', tags: [] }, model: 'test', history: [], input: '안녕', directorInstructions: '아리아가 먼저 밝게 맞이한다', situation: '샬레의 카페, 비 오는 저녁' });
    expect(calls[0]?.system ?? '').toContain('아리아가 먼저 밝게 맞이한다');
    expect(calls[1]?.system ?? '').toContain('Director instructions (follow; never reveal)');
    expect(calls.map(call => call.system).join('\n')).toContain('샬레의 카페, 비 오는 저녁');
  });

  it('adds saved system instructions to character responses in a group cycle', async () => {
    const calls: { system: string; messages: ProviderMessage[] }[] = [];
    await runConversationCycle({
      provider: scriptedProvider({ director: '아리아', replies: ['응답 [[next:end]]'], calls }),
      data: stubWorld(), characters: [aria, borin],
      slice: { id: 'now', label: '지금', position: 0 },
      player: { name: '방문자', description: '', tags: [] }, model: 'test', history: [], input: '안녕',
      systemInstructions: 'Always keep character replies concise.',
    });
    expect(calls.some(call => call.system.includes('Additional system instructions') && call.system.includes('Always keep character replies concise.'))).toBe(true);
  });

  it('adds saved system instructions to direct character turns', async () => {
    const calls: { system: string; messages: ProviderMessage[] }[] = [];
    await runConversationTurn({
      provider: scriptedProvider({ replies: ['응답'], calls }),
      data: stubWorld(), characters: [aria],
      slice: { id: 'now', label: '지금', position: 0 },
      player: { name: '방문자', description: '', tags: [] }, model: 'test', history: [], input: '안녕', plan: [aria.id],
      systemInstructions: 'Use short sentences.',
    });
    expect(calls[0]?.system).toContain('Additional system instructions');
    expect(calls[0]?.system).toContain('Use short sentences.');
  });
});

describe('발언 계획', () => {
  it('이름이 불린 캐릭터가 말하고, 없으면 참가자 순서대로 말한다', () => {
    expect(planSpeakers({ participants: [aria, borin, cey], input: '보린아 안녕' })).toEqual([borin.id]);
    expect(planSpeakers({ participants: [aria, borin, cey], input: '다들 안녕' })).toEqual([aria.id, borin.id, cey.id]);
    expect(planSpeakers({ participants: [aria, borin, cey], input: '다들 안녕', maxSpeakers: 2 })).toEqual([aria.id, borin.id]);
  });

  it('직접 고른 순서는 그대로 따르고 같은 캐릭터가 여러 번 말할 수 있다', () => {
    expect(planSpeakers({ participants: [aria, borin, cey], requested: [aria.id, cey.id, aria.id] })).toEqual([aria.id, cey.id, aria.id]);
  });

  it('다음 라운드는 마지막 화자 다음 사람부터 시작한다', () => {
    expect(nextRoundPlan([aria, borin, cey], [aria.id, borin.id, cey.id])).toEqual([aria.id, borin.id, cey.id]);
    expect(nextRoundPlan([aria, borin, cey], [aria.id])).toEqual([borin.id, cey.id, aria.id]);
  });
});

function stubWorld(): WorldData {
  return {
    world: { id: 'w', name: 'W', version: '1', summary: '', entrypoints: [], tags: [] },
    entities: new Map([aria, borin, cey].map(item => [item.id, item as never])),
    timeSlices: [{ id: 'now', label: '지금', position: 0 }],
    states: [], documents: new Map(), media: new Map(), assetFiles: new Set(), assetBytes: new Map(), packageFiles: new Map(), links: new Map(),
  } as unknown as WorldData;
}

describe('턴 실행', () => {
  const slice = { id: 'now', label: '지금', position: 0 };

  it('계획 순서대로 말하고(A B C A C) 각 발언이 다음 화자에게 전달된다', async () => {
    const requests: { system: string; messages: ProviderMessage[]; sampling?: SamplingOptions }[] = [];
    const provider = { createStream: async function* (request: { system: string; messages: ProviderMessage[]; sampling?: SamplingOptions }) { requests.push({ system: request.system, messages: [...request.messages], sampling: request.sampling }); yield { type: 'text' as const, text: `reply-${requests.length}` }; } };
    const plan = [aria.id, borin.id, cey.id, aria.id, cey.id];
    const result = await runConversationTurn({ provider, data: stubWorld(), characters: [aria, borin, cey], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '다들 안녕', plan });

    // 요청 순서 = 계획 순서(A B C A C)
    expect(requests.map(request => request.system.match(/You are (\S+)\./)?.[1])).toEqual(['아리아', '보린', '세이', '아리아', '세이']);
    expect(result.turns.map(item => item.speaker.id)).toEqual(plan);
    expect(result.history).toHaveLength(6); // 플레이어 + 5발언

    // 늦게 말하는 캐릭터는 앞선 모든 발언을 이름과 함께 받는다
    const lastRequest = requests.at(-1)!;
    expect(lastRequest.messages.some(message => message.content.includes('아리아: reply-1'))).toBe(true);
    expect(lastRequest.messages.some(message => message.content.includes('보린: reply-2'))).toBe(true);
    // 자기 발언은 접두사 없이 assistant 로 들어간다
    expect(lastRequest.messages.some(message => message.role === 'assistant' && message.content.includes('reply-3'))).toBe(true);
    // 두 번째 아리아(4번째 발언)에게는 그 시점까지의 발언이 들어간다
    const secondAria = requests[3];
    expect(secondAria.messages.some(message => message.content.includes('보린: reply-2'))).toBe(true);
    expect(secondAria.messages.some(message => message.content.includes('reply-4'))).toBe(false);

    // 캐릭터마다 샘플링 값이 다르게 실린다
    const temps = requests.map(request => request.sampling?.temperature);
    expect(new Set(temps).size).toBeGreaterThan(1);
  });

  it('이미 만든 플레이어 발언 객체를 넘기면 기록에 정확히 한 번만 들어간다', async () => {
    const requests: ProviderMessage[][] = [];
    const provider = { createStream: async function* (request: { messages: ProviderMessage[] }) { requests.push(request.messages); yield { type: 'text' as const, text: 'ok' }; } };
    const userTurn: ChatMessage = { id: 'u-1', speaker: { type: 'player', id: '방문자' }, content: [{ type: 'text', text: '안녕' }], timestamp: '2026-01-01T00:00:00.000Z' };
    const result = await runConversationTurn({ provider, data: stubWorld(), characters: [aria], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕', inputTurn: userTurn, plan: [aria.id] });
    expect(result.history.filter(item => item.speaker.type === 'player')).toHaveLength(1);
    expect(result.history[0].id).toBe('u-1');
    expect(requests[0].filter(message => message.content.includes('방문자: 안녕'))).toHaveLength(1);
  });

  it('input 없이도 이어 말할 수 있다(사용자 발언 추가 없음)', async () => {
    const provider = { createStream: async function* () { yield { type: 'text' as const, text: 'ok' }; } };
    const result = await runConversationTurn({ provider, data: stubWorld(), characters: [aria, borin], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], plan: [borin.id] });
    expect(result.turns).toHaveLength(1);
    expect(result.history).toHaveLength(1);
    expect(result.turns[0].speaker.id).toBe(borin.id);
  });
});

describe('턴 넘김 신호 (대화를 끝낼 시점은 캐릭터가 정한다)', () => {
  it('마지막 신호를 읽는다 — 이름 / 여러 명 / 종료', () => {
    expect(parseNextDirective('그럼 이만. [[next:보린]]')).toEqual({ names: ['보린'], end: false });
    expect(parseNextDirective('둘 다 들어봐. [[next:보린, 세이]]')).toEqual({ names: ['보린', '세이'], end: false });
    expect(parseNextDirective('이야기는 여기까지. [[next:end]]')).toEqual({ names: [], end: true });
    expect(parseNextDirective('[[next:보린]] 그리고 정리. [[next:end]]')).toEqual({ names: [], end: true });
    expect(parseNextDirective('신호 없는 답변')).toEqual({ names: [], end: false });
  });

  it('신호는 화면에 보이기 전에 제거된다(스트리밍 중 조각도 숨긴다)', () => {
    expect(visibleText('안녕! [[next:보린]]')).toBe('안녕!');
    expect(visibleText('안녕! [[next:보')).toBe('안녕!');
    expect(visibleText('안녕! [[')).toBe('안녕!');
    // 사진 지시문은 내용이므로 남긴다
    expect(visibleText('봐봐 [[media:lobby-aria]]')).toContain('[[media:lobby-aria]]');
    expect(visibleText('안녕 [[bubble]]선생님!')).toBe('안녕\n선생님!');
  });

  it('MomoTalk transcript statistics distinguish concise and fragment-heavy voices', () => {
    const style = inferMessageStyle(['- Yuuka: Hello, Sensei.', '- Yuuka: Do you remember me?', '- Yuuka: Well, that is a relief.', '- Yuuka: Thank you.'].join('\n'), ['Yuuka']);
    expect(style?.sentencesPerBubble).toBe(1);
    expect(style?.guidance).toContain('cadence sample (4 bubbles)');
    expect(inferMessageStyle('- Hoshino: This document contains no transcript lines.', ['Yuuka'])).toBeUndefined();
  });

  const slice = { id: 'now', label: '지금', position: 0 };

  it('캐릭터가 지목한 다음 화자로 이어지고, 종료 신호에서 멈춘다', async () => {
    const requests: { system: string; messages: ProviderMessage[] }[] = [];
    // 아리아 → 보린 → 세이 → 종료
    const replies = ['아리아입니다. [[next:보린]]', '보린입니다. [[next:세이]]', '세이입니다. [[next:end]]'];
    const provider = scriptedProvider({ director: '아리아', replies, calls: requests });
    const shown: string[] = [];
    const result = await runConversationCycle({
      provider, data: stubWorld(), characters: [aria, borin, cey], slice,
      player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '다들 안녕',
      plan: [aria.id], onText: (_speaker, text) => shown.push(text),
    });
    expect(result.turns.map(turn => turn.speaker.id)).toEqual([aria.id, borin.id, cey.id]);
    expect(result.endedBy).toBe('end');
    // 저장/표시되는 본문에는 신호가 남지 않는다
    expect(result.turns.map(turn => turn.content[0].text)).toEqual(['아리아입니다.', '보린입니다.', '세이입니다.']);
    expect(shown.some(text => text.includes('next'))).toBe(false);
    // 늦게 말하는 캐릭터는 앞선 발언을 이름과 함께 받는다
    // 두 번째 캐릭터 요청(진행자 호출 다음)은 앞선 발언을 이름과 함께 받는다
    expect(requests[2].messages.some(message => message.content.includes('아리아: 아리아입니다.'))).toBe(true);
    expect(requests[1].system).toContain('그룹 대화 진행 규칙');
  });

  it('후속 화자 요청이 실패해도 이미 끝난 캐릭터 응답은 반환한다', async () => {
    let calls = 0;
    const provider = { createStream: async function* () {
      calls += 1;
      if (calls === 1) { yield { type: 'text' as const, text: '첫 응답입니다. [[next:보린]]' }; return; }
      throw new Error('provider unavailable');
    } };
    const result = await runConversationCycle({
      provider, data: stubWorld(), characters: [aria, borin], slice,
      player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕', plan: [aria.id],
    });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].speaker.id).toBe(aria.id);
    expect(result.endedBy).toBe('error');
    expect(result.error?.message).toBe('provider unavailable');
  });

  it('splits a long character answer into natural two-sentence bubbles', async () => {
    const provider = scriptedProvider({ director: '아리아', replies: ['One. Two. Three. Four. Five. [[next:end]]'] });
    const result = await runConversationCycle({
      provider, data: stubWorld(), characters: [aria], slice,
      player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕', plan: [aria.id],
    });
    expect(result.turns.map(turn => turn.content[0].text)).toEqual(['One. Two.', 'Three. Four.', 'Five.']);
  });

  it('2인 대화에서 "A가 B를 지목 → B가 A를 지목 → A가 정리" 흐름이 중복 없이 진행된다', async () => {
    // 사용자 시나리오: [user: 연필 있어?] A: 난 없는데, B 넌 있어? → B: 나도 없는데, 네 서랍 찾아봐 → A: 알겠어.
    const replies = [
      '나는 없는데, 보린 넌 있어? [[next:보린]]',
      '나도 없는데, 네 서랍 찾아봐. [[next:아리아]]',
      '알겠어, 찾아볼게. [[next:end]]',
    ];
    const speakers: string[] = [];
    // 발화자 통지는 스트리밍보다 먼저 오므로, 호출 순서는 별도 카운터로 센다.
    const provider = scriptedProvider({ director: '아리아', replies });
    const result = await runConversationCycle({
      provider, data: stubWorld(), characters: [aria, borin], slice,
      player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '연필 있어?', plan: [aria.id],
      onSpeaker: speaker => speakers.push(speaker.name),
    });
    // A → B → A (B가 두 번 말하지 않는다)
    expect(speakers).toEqual(['아리아', '보린', '아리아']);
    expect(result.endedBy).toBe('end');
    expect(result.turns.map(turn => turn.content[0].text)).toEqual(['나는 없는데, 보린 넌 있어?', '나도 없는데, 네 서랍 찾아봐.', '알겠어, 찾아볼게.']);
  });

  it('신호가 없으면 그 홉에서 끝난다(무한히 이어지지 않는다)', async () => {
    let calls = 0;
    const provider = { createStream: async function* (request: { system: string }) { if (request.system.toLowerCase().includes('turn director')) { yield { type: 'text' as const, text: '아리아' }; return; } calls += 1; yield { type: 'text' as const, text: '신호 없음' }; } };
    const result = await runConversationCycle({ provider, data: stubWorld(), characters: [aria, borin], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕' });
    expect(calls).toBe(1);
    expect(result.endedBy).toBe('empty');
  });

  it('상한에 도달하면 멈춘다(신호가 계속 이어져도)', async () => {
    let calls = 0;
    const provider = { createStream: async function* (request: { system: string }) { if (request.system.toLowerCase().includes('turn director')) { yield { type: 'text' as const, text: '보린' }; return; } calls += 1; yield { type: 'text' as const, text: '계속. [[next:보린]]' }; } };
    const result = await runConversationCycle({ provider, data: stubWorld(), characters: [aria, borin], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕', plan: [aria.id], maxSpeakersPerCycle: 3 });
    expect(calls).toBe(3);
    expect(result.endedBy).toBe('budget');
  });

  it('멈추기 요청이 오면 그 자리에서 끝난다', async () => {
    let calls = 0;
    const provider = { createStream: async function* (request: { system: string }) { if (request.system.toLowerCase().includes('turn director')) { yield { type: 'text' as const, text: '아리아' }; return; } calls += 1; yield { type: 'text' as const, text: '계속. [[next:보린]]' }; } };
    const result = await runConversationCycle({ provider, data: stubWorld(), characters: [aria, borin], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕', plan: [aria.id], shouldStop: () => calls >= 2 });
    expect(calls).toBe(2);
    expect(result.endedBy).toBe('stop');
  });
});

describe('진행자 — 누가 먼저 말할지도 캐릭터들이 정한다', () => {
  const slice = { id: 'now', label: '지금', position: 0 };

  it('진행자 호출로 첫 화자를 정하고, 그 캐릭터가 한 번만 답하고 턴을 끝낼 수 있다', async () => {
    const calls: { system: string; messages: ProviderMessage[] }[] = [];
    const provider = scriptedProvider({ director: '보린', replies: ['나 혼자만 답할게. [[next:end]]'], calls });
    provider.createStream = async function* (request: { system: string; messages: ProviderMessage[] }) { calls.push({ system: request.system, messages: [...request.messages] }); yield { type: 'text' as const, text: request.system.toLowerCase().includes('turn director') || request.system.includes('Turn director') ? '보린' : '나 혼자만 답할게. [[next:end]]' }; };
    const speakers: string[] = [];
    const result = await runConversationCycle({
      provider, data: stubWorld(), characters: [aria, borin, cey], slice,
      player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '보린 있어?',
      onSpeaker: speaker => speakers.push(speaker.name),
    });
    // 진행자 호출 1회 + 캐릭터 발언 1회 = 2회. 아리아·세이는 말하지 않는다.
    expect(calls).toHaveLength(2);
    expect(calls[0].system).toContain('turn director');
    expect(calls[1].system).toContain('그룹 대화 진행 규칙');
    expect(speakers).toEqual(['보린']);
    expect(result.endedBy).toBe('end');
  });

  it('진행자가 end 라고 하면 아무도 답하지 않고 턴이 끝난다', async () => {
    const provider = scriptedProvider({ director: 'end' });
    const result = await runConversationCycle({ provider, data: stubWorld(), characters: [aria, borin, cey], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '...' });
    expect(result.turns).toHaveLength(0);
    expect(result.endedBy).toBe('empty');
  });

  it('참가자가 한 명뿐이면 진행자 호출을 건너뛴다(고를 것이 없다)', async () => {
    let calls = 0;
    const provider = { createStream: async function* () { calls += 1; yield { type: 'text' as const, text: '혼자 답할게. [[next:end]]' }; } };
    const result = await runConversationCycle({ provider, data: stubWorld(), characters: [aria], slice, player: { name: '방문자', description: '', tags: [] }, model: 'stub', history: [], input: '안녕' });
    expect(calls).toBe(1);
    expect(result.turns).toHaveLength(1);
  });

  it('진행자 응답에서 이름을 찾고, 이름이 없으면 종료로 본다', async () => {
    const nameOnly = { createStream: async function* () { yield { type: 'text' as const, text: '세이' }; } };
    expect(await chooseSpeaker({ provider: nameOnly, model: 'm', characters: [aria, borin, cey], playerName: '방문자', history: [] })).toMatchObject({ id: cey.id, end: false });
    const verbose = { createStream: async function* () { yield { type: 'text' as const, text: '가장 관련 있는 사람은\n보린' }; } };
    expect((await chooseSpeaker({ provider: verbose, model: 'm', characters: [aria, borin, cey], playerName: '방문자', history: [] })).id).toBe(borin.id);
    const nothing = { createStream: async function* () { yield { type: 'text' as const, text: '알 수 없음' }; } };
    expect((await chooseSpeaker({ provider: nothing, model: 'm', characters: [aria, borin, cey], playerName: '방문자', history: [] })).end).toBe(true);
  });
});
