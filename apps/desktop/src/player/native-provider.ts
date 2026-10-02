import { invoke } from '@tauri-apps/api/core';
import { samplingBody, type ChatEvent, type ChatProvider, type ChatRequest, type ModelInfo } from '@world-player/provider';

/** Native Tauri transport avoids WebView CORS restrictions on Android and desktop. */
export class NativeOpenAICompatibleProvider implements ChatProvider {
  readonly id = 'openai-compatible-native';

  constructor(private readonly endpoint: string, private readonly apiKey?: string) {}

  listModels(): Promise<ModelInfo[]> {
    return invoke<ModelInfo[]>('provider_list_models', { endpoint: this.endpoint, apiKey: this.apiKey ?? '' });
  }

  async *createStream(request: ChatRequest): AsyncIterable<ChatEvent> {
    const signal = request.signal;
    if (signal?.aborted) { yield { type: 'done' }; return; }
    let onAbort: (() => void) | undefined;
    try {
      const response = invoke<string>('provider_chat', {
        endpoint: this.endpoint,
        apiKey: this.apiKey ?? '',
        request: {
          model: request.model,
          stream: false,
          messages: [{ role: 'system', content: request.system }, ...request.messages],
          ...samplingBody(request.sampling),
        },
      });
      const text = signal ? await Promise.race([response, new Promise<string>((_resolve, reject) => {
        onAbort = () => reject(new DOMException('Reply stopped.', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      })]) : await response;
      if (signal?.aborted) { yield { type: 'done' }; return; }
      if (text) yield { type: 'text', text };
      yield { type: 'done' };
    } catch (error) {
      if (signal?.aborted) { yield { type: 'done' }; return; }
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) };
    } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); }
  }
}
