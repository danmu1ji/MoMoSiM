/**
 * 지연 로딩용 ZIP 소스 — 중앙 디렉터리만 읽고, 엔트리는 **요청할 때** 푼다.
 *
 * 왜 필요한가: 수백 MB짜리 세계관 패키지(`.😭`)를 fflate `unzipSync`로 열면
 * 압축 해제된 전체 사본이 메모리에 올라온다(그 위에 assetBytes·packageFiles 사본까지 생겨 2~3배).
 * 여기서는 원본 바이트만 보관하고, 필요한 엔트리만 그때 inflate 한다.
 *
 * 지원: 저장(stored) · deflate(일반 ZIP 기본). ZIP64/암호화/기타 압축은 명확히 실패한다.
 */
import { inflateSync, unzipSync, strFromU8 } from 'fflate';

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; localHeaderOffset: number }

const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

function createByteCache() {
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  return {
    get(path: string) {
      const value = entries.get(path);
      if (value) { entries.delete(path); entries.set(path, value); }
      return value;
    },
    set(path: string, value: Uint8Array) {
      if (value.byteLength > CACHE_BUDGET_BYTES) return;
      const previous = entries.get(path);
      if (previous) totalBytes -= previous.byteLength;
      entries.set(path, value);
      totalBytes += value.byteLength;
      while (totalBytes > CACHE_BUDGET_BYTES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        totalBytes -= entries.get(oldest)!.byteLength;
        entries.delete(oldest);
      }
    },
    clear() { entries.clear(); totalBytes = 0; },
  };
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** 중앙 디렉터리를 스캔해 엔트리 목록을 만든다(압축 해제는 하지 않는다). */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  // EOCD는 파일 끝에서 최대 64KB(코멘트) 안에 있다.
  const limit = Math.max(0, bytes.length - 0x10000 - 22);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= limit; offset -= 1) {
    if (readU32(bytes, offset) === EOCD_SIGNATURE) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('.😭 파일의 ZIP 중앙 디렉터리를 찾지 못했습니다(손상되었거나 ZIP이 아닙니다).');
  const entryCount = readU16(bytes, eocd + 10);
  if (entryCount === 0xffff) throw new Error('ZIP64 패키지는 아직 지원하지 않습니다.');
  let cursor = readU32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, cursor) !== CENTRAL_SIGNATURE) break;
    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const size = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localHeaderOffset = readU32(bytes, cursor + 42);
    const name = strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name.endsWith('/')) entries.push({ name: name.replace(/\\/g, '/'), method, compressedSize, size, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 엔트리 하나를 그때 푼다. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) throw new Error(`ZIP entry is too large: ${entry.name}`);
  const offset = entry.localHeaderOffset;
  if (readU32(bytes, offset) !== LOCAL_SIGNATURE) throw new Error(`ZIP 엔트리를 읽지 못했습니다: ${entry.name}`);
  const nameLength = readU16(bytes, offset + 26);
  const extraLength = readU16(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const payload = bytes.subarray(start, start + entry.compressedSize);
  if (payload.byteLength !== entry.compressedSize) throw new Error(`ZIP entry is truncated: ${entry.name}`);
  // The caller-provided output buffer prevents a forged ZIP size from allocating arbitrarily.
  const value = entry.method === 0 ? payload.slice() : entry.method === 8 ? inflateSync(payload, { out: new Uint8Array(entry.size + 1) }) : undefined;
  if (value) {
    if (value.byteLength !== entry.size) throw new Error(`ZIP entry size does not match its directory: ${entry.name}`);
    return value;
  }
  throw new Error(`지원하지 않는 ZIP 압축 방식입니다(${entry.method}): ${entry.name}`);
}

/**
 * 지연 ZIP 소스. `readBytes(path)`는 그 경로만 푼다.
 * `listPaths()`는 중앙 디렉터리 이름만 돌려주므로 비용이 거의 없다.
 */
export function createLazyZipSource(bytes: Uint8Array): import('./core.js').WorldSource {
  const entries = readZipDirectory(bytes);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  // 단일 최상위 폴더로 압축된 패키지(`world/…`)를 허용한다: manifest.yaml이 그 안에 있으면 접두사를 벗긴다.
  const hasRootManifest = byName.has('manifest.yaml');
  let prefix = '';
  if (!hasRootManifest) {
    const roots = new Set(entries.map(entry => entry.name.split('/')[0]));
    if (roots.size === 1) {
      const candidate = `${[...roots][0]}/`;
      if (entries.every(entry => entry.name.startsWith(candidate))) prefix = candidate;
    }
  }
  const resolve = (path: string): ZipEntry | undefined => byName.get(prefix ? `${prefix}${path}` : path);
  const cache = createByteCache();
  return {
    read: async (path: string) => strFromU8(await readBytes(path)),
    readBytes,
    exists: async (path: string) => Boolean(resolve(path)),
    listPaths: async () => entries.map(entry => (prefix && entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name)),
    clearCache: cache.clear,
  };

  async function readBytes(path: string): Promise<Uint8Array> {
    const cached = cache.get(path);
    if (cached) return cached;
    const entry = resolve(path);
    if (!entry) throw new Error(`패키지에 ${path} 파일이 없습니다.`);
    const value = readZipEntry(bytes, entry);
    cache.set(path, value);
    return value;
  }
}

/**
 * Reads a ZIP package over HTTP byte ranges. Startup fetches only the central directory and
 * individual metadata/assets on demand, instead of downloading a multi-gigabyte archive first.
 */
export async function createRemoteZipSource(url: string): Promise<import('./core.js').WorldSource> {
  const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (!head.ok) throw new Error(`Could not inspect world package: HTTP ${head.status}`);
  const fileSize = Number(head.headers.get('content-length'));
  if (!Number.isSafeInteger(fileSize) || fileSize < 22) throw new Error('Remote world package has no valid content length.');
  if (!/bytes/i.test(head.headers.get('accept-ranges') ?? '')) throw new Error('World package server does not support byte ranges.');

  const tailStart = Math.max(0, fileSize - 0x10000 - 22);
  const tail = await fetchRange(tailStart, fileSize - 1);
  let eocd = -1;
  for (let offset = tail.length - 22; offset >= Math.max(0, tail.length - 0x10000 - 22); offset -= 1) {
    if (readU32(tail, offset) === EOCD_SIGNATURE && offset + 22 + readU16(tail, offset + 20) === tail.length) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('Remote ZIP central directory was not found.');
  if (readU16(tail, eocd + 4) !== 0 || readU16(tail, eocd + 6) !== 0 || readU16(tail, eocd + 8) !== readU16(tail, eocd + 10)) throw new Error('Multi-disk ZIP packages are not supported by ranged loading.');
  const count = readU16(tail, eocd + 10);
  const directorySize = readU32(tail, eocd + 12);
  const directoryOffset = readU32(tail, eocd + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 packages are not supported by ranged loading.');
  if (directoryOffset + directorySize > fileSize) throw new Error('Remote ZIP central directory is outside the archive.');
  const directory = directorySize ? await fetchRange(directoryOffset, directoryOffset + directorySize - 1) : new Uint8Array();
  const entries: ZipEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directory.length || readU32(directory, cursor) !== CENTRAL_SIGNATURE) throw new Error('Remote ZIP central directory is malformed.');
    const method = readU16(directory, cursor + 10);
    const compressedSize = readU32(directory, cursor + 20);
    const size = readU32(directory, cursor + 24);
    const nameLength = readU16(directory, cursor + 28);
    const extraLength = readU16(directory, cursor + 30);
    const commentLength = readU16(directory, cursor + 32);
    const localHeaderOffset = readU32(directory, cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > directory.length) throw new Error('Remote ZIP central directory entry is truncated.');
    const name = strFromU8(directory.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name.endsWith('/')) entries.push({ name: name.replace(/\\/g, '/'), method, compressedSize, size, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  let prefix = '';
  if (!byName.has('manifest.yaml')) {
    const roots = new Set(entries.map(entry => entry.name.split('/')[0]));
    if (roots.size === 1) {
      const candidate = `${[...roots][0]}/`;
      if (entries.every(entry => entry.name.startsWith(candidate))) prefix = candidate;
    }
  }
  const cache = createByteCache();
  return {
    read: async path => strFromU8(await readBytes(path)),
    readBytes,
    exists: async path => Boolean(resolveEntry(path)),
    listPaths: async () => entries.map(entry => prefix && entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name),
    clearCache: cache.clear,
  };

  function resolveEntry(path: string): ZipEntry | undefined { return byName.get(prefix ? `${prefix}${path}` : path); }
  async function fetchRange(start: number, end: number): Promise<Uint8Array> {
    const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store' });
    if (response.status !== 206) throw new Error(`World package range request failed: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== end - start + 1) throw new Error('World package returned an incomplete byte range.');
    return bytes;
  }
  async function readBytes(path: string): Promise<Uint8Array> {
    const cached = cache.get(path);
    if (cached) return cached;
    const entry = resolveEntry(path);
    if (!entry) throw new Error(`Package is missing ${path}.`);
    const headerAndPayload = await fetchRange(entry.localHeaderOffset, Math.min(fileSize - 1, entry.localHeaderOffset + 30 + 1024 + entry.compressedSize - 1));
    if (readU32(headerAndPayload, 0) !== LOCAL_SIGNATURE) throw new Error(`Could not read ZIP entry header: ${path}`);
    const nameLength = readU16(headerAndPayload, 26);
    const extraLength = readU16(headerAndPayload, 28);
    const payloadStart = 30 + nameLength + extraLength;
    let entryBytes = headerAndPayload;
    if (entryBytes.length < payloadStart + entry.compressedSize) entryBytes = await fetchRange(entry.localHeaderOffset, entry.localHeaderOffset + payloadStart + entry.compressedSize - 1);
    const value = readZipEntry(entryBytes, { ...entry, localHeaderOffset: 0 });
    cache.set(path, value);
    return value;
  }
}

/** 압축 해제 없이 파일 목록만 필요할 때(진단·검증용). */
export function listZipPaths(bytes: Uint8Array): string[] {
  return readZipDirectory(bytes).map(entry => entry.name);
}

/** 기존 동작(전체 압축 해제)이 필요한 경우를 위한 별칭. */
export function decodeZipSourceEager(bytes: Uint8Array): import('./core.js').WorldSource {
  const archive = unzipSync(bytes);
  const files = Object.fromEntries(Object.entries(archive).map(([path, value]) => [path.replace(/\\/g, '/'), value]));
  return {
    read: async (path: string) => { const value = files[path]; if (!value) throw new Error(`패키지에 ${path} 파일이 없습니다.`); return strFromU8(value); },
    readBytes: async (path: string) => { const value = files[path]; if (!value) throw new Error(`패키지에 ${path} 파일이 없습니다.`); return value; },
    exists: async (path: string) => path in files,
    listPaths: async () => Object.keys(files),
  };
}
