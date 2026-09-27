import { zipSync, strToU8 } from 'fflate';
import { stringify } from 'yaml';
import type { WorldData } from './core.js';

export function worldToFiles(data: WorldData): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const [path, bytes] of data.packageFiles) if (!(path in files)) files[path] = bytes;
  files['manifest.yaml'] = strToU8(stringify(data.manifest));
  files[data.manifest.entry] = strToU8(stringify(data.world));
  files['index/entities.yaml'] = strToU8(stringify({ entities: [...data.entities.values()] }));
  files['timeline/time-slices.yaml'] = strToU8(stringify({ timeSlices: data.timeSlices }));
  files['timeline/states.yaml'] = strToU8(stringify({ states: data.states }));
  files['assets/media.yaml'] = strToU8(stringify({ media: [...data.media.values()] }));
  files['assets/media-index.json'] = strToU8(JSON.stringify({ media: [...data.media.values()] }));
  for (const [path, body] of data.documents) files[path] = strToU8(body);
  for (const [path, bytes] of data.assetBytes) files[path] = bytes;
  return files;
}
export function exportWorldPackage(data: WorldData): Uint8Array { return zipSync(worldToFiles(data)); }

/**
 * 지연 로딩된 세계관도 **자산을 포함해** 내보낸다.
 *
 * 지연 모드에서는 assetBytes가 비어 있으므로, media.yaml이 참조하는 파일을 소스에서 그때 읽어 담는다.
 * (동기 `exportWorldPackage`는 eager 모드·테스트용으로 남겨 둔다.)
 */
export async function exportWorldPackageAsync(data: WorldData): Promise<Uint8Array> {
  const files = worldToFiles(data);
  const wanted = new Set<string>();
  for (const asset of data.media.values()) if (data.assetFiles.has(asset.file) && !(asset.file in files)) wanted.add(asset.file);
  // 원본 패키지에 있던 다른 파일(문서·자산 외 첨부)도 보존한다: 목록을 훑어 아직 없는 것만 읽는다.
  if (data.source?.listPaths) {
    for (const path of await data.source.listPaths()) if (!(path in files)) wanted.add(path);
  }
  const pending = [...wanted];
  for (let index = 0; index < pending.length; index += 32) {
    const chunk = pending.slice(index, index + 32);
    const results = await Promise.all(chunk.map(async path => {
      const cached = data.assetCache?.get(path) ?? data.assetBytes.get(path);
      if (cached) return [path, cached] as const;
      try { return [path, await data.source?.readBytes?.(path)] as const; } catch { return [path, undefined] as const; }
    }));
    for (const [path, bytes] of results) if (bytes) files[path] = bytes;
  }
  return zipSync(files);
}
