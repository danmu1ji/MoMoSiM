use rusqlite::{Connection, Result};
use std::collections::HashSet;

pub fn create_fts(conn: &Connection) -> Result<()> { conn.execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS entity_fts USING fts5(id UNINDEXED, name, summary, body, tags);") }
pub fn index_entity(conn: &Connection, id: &str, name: &str, summary: &str, body: &str, tags: &str) -> Result<()> { conn.execute("INSERT INTO entity_fts (id,name,summary,body,tags) VALUES (?1,?2,?3,?4,?5)", (id, name, summary, body, tags)).map(|_| ()) }
pub fn search_entities(conn: &Connection, query: &str, limit: u32) -> Result<Vec<(String, String)>> { let mut statement = conn.prepare("SELECT id, name FROM entity_fts WHERE entity_fts MATCH ?1 LIMIT ?2")?; let rows = statement.query_map((query, limit), |row| Ok((row.get(0)?, row.get(1)?)))?; rows.collect() }

/// Permissioned search: the Fog/Time-Slice allow-list is applied inside the Rust boundary, so a caller
/// cannot obtain hidden entities by omitting or tampering with the filter.
pub fn search_entities_allowed(conn: &Connection, query: &str, limit: u32, allowed: &HashSet<String>) -> Result<Vec<(String, String)>> { Ok(search_entities(conn, query, limit)?.into_iter().filter(|(id, _)| allowed.contains(id)).collect()) }

#[cfg(test)] mod tests {
    use super::*;

    fn seeded() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        create_fts(&db).unwrap();
        index_entity(&db, "location:harbor", "Harbor", "Open port", "salt and ships", "port").unwrap();
        index_entity(&db, "location:secret-vault", "Harbor Vault", "Hidden cellar", "Harbor smuggler ledger", "port").unwrap();
        db
    }

    #[test] fn fts_round_trip() { let db = seeded(); assert_eq!(search_entities(&db, "Harbor", 10).unwrap().len(), 2); }

    #[test] fn empty_allow_list_is_deny_all() { let db = seeded(); assert!(search_entities_allowed(&db, "Harbor", 10, &HashSet::new()).unwrap().is_empty()); }

    #[test] fn hidden_entity_cannot_bypass_fog_through_search() {
        let db = seeded();
        let allowed: HashSet<String> = ["location:harbor".to_string()].into_iter().collect();
        let visible = search_entities_allowed(&db, "Harbor", 10, &allowed).unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible_best_id(&visible), "location:harbor");
        assert!(!visible.iter().any(|(id, _)| id == "location:secret-vault"));
    }

    fn visible_best_id(rows: &[(String, String)]) -> &str { rows.first().map(|(id, _)| id.as_str()).unwrap_or("") }
}
