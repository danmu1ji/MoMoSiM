import type { Entity, EntityType } from '@world-player/schema';
import type { WorldData } from './core.js';

/**
 * Player-facing browse model: which categories exist at the top, what belongs below them, and which
 * characters can be picked inside a category (directly or through its subcategories).
 * Declaration order from the package is preserved, so a world author controls the rail order.
 */
export function categoryRoots(entities: Iterable<Entity>): Entity[] {
  const all = [...entities].filter(entity => entity.type === 'category');
  const ids = new Set(all.map(entity => entity.id));
  return all.filter(entity => !(entity as { parent?: string }).parent || !ids.has((entity as { parent?: string }).parent!));
}

export function subcategoriesOf(entities: Iterable<Entity>, parentId: string): Entity[] {
  return [...entities].filter(entity => entity.type === 'category' && (entity as { parent?: string }).parent === parentId);
}

export function charactersInCategory(entities: Iterable<Entity>, categoryId: string): Entity[] {
  return [...entities].filter(entity => entity.type === 'character' && (entity.categories ?? []).includes(categoryId));
}

export function charactersUnder(entities: Iterable<Entity>, categoryId: string): Entity[] {
  const direct = charactersInCategory(entities, categoryId);
  const seen = new Set(direct.map(entity => entity.id));
  const nested = subcategoriesOf(entities, categoryId).flatMap(sub => charactersUnder(entities, sub.id)).filter(entity => !seen.has(entity.id));
  return [...direct, ...nested];
}

export function breadcrumbFor(entities: Iterable<Entity>, categoryId: string): Entity[] {
  const byId = new Map([...entities].map(entity => [entity.id, entity]));
  const trail: Entity[] = [];
  let current = byId.get(categoryId);
  while (current) { trail.unshift(current); current = byId.get((current as { parent?: string }).parent ?? ''); }
  return trail;
}

export function orderedEntities(entities: Iterable<Entity>, type?: EntityType): Entity[] {
  return [...entities].filter(entity => !type || entity.type === type);
}

/** Category rail payload: every card the world screen shows, with its banner already resolved. */
export function browseState(data: WorldData, categoryId?: string) {
  // Materialize once: an entity iterator is single-use, and several helpers consume it.
  const entities = [...data.entities.values()];
  const category = categoryId ? data.entities.get(categoryId) : undefined;
  return {
    roots: categoryRoots(entities),
    category,
    trail: category ? breadcrumbFor(entities, category.id) : [],
    subcategories: category ? subcategoriesOf(entities, category.id) : [],
    characters: category ? charactersUnder(entities, category.id) : [],
    directCharacters: category ? charactersInCategory(entities, category.id) : [],
  };
}
