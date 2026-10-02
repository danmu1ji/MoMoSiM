import { describe, expect, it } from 'vitest';
import { messageText, searchMessages, transcriptFilename, transcriptText, type TranscriptMessage } from './chat-tools';

const messages: TranscriptMessage[] = [
  { speaker: 'Aria', nodes: [{ type: 'text', text: 'Hello harbor' }, { type: 'lineBreak' }, { type: 'strong', text: '안녕하세요' }], createdAt: '2026-10-02T00:00:00Z', edited: false },
  { speaker: 'You', nodes: [{ type: 'image', imageDataUrl: 'data:image/png;base64,SECRET', alt: 'photo' }, { type: 'media', asset: 'portrait' }], createdAt: '2026-10-02T00:01:00Z', edited: true },
];

describe('chat tools', () => {
  it('searches speaker names and rendered content, preserving original order', () => {
    expect(searchMessages(messages, ' ARIA ')).toEqual([messages[0]]);
    expect(searchMessages(messages, 'HARBOR')).toEqual([messages[0]]);
    expect(searchMessages(messages, '안녕하세요')).toEqual([messages[0]]);
    expect(searchMessages(messages, 'ｈｅｌｌｏ')).toEqual([messages[0]]);
    expect(searchMessages(messages, 'missing')).toEqual([]);
    expect(searchMessages(messages, '  ')).toBe(messages);
  });
  it('serializes line breaks and attachment descriptions without embedding binary data', () => {
    expect(messageText(messages[0].nodes)).toBe('Hello harbor\n안녕하세요');
    const exportText = transcriptText('Echo World', 'Opening', messages);
    expect(exportText).toContain('Timeline: Opening');
    expect(exportText).toContain('You (edited)');
    expect(exportText).toContain('[image: photo][media: portrait]');
    expect(exportText).not.toContain('SECRET');
    expect(exportText).not.toContain('base64');
  });
  it('makes bounded filenames without path traversal or control characters', () => {
    expect(transcriptFilename('../../world\nname')).not.toMatch(/[\/\n]/);
    expect(transcriptFilename('a'.repeat(1000)).length).toBeLessThan(90);
    expect(transcriptFilename('')).toBe('danmutalk-chat.txt');
  });
});
