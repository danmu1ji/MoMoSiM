import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { NativeOpenAICompatibleProvider } from './native-provider';
import type { ChatEvent, ChatRequest } from '@world-player/provider';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const request: ChatRequest = { model: 'model', system: '', messages: [] };
async function collect(events: AsyncIterable<ChatEvent>) { const result = []; for await (const event of events) result.push(event); return result; }

describe('native provider cancellation', () => {
  it('skips requests cancelled before sending', async () => {
    const signal = AbortSignal.abort();
    expect(await collect(new NativeOpenAICompatibleProvider('https://provider/v1').createStream({ ...request, signal }))).toEqual([{ type: 'done' }]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('returns promptly on Stop and discards a late native reply', async () => {
    let resolve!: (text: string) => void;
    vi.mocked(invoke).mockImplementation(() => new Promise<string>(r => { resolve = r; }));
    const controller = new AbortController();
    const response = collect(new NativeOpenAICompatibleProvider('https://provider/v1').createStream({ ...request, signal: controller.signal }));
    controller.abort();
    expect(await response).toEqual([{ type: 'done' }]);
    resolve('late reply');
  });
  it('reports provider failures and sends sampling through the native command', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('offline'));
    const events = await collect(new NativeOpenAICompatibleProvider('https://provider/v1').createStream(request));
    expect(events[0].type).toBe('error');
    vi.mocked(invoke).mockResolvedValue('hello');
    expect(await collect(new NativeOpenAICompatibleProvider('https://provider/v1').createStream(request))).toEqual([{ type: 'text', text: 'hello' }, { type: 'done' }]);
  });
});
