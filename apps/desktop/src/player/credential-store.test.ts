import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadProviderSettings, pickSettings, saveApiKey, saveProviderSettings, clearProviderSettings } from './credential-store';

/** 최소 localStorage 대역. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
    clear: () => map.clear(),
  };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('provider 설정 저장소', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('저장할 설정만 추린다(모르는 키·잘못된 타입 제거)', () => {
    expect(pickSettings({ endpoint: 'http://x/v1', model: 'm', systemInstructions: 'Keep responses concise.', temperature: 1.2, contextWindow: 128_000, contextWindowOverride: 64_000, variation: true, maxCycleSpeakers: 6, apiKey: '비밀', nope: 1 }))
      .toEqual({ endpoint: 'http://x/v1', model: 'm', systemInstructions: 'Keep responses concise.', temperature: 1.2, contextWindow: 128_000, contextWindowOverride: 64_000, variation: true, maxCycleSpeakers: 6 });
    expect(pickSettings({ temperature: Number.NaN, model: 42, variation: 'yes' })).toEqual({});
    expect(pickSettings({ systemInstructions: 42 })).toEqual({});
    expect(pickSettings(undefined)).toEqual({});
  });

  it('서버가 있으면 설정을 서버 파일에 저장하고, 없으면 브라우저 저장소에 넣는다', async () => {
    const calls: { url: string; body?: string }[] = [];
    let serverSettings: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
      if (String(url).endsWith('/api/health')) return jsonResponse({ ok: true });
      calls.push({ url: String(url), body: init?.body });
      if (init?.method === 'PUT') serverSettings = JSON.parse(init.body ?? '{}').settings;
      return jsonResponse({ saved: true, settings: serverSettings });
    }));
    const settings = { endpoint: 'http://127.0.0.1:9999/v1', model: 'm-1', systemInstructions: 'Keep replies concise.', temperature: 0.9, maxCycleSpeakers: 4 };
    expect(await saveProviderSettings(settings)).toBe('server');
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].body ?? '{}').settings).toEqual(settings);
    const loaded = await loadProviderSettings();
    expect(loaded.settings?.systemInstructions).toBe('Keep replies concise.');
    // 로컬에도 사본을 둔다(서버가 사라져도 마지막 설정을 쓸 수 있게)
    expect(JSON.parse(storage.getItem('world-player.provider') ?? '{}')).toMatchObject({ model: 'm-1' });

    vi.unstubAllGlobals();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await saveProviderSettings({ model: 'm-2' })).toBe('browser');
    expect(JSON.parse(storage.getItem('world-player.provider') ?? '{}')).toMatchObject({ model: 'm-2' });
  });

  it('불러오기는 서버를 먼저 보고, 서버가 없으면 브라우저 저장소를 쓴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/health')) return jsonResponse({ ok: true });
      return jsonResponse({ secret: 'sk-secret', settings: { endpoint: 'http://server/v1', temperature: 1.4 } });
    }));
    const fromServer = await loadProviderSettings();
    expect(fromServer.backend).toBe('server');
    expect(fromServer.settings).toEqual({ endpoint: 'http://server/v1', temperature: 1.4 });

    storage.setItem('world-player.provider', JSON.stringify({ model: 'local-model', variation: false }));
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const fromBrowser = await loadProviderSettings();
    expect(fromBrowser.backend).toBe('browser');
    expect(fromBrowser.settings).toEqual({ model: 'local-model', variation: false });
  });

  it('설정 삭제는 키를 지우지 않는다(서버 요청도 설정 범위로만 간다)', async () => {
    storage.setItem('world-player.api-key', 'sk-keep');
    storage.setItem('world-player.provider', JSON.stringify({ model: 'x' }));
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/health')) return jsonResponse({ ok: true });
      urls.push(String(url));
      return jsonResponse({ cleared: 'settings' });
    }));
    await clearProviderSettings();
    expect(storage.getItem('world-player.provider')).toBeNull();
    expect(storage.getItem('world-player.api-key')).toBe('sk-keep');
    expect(urls).toEqual(['/api/credentials?scope=settings']);
  });

  it('서버가 있으면 API 키를 브라우저 저장소에 남기지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/health')) return jsonResponse({ ok: true });
      return jsonResponse({ saved: true });
    }));
    expect(await saveApiKey('sk-secret-value')).toBe('server');
    expect(storage.getItem('world-player.api-key')).toBeNull();
  });
});
