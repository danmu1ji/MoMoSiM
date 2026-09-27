use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};

/// A persisted chat message. Bodies are stored as raw text; the Chat AST is rebuilt by the caller.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub conversation_id: String,
    pub speaker_type: String,
    pub speaker_id: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversationMeta {
    pub id: String,
    pub world: String,
    pub time_slice: String,
    pub player: String,
    pub updated_at: String,
}

pub fn create_conversations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversations (
             id TEXT PRIMARY KEY, world TEXT NOT NULL, time_slice TEXT NOT NULL,
             player TEXT NOT NULL, updated_at TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS messages (
             id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
             speaker_type TEXT NOT NULL, speaker_id TEXT NOT NULL,
             body TEXT NOT NULL, created_at TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, created_at);",
    )
}

pub fn upsert_conversation(conn: &Connection, meta: &ConversationMeta) -> Result<()> {
    conn.execute(
        "INSERT INTO conversations (id, world, time_slice, player, updated_at) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET world=?2, time_slice=?3, player=?4, updated_at=?5",
        (&meta.id, &meta.world, &meta.time_slice, &meta.player, &meta.updated_at),
    )
    .map(|_| ())
}

pub fn append_message(conn: &Connection, message: &StoredMessage) -> Result<()> {
    conn.execute(
        "INSERT INTO messages (id, conversation_id, speaker_type, speaker_id, body, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        (&message.id, &message.conversation_id, &message.speaker_type, &message.speaker_id, &message.body, &message.created_at),
    )
    .map(|_| ())
}

pub fn list_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<StoredMessage>> {
    let mut statement = conn.prepare(
        "SELECT id, conversation_id, speaker_type, speaker_id, body, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = statement.query_map([conversation_id], |row| {
        Ok(StoredMessage { id: row.get(0)?, conversation_id: row.get(1)?, speaker_type: row.get(2)?, speaker_id: row.get(3)?, body: row.get(4)?, created_at: row.get(5)? })
    })?;
    rows.collect()
}

pub fn list_conversations(conn: &Connection, world: &str) -> Result<Vec<ConversationMeta>> {
    let mut statement = conn.prepare(
        "SELECT id, world, time_slice, player, updated_at FROM conversations WHERE world = ?1 ORDER BY updated_at DESC, id",
    )?;
    let rows = statement.query_map([world], |row| {
        Ok(ConversationMeta { id: row.get(0)?, world: row.get(1)?, time_slice: row.get(2)?, player: row.get(3)?, updated_at: row.get(4)? })
    })?;
    rows.collect()
}

pub fn remove_conversation(conn: &mut Connection, conversation_id: &str) -> Result<()> {
    let transaction = conn.transaction()?;
    transaction.execute("DELETE FROM messages WHERE conversation_id = ?1", [conversation_id])?;
    transaction.execute("DELETE FROM conversations WHERE id = ?1", [conversation_id])?;
    transaction.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(id: &str) -> ConversationMeta {
        ConversationMeta { id: id.to_string(), world: "echo-world".to_string(), time_slice: "opening".to_string(), player: "방문자".to_string(), updated_at: "2026-01-01T00:00:00Z".to_string() }
    }

    fn message(id: &str, conversation: &str, created_at: &str) -> StoredMessage {
        StoredMessage { id: id.to_string(), conversation_id: conversation.to_string(), speaker_type: "character".to_string(), speaker_id: "character:aria".to_string(), body: "본문".to_string(), created_at: created_at.to_string() }
    }

    #[test]
    fn messages_round_trip_in_chronological_order() {
        let db = Connection::open_in_memory().unwrap();
        create_conversations(&db).unwrap();
        upsert_conversation(&db, &meta("c1")).unwrap();
        append_message(&db, &message("m2", "c1", "2026-01-01T00:00:02Z")).unwrap();
        append_message(&db, &message("m1", "c1", "2026-01-01T00:00:01Z")).unwrap();
        let stored = list_messages(&db, "c1").unwrap();
        assert_eq!(stored.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["m1", "m2"]);
        assert_eq!(stored[0].speaker_id, "character:aria");
    }

    #[test]
    fn conversations_are_isolated_and_meta_updates_in_place() {
        let db = Connection::open_in_memory().unwrap();
        create_conversations(&db).unwrap();
        upsert_conversation(&db, &meta("c1")).unwrap();
        upsert_conversation(&db, &meta("c2")).unwrap();
        append_message(&db, &message("m1", "c1", "2026-01-01T00:00:01Z")).unwrap();
        let mut updated = meta("c1");
        updated.time_slice = "after-storm".to_string();
        upsert_conversation(&db, &updated).unwrap();
        assert_eq!(list_messages(&db, "c2").unwrap().len(), 0);
        assert_eq!(list_messages(&db, "c1").unwrap().len(), 1);
        let slice: String = db.query_row("SELECT time_slice FROM conversations WHERE id='c1'", [], |row| row.get(0)).unwrap();
        assert_eq!(slice, "after-storm");
        let count: i64 = db.query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn conversation_listing_is_scoped_to_world_and_newest_first() {
        let db = Connection::open_in_memory().unwrap();
        create_conversations(&db).unwrap();
        let mut first = meta("ba-character:a+character:b");
        first.updated_at = "2026-01-01T00:00:01Z".to_string();
        let mut second = meta("ba-character:c+character:d");
        second.updated_at = "2026-01-01T00:00:02Z".to_string();
        let mut other_world = meta("ba-character:e+character:f");
        other_world.world = "other-world".to_string();
        upsert_conversation(&db, &first).unwrap();
        upsert_conversation(&db, &second).unwrap();
        upsert_conversation(&db, &other_world).unwrap();
        let listed = list_conversations(&db, "echo-world").unwrap();
        assert_eq!(listed.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec![second.id.as_str(), first.id.as_str()]);
    }

    #[test]
    fn removing_conversation_deletes_its_messages_and_listing_entry() {
        let mut db = Connection::open_in_memory().unwrap();
        create_conversations(&db).unwrap();
        upsert_conversation(&db, &meta("ba-character:a+character:b")).unwrap();
        append_message(&db, &message("m1", "ba-character:a+character:b", "2026-01-01T00:00:01Z")).unwrap();
        remove_conversation(&mut db, "ba-character:a+character:b").unwrap();
        assert!(list_messages(&db, "ba-character:a+character:b").unwrap().is_empty());
        assert!(list_conversations(&db, "echo-world").unwrap().is_empty());
    }
}
