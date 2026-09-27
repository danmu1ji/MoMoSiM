import type { Entity } from '@world-player/schema';

export interface FtsDatabase { exec(sql: string): void; prepare(sql: string): { run(...values: unknown[]): void; all(...values: unknown[]): unknown[] }; close(): void }
/** SQLite FTS5 index adapter. The host supplies node:sqlite (desktop) or a Rust/Tauri bridge. */
export class WorldSearchIndex {
  constructor(private readonly db: FtsDatabase) { db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(id UNINDEXED, name, summary, body, tags);'); }
  rebuild(entities: Iterable<Entity>, documents = new Map<string, string>()): void { this.db.exec('DELETE FROM entity_fts'); const insert = this.db.prepare('INSERT INTO entity_fts (id,name,summary,body,tags) VALUES (?,?,?,?,?)'); for (const e of entities) insert.run(e.id,e.name,e.summary ?? '',e.markdown ? documents.get(e.markdown) ?? '' : '',e.tags.join(' ')); }
  search(query: string, limit = 50, allowedIds?: Set<string>): Entity[] { const rows = this.db.prepare('SELECT id,name,summary,tags FROM entity_fts WHERE entity_fts MATCH ? LIMIT ?').all(query, limit) as {id:string;name:string;summary:string;tags:string}[]; return rows.filter(r=>!allowedIds || allowedIds.has(r.id)).map(r => ({id:r.id,type:'world',name:r.name,summary:r.summary,tags:r.tags.split(' ').filter(Boolean),relations:[]})); }
  close(): void { this.db.close(); }
}
