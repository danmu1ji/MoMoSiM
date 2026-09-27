#!/usr/bin/env node
/**
 * 월드 플레이어 로컬 서버.
 *
 * 하는 일:
 *   1) 빌드된 웹 앱(apps/desktop/dist)을 정적으로 서비스한다 — 브라우저에서 그대로 플레이.
 *   2) **API 키 + Provider 설정 저장/불러오기**를 서버 파일로 제공한다(웹 서버 모드에서도 유지된다).
 *      - 저장 위치: ~/.config/world-player/credentials.json (권한 600)
 *      - 저장 내용: { secret: API 키, settings: 엔드포인트·모델·temperature 등 }
 *      - 같은 출처(로컬)의 페이지에서만 읽을 수 있다.
 *
 * 사용:
 *   node tools/serve.mjs [--port 5173] [--host 127.0.0.1] [--dir apps/desktop/dist]
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, chmod } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fetchProviderChat, fetchProviderModels } from './provider-proxy.mjs';
import { ensureTtsWorker, stopTtsWorker } from './tts-worker.mjs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const PORT = Number(argOf('--port', process.env.PORT ?? 5173));
const HOST = argOf('--host', '127.0.0.1');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
if (!LOOPBACK_HOSTS.has(HOST)) throw new Error('The local server must bind to a loopback address because it serves saved API credentials.');
const HOST_FOR_URL = HOST === '::1' ? '[::1]' : HOST;
const ROOT = resolve(argOf('--dir', 'apps/desktop/dist'));
const BLUE_ARCHIVE = resolve(argOf('--blue-archive', 'worlds/blue-archive.😭'));
const CREDENTIAL_PATH = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'world-player', 'credentials.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.wast': 'application/wasm',
  '.😭': 'application/zip',
};

async function readCredentials() {
  try {
    const raw = await readFile(CREDENTIAL_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      secret: typeof parsed.secret === 'string' ? parsed.secret : '',
      secrets: parsed.secrets && typeof parsed.secrets === 'object' ? parsed.secrets : {},
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : null,
      settingsUpdatedAt: typeof parsed.settingsUpdatedAt === 'number' ? parsed.settingsUpdatedAt : 0,
    };
  } catch {
    return { secret: '', secrets: {}, settings: null, settingsUpdatedAt: 0 };
  }
}

async function writeCredentials(payload) {
  await mkdir(dirname(CREDENTIAL_PATH), { recursive: true });
  await writeFile(CREDENTIAL_PATH, JSON.stringify(payload, null, 1), { mode: 0o600 });
  await chmod(CREDENTIAL_PATH, 0o600).catch(() => {});
}

let credentialMutationQueue = Promise.resolve();
function serializeCredentialMutation(operation) {
  const result = credentialMutationQueue.then(operation);
  credentialMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}

async function body(request, maxBytes) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError('Request body is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new RangeError('Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('JSON object required.');
  return parsed;
}

async function readJsonBody(request, response, maxBytes) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? '')) {
    json(response, 415, { error: 'JSON content type required.' });
    return undefined;
  }
  try { return await body(request, maxBytes); }
  catch (error) {
    json(response, error instanceof RangeError ? 413 : 400, { error: error instanceof RangeError ? 'Request body is too large.' : 'Invalid JSON body.' });
    return undefined;
  }
}

function trustedHostAndOrigin(request) {
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (host.username || host.password || !LOOPBACK_HOSTS.has(host.hostname) || Number(host.port || 80) !== activePort) return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname) && Number(parsed.port || 80) === activePort;
  } catch { return false; }
}

const server = createServer(async (request, response) => {
  if (!trustedHostAndOrigin(request)) return json(response, 403, { error: 'Only this local application origin may access the server.' });
  const url = new URL(request.url ?? '/', `http://${HOST_FOR_URL}:${PORT}`);

  // Large game data stays outside dist and is streamed only when the user opens it.
  if (url.pathname === '/api/blue-archive') {
    try {
      const info = await stat(BLUE_ARCHIVE);
      const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (request.headers.range && !range) {
        response.writeHead(416, { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' });
        return response.end();
      }
      let start = 0;
      let end = info.size - 1;
      if (range) {
        if (range[1]) start = Number(range[1]);
        if (range[2]) end = Number(range[2]);
        if (!range[1]) start = Math.max(0, info.size - end), end = info.size - 1;
        end = Math.min(end, info.size - 1);
        if (start >= info.size || start > end) {
          response.writeHead(416, { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' });
          return response.end();
        }
      }
      const partial = Boolean(range);
      response.writeHead(partial ? 206 : 200, {
        'content-type': 'application/zip', 'content-length': end - start + 1,
        'accept-ranges': 'bytes', ...(partial ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
        'cache-control': 'no-cache',
      });
      if (request.method === 'HEAD') return response.end();
      return createReadStream(BLUE_ARCHIVE, { start, end }).pipe(response);
    } catch {
      return json(response, 404, { error: `Blue Archive package not found: ${BLUE_ARCHIVE}` });
    }
  }

  // ── API: 자격증명(API 키) ──
  if (url.pathname === '/api/health') return json(response, 200, { ok: true, credentials: existsSync(CREDENTIAL_PATH) });
  if (url.pathname === '/api/credentials') {
    if (request.method === 'GET') {
      const stored = await readCredentials();
      const account = url.searchParams.get('account') ?? 'default';
      const secret = account === 'default' ? stored.secret : stored.secrets[account];
      return json(response, 200, { secret: typeof secret === 'string' ? secret : '', settings: stored.settings, settingsUpdatedAt: stored.settingsUpdatedAt });
    }
    // PUT/POST는 부분 갱신이다: 보낸 필드만 바뀐다(설정만 저장하거나 키만 저장할 수 있다).
    if (request.method === 'PUT' || request.method === 'POST') {
      const payload = await readJsonBody(request, response, 128 * 1024);
      if (payload === undefined) return;
      const next = await serializeCredentialMutation(async () => {
        const stored = await readCredentials();
        const account = typeof payload.account === 'string' && /^[a-z0-9-]{1,40}$/i.test(payload.account) ? payload.account : 'default';
        const secrets = { ...stored.secrets };
        let primarySecret = stored.secret;
        if (typeof payload.secret === 'string') {
          if (account === 'default') primarySecret = payload.secret;
          else secrets[account] = payload.secret;
        }
        const updated = {
          secret: primarySecret,
          secrets,
          // Settings updates are partial. Voice toggles must not erase provider endpoint/model.
          settings: payload.settings && typeof payload.settings === 'object' ? { ...(stored.settings ?? {}), ...payload.settings } : stored.settings,
          settingsUpdatedAt: payload.settings && typeof payload.settings === 'object'
            ? (typeof payload.settingsUpdatedAt === 'number' ? payload.settingsUpdatedAt : Date.now())
            : stored.settingsUpdatedAt,
          updatedAt: new Date().toISOString(),
        };
        if (!updated.secret && !Object.keys(updated.secrets).length && !updated.settings) return null;
        await writeCredentials(updated);
        return updated;
      });
      if (!next) return json(response, 400, { error: 'secret or settings required' });
      return json(response, 200, { saved: true, savedFields: Object.keys(payload).filter(key => key === 'secret' || key === 'settings') });
    }
    if (request.method === 'DELETE') {
      const scope = url.searchParams.get('scope') ?? 'secret';
      const account = url.searchParams.get('account') ?? 'default';
      await serializeCredentialMutation(async () => {
        const stored = await readCredentials();
        const secrets = { ...stored.secrets };
        if (scope === 'secret' && account !== 'default') delete secrets[account];
        const next = {
          secret: scope === 'settings' || account !== 'default' ? stored.secret : '',
          secrets,
          settings: scope === 'secret' ? stored.settings : null,
          settingsUpdatedAt: scope === 'settings' ? 0 : stored.settingsUpdatedAt,
          updatedAt: new Date().toISOString(),
        };
        await writeCredentials(next);
      });
      return json(response, 200, { cleared: scope });
    }
    return json(response, 405, { error: 'method not allowed' });
  }

  if (url.pathname === '/api/provider/models') {
    if (request.method !== 'POST') return json(response, 405, { error: 'method not allowed' });
    const payload = await readJsonBody(request, response, 64 * 1024);
    if (payload === undefined) return;
    const credentials = await readCredentials();
    try {
      const models = await fetchProviderModels(String(payload.endpoint ?? ''), typeof payload.apiKey === 'string' ? payload.apiKey : credentials.secret);
      return json(response, 200, { models });
    } catch (error) {
      return json(response, 502, { error: error instanceof Error ? error.message : 'Model listing failed.' });
    }
  }

  if (url.pathname === '/api/tts/ensure') {
    if (request.method !== 'POST') return json(response, 405, { error: 'method not allowed' });
    const payload = await readJsonBody(request, response, 4096);
    if (payload === undefined) return;
    try { return json(response, 200, await ensureTtsWorker(typeof payload.endpoint === 'string' ? payload.endpoint : undefined)); }
    catch (error) { return json(response, 503, { error: error instanceof Error ? error.message : 'Could not start the local TTS service.' }); }
  }

  if (url.pathname === '/api/provider/chat/completions') {
    if (request.method !== 'POST') return json(response, 405, { error: 'method not allowed' });
    const payload = await readJsonBody(request, response, 32 * 1024 * 1024);
    if (payload === undefined) return;
    const endpoint = typeof payload.endpoint === 'string' ? payload.endpoint : '';
    const chatRequest = payload.request && typeof payload.request === 'object' ? payload.request : null;
    if (!endpoint || !chatRequest || typeof chatRequest.model !== 'string' || !Array.isArray(chatRequest.messages)) {
      return json(response, 400, { error: 'A provider endpoint and valid chat request are required.' });
    }
    const credentials = await readCredentials();
    const apiKey = typeof payload.apiKey === 'string' && payload.apiKey ? payload.apiKey : credentials.secret;
    const controller = new AbortController();
    request.on('aborted', () => controller.abort());
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const upstream = await fetchProviderChat(endpoint, apiKey, chatRequest, controller.signal);
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      });
      if (!upstream.body) return response.end();
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!response.write(Buffer.from(value))) await new Promise(resolve => response.once('drain', resolve));
      }
      response.end();
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const detail = error instanceof Error ? error.message : 'Provider request failed.';
      return json(response, 502, { error: `Could not reach provider: ${detail}` });
    }
    return;
  }

  // ── 정적 파일 ──
  if (!existsSync(ROOT)) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end(`빌드 결과가 없습니다: ${ROOT}\n먼저 실행하세요: pnpm --filter @world-player/desktop build`);
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const target = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    if (!extname(pathname)) filePath = join(ROOT, 'index.html'); // SPA 폴백
  }
  try {
    const data = await readFile(filePath);
    response.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(data);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});

let activePort = PORT;
let portAttempts = 0;
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && portAttempts < 10) {
    portAttempts += 1;
    activePort = PORT + portAttempts;
    console.warn(`포트 ${activePort - 1} 사용 중 — ${activePort} 포트로 다시 시작합니다.`);
    server.listen(activePort, HOST);
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
server.on('close', stopTtsWorker);
process.once('SIGINT', () => { stopTtsWorker(); server.close(); });
process.once('SIGTERM', () => { stopTtsWorker(); server.close(); });

server.on('listening', () => {
  const address = server.address();
  if (address && typeof address === 'object') activePort = address.port;
  console.log(`▶ 월드 플레이어 서버: http://${HOST}:${activePort}`);
  console.log(`  정적 루트: ${ROOT}`);
  console.log(`  Blue Archive package: ${BLUE_ARCHIVE}`);
  console.log(`  키·설정 저장: ${CREDENTIAL_PATH} (권한 600)`);
});
server.listen(PORT, HOST);
