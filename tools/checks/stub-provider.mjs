// Minimal OpenAI-compatible provider used to verify the desktop chat path end-to-end.
// GET /v1/models         → model list
// POST /v1/chat/completions → SSE stream (stream: true) or single JSON response
// Every request is appended to --log=<path> as JSON lines for evidence.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, '').split('=')));
const port = Number(args.port ?? 5301);
const logPath = args.log ?? '/tmp/stub-provider.log';
let hit = 0;

const server = createServer((request, response) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (request.method === 'OPTIONS') { response.writeHead(204, headers); response.end(); return; }

  if (request.method === 'GET' && request.url?.startsWith('/v1/models')) {
    response.writeHead(200, headers);
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-echo-1', object: 'model' }, { id: 'stub-echo-2', object: 'model' }] }));
    return;
  }

  if (request.method === 'POST' && request.url?.startsWith('/v1/chat/completions')) {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const system = String(body.messages?.find(message => message.role === 'system')?.content ?? '');
      // 진행자 호출(누가 먼저 말할지)에는 참가자 이름을 돌려준다.
      if (system.includes('turn director')) {
        appendFileSync(logPath, `${JSON.stringify({ role: 'director', model: body.model, temperature: body.temperature ?? null, transcript: String(body.messages?.[1]?.content ?? '').slice(0, 400) })}\n`);
        const startName = args.start ?? '';
        const text = startName || 'end';
        const stream = () => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n`);
        response.writeHead(200, { ...headers, 'content-type': 'text/event-stream' });
        response.end(stream());
        return;
      }
      const speaker = (system.match(/You are ([^.\n]+)\./) ?? [, 'unknown'])[1].trim();
      const knowledge = (system.match(/Visible world knowledge:\n([\s\S]*?)\n(?:Events you remember[^\n]*|Media you may attach[^\n]*|Knowledge boundary):/) ?? [, '- none'])[1].trim().replace(/\n/g, ' | ');
      const memoryMatch = system.match(/Events you remember[^\n]*\n([\s\S]*?)(?:\nMedia you may attach|\nKnowledge boundary|$)/);
      const memory = memoryMatch ? memoryMatch[1].replace(/\s+/g, ' ').trim().slice(0, 400) : '';
      const turns = (body.messages ?? []).length;
      // 화자 표시가 있는 대화 기록(다른 캐릭터 발언이 '이름: ...' user 메시지로 들어오는지 확인용)
      const incoming = (body.messages ?? []).filter(message => message.role === 'user').map(message => message.content).join('\n');
      appendFileSync(logPath, `${JSON.stringify({
        speaker, model: body.model, turns,
        sampling: { temperature: body.temperature ?? null, frequencyPenalty: body.frequency_penalty ?? null, presencePenalty: body.presence_penalty ?? null },
        hearsEarlierSpeakers: /: /.test(incoming),
        incoming,
        knowledge, memoryChars: memory.length, memory, stream: Boolean(body.stream), authorization: request.headers.authorization ?? null,
      })}\n`);
      // 대화 사이클 검증용: 다른 화자에게 턴을 넘기고, 3번째 발언에서 정리한다.
      const hop = Number(args.hops ?? 3);
      const next = args.next ?? '';
      const directive = hit >= hop ? '[[next:end]]' : next ? `[[next:${next}]]` : '[[next:end]]';
      hit += 1;
      const reply = `${speaker} 응답 (turns=${turns})\n아는 지식: ${knowledge}\n${directive}`;
      if (body.stream) {
        response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        for (const piece of reply.match(/[\s\S]{1,12}/g) ?? []) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        response.write('data: [DONE]\n\n');
        response.end();
      } else {
        response.writeHead(200, headers);
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
      }
    });
    return;
  }

  response.writeHead(404, headers);
  response.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '127.0.0.1', () => console.log(`stub provider listening on http://127.0.0.1:${port}/v1 (log: ${logPath})`));
