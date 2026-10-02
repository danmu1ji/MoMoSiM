#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { createRemoteZipSource, loadWorld, loadWorldDocuments, withLocaleOverlay } from '../packages/engine/dist/desktop-adapter.js';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const packageUrl = new URL('api/worlds/blue-archive.%F0%9F%98%AD', baseUrl).href;
const iterations = Number(process.argv[3] ?? 5);
const compareParser = process.argv.includes('--compare-parser');
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('Iterations must be between 1 and 100.');

async function sourceForLanguage(source, language) {
  if (language === 'ko') return { source, options: { language, lazyDocuments: true } };
  const response = await fetch(new URL('locales/en/manifest.json', baseUrl));
  if (!response.ok) throw new Error(`English source manifest returned HTTP ${response.status}`);
  const paths = await response.json();
  const pathSet = new Set(paths);
  const overlay = {
    read: async path => {
      if (!pathSet.has(path)) throw new Error(`English source missing: ${path}`);
      const file = await fetch(new URL(path, baseUrl));
      if (!file.ok) throw new Error(`English source returned HTTP ${file.status}: ${path}`);
      return file.text();
    },
    exists: async path => pathSet.has(path),
    listPaths: async () => paths,
  };
  return { source: withLocaleOverlay(source, overlay, paths), options: { language, lazyDocuments: true } };
}

for (const language of ['ko', 'en']) {
  const modes = compareParser ? ['fast-core', 'original-yaml'] : ['fast-core'];
  const results = new Map(modes.map(mode => [mode, []]));
  const timings = [];
  let world;
  for (let index = 0; index < iterations; index += 1) {
    // Alternate order to reduce warm-up/CPU-load bias. Each run opens a fresh ranged source.
    for (const mode of index % 2 ? [...modes].reverse() : modes) {
    const start = performance.now();
    const source = await createRemoteZipSource(packageUrl);
    const setup = await sourceForLanguage(source, language);
    if (mode === 'original-yaml') {
      const originalRead = setup.source.read;
      setup.source = { ...setup.source, read: async path => {
        const body = await originalRead(path);
        // An unused anchored scalar selects the compatibility parser. The entity data is identical.
        return /(?:^|\/)index\/entities\.yaml$/.test(path) ? `benchmarkParser: &benchmark true\n${body}` : body;
      } };
    }
    world = await loadWorld(setup.source, setup.options);
    results.get(mode).push(performance.now() - start);
    }
  }
  timings.push(...results.get('fast-core'));
  const sorted = [...timings].sort((a, b) => a - b);
  const character = [...world.entities.values()].find(entity => entity.type === 'character');
  const documentsLoadedAtStartup = world.loadedDocuments?.size ?? null;
  const documentPath = character?.markdown
    ? language === 'en' ? `locales/en/${character.markdown}` : character.markdown
    : undefined;
  const documentStart = performance.now();
  if (documentPath) await loadWorldDocuments(world, [documentPath]);
  const documentMs = performance.now() - documentStart;
  console.log(JSON.stringify({
    language,
    iterations,
    samplesMs: timings.map(value => Number(value.toFixed(1))),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
    entities: world.entities.size,
    documentsIndexed: world.documents.size,
    documentsLoadedAtStartup,
    firstCharacterDocumentMs: Number(documentMs.toFixed(1)),
    firstCharacterDocumentLoaded: documentPath ? world.loadedDocuments?.has(documentPath) : false,
    ...(compareParser ? {
      originalYamlSamplesMs: results.get('original-yaml').map(value => Number(value.toFixed(1))),
      originalYamlMedianMs: Number([...results.get('original-yaml')].sort((a, b) => a - b)[Math.floor(iterations / 2)].toFixed(1)),
      reductionPercent: Number((100 * (1 - sorted[Math.floor(iterations / 2)] / [...results.get('original-yaml')].sort((a, b) => a - b)[Math.floor(iterations / 2)])).toFixed(1)),
    } : {}),
  }));
}
