const PREFIX = 'world-player.bookmarks.v1:';
const MAX_BOOKMARKS = 1000;

export function bookmarkKey(world: string, conversation: string): string {
  return `${PREFIX}${encodeURIComponent(world)}:${encodeURIComponent(conversation)}`;
}

export function loadBookmarks(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length <= 512).slice(0, MAX_BOOKMARKS) : []);
  } catch { return new Set(); }
}

export function saveBookmarks(key: string, ids: Set<string>): void {
  try {
    if (ids.size) localStorage.setItem(key, JSON.stringify([...ids].slice(-MAX_BOOKMARKS)));
    else localStorage.removeItem(key);
  } catch { /* Keep bookmarks usable in this session if persistence is unavailable. */ }
}
