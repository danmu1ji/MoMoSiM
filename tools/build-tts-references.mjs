#!/usr/bin/env node
/** Rebuild cloned-voice references from local character audio, filtering expressive vocalizations with local Japanese ASR. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';

const exec = promisify(execFile);
const root = resolve(process.argv[2] ?? 'worlds/blue-archive');
const refsDir = join(root, 'tts-references');
const targetSeconds = 8;
const minimumSeconds = 0.8;
const ASR_PYTHON = process.env.WORLD_PLAYER_ASR_PYTHON ?? 'python3';

function runTranscriber(inputPath, outputPath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(ASR_PYTHON, [resolve('tools/transcribe-tts-reference-candidates.py'), inputPath, outputPath], { stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', code => code === 0 ? resolveRun() : rejectRun(new Error(`Japanese ASR exited with code ${code}. Set WORLD_PLAYER_ASR_PYTHON to a Python environment with torch and transformers installed.`)));
  });
}

async function duration(path) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return Number.parseFloat(stdout.trim()) || 0;
}

function cueInfo(slug, path) {
  const stem = basename(path).replace(/\.[^.]+$/, '').split('__').at(-1) ?? '';
  const cue = stem.replace(new RegExp(`^${slug}_`, 'i'), '').replaceAll('_', ' ');
  const rank = /^cafe\b/i.test(cue) ? 0 : /^lobby\b/i.test(cue) ? 1 : /^login\b/i.test(cue) ? 2 : 3;
  return { key: cue.replace(/\b\w/g, letter => letter.toUpperCase()), rank };
}

const catalog = parse(await readFile(join(root, 'assets/media.yaml'), 'utf8'));
const existing = JSON.parse(await readFile(join(refsDir, 'manifest.json'), 'utf8'));
const characterFolders = (await readdir(join(root, 'locales/en/characters'), { withFileTypes: true }))
  .filter(item => item.isDirectory()).map(item => item.name).sort();
const candidates = [];
const candidateRecords = catalog.media.filter(asset => asset.kind === 'audio' && asset.file?.startsWith('assets/audio/')
  && /(?:^|_)(?:cafe|lobby|login)(?:_|\.)/i.test(asset.file)
  && characterFolders.some(slug => (asset.tags ?? []).includes(slug)));
for (let offset = 0; offset < candidateRecords.length; offset += 16) {
  const batch = candidateRecords.slice(offset, offset + 16);
  candidates.push(...(await Promise.all(batch.map(async record => {
    const slug = characterFolders.find(id => (record.tags ?? []).includes(id));
    if (!slug) return undefined;
    const seconds = await duration(resolve(root, record.file)).catch(() => 0);
    if (seconds < 0.2) return undefined;
    return { slug, path: record.file, absolutePath: resolve(root, record.file), seconds, ...cueInfo(slug, record.file) };
  }))).filter(Boolean));
  if ((offset + batch.length) % 160 === 0) console.log(`Measured ${Math.min(offset + batch.length, candidateRecords.length)}/${candidateRecords.length} audio clips…`);
}

const tempDir = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'world-player-tts-ref-')));
const inputPath = join(tempDir, 'candidates.json');
const outputPath = join(tempDir, 'transcriptions.json');
await writeFile(inputPath, JSON.stringify(candidates));
console.log(`Scanned ${candidates.length} local cafe/lobby/login clips; transcribing candidates until each student has 8 clean seconds…`);
await runTranscriber(inputPath, outputPath);
const transcriptions = JSON.parse(await readFile(outputPath, 'utf8'));
const transcriptByPath = new Map(transcriptions.map(item => [item.path, item]));

async function makeReference(slug, selected) {
  const inputs = [];
  const filters = [];
  selected.forEach((line, index) => {
    inputs.push('-i', resolve(root, line.path));
    filters.push(`[${index}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[s${index}]`);
  });
  filters.push(`${selected.map((_line, index) => `[s${index}]`).join('')}concat=n=${selected.length}:v=0:a=1[out]`);
  const path = join(refsDir, `${slug}.wav`);
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', path]);
  const actualDuration = await duration(path);
  const transcript = selected.map(line => /[。！？!?…]$/.test(line.transcript) ? line.transcript : `${line.transcript}。`).join(' ');
  const previous = existing.references?.[`character:${slug}`] ?? {};
  existing.references ??= {};
  existing.references[`character:${slug}`] = {
    ...previous, file: `tts-references/${slug}.wav`, transcript,
    durationSeconds: Number(actualDuration.toFixed(2)), shorterThanPreferred: actualDuration < targetSeconds,
    sourcePage: previous.sourcePage ?? 'Local Blue Archive voice assets; Japanese transcript generated with Whisper large-v3-turbo',
    sourceLines: selected.map(line => ({ file: line.path, key: line.key, variant: line.path.split('/').at(-1).split('__')[1] ?? 'base', transcript: line.transcript })),
  };
  return actualDuration;
}

const safeByCharacter = new Map(characterFolders.map(slug => [slug, []]));
const rejected = [];
for (const candidate of candidates) {
  const result = transcriptByPath.get(candidate.path);
  if (!result) continue; // candidates after the 8-second target were intentionally not transcribed
  if (!result.safe) {
    rejected.push({ ...candidate, transcript: result?.transcript ?? '', reason: result?.reason ?? 'no ASR result' });
    continue;
  }
  safeByCharacter.get(candidate.slug)?.push({ ...candidate, transcript: result.transcript });
}

const outcomes = [];
for (const slug of characterFolders) {
  const lines = safeByCharacter.get(slug) ?? [];
  // Calm, ordinary cafe speech first; when choices tie, use shorter clips to limit breaths and pauses.
  lines.sort((a, b) => a.rank - b.rank || a.seconds - b.seconds);
  const selected = [];
  let sum = 0;
  for (const line of lines) {
    if (sum >= targetSeconds) break;
    selected.push(line);
    sum += line.seconds;
  }
  if (sum < minimumSeconds) {
    const hasAudioCandidates = candidates.some(line => line.slug === slug);
    outcomes.push({ slug, status: hasAudioCandidates ? `only ${sum.toFixed(2)}s of clean speech available; kept prior reference if present` : 'no local voice audio; skipped' });
    continue;
  }
  const actualDuration = await makeReference(slug, selected);
  outcomes.push({ slug, status: 'regenerated', duration: actualDuration, totalCleanAvailable: sumClean(lines), cues: selected.map(line => line.key) });
}

function sumClean(lines) { return lines.reduce((sum, line) => sum + line.seconds, 0); }

await writeFile(join(refsDir, 'manifest.json'), `${JSON.stringify(existing, null, 2)}\n`);
const regenerated = outcomes.filter(result => result.status === 'regenerated');
const eligible = outcomes.filter(result => result.totalCleanAvailable >= targetSeconds);
const missingEligible = eligible.filter(result => result.status !== 'regenerated');
const noAudio = outcomes.filter(result => result.status === 'no local voice audio; skipped');
const insufficientCleanAudio = outcomes.filter(result => result.status.includes('only ') && result.status !== 'no local voice audio; skipped');
const average = regenerated.length ? regenerated.reduce((sum, result) => sum + result.duration, 0) / regenerated.length : 0;
const report = [
  '# Voice reference audio selection', '',
  'References are rebuilt only from cafe, lobby, and login voice clips already present under `assets/audio/`. Japanese speech is transcribed locally with Whisper large-v3-turbo; clips with laughter, crying, coughs, yawns, or expressive/interjection-only sounds (such as elongated “haa/hee/waa”) are excluded. No audio is downloaded.', '',
  `The selector targets at least ${targetSeconds} seconds of clean speech for every student with that much safe local source audio. If less clean speech exists, the available clips are used down to ${minimumSeconds} seconds.`, '',
  `Regenerated ${regenerated.length} references; ${eligible.length} students have at least ${targetSeconds} seconds of clean local source audio; ${missingEligible.length} eligible students are missing a regenerated reference; average output duration ${average.toFixed(2)} seconds.`, '',
  '| Character ID | Output seconds | Clean seconds available | Selected source cues |', '| --- | ---: | ---: | --- |',
  ...regenerated.map(item => `| ${item.slug} | ${item.duration.toFixed(2)} | ${item.totalCleanAvailable.toFixed(2)} | ${item.cues.join('<br>')} |`),
  '', `Skipped because no local voice clips exist: ${noAudio.length}${noAudio.length ? ` (${noAudio.map(item => item.slug).join(', ')})` : ''}.`,
  `Students with source clips but less than ${minimumSeconds} seconds of clean speech: ${insufficientCleanAudio.length}${insufficientCleanAudio.length ? ` (${insufficientCleanAudio.map(item => item.slug).join(', ')})` : ''}.`,
  '', '## Candidates rejected by local transcript screening', '',
  '| Character | Cue | Duration | ASR transcript | Reason |', '| --- | --- | ---: | --- | --- |',
  ...rejected.map(item => `| ${item.slug} | ${item.key} | ${item.seconds.toFixed(2)} | ${item.transcript || '—'} | ${item.reason} |`),
  '',
].join('\n');
await writeFile(join(refsDir, 'SELECTION.md'), report);
console.log(`Regenerated ${regenerated.length}/${characterFolders.length}; ${eligible.length} students had 8+ seconds of clean audio; missing eligible references: ${missingEligible.map(item => item.slug).join(', ') || 'none'}; no local voice clips: ${noAudio.length}. Average output ${average.toFixed(2)}s.`);
