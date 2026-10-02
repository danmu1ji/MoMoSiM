import { inferMessageStyle, type MessageStyle, type WorldData } from '@world-player/engine/desktop';
import type { Character } from '@world-player/schema';

/** Scope caches by loaded package object; reimporting a changed package must not reuse stale styles. */
export function createMessageStyleLoader(baseUrl: string) {
  const worlds = new WeakMap<WorldData, Map<string, MessageStyle | null>>();
  return async (data: WorldData, characters: Character[], language: 'ko' | 'en') => {
    let cache = worlds.get(data);
    if (!cache) { cache = new Map(); worlds.set(data, cache); }
    const result: Record<string, MessageStyle> = {};
    await Promise.all(characters.map(async character => {
      const key = `${language}:${character.id}`;
      if (cache.has(key)) { const style = cache.get(key); if (style) result[character.id] = style; return; }
      const slug = character.id.replace(/^character:/, '');
      const paths = language === 'en'
        ? [`locales/en/characters/${slug}/conversation.md`, `characters/${slug}/conversation.md`]
        : [`characters/${slug}/conversation.md`, `locales/en/characters/${slug}/conversation.md`];
      let style: MessageStyle | undefined;
      for (const path of paths) {
        try {
          let transcript: string | undefined;
          if (data.source && await data.source.exists(path)) transcript = await data.source.read(path);
          else if (path.startsWith('locales/en/') && !path.split('/').includes('..') && !/[\\?#]/.test(path)) {
            const response = await fetch(`${baseUrl}${path}`);
            if (response.ok) transcript = await response.text();
          }
          if (transcript) style = inferMessageStyle(transcript, [character.name, character.nameEn ?? '', slug]);
          if (style) break;
        } catch { /* Transcript references are optional. */ }
      }
      cache.set(key, style ?? null);
      if (style) result[character.id] = style;
    }));
    return result;
  };
}
