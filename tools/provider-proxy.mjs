/** Fetch an OpenAI-compatible model catalog from the local app backend, avoiding browser CORS. */
export async function fetchProviderModels(endpoint, apiKey = '') {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Provider endpoint must use HTTP or HTTPS.');
  const url = `${base.toString().replace(/\/$/, '')}/models`;
  const response = await fetch(url, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(20000),
  });
  const responseText = await response.text();
  let payload;
  try { payload = JSON.parse(responseText); }
  catch { payload = undefined; }
  if (!response.ok) {
    const detail = typeof payload?.error?.message === 'string' ? `: ${payload.error.message}` : '';
    throw new Error(`Provider returned HTTP ${response.status}${detail}`);
  }
  if (!Array.isArray(payload?.data)) throw new Error('Provider response did not contain a model list.');
  return payload.data.filter(model => model && typeof model.id === 'string')
    .map(model => ({ id: model.id, name: typeof model.name === 'string' ? model.name : model.id }));
}

/** Start an OpenAI-compatible streaming completion without buffering its response. */
export async function fetchProviderChat(endpoint, apiKey = '', request, signal) {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Provider endpoint must use HTTP or HTTPS.');
  if (base.username || base.password) throw new Error('Provider endpoint must not contain embedded credentials.');
  const url = `${base.toString().replace(/\/$/, '')}/chat/completions`;
  return fetch(url, {
    method: 'POST',
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      'content-type': 'application/json',
      accept: 'text/event-stream, application/json',
    },
    body: JSON.stringify(request),
    signal,
  });
}
