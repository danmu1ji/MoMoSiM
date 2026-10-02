import { useRef, useState, type SetStateAction } from 'react';

const PREFIX = 'world-player.draft.v1:';
export const MAX_DRAFT_LENGTH = 16_000;
export const draftKey = (world: string, conversation: string) => `${PREFIX}${encodeURIComponent(world)}:${encodeURIComponent(conversation)}`;

export function loadDraft(key: string): string {
  try { return (localStorage.getItem(key) ?? '').slice(0, MAX_DRAFT_LENGTH); }
  catch { return ''; }
}

export function saveDraft(key: string, text: string): void {
  try {
    if (text) localStorage.setItem(key, text.slice(0, MAX_DRAFT_LENGTH));
    else localStorage.removeItem(key);
  } catch { /* Private/full storage must not disable the composer. */ }
}

/** Write through at the input boundary so switching chats or closing the app cannot lose a draft. */
export function useConversationDraft(key: string) {
  const drafts = useRef(new Map<string, string>());
  const [, refresh] = useState(0);
  if (!drafts.current.has(key)) drafts.current.set(key, loadDraft(key));
  const text = drafts.current.get(key)!;
  const setText = (next: SetStateAction<string>) => {
    const value = (typeof next === 'function' ? next(drafts.current.get(key) ?? '') : next).slice(0, MAX_DRAFT_LENGTH);
    drafts.current.set(key, value);
    saveDraft(key, value);
    refresh(version => version + 1);
  };
  return [text, setText] as const;
}
