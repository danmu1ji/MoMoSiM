import type { ChatNode } from '@world-player/schema';

export interface TranscriptMessage {
  speaker: string;
  nodes: ChatNode[];
  createdAt: string;
  edited: boolean;
}

/** Plain text only: never embed an attachment's data URL or execute message Markdown. */
export function messageText(nodes: ChatNode[]): string {
  return nodes.map(node => {
    if (node.type === 'lineBreak') return '\n';
    if (node.type === 'image') return `[image: ${node.alt || 'attachment'}]`;
    if (node.type === 'media') return `[media: ${node.asset || 'attachment'}]`;
    return node.text ?? '';
  }).join('');
}

export function searchMessages<T extends TranscriptMessage>(messages: T[], query: string): T[] {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!needle) return messages;
  return messages.filter(message => `${message.speaker}\n${messageText(message.nodes)}`.normalize('NFKC').toLocaleLowerCase().includes(needle));
}

export function transcriptText(world: string, timeline: string, messages: TranscriptMessage[]): string {
  return [`DanmuTalk — ${world}`, `Timeline: ${timeline}`, '', ...messages.map(message =>
    `[${message.createdAt}] ${message.speaker}${message.edited ? ' (edited)' : ''}\n${messageText(message.nodes)}`,
  )].join('\n\n');
}

export function transcriptFilename(world: string): string {
  return `danmutalk-${world.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 64) || 'chat'}.txt`;
}
