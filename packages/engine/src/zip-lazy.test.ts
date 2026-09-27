/**
 * 지연 로딩 계약 테스트.
 *
 * 큰 세계관(772MB)에서 fflate `unzipSync`로 전체를 풀면 압축 해제 사본 + assetBytes + packageFiles로
 * 메모리가 2~3배가 된다. 여기서는 (1) 중앙 디렉터리만 읽고 (2) 요청한 엔트리만 풀며
 * (3) loadWorld가 지연 모드에서 자산 바이트를 읽지 않는 것을 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createLazyZipSource, listZipPaths, loadWorld, readAssetBytes, mimeFor } from './index';

function makeArchive(): Uint8Array {
  return zipSync({
    'manifest.yaml': strToU8('schemaVersion: "1.0"\nid: w\nname: W\nversion: 0.1.0\nentry: world.yaml'),
    'world.yaml': strToU8('id: w\nname: W\nversion: 0.1.0\nsummary: s'),
    'index/entities.yaml': strToU8('entities:\n  - id: character:a\n    type: character\n    name: A\n    summary: s\n    markdown: characters/a/character.md'),
    'characters/a/character.md': strToU8('# A'),
    'timeline/time-slices.yaml': strToU8('timeSlices:\n  - id: now\n    label: Now\n    position: 0'),
    'timeline/states.yaml': strToU8('states: []'),
    'assets/media.yaml': strToU8('media:\n  - id: banner-a\n    file: assets/images/a.png\n    kind: portrait\n    description: A banner'),
    'assets/images/a.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  });
}

describe('lazy zip source', () => {
  it('lists entries without inflating them', () => {
    const paths = listZipPaths(makeArchive());
    expect(paths.sort()).toEqual([
      'assets/images/a.png',
      'assets/media.yaml',
      'characters/a/character.md',
      'index/entities.yaml',
      'manifest.yaml',
      'timeline/states.yaml',
      'timeline/time-slices.yaml',
      'world.yaml',
    ]);
  });

  it('reads a single entry on demand and caches it', async () => {
    const source = createLazyZipSource(makeArchive());
    const first = await source.readBytes!('assets/images/a.png');
    expect([...first]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await source.read('manifest.yaml')).toContain('schemaVersion');
    expect(await source.readBytes!('missing.png').catch(() => 'threw')).toBe('threw');
  });

  it('unwraps a single top-level folder like the eager loader does', async () => {
    const archive = zipSync({
      'world/manifest.yaml': strToU8('schemaVersion: "1.0"\nid: w\nname: W\nversion: 1\nentry: world.yaml'),
      'world/world.yaml': strToU8('id: w\nname: W\nversion: 1'),
      'world/index/entities.yaml': strToU8('entities: []'),
      'world/timeline/time-slices.yaml': strToU8('timeSlices: []'),
      'world/timeline/states.yaml': strToU8('states: []'),
      'world/assets/media.yaml': strToU8('media: []'),
    });
    const source = createLazyZipSource(archive);
    expect(await source.exists('manifest.yaml')).toBe(true);
    expect(await source.exists('world/manifest.yaml')).toBe(false);
  });
});

describe('lazy world loading', () => {
  it('does not read asset bytes unless asked', async () => {
    const source = createLazyZipSource(makeArchive());
    const data = await loadWorld(source);
    // 자산은 존재만 확인되고 바이트는 비어 있다
    expect(data.assetFiles.has('assets/images/a.png')).toBe(true);
    expect(data.assetBytes.size).toBe(0);
    // 필요할 때만 읽는다
    const bytes = await readAssetBytes(data, 'assets/images/a.png');
    expect(bytes?.byteLength).toBe(8);
    expect(data.assetCache?.size).toBe(1);
    // 문서는 즉시 로드된다(대화에 필요)
    expect(data.documents.get('characters/a/character.md')).toBe('# A');
  });

  it('still supports eager mode for small packages', async () => {
    const source = createLazyZipSource(makeArchive());
    const data = await loadWorld(source, { eagerAssets: true });
    expect(data.assetBytes.size).toBe(1);
    expect(data.packageFiles.has('assets/images/a.png')).toBe(true);
  });

  it('maps mime types for the player', () => {
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('a.jpg')).toBe('image/jpeg');
    expect(mimeFor('a.ogg', 'audio')).toBe('audio/ogg');
    expect(mimeFor('a.mp3', 'audio')).toBe('audio/mpeg');
  });
});