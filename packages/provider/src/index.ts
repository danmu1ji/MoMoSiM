import type { ChatMessage } from '@world-player/schema';

export interface ModelInfo { id: string; name: string; }

/** 모델에게 보내는 최종 메시지. 어떤 화자의 말인지는 엔진이 정해서 넘긴다. */
export type ProviderContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };
export type ProviderContent = string | ProviderContentPart[];
export interface ProviderMessage { role: 'user' | 'assistant'; content: ProviderContent }

/** 생성 파라미터. 캐릭터마다 다르게 주면 목소리가 갈린다(엔진 `samplingFor`). */
export interface SamplingOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface ChatRequest { model: string; system: string; messages: ProviderMessage[]; sampling?: SamplingOptions; signal?: AbortSignal; }
export type ChatEvent = { type: 'text'; text: string } | { type: 'done' } | { type: 'error'; error: Error };
export interface ChatProvider { id: string; listModels(): Promise<ModelInfo[]>; createStream(request: ChatRequest): AsyncIterable<ChatEvent>; }

/** 샘플링 옵션 → OpenAI 호환 본문 필드. 지정하지 않은 값은 아예 보내지 않는다(서버 기본값 존중). */
export function samplingBody(sampling?: SamplingOptions): Record<string, number> {
  if (!sampling) return {};
  const body: Record<string, number> = {};
  if (sampling.temperature !== undefined) body.temperature = sampling.temperature;
  if (sampling.topP !== undefined) body.top_p = sampling.topP;
  if (sampling.maxTokens !== undefined) body.max_tokens = sampling.maxTokens;
  if (sampling.frequencyPenalty !== undefined) body.frequency_penalty = sampling.frequencyPenalty;
  if (sampling.presencePenalty !== undefined) body.presence_penalty = sampling.presencePenalty;
  return body;
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly id = 'openai-compatible';
  constructor(private readonly endpoint: string, private readonly apiKey?: string, private readonly browserProxy?: string) {}
  async listModels(): Promise<ModelInfo[]> { const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/models`, { headers: this.headers() }); if (!response.ok) throw new Error(`Model listing failed: ${response.status}`); const json = await response.json() as { data?: { id: string }[] }; return (json.data ?? []).map(x => ({ id: x.id, name: x.id })); }
  async *createStream(request: ChatRequest): AsyncIterable<ChatEvent> {
    const chatRequest = {
      model: request.model,
      stream: true,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      ...samplingBody(request.sampling),
    };
    let response: Response;
    try {
      response = await fetch(this.browserProxy ?? `${this.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { ...(!this.browserProxy ? this.headers() : {}), 'content-type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify(this.browserProxy ? { endpoint: this.endpoint, apiKey: this.apiKey ?? '', request: chatRequest } : chatRequest),
      });
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
      throw new Error(`Could not reach the provider at ${this.endpoint}${this.browserProxy ? ' through the local chat proxy' : ''}${detail}`, { cause: error });
    }
    if (!response.ok || !response.body) {
      const responseText = await response.text().catch(() => '');
      let detail = '';
      try {
        const payload = JSON.parse(responseText) as { error?: { message?: string } | string };
        detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? '';
      } catch { detail = responseText.slice(0, 240); }
      yield { type: 'error', error: new Error(`Chat request failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`) };
      return;
    }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) { const {done,value} = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), {stream: !done}); const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''; for (const line of lines.filter(x => x.startsWith('data:'))) { const payload = line.slice(5).trim(); if (payload === '[DONE]') { yield {type:'done'}; return; } try { const content = (JSON.parse(payload) as {choices?:{delta?:{content?:string | { type?: string; text?: string }[]}}[]}).choices?.[0]?.delta?.content; const text = typeof content === 'string' ? content : content?.map(part => part.text ?? '').join(''); if (text) yield {type:'text',text}; } catch { yield {type:'error',error:new Error('Malformed SSE JSON')}; } } if (done) break; } yield {type:'done'};
  }
  private headers(): Record<string,string> { return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}; }
}

export type { ChatMessage };
