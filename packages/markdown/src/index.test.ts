import { describe, expect, it } from 'vitest';
import { parseChatMarkdown, parseMarkdown } from './index';

describe('markdown', () => {
  it('parses frontmatter and links', () => {
    const document = parseMarkdown('---\ntitle: Test\n---\nSee [[character:aria]] [[media:portrait]]');
    expect(document.frontmatter.title).toBe('Test');
    expect(document.links).toEqual(['character:aria']);
    expect(document.nodes.at(-1)?.asset).toBe('portrait');
  });

  it('parses lightweight single-star narration and bold double-star emphasis', () => {
    expect(parseChatMarkdown('일반 *생각* **중요**')).toEqual([
      { type: 'text', text: '일반 ' },
      { type: 'emphasis', text: '생각' },
      { type: 'text', text: ' ' },
      { type: 'strong', text: '중요' },
    ]);
  });
});
