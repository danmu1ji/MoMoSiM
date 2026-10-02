import type { ChatMessage } from '@world-player/schema';
import type { StreamingProvider } from '@world-player/engine/desktop';

export interface ConversationMemory {
  summary: string;
  throughMessageId: string;
  updatedAt: string;
}

const STORAGE_KEY = 'world-player.conversation-memory.v1';
const VERSIONS_KEY = 'world-player.conversation-memory-versions.v1';
const MAX_TRANSCRIPT_CHARS = 18_000;
const MAX_TRANSCRIPT_BATCHES = 4;
const COMPACTION_TIMEOUT_MS = 90_000;
const KEEP_RECENT_MESSAGES = 40;
const compacting = new Set<string>();
type StoredMemory = ConversationMemory | { generation: string; memory: ConversationMemory };
type MemoryVersion = { generation: string; status: 'resetting' | 'ready' };

function memoryKey(worldId: string, conversationId: string): string { return JSON.stringify([worldId, conversationId]); }

async function withMemoryStoreLock<T>(operation: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('world-player-conversation-memory-store', operation);
  return operation();
}

function transcriptLineLength(message: ChatMessage): number {
  const speaker = message.speaker.type === 'player' ? 'User' : message.speaker.id;
  const text = message.content.map(node => node.type === 'image' ? '[image]' : node.text ?? '').join('').trim();
  return speaker.length + text.length + 2;
}

function readAll(): Record<string, StoredMemory> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as Record<string, ConversationMemory> : {};
  } catch { return {}; }
}

function currentMemory(record: StoredMemory | undefined, generation: string): ConversationMemory | undefined {
  if (!record) return undefined;
  if ('memory' in record) return record.generation === generation ? record.memory : undefined;
  return generation === '0' ? record : undefined;
}

function readVersions(): Record<string, string | MemoryVersion> {
  try {
    const versions = JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? '{}');
    return versions && typeof versions === 'object' ? versions as Record<string, string | MemoryVersion> : {};
  } catch { return {}; }
}

function readVersion(key: string): string {
  const entry = readVersions()[key];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry.generation === 'string') return entry.status === 'resetting' ? `resetting:${entry.generation}` : entry.generation;
  return '0';
}

export function conversationMemoryGeneration(worldId: string, conversationId: string): string {
  return readVersion(memoryKey(worldId, conversationId));
}

export function loadConversationMemory(worldId: string, conversationId: string): ConversationMemory | undefined {
  const key = memoryKey(worldId, conversationId);
  const memory = currentMemory(readAll()[key], readVersion(key));
  return memory && typeof memory.summary === 'string' && typeof memory.throughMessageId === 'string' ? memory : undefined;
}

export async function clearConversationMemory(worldId: string, conversationId: string): Promise<string> {
  return withMemoryStoreLock(() => {
  const key = memoryKey(worldId, conversationId);
  const version = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const versions = readVersions();
  versions[key] = { generation: version, status: 'resetting' };
  try {
    const retainedVersions = Object.entries(versions).slice(-1000);
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(Object.fromEntries(retainedVersions)));
  } catch {
    try {
      const all = readAll();
      delete all[key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      localStorage.setItem(VERSIONS_KEY, JSON.stringify({ [key]: { generation: version, status: 'resetting' } }));
    } catch { throw new Error('Could not persist the conversation reset generation; compaction was not safely invalidated.'); }
  }
  try { const all = readAll(); delete all[key]; localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* A stale summary is rejected by its prior generation. */ }
  return version;
  });
}

export async function completeConversationMemoryReset(worldId: string, conversationId: string, generation: string): Promise<void> {
  await withMemoryStoreLock(() => {
  const key = memoryKey(worldId, conversationId);
  const versions = readVersions();
  const current = versions[key];
  if (current && typeof current !== 'string' && current.generation !== generation) return;
  versions[key] = { generation, status: 'ready' };
  try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions)); }
  catch { throw new Error('Could not finalize the conversation reset generation; compaction remains disabled for this chat.'); }
  });
}

export function historyAfterCompaction(history: ChatMessage[], memory?: ConversationMemory): ChatMessage[] {
  if (!memory) return history;
  const index = history.findIndex(message => message.id === memory.throughMessageId);
  return index < 0 ? history : history.slice(index + 1);
}

export function compactableHistory(history: ChatMessage[], memory?: ConversationMemory, keepRecentMessages = KEEP_RECENT_MESSAGES): ChatMessage[] {
  const pending = historyAfterCompaction(history, memory);
  const candidates = pending.slice(0, keepRecentMessages > 0 ? -keepRecentMessages : undefined);
  const selected: ChatMessage[] = [];
  let transcriptLength = 0;
  for (const message of candidates) {
    const lineLength = transcriptLineLength(message);
    if (lineLength > MAX_TRANSCRIPT_CHARS && selected.length === 0) return lineLength <= MAX_TRANSCRIPT_CHARS * MAX_TRANSCRIPT_BATCHES ? [message] : [];
    if (lineLength > MAX_TRANSCRIPT_CHARS || transcriptLength + lineLength > MAX_TRANSCRIPT_CHARS) break;
    selected.push(message);
    transcriptLength += lineLength;
  }
  return selected;
}

export function shouldCompactForContext(contextWindowTokens: number, estimatedPromptTokens: number, responseReserveTokens = 0): boolean {
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0 || !Number.isFinite(estimatedPromptTokens) || estimatedPromptTokens < 0 || !Number.isFinite(responseReserveTokens) || responseReserveTokens < 0) return false;
  return (contextWindowTokens - estimatedPromptTokens - responseReserveTokens) / contextWindowTokens < 0.1;
}

function transcriptBatches(turns: ChatMessage[], language: 'ko' | 'en'): string[] {
  const batches: string[] = [];
  let batch = '';
  for (const message of turns) {
    const speaker = message.speaker.type === 'player' ? (language === 'en' ? 'User' : '사용자') : message.speaker.id;
    let line = `${speaker}: ${message.content.map(node => node.type === 'image' ? '[image]' : node.text ?? '').join('').trim()}`;
    while (line.length) {
      if (batch.length + (batch ? 1 : 0) >= MAX_TRANSCRIPT_CHARS) { batches.push(batch); batch = ''; }
      const capacity = Math.max(1, MAX_TRANSCRIPT_CHARS - batch.length - (batch ? 1 : 0));
      const part = line.slice(0, capacity);
      batch += `${batch ? '\n' : ''}${part}`;
      line = line.slice(part.length);
      if (line) {
        batches.push(batch);
        batch = language === 'en' ? '[continued turn]' : '[이전 발화 이어짐]';
      }
    }
  }
  if (batch) batches.push(batch);
  return batches;
}

export async function compactConversation(input: {
  worldId: string;
  conversationId: string;
  history: ChatMessage[];
  memory?: ConversationMemory;
  provider: StreamingProvider;
  model: string;
  language: 'ko' | 'en';
  expectedGeneration?: string;
  contextWindowTokens: number;
  estimatedPromptTokens: number;
  responseReserveTokens: number;
}): Promise<ConversationMemory | undefined> {
  const key = memoryKey(input.worldId, input.conversationId);
  if (compacting.has(key)) return input.memory;
  if (!shouldCompactForContext(input.contextWindowTokens, input.estimatedPromptTokens, input.responseReserveTokens)) return input.memory;
  const pending = historyAfterCompaction(input.history, input.memory);
  const keepRecent = Math.min(KEEP_RECENT_MESSAGES, Math.floor(pending.length / 2));
  const oldTurns = compactableHistory(input.history, input.memory, keepRecent);
  if (!oldTurns.length) {
    const candidateCount = keepRecent > 0 ? Math.max(0, pending.length - keepRecent) : pending.length;
    if (candidateCount > 0 && transcriptLineLength(pending[0]!) > MAX_TRANSCRIPT_CHARS * MAX_TRANSCRIPT_BATCHES) {
      throw new Error('A conversation turn is too large to summarize within the safety limit.');
    }
    return input.memory;
  }
  const version = readVersion(key);
  if (version.startsWith('resetting:')) return input.memory;
  if (input.expectedGeneration !== undefined && input.expectedGeneration !== version) return undefined;
  compacting.add(key);
  try {
  const system = input.language === 'en'
    ? 'Create a concise continuity note for a roleplay conversation. Preserve durable user preferences, promises, relationship changes, unresolved plans, important events, and current emotional context. Do not invent facts. Return only the note, under 1800 characters.'
    : '역할극 대화를 이어가기 위한 간결한 기억 메모를 작성해. 사용자의 지속적인 선호, 약속, 관계 변화, 미해결 계획, 중요한 사건, 현재 감정 맥락을 보존해. 사실을 만들지 말고 1800자 이내 메모만 반환해.';
  let summary = input.memory?.summary ?? '';
  const batches = transcriptBatches(oldTurns, input.language);
  if (batches.length > MAX_TRANSCRIPT_BATCHES) throw new Error('A conversation turn is too large to summarize within the safety limit.');
  const signal = AbortSignal.timeout(COMPACTION_TIMEOUT_MS);
  for (const transcript of batches) {
    let nextSummary = '';
    for await (const event of input.provider.createStream({
      model: input.model,
      system,
      messages: [{ role: 'user', content: `${summary ? `Previous note:\n${summary}\n\n` : ''}Conversation turns:\n${transcript}` }],
      sampling: { temperature: 0.2, maxTokens: 900 },
      signal,
    })) {
      if (event.type === 'text' && typeof event.text === 'string' && nextSummary.length < 6000) nextSummary += event.text.slice(0, 6000 - nextSummary.length);
      if (event.type === 'error') throw event.error ?? new Error('Conversation compaction failed');
    }
    if (!nextSummary.trim()) throw new Error('Conversation compaction returned an empty memory note');
    summary = nextSummary.trim().slice(0, 6000);
  }
  if (!summary) return input.memory;
  const memory: ConversationMemory = { summary, throughMessageId: oldTurns.at(-1)!.id, updatedAt: new Date().toISOString() };
  const saveMemory = async (): Promise<ConversationMemory | undefined> => withMemoryStoreLock(() => {
    if (readVersion(key) !== version) return undefined;
    const all = readAll();
    const entries = Object.entries(all).filter(([id]) => id !== key).sort((a, b) => {
      const left = 'memory' in a[1] ? a[1].memory : a[1];
      const right = 'memory' in b[1] ? b[1].memory : b[1];
      return left.updatedAt.localeCompare(right.updatedAt);
    }).slice(-499);
    const retained = Object.fromEntries(entries);
    retained[key] = { generation: version, memory };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(retained));
    return memory;
  });
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return await navigator.locks.request(`world-player-conversation:${input.conversationId}`, saveMemory);
  }
  return saveMemory();
  } finally { compacting.delete(key); }
}
