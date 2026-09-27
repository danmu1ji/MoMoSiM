import { invoke } from '@tauri-apps/api/core';
import type { StoredTurn } from '@world-player/engine/desktop';
import { isDesktopRuntime } from './credential-store';

type StoredConversation = { world: string; timeSlice: string; player: string; updatedAt: string; turns: StoredTurn[] };
type BrowserDatabase = Record<string, StoredConversation>;
export type ConversationSummary = { id: string; updatedAt: string; timeSlice: string };
const STORAGE_KEY = 'world-player.conversations.v1';
const CONTEXT_MODE_KEY = 'world-player.context-mode.v1';

export type ConversationContextMode = 'full' | 'medium' | 'high';
export function defaultContextMode(participantCount: number): ConversationContextMode {
  return participantCount >= 60 ? 'high' : participantCount >= 30 ? 'medium' : 'full';
}
export function loadConversationContextMode(conversationId: string, participantCount: number): ConversationContextMode {
  try {
    const modes = JSON.parse(localStorage.getItem(CONTEXT_MODE_KEY) ?? '{}') as Record<string, ConversationContextMode>;
    const saved = modes[conversationId];
    return saved === 'full' || saved === 'medium' || saved === 'high' ? saved : defaultContextMode(participantCount);
  } catch { return defaultContextMode(participantCount); }
}
export function saveConversationContextMode(conversationId: string, mode: ConversationContextMode): void {
  try {
    const modes = JSON.parse(localStorage.getItem(CONTEXT_MODE_KEY) ?? '{}') as Record<string, ConversationContextMode>;
    modes[conversationId] = mode;
    localStorage.setItem(CONTEXT_MODE_KEY, JSON.stringify(modes));
  } catch { /* Context choice is a convenience; chat remains available if storage is full. */ }
}

function readBrowserDatabase(): BrowserDatabase {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as BrowserDatabase; }
  catch { return {}; }
}

export async function loadConversation(conversationId: string): Promise<StoredTurn[]> {
  if (isDesktopRuntime()) return invoke<StoredTurn[]>('conversation_load', { conversationId });
  return readBrowserDatabase()[conversationId]?.turns ?? [];
}

export async function saveConversationTurn(input: {
  id: string; world: string; timeSlice: string; player: string; updatedAt: string; message: StoredTurn;
}): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke('conversation_save', {
      id: input.id, world: input.world, timeSlice: input.timeSlice,
      player: input.player, updatedAt: input.updatedAt, message: input.message,
    });
    return;
  }
  const database = readBrowserDatabase();
  const conversation = database[input.id] ?? {
    world: input.world, timeSlice: input.timeSlice, player: input.player, updatedAt: input.updatedAt, turns: [],
  };
  conversation.world = input.world;
  conversation.timeSlice = input.timeSlice;
  conversation.player = input.player;
  conversation.updatedAt = input.updatedAt;
  if (!conversation.turns.some(turn => turn.id === input.message.id)) conversation.turns.push(input.message);
  conversation.turns.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  database[input.id] = conversation;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
}

export async function listConversations(world: string): Promise<ConversationSummary[]> {
  if (isDesktopRuntime()) {
    const rows = await invoke<{ id: string; updated_at: string; time_slice: string }[]>('conversation_list', { world });
    return rows.map(row => ({ id: row.id, updatedAt: row.updated_at, timeSlice: row.time_slice }));
  }
  return Object.entries(readBrowserDatabase()).filter(([, item]) => item.world === world)
    .map(([id, item]) => ({ id, updatedAt: item.updatedAt, timeSlice: item.timeSlice }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function clearConversation(conversationId: string): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke('conversation_delete', { conversationId });
    return;
  }
  const database = readBrowserDatabase();
  delete database[conversationId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
}
