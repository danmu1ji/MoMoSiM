#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use world_boundary::{conversations, permissions, search};

#[derive(Debug, Deserialize)]
struct SearchDocument { id: String, name: String, summary: String, body: String, tags: String }

#[derive(Debug, Serialize)]
struct ProviderModel { id: String, name: String }

/// Index location. Overridable so tests (and portable installs) do not depend on the process cwd.
fn database_path() -> String { std::env::var("WORLD_PLAYER_DB").unwrap_or_else(|_| "world-player.sqlite".to_string()) }

fn open_database() -> Result<rusqlite::Connection, String> {
    let connection = rusqlite::Connection::open(database_path()).map_err(|e| e.to_string())?;
    search::create_fts(&connection).map_err(|e| e.to_string())?;
    Ok(connection)
}

#[tauri::command]
fn runtime_status() -> &'static str { "world-player runtime ready" }

#[tauri::command]
fn world_index(documents: Vec<SearchDocument>) -> Result<(), String> {
    let connection = open_database()?;
    connection.execute("DELETE FROM entity_fts", []).map_err(|e| e.to_string())?;
    for document in documents { search::index_entity(&connection, &document.id, &document.name, &document.summary, &document.body, &document.tags).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Permissioned search. The Fog/Time-Slice decision is re-derived here from the caller's rules, so a
/// frontend cannot widen its own knowledge by sending a different id list or omitting the filter.
#[tauri::command]
fn world_search(query: String, limit: u32, fog_rules: Vec<permissions::FogGrant>, time_slice: String) -> Result<Vec<(String, String)>, String> {
    let allowed = permissions::resolve_allowed(&fog_rules, &time_slice);
    if allowed.is_empty() { return Ok(Vec::new()); }
    let connection = open_database()?;
    search::search_entities_allowed(&connection, &query, limit, &allowed).map_err(|e| e.to_string())
}

#[tauri::command]
fn credential_set(service: String, account: String, secret: String) -> Result<(), String> { keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?.set_password(&secret).map_err(|e| e.to_string()) }

#[tauri::command]
fn credential_get(service: String, account: String) -> Result<Option<String>, String> { match keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?.get_password() { Ok(value) => Ok(Some(value)), Err(keyring::Error::NoEntry) => Ok(None), Err(e) => Err(e.to_string()) } }

/// Fetch a provider's model catalog natively so desktop builds are not blocked by the provider's CORS policy.
#[tauri::command]
async fn provider_list_models(endpoint: String, api_key: String) -> Result<Vec<ProviderModel>, String> {
    let url = format!("{}/models", endpoint.trim().trim_end_matches('/'));
    let mut request = reqwest::Client::new().get(url);
    if !api_key.is_empty() { request = request.bearer_auth(api_key); }
    let response = request.send().await.map_err(|error| format!("Could not reach provider: {error}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|error| format!("Could not read provider response: {error}"))?;
    let payload: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("Provider returned invalid JSON (HTTP {}).", status.as_u16()))?;
    if !status.is_success() {
        let detail = payload.get("error").and_then(|error| error.get("message")).and_then(serde_json::Value::as_str).unwrap_or("");
        return Err(if detail.is_empty() { format!("Provider returned HTTP {}.", status.as_u16()) } else { format!("Provider returned HTTP {}: {}", status.as_u16(), detail) });
    }
    let rows = payload.get("data").and_then(serde_json::Value::as_array).ok_or_else(|| "Provider response did not contain a model list.".to_string())?;
    Ok(rows.iter().filter_map(|model| {
        let id = model.get("id")?.as_str()?.to_string();
        let name = model.get("name").and_then(serde_json::Value::as_str).unwrap_or(&id).to_string();
        Some(ProviderModel { id, name })
    }).collect())
}

/// Persist one chat turn: conversation metadata plus the message that was just produced.
#[tauri::command]
fn conversation_save(id: String, world: String, time_slice: String, player: String, updated_at: String, message: conversations::StoredMessage) -> Result<(), String> {
    let connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::upsert_conversation(&connection, &conversations::ConversationMeta { id, world, time_slice, player, updated_at }).map_err(|e| e.to_string())?;
    conversations::append_message(&connection, &message).map_err(|e| e.to_string())
}

/// Restore a saved conversation so a session can continue after restart.
#[tauri::command]
fn conversation_load(conversation_id: String) -> Result<Vec<conversations::StoredMessage>, String> {
    let connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::list_messages(&connection, &conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn conversation_list(world: String) -> Result<Vec<conversations::ConversationMeta>, String> {
    let connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::list_conversations(&connection, &world).map_err(|e| e.to_string())
}

#[tauri::command]
fn conversation_delete(conversation_id: String) -> Result<(), String> {
    let mut connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::remove_conversation(&mut connection, &conversation_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn fts5_status() -> Result<Vec<(String, String)>, String> {
    let connection = open_database()?;
    search::search_entities(&connection, "World", 10).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_status, world_index, world_search, conversation_save, conversation_load, conversation_list, conversation_delete, fts5_status, credential_set, credential_get, provider_list_models])
        .run(tauri::generate_context!())
        .expect("error while running World Player");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `WORLD_PLAYER_DB` is process-global, so tests that override it must not interleave.
    static DB_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn document(id: &str, name: &str, body: &str) -> SearchDocument {
        SearchDocument { id: id.to_string(), name: name.to_string(), summary: "요약".to_string(), body: body.to_string(), tags: "port".to_string() }
    }

    fn grant(target: &str, access: &str, time_slice: Option<&str>) -> permissions::FogGrant {
        permissions::FogGrant { target: target.to_string(), access: access.to_string(), time_slice: time_slice.map(str::to_string) }
    }

    /// Drives the real command bodies against a real SQLite FTS5 file: index two entities, then prove the
    /// hidden one cannot be reached through the search command at the active time slice.
    #[test]
    fn search_command_enforces_fog_and_time_slice() {
        let _guard = DB_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let directory = std::env::temp_dir().join(format!("world-player-boundary-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::env::set_var("WORLD_PLAYER_DB", directory.join("test.sqlite"));

        world_index(vec![
            document("location:harbor", "Harbor", "항구는 배가 드나드는 곳이다."),
            document("location:secret-vault", "Harbor Vault", "항구 지하의 비밀 금고."),
        ]).unwrap();

        let visible = world_search("Harbor".to_string(), 10, vec![grant("location:harbor", "public", None)], "now".to_string()).unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].0, "location:harbor");

        let denied = world_search("Harbor".to_string(), 10, vec![grant("location:secret-vault", "hidden", None)], "now".to_string()).unwrap();
        assert!(denied.is_empty(), "hidden entity leaked through the search command: {denied:?}");

        let foreign_slice = world_search("Harbor".to_string(), 10, vec![grant("location:secret-vault", "full", Some("past"))], "now".to_string()).unwrap();
        assert!(foreign_slice.is_empty(), "other-time-slice rule leaked at the active slice: {foreign_slice:?}");

        let no_rules = world_search("Harbor".to_string(), 10, vec![], "now".to_string()).unwrap();
        assert!(no_rules.is_empty(), "empty Fog rules must deny all: {no_rules:?}");

        // Rules limited to another slice still work once the slice matches.
        let past = world_search("Harbor".to_string(), 10, vec![grant("location:secret-vault", "full", Some("past"))], "past".to_string()).unwrap();
        assert_eq!(past.len(), 1);

        std::env::remove_var("WORLD_PLAYER_DB");
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// Saves two turns through the command bodies and reads them back in order.
    #[test]
    fn conversation_commands_persist_and_restore_turns() {
        let _guard = DB_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let directory = std::env::temp_dir().join(format!("world-player-conversations-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::env::set_var("WORLD_PLAYER_DB", directory.join("test.sqlite"));

        let turn = |id: &str, created_at: &str, body: &str| conversations::StoredMessage { id: id.to_string(), conversation_id: "c1".to_string(), speaker_type: "character".to_string(), speaker_id: "character:aria".to_string(), body: body.to_string(), created_at: created_at.to_string() };
        conversation_save("c1".to_string(), "echo-world".to_string(), "opening".to_string(), "방문자".to_string(), "2026-01-01T00:00:03Z".to_string(), turn("m2", "2026-01-01T00:00:02Z", "두 번째")).unwrap();
        conversation_save("c1".to_string(), "echo-world".to_string(), "opening".to_string(), "방문자".to_string(), "2026-01-01T00:00:04Z".to_string(), turn("m1", "2026-01-01T00:00:01Z", "첫 번째")).unwrap();

        let restored = conversation_load("c1".to_string()).unwrap();
        assert_eq!(restored.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), vec!["m1", "m2"]);
        assert_eq!(restored[0].body, "첫 번째");
        assert!(conversation_load("missing".to_string()).unwrap().is_empty());

        std::env::remove_var("WORLD_PLAYER_DB");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn runtime_status_reports_ready() { assert_eq!(runtime_status(), "world-player runtime ready"); }
}
