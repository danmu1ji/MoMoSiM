import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@world-player/schema';
import { clearConversationMemory, compactConversation, compactableHistory, historyAfterCompaction, loadConversationMemory, shouldCompactForContext } from './conversation-memory';

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
}

function history(size: number, firstText = 'turn'): ChatMessage[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `m${index}`, speaker: index % 2 ? { type: 'character' as const, id: 'character:yuuka' } : { type: 'player' as const, id: 'User' },
    content: [{ type: 'text' as const, text: index === 0 ? firstText : 'turn' }], timestamp: new Date(index * 1000).toISOString(),
  }));
}

describe('conversation memory compaction', () => {
  it('uses the selected model context window and a strict 10% remaining threshold', () => {
    expect(shouldCompactForContext(100_000, 89_999)).toBe(false);
    expect(shouldCompactForContext(100_000, 90_001)).toBe(true);
    expect(shouldCompactForContext(200_000, 180_001)).toBe(true);
    expect(shouldCompactForContext(100_000, 80_000, 20_000)).toBe(true);
    expect(shouldCompactForContext(0, 0)).toBe(false);
  });

  it('keeps the latest 40 turns and only advances through complete summarized turns', () => {
    const turns = history(81);
    const selected = compactableHistory(turns);
    expect(selected).toHaveLength(41);
    expect(historyAfterCompaction(turns, { summary: 'note', throughMessageId: selected.at(-1)!.id, updatedAt: '' })).toHaveLength(40);
  });

  it('chunks an oversized single turn when it fits the bounded provider budget', () => {
    expect(compactableHistory(history(81, 'x'.repeat(60_000))).map(turn => turn.id)).toEqual(['m0']);
  });

  it('reports an uncompactable oversized turn instead of silently skipping memory', async () => {
    installLocalStorage();
    const createStream = vi.fn(async function* () { yield { type: 'text', text: 'should not run' }; });
    await expect(compactConversation({ worldId: 'w', conversationId: 'too-large', history: history(81, 'x'.repeat(80_000)), provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0 })).rejects.toThrow(/too large to summarize/);
    expect(createStream).not.toHaveBeenCalled();
  });

  it('reports continuation marker overhead at the four-batch boundary', async () => {
    installLocalStorage();
    const createStream = vi.fn(async function* () { yield { type: 'text', text: 'should not run' }; });
    await expect(compactConversation({ worldId: 'w', conversationId: 'four-batch-limit', history: history(81, 'x'.repeat(71_990)), provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0 })).rejects.toThrow(/too large to summarize/);
    expect(createStream).not.toHaveBeenCalled();
  });

  it('processes an oversized turn in bounded chunks and stores a world-scoped summary', async () => {
    installLocalStorage();
    const createStream = vi.fn(async function* () { yield { type: 'text', text: 'continuity note' }; });
    const turns = history(81, 'important '.repeat(4000));
    const memory = await compactConversation({
      worldId: 'world-one', conversationId: 'ba-character:yuuka', history: turns,
      provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0,
    });
    expect(createStream.mock.calls.length).toBeGreaterThan(1);
    expect(memory?.throughMessageId).toBe('m0');
    expect(loadConversationMemory('world-one', 'ba-character:yuuka')).toEqual(memory);
    expect(loadConversationMemory('world-two', 'ba-character:yuuka')).toBeUndefined();
  });

  it('does not recreate deleted memory when an in-flight compaction finishes', async () => {
    installLocalStorage();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const createStream = () => (async function* () { await waiting; yield { type: 'text', text: 'stale note' }; })();
    const pending = compactConversation({ worldId: 'w', conversationId: 'c', history: history(81), provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0 });
    await Promise.resolve();
    await clearConversationMemory('w', 'c');
    release();
    await pending;
    expect(loadConversationMemory('w', 'c')).toBeUndefined();
  });

  it('honors a deletion from another tab while compaction is in flight', async () => {
    installLocalStorage();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const createStream = () => (async function* () { await waiting; yield { type: 'text', text: 'stale note' }; })();
    const pending = compactConversation({ worldId: 'w', conversationId: 'cross-tab', history: history(81), provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0 });
    await Promise.resolve();
    const key = JSON.stringify(['w', 'cross-tab']);
    localStorage.setItem('world-player.conversation-memory-versions.v1', JSON.stringify({ [key]: 'another-tab-reset' }));
    release();
    await pending;
    expect(loadConversationMemory('w', 'cross-tab')).toBeUndefined();
  });

  it('reports storage write failures instead of returning an unsaved summary', async () => {
    installLocalStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: () => undefined,
    } });
    const createStream = async function* () { yield { type: 'text', text: 'continuity note' }; };
    await expect(compactConversation({ worldId: 'w', conversationId: 'write-failure', history: history(81), provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0 })).rejects.toThrow();
  });

  it('fails closed when reset generations cannot be persisted', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: () => undefined,
    } });
    await expect(clearConversationMemory('w', 'reset-failure')).rejects.toThrow(/reset generation/);
  });

  it('does not compact stale loaded history after a reset generation changes', async () => {
    installLocalStorage();
    const createStream = vi.fn(async function* () { yield { type: 'text', text: 'should not run' }; });
    const expectedGeneration = 'before-reset';
    await clearConversationMemory('w', 'stale-history');
    const memory = await compactConversation({ worldId: 'w', conversationId: 'stale-history', history: history(81), expectedGeneration, provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 1_000, estimatedPromptTokens: 950, responseReserveTokens: 0 });
    expect(memory).toBeUndefined();
    expect(createStream).not.toHaveBeenCalled();
  });

  it('skips compaction while more than 10% of the model context remains', async () => {
    installLocalStorage();
    const createStream = vi.fn(async function* () { yield { type: 'text', text: 'should not run' }; });
    const memory = await compactConversation({ worldId: 'w', conversationId: 'below-threshold', history: history(100), provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 100_000, estimatedPromptTokens: 80_000, responseReserveTokens: 0 });
    expect(memory).toBeUndefined();
    expect(createStream).not.toHaveBeenCalled();
  });

  it('compacts large short histories by summarizing older turns and keeping the recent half', async () => {
    installLocalStorage();
    const createStream = vi.fn(async function* () { yield { type: 'text', text: 'continuity note' }; });
    const turns = history(6);
    for (const turn of turns) turn.content = [{ type: 'text', text: 'large conversation content '.repeat(120) }];
    const memory = await compactConversation({ worldId: 'w', conversationId: 'short-large', history: turns, provider: { createStream }, model: 'test', language: 'en', contextWindowTokens: 10_000, estimatedPromptTokens: 9_500, responseReserveTokens: 0 });
    expect(memory?.throughMessageId).toBe('m2');
    expect(historyAfterCompaction(turns, memory)).toHaveLength(3);
  });
});
