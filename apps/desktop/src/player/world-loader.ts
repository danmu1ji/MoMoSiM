import { loadWorld, validateWorld, withLocaleOverlay, type WorldData, type WorldSource } from '@world-player/engine/desktop';

/** Package identity, locale overlays, validation and retryable caching live at one boundary. */
export function createWorldLoader(baseUrl: string) {
  const cache = new WeakMap<WorldSource, Map<string, Promise<WorldData>>>();
  async function load(source: WorldSource, language: 'ko' | 'en'): Promise<WorldData> {
    let localizedSource = source;
    if (language === 'en' && /^id:\s*['"]?blue-archive['"]?\s*$/m.test(await source.read('manifest.yaml'))) {
      const response = await fetch(`${baseUrl}locales/en/manifest.json`);
      if (response.ok) {
        const value: unknown = await response.json();
        if (!Array.isArray(value) || !value.every(path => typeof path === 'string' && path.startsWith('locales/en/') && !path.split('/').includes('..') && !/[\\?#]/.test(path))) {
          throw new Error('Invalid English source manifest.');
        }
        const paths = value as string[];
        const pathSet = new Set(paths);
        const overlay: WorldSource = {
          read: async path => {
            if (!pathSet.has(path)) throw new Error(`No original English source is available for ${path}.`);
            const file = await fetch(`${baseUrl}${path}`);
            if (!file.ok) throw new Error(`English source file missing: ${path}`);
            return file.text();
          },
          exists: async path => pathSet.has(path),
          listPaths: async () => paths,
        };
        localizedSource = withLocaleOverlay(source, overlay, paths);
      }
    }
    const world = await loadWorld(localizedSource, { language, lazyDocuments: true });
    const errors = validateWorld(world).filter(issue => issue.level === 'error');
    if (errors.length) throw new Error(errors.map(issue => issue.message).join(' · '));
    return world;
  }
  return (source: WorldSource, language: 'ko' | 'en'): Promise<WorldData> => {
    let languages = cache.get(source);
    if (!languages) { languages = new Map(); cache.set(source, languages); }
    const cached = languages.get(language);
    if (cached) return cached;
    const pending = load(source, language);
    languages.set(language, pending);
    void pending.catch(() => { if (languages.get(language) === pending) languages.delete(language); });
    return pending;
  };
}
