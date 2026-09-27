import { parseChatMarkdown } from '@world-player/markdown';
import type { ChatMessage } from '@world-player/schema';

/** Row shape persisted by the Rust `conversation_save` / `conversation_load` commands. */
export interface StoredTurn { id: string; conversation_id: string; speaker_type: string; speaker_id: string; body: string; created_at: string }

export function toStoredTurn(conversationId: string, message: ChatMessage): StoredTurn {
  return {
    id: message.id,
    conversation_id: conversationId,
    speaker_type: message.speaker.type,
    speaker_id: message.speaker.id,
    body: message.content.map(node => node.type === 'lineBreak' ? '\n' : node.type === 'media' || node.type === 'audio' ? `[[${node.type}:${node.asset ?? ''}]]` : node.type === 'image' ? `[[image:${encodeURIComponent(node.alt ?? '')}:${node.imageDataUrl ?? ''}]]` : node.type === 'strong' ? `**${node.text ?? ''}**` : node.type === 'emphasis' ? `*${node.text ?? ''}*` : node.text ?? '').join(''),
    created_at: message.timestamp,
  };
}

export function fromStoredTurn(turn: StoredTurn): ChatMessage {
  const nodes: ChatMessage['content'] = [];
  let cursor = 0;
  const imagePattern = /\[\[image:([^:]*):(data:image\/(?:png|jpeg|webp|gif);base64,[^\]]+)\]\]/g;
  for (const match of turn.body.matchAll(imagePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(...parseChatMarkdown(turn.body.slice(cursor, index)));
    nodes.push({ type: 'image', alt: decodeURIComponent(match[1]), imageDataUrl: match[2] });
    cursor = index + match[0].length;
  }
  if (cursor < turn.body.length) nodes.push(...parseChatMarkdown(turn.body.slice(cursor)));

  return { id: turn.id, speaker: { type: turn.speaker_type === 'player' ? 'player' : 'character', id: turn.speaker_id }, content: nodes, timestamp: turn.created_at };
}

export function fromStoredTurns(turns: StoredTurn[]): ChatMessage[] { return turns.map(fromStoredTurn); }
