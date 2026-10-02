import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemorySource } from '@world-player/engine/desktop';
import { createWorldLoader } from './world-loader';

afterEach(() => vi.unstubAllGlobals());
const files = {
  'manifest.yaml': 'id: demo\nschemaVersion: "1.0"\nentry: world.yaml',
  'world.yaml': 'id: demo\nname: Demo\nentrypoints: []',
  'index/entities.yaml': 'entities: []',
  'timeline/time-slices.yaml': 'timeSlices: []',
  'timeline/states.yaml': 'states: []',
  'assets/media.yaml': 'media: []',
};

describe('world loading boundary', () => {
  it('deduplicates concurrent loads but scopes its cache to the actual source', async () => {
    const load = createWorldLoader('/');
    const source = createMemorySource(files);
    const first = load(source, 'ko'), second = load(source, 'ko');
    expect(second).toBe(first);
    expect(await first).toBe(await load(source, 'ko'));
    expect(await load(createMemorySource(files), 'ko')).not.toBe(await first);
  });
  it('retries a failed load instead of caching the rejected result forever', async () => {
    const load = createWorldLoader('/');
    const source = createMemorySource(files);
    const read = source.read;
    let failed = false;
    source.read = async path => { if (path === 'manifest.yaml' && !failed) { failed = true; throw new Error('transient'); } return read(path); };
    await expect(load(source, 'ko')).rejects.toThrow('transient');
    expect((await load(source, 'ko')).world.id).toBe('demo');
  });
  it('validates packages before caching a result exposed to the player', async () => {
    const source = createMemorySource({ ...files, 'index/entities.yaml': 'entities:\n - id: character:missing\n   type: character\n   name: Missing\n   markdown: absent.md' });
    await expect(createWorldLoader('/')(source, 'ko')).rejects.toThrow(/absent.md/);
  });
  it('rejects invalid locale manifests before dereferencing their paths', async () => {
    const source = createMemorySource({ ...files, 'manifest.yaml': 'id: blue-archive\nentry: world.yaml' });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(['locales/en/../../api/credentials'])));
    vi.stubGlobal('fetch', fetch);
    await expect(createWorldLoader('/')(source, 'en')).rejects.toThrow('Invalid English source manifest');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
