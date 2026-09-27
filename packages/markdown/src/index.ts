import { parse as parseYaml } from 'yaml';
import type { ChatNode } from '@world-player/schema';

export interface MarkdownDocument { frontmatter: Record<string, unknown>; body: string; links: string[]; nodes: ChatNode[] }
const directive = /\[\[(media|audio):([^\]]+)\]\]/g;
export function parseMarkdown(input: string): MarkdownDocument {
  let frontmatter: Record<string, unknown> = {}; let body = input;
  if (input.startsWith('---')) { const end = input.indexOf('\n---', 3); if (end >= 0) { frontmatter = (parseYaml(input.slice(3, end)) ?? {}) as Record<string, unknown>; body = input.slice(end + 4).replace(/^\n/, ''); } }
  const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]).filter(x => !x.startsWith('media:') && !x.startsWith('audio:'));
  const nodes: ChatNode[] = []; let cursor = 0;
  for (const match of body.matchAll(directive)) { if (match.index! > cursor) nodes.push({ type: 'text', text: body.slice(cursor, match.index) }); nodes.push({ type: match[1] as 'media' | 'audio', asset: match[2] }); cursor = match.index! + match[0].length; }
  if (cursor < body.length) nodes.push({ type: 'text', text: body.slice(cursor) });
  return { frontmatter, body, links, nodes };
}
export function parseChatMarkdown(input: string): ChatNode[] {
  const nodes: ChatNode[] = []; const token = /(\*\*[^*]+\*\*|\*[^*]+\*|\[\[(?:media|audio):[^\]]+\]\]|\n)/g; let cursor = 0;
  for (const m of input.matchAll(token)) { if (m.index! > cursor) nodes.push({ type: 'text', text: input.slice(cursor, m.index) }); const v = m[0]; if (v === '\n') nodes.push({ type: 'lineBreak' }); else if (v.startsWith('**')) nodes.push({ type: 'strong', text: v.slice(2, -2) }); else if (v.startsWith('*')) nodes.push({ type: 'emphasis', text: v.slice(1, -1) }); else { const [, kind, asset] = v.match(/^\[\[(media|audio):([^\]]+)\]\]$/)!; nodes.push({ type: kind as 'media' | 'audio', asset }); } cursor = m.index! + v.length; }
  if (cursor < input.length) nodes.push({ type: 'text', text: input.slice(cursor) }); return nodes;
}
