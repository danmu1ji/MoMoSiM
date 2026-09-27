import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './index';
describe('openai compatible provider',()=>{it('preserves SSE frames split across chunks',async()=>{const encoder=new TextEncoder(); const chunks=['data: {"choices":[{"delta":{"content":"hel','lo"}}]}\n','data: [DONE]\n']; const body=new ReadableStream({start(c){c.enqueue(encoder.encode(chunks[0]));c.enqueue(encoder.encode(chunks[1]));c.close();}}); vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{status:200}))); const events=[]; for await (const e of new OpenAICompatibleProvider('http://localhost').createStream({model:'m',system:'s',messages:[]})) events.push(e); expect(events).toContainEqual({type:'text',text:'hello'}); expect(events.at(-1)).toEqual({type:'done'}); vi.unstubAllGlobals();});});

describe('sampling options', () => {
  it('sends temperature and repetition penalties to the endpoint', async () => {
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init: { body?: string }) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n')); controller.close(); } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider('http://localhost/v1');
    for await (const _ of provider.createStream({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], sampling: { temperature: 1.2, topP: 0.9, maxTokens: 256, frequencyPenalty: 0.5, presencePenalty: 0.2 } })) { /* drain */ }
    expect(body.temperature).toBe(1.2);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(256);
    expect(body.frequency_penalty).toBe(0.5);
    expect(body.presence_penalty).toBe(0.2);
    // 시스템 프롬프트는 맨 앞, 화자 표시가 끝난 메시지는 그대로 전달된다
    expect((body.messages as { role: string; content: string }[])[0]).toEqual({ role: 'system', content: 's' });
    expect((body.messages as { role: string; content: string }[])[1]).toEqual({ role: 'user', content: 'hi' });
    vi.unstubAllGlobals();
  });

  it('sends multimodal image content parts unchanged and reads text deltas', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body?: string }) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"seen"}}]}\ndata: [DONE]\n\n')); controller.close(); } }), { status: 200 });
    }));
    const image = [{ type: 'text' as const, text: 'look' }, { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA', detail: 'auto' as const } }];
    const events = [];
    for await (const event of new OpenAICompatibleProvider('http://localhost/v1').createStream({ model: 'vision-model', system: 'system', messages: [{ role: 'user', content: image }] })) events.push(event);
    expect(((body.messages as { content: unknown }[])[1].content)).toEqual(image);
    expect(events).toContainEqual({ type: 'text', text: 'seen' });
    vi.unstubAllGlobals();
  });

  it('omits parameters that were not set so the server default applies', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body?: string }) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n')); controller.close(); } }), { status: 200 });
    }));
    const provider = new OpenAICompatibleProvider('http://localhost/v1');
    for await (const _ of provider.createStream({ model: 'm', system: 's', messages: [] })) { /* drain */ }
    expect('temperature' in body).toBe(false);
    expect('max_tokens' in body).toBe(false);
    vi.unstubAllGlobals();
  });
});
