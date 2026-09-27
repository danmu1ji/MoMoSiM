import type { Entity } from '@world-player/schema';
import type { FtsDatabase } from './sqlite-index.js';
import { WorldSearchIndex } from './sqlite-index.js';
export function createPersistentSearchIndex(db: FtsDatabase, entities: Iterable<Entity>, documents: Map<string,string>): WorldSearchIndex { const index=new WorldSearchIndex(db); index.rebuild(entities,documents); return index; }
