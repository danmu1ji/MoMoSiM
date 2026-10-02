import { describe, expect, it } from 'vitest';
import { conversationIdFor, participantsForConversationId, worldScopedChatId } from './conversation-id';

describe('conversation IDs', () => {
  it('isolates direct/group chats by world and treats participant order as irrelevant', () => {
    const ids = ['character:a', 'character:b'];
    expect(conversationIdFor('one', ids)).not.toBe(conversationIdFor('two', ids));
    expect(conversationIdFor('one', ids)).toBe(conversationIdFor('one', [...ids].reverse()));
    expect(conversationIdFor('one', [...ids, ids[0]])).toBe(conversationIdFor('one', ids));
  });

  it('round-trips separators, Unicode and percent signs in identifiers', () => {
    const ids = ['character:한+글%', 'character:a:b'];
    expect(participantsForConversationId(conversationIdFor('world:+%', ids))).toEqual([...ids].sort());
    expect(participantsForConversationId('chat-v2:world:%invalid')).toEqual([]);
    expect(participantsForConversationId('chat-v2:world:a:extra')).toEqual([]);
  });
  it('round-trips a world-scoped one-to-one chat without colliding with legacy IDs', () => {
    const id = worldScopedChatId('world:one', 'character:yuuka');
    expect(id).not.toBe('ba-character:yuuka');
    expect(participantsForConversationId(id)).toEqual(['character:yuuka']);
  });

  it('parses legacy direct and group chat participant IDs', () => {
    expect(participantsForConversationId('ba-character:yuuka')).toEqual(['character:yuuka']);
    expect(participantsForConversationId('ba-character:yuuka+character:koyuki')).toEqual(['character:yuuka', 'character:koyuki']);
  });
});
