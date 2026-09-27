import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createZipSource, loadWorld, normalizeArchiveEntries } from './core';

/** A minimal valid world, as package files relative to the package root. */
const worldFiles: Record<string, Uint8Array> = {
  'manifest.yaml': strToU8('schemaVersion: "1.0"\nid: wrapped\nname: Wrapped\nversion: "1.0"\nentry: world.yaml\n'),
  'world.yaml': strToU8('id: wrapped\nname: Wrapped\nversion: "1.0"\nsummary: s\nentrypoints: []\ntags: []\n'),
  'index/entities.yaml': strToU8('entities: []\n'),
  'timeline/time-slices.yaml': strToU8('timeSlices: []\n'),
  'timeline/states.yaml': strToU8('states: []\n'),
  'assets/media.yaml': strToU8('media: []\n'),
};

describe('archive normalisation', () => {
  it('unwraps a package that was zipped together with its folder', () => {
    // `zip -r wrapped.😭 wrapped/` is the common mistake: everything sits under one root folder
    const wrapped = Object.fromEntries(Object.entries(worldFiles).map(([path, bytes]) => [`wrapped/${path}`, bytes]));
    const files = normalizeArchiveEntries(wrapped);
    expect(Object.keys(files)).toContain('manifest.yaml');
    expect(Object.keys(files).some(path => path.startsWith('wrapped/'))).toBe(false);
  });

  it('drops directory entries and normalises separators', () => {
    const noisy: Record<string, Uint8Array> = { ...worldFiles, 'wrapped/': new Uint8Array(), 'wrapped/index/': new Uint8Array(), './world.yaml': worldFiles['world.yaml']! };
    const files = normalizeArchiveEntries(noisy);
    expect(Object.keys(files)).not.toContain('wrapped/');
    expect(Object.keys(files)).not.toContain('wrapped/index/');
    expect(Object.keys(files)).toContain('index/entities.yaml');
    expect(files['world.yaml']).toBeDefined();
  });

  it('loads a folder-wrapped archive end to end', async () => {
    const archive = Object.fromEntries(Object.entries(worldFiles).map(([path, bytes]) => [`sample-world/${path}`, bytes]));
    const data = await loadWorld(createZipSource(zipSync(archive)));
    expect(data.world.id).toBe('wrapped');
  });

  it('still reports a clear error when the manifest is genuinely absent', async () => {
    const archive = { 'a/manifest.yaml': worldFiles['manifest.yaml']!, 'b/world.yaml': worldFiles['world.yaml']! };
    const source = createZipSource(zipSync(archive));
    await expect(loadWorld(source)).rejects.toThrow(/manifest\.yaml/);
  });
});
