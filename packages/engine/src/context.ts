import type { Character, ChatMessage, Entity } from '@world-player/schema';

export type ContextStrategy = 'full' | 'medium' | 'high';

const contentText = (message: ChatMessage) => message.content.map(node => node.type === 'text' ? node.text : node.alt ?? '').join(' ');
const terms = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

function relevance(text: string, queryTerms: Set<string>, query: string): number {
  const lower = text.toLocaleLowerCase();
  const tokens = terms(text);
  let score = 0;
  for (const token of tokens) if (queryTerms.has(token)) score += token.length > 5 ? 3 : 1;
  if (query.length > 1 && lower.includes(query)) score += 12;
  return score;
}

/** Lossy context selection used only when a large group explicitly uses compact mode. */
export function compactContext(input: {
  strategy: ContextStrategy;
  characters: Character[];
  entities: Entity[];
  history: ChatMessage[];
  speaker?: Character;
  query: string;
  language?: 'ko' | 'en';
}): { characters: Character[]; entities: Entity[]; history: ChatMessage[] } {
  if (input.strategy === 'full') return { characters: input.characters, entities: input.entities, history: input.history };

  const high = input.strategy === 'high';
  const query = [input.query, ...input.history.slice(-12).map(contentText)].join(' ').toLocaleLowerCase();
  const queryTerms = new Set(terms(query));
  const displayName = (character: Character) => input.language === 'en' ? character.nameEn ?? character.name : character.name;
  const recentSpeakers = new Set(input.history.slice(-12).filter(message => message.speaker.type !== 'player').map(message => message.speaker.id.replace(/^character:/, '')));
  const addressed = input.characters.filter(character => query.includes(displayName(character).toLocaleLowerCase()) || query.includes(character.name.toLocaleLowerCase()));
  const rankedCharacters = input.characters.map(character => ({
    character,
    score: relevance(`${displayName(character)} ${character.name} ${character.summaryEn ?? ''} ${character.summary ?? ''} ${character.tags.join(' ')}`, queryTerms, query)
      + (recentSpeakers.has(character.id.replace(/^character:/, '')) ? 8 : 0)
      + (addressed.includes(character) ? 30 : 0)
      + (character.id === input.speaker?.id ? 1000 : 0),
  })).sort((a, b) => b.score - a.score || a.character.id.localeCompare(b.character.id));
  const rosterLimit = high ? 12 : 24;
  const retainedCharacters = rankedCharacters.slice(0, Math.max(rosterLimit, addressed.length + 1)).map(item => item.character);
  if (input.speaker && !retainedCharacters.some(character => character.id === input.speaker!.id)) retainedCharacters.unshift(input.speaker);

  const maxEntities = high ? 10 : 24;
  const rankedEntities = input.entities.map(entity => ({
    entity,
    score: relevance(`${entity.nameEn ?? ''} ${entity.name} ${entity.summaryEn ?? ''} ${entity.summary ?? ''} ${entity.tags.join(' ')}`, queryTerms, query)
      + (entity.type === 'event' ? 2 : 0),
  })).sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  const retainedEntities = rankedEntities.filter(item => item.score > 0).slice(0, maxEntities).map(item => item.entity);

  let history = input.history;
  if (high && history.length > 32) {
    const recent = history.slice(-24);
    const recentIds = new Set(recent.map(message => message.id));
    const olderRelevant = history.slice(0, -24)
      .map((message, index) => ({ message, index, score: relevance(contentText(message), queryTerms, query) }))
      .filter(item => item.score > 0 && !recentIds.has(item.message.id))
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 8)
      .sort((a, b) => a.index - b.index)
      .map(item => item.message);
    history = [...olderRelevant, ...recent];
  }
  return { characters: retainedCharacters, entities: retainedEntities, history };
}
