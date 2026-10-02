import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftKey, loadDraft, MAX_DRAFT_LENGTH, saveDraft } from './conversation-draft';
import { bookmarkKey, loadBookmarks, saveBookmarks } from './message-bookmarks';

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('conversation drafts', () => {
  it('persists drafts separately across conversations, worlds and key delimiters', () => {
    const a = draftKey('a:b', 'c'), b = draftKey('a', 'b:c');
    expect(a).not.toBe(b);
    saveDraft(a, 'first'); saveDraft(b, 'second');
    expect(loadDraft(a)).toBe('first'); expect(loadDraft(b)).toBe('second');
    saveDraft(a, ''); expect(storage.has(a)).toBe(false); expect(loadDraft(b)).toBe('second');
  });
  it('bounds draft storage and remains usable when storage is unavailable', () => {
    saveDraft('draft', 'x'.repeat(MAX_DRAFT_LENGTH + 1));
    expect(loadDraft('draft').length).toBe(MAX_DRAFT_LENGTH);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(loadDraft('draft')).toBe(''); expect(() => saveDraft('draft', 'text')).not.toThrow(); expect(() => saveDraft('draft', '')).not.toThrow();
  });
});

describe('message bookmarks', () => {
  it('retains only message IDs and isolates each chat', () => {
    const a = bookmarkKey('world', 'a'), b = bookmarkKey('world', 'b');
    saveBookmarks(a, new Set(['one', 'two']));
    expect([...loadBookmarks(a)]).toEqual(['one', 'two']); expect(loadBookmarks(b).size).toBe(0);
    saveBookmarks(a, new Set()); expect(storage.has(a)).toBe(false);
  });
  it('rejects corrupted records and bounds restored state', () => {
    storage.set('key', '{invalid'); expect(loadBookmarks('key').size).toBe(0);
    storage.set('key', '{}'); expect(loadBookmarks('key').size).toBe(0);
    storage.set('key', JSON.stringify([null, 3, {}, 'valid', 'x'.repeat(513)]));
    expect([...loadBookmarks('key')]).toEqual(['valid']);
    saveBookmarks('key', new Set(Array.from({ length: 1100 }, (_, i) => String(i))));
    expect(loadBookmarks('key').size).toBe(1000);
  });
});
