import type { Entity, Relation } from '@world-player/schema';
import type { MarkdownDocument } from '@world-player/markdown';

export interface EntityGraph { links: Map<string, string[]>; relations: Map<string, Relation[]> }

/** Builds the Entity Graph index: Markdown `[[target]]` links plus structured relations, keyed by entity id. */
export function buildEntityGraph(entities: Iterable<Entity>, documents: Map<string, MarkdownDocument>): EntityGraph {
  const links = new Map<string, string[]>();
  const relations = new Map<string, Relation[]>();
  for (const entity of entities) {
    relations.set(entity.id, [...entity.relations]);
    const document = entity.markdown ? documents.get(entity.markdown) : undefined;
    links.set(entity.id, [...(document?.links ?? [])].filter(link => link.includes(':')));
  }
  return { links, relations };
}

export function relatedEntities(graph: EntityGraph, id: string): string[] {
  return [...new Set([...(graph.links.get(id) ?? []), ...(graph.relations.get(id) ?? []).map(relation => relation.target)])];
}

/** Resolvable internal-link targets for the Explorer: only ids that exist as entities. */
export function resolvableLinks(graph: EntityGraph, id: string, existing: Iterable<string>): string[] {
  const ids = new Set(existing);
  return relatedEntities(graph, id).filter(target => ids.has(target));
}
