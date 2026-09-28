import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchProviderChat, fetchProviderModels } from '../../tools/provider-proxy.mjs';

const worldsDirectory = resolve(import.meta.dirname, '../../worlds');

async function readJsonRequest(request: IncomingMessage, response: ServerResponse, maxBytes: number): Promise<Record<string, unknown> | undefined> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? '')) {
    response.writeHead(415, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'JSON content type required.' }));
    return undefined;
  }
  try {
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError('Request body is too large.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new RangeError('Request body is too large.');
      chunks.push(Buffer.from(chunk));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SyntaxError('JSON object required.');
    return payload as Record<string, unknown>;
  } catch (error) {
    response.writeHead(error instanceof RangeError ? 413 : 400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error instanceof RangeError ? 'Request body is too large.' : 'Invalid JSON body.' }));
    return undefined;
  }
}

export default defineConfig({
  plugins: [react(), {
    name: 'danmutalk-dev-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] === '/api/provider/chat/completions') {
          if (request.method !== 'POST') {
            response.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          const controller = new AbortController();
          request.on('aborted', () => controller.abort());
          response.on('close', () => { if (!response.writableEnded) controller.abort(); });
          try {
            const payload = await readJsonRequest(request, response, 32 * 1024 * 1024);
            if (!payload) return;
            const chatRequest = payload.request as { model?: string; messages?: unknown[] } | undefined;
            if (typeof payload.endpoint !== 'string' || !chatRequest || typeof chatRequest.model !== 'string' || !Array.isArray(chatRequest.messages)) throw new Error('A provider endpoint and valid chat request are required.');
            const upstream = await fetchProviderChat(payload.endpoint, typeof payload.apiKey === 'string' ? payload.apiKey : '', chatRequest, controller.signal);
            response.writeHead(upstream.status, {
              'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
              'cache-control': 'no-cache, no-transform',
              'x-accel-buffering': 'no',
            });
            if (!upstream.body) { response.end(); return; }
            const reader = upstream.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!response.write(Buffer.from(value))) await new Promise(resolve => response.once('drain', resolve));
            }
            response.end();
          } catch (error) {
            if (response.headersSent) { response.destroy(); return; }
            response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ error: error instanceof Error ? `Could not reach provider: ${error.message}` : 'Provider request failed.' }));
          }
          return;
        }
        if (request.url?.split('?')[0] === '/api/provider/models') {
          if (request.method !== 'POST') {
            response.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ error: 'method not allowed' }));
            return;
          }
          try {
            const payload = await readJsonRequest(request, response, 64 * 1024);
            if (!payload) return;
            const models = await fetchProviderModels(typeof payload.endpoint === 'string' ? payload.endpoint : '', typeof payload.apiKey === 'string' ? payload.apiKey : '');
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ models }));
          } catch (error) {
            response.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Model listing failed.' }));
          }
          return;
        }
        const path = request.url?.split('?')[0] ?? '';
        if (path === '/api/worlds' && request.method === 'GET') {
          try {
            const entries = await readdir(worldsDirectory, { withFileTypes: true });
            const worlds = entries.filter(entry => entry.isFile() && /\.(?:😭|zip)$/i.test(entry.name))
              .map(entry => ({ name: entry.name, url: `/api/worlds/${encodeURIComponent(entry.name)}` }))
              .sort((left, right) => left.name.localeCompare(right.name));
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ worlds }));
          } catch {
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            response.end(JSON.stringify({ worlds: [] }));
          }
          return;
        }
        if (!path.startsWith('/api/worlds/')) return next();
        try {
          const name = decodeURIComponent(path.slice('/api/worlds/'.length));
          if (!name || name !== name.split(/[\\/]/).pop() || !/\.(?:😭|zip)$/i.test(name)) throw new Error('not a world archive');
          const archive = resolvePath(worldsDirectory, name);
          if (dirname(archive) !== worldsDirectory) throw new Error('invalid path');
          const info = await stat(archive);
          if (!info.isFile()) throw new Error('not a file');
          const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
          if (request.headers.range && !range) {
            response.writeHead(416, { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' });
            response.end();
            return;
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
              response.end();
              return;
            }
          }
          const partial = Boolean(range);
          response.writeHead(partial ? 206 : 200, {
            'content-type': 'application/zip',
            'content-length': end - start + 1,
            'accept-ranges': 'bytes',
            ...(partial ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
            'cache-control': 'no-cache',
          });
          if (request.method === 'HEAD') return response.end();
          createReadStream(archive, { start, end }).pipe(response);
        } catch {
          response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'World package not found in the worlds folder.' }));
        }
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        player: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
});
