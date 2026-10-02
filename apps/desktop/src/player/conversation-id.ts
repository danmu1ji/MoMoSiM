const XCHAT_PREFIX = 'ba-xchat:';
const CHAT_PREFIX = 'chat-v2:';

/** Stable across participant order, scoped to the package, and safe for IDs containing + or :. */
export function conversationIdFor(worldId: string, participantIds: string[]): string {
  const ids = [...new Set(participantIds)].sort().map(encodeURIComponent);
  return `${CHAT_PREFIX}${encodeURIComponent(worldId)}:${ids.join('+')}`;
}

export function worldScopedChatId(worldId: string, characterId: string): string {
  return `${XCHAT_PREFIX}${encodeURIComponent(worldId)}:${encodeURIComponent(characterId)}`;
}

export function participantsForConversationId(conversationId: string): string[] {
  try {
    if (conversationId.startsWith(CHAT_PREFIX)) {
      const [worldId, participants, extra] = conversationId.slice(CHAT_PREFIX.length).split(':');
      return worldId && participants && extra === undefined ? participants.split('+').map(decodeURIComponent) : [];
    }
    if (conversationId.startsWith(XCHAT_PREFIX)) {
      const [worldId, characterId] = conversationId.slice(XCHAT_PREFIX.length).split(':');
      return worldId && characterId ? [decodeURIComponent(characterId)] : [];
    }
    return conversationId.startsWith('ba-') ? conversationId.slice(3).split('+').filter(Boolean) : [];
  } catch { return []; }
}
