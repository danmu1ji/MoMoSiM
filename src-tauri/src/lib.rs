#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
#[cfg(not(target_os = "android"))]
use serde::Deserialize;
#[cfg(not(target_os = "android"))]
use world_boundary::{conversations, permissions, search};

#[cfg(not(target_os = "android"))]
#[derive(Debug, Deserialize)]
struct SearchDocument { id: String, name: String, summary: String, body: String, tags: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModel { id: String, name: String, #[serde(skip_serializing_if = "Option::is_none")] context_window: Option<u64> }

fn provider_url(endpoint: &str, path: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(&format!("{}/{path}", endpoint.trim().trim_end_matches('/')))
        .map_err(|_| "Enter a valid HTTP or HTTPS provider endpoint.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Provider endpoints must use HTTP or HTTPS without embedded credentials, a query or a fragment.".to_string());
    }
    Ok(url)
}

fn provider_client(timeout_seconds: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_seconds))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build().map_err(|error| error.without_url().to_string())
}

async fn bounded_provider_text(mut response: reqwest::Response, max_bytes: usize) -> Result<String, String> {
    if response.content_length().is_some_and(|length| length > max_bytes as u64) {
        return Err("Provider response is too large.".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("Could not read provider response: {}", error.without_url()))? {
        if bytes.len() + chunk.len() > max_bytes { return Err("Provider response is too large.".to_string()); }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "Provider response is not valid UTF-8.".to_string())
}

/// Index location. Overridable so tests (and portable installs) do not depend on the process cwd.
#[cfg(not(target_os = "android"))]
fn database_path() -> String { std::env::var("WORLD_PLAYER_DB").unwrap_or_else(|_| "world-player.sqlite".to_string()) }

#[cfg(not(target_os = "android"))]
fn open_database() -> Result<rusqlite::Connection, String> {
    let connection = rusqlite::Connection::open(database_path()).map_err(|e| e.to_string())?;
    search::create_fts(&connection).map_err(|e| e.to_string())?;
    Ok(connection)
}

#[tauri::command]
fn runtime_status() -> &'static str { "world-player runtime ready" }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn world_index(documents: Vec<SearchDocument>) -> Result<(), String> {
    let connection = open_database()?;
    connection.execute("DELETE FROM entity_fts", []).map_err(|e| e.to_string())?;
    for document in documents { search::index_entity(&connection, &document.id, &document.name, &document.summary, &document.body, &document.tags).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Permissioned search. The Fog/Time-Slice decision is re-derived here from the caller's rules, so a
/// frontend cannot widen its own knowledge by sending a different id list or omitting the filter.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn world_search(query: String, limit: u32, fog_rules: Vec<permissions::FogGrant>, time_slice: String) -> Result<Vec<(String, String)>, String> {
    let allowed = permissions::resolve_allowed(&fog_rules, &time_slice);
    if allowed.is_empty() { return Ok(Vec::new()); }
    let connection = open_database()?;
    search::search_entities_allowed(&connection, &query, limit, &allowed).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn credential_set(service: String, account: String, secret: String) -> Result<(), String> { keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?.set_password(&secret).map_err(|e| e.to_string()) }

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn credential_get(service: String, account: String) -> Result<Option<String>, String> { match keyring::Entry::new(&service, &account).map_err(|e| e.to_string())?.get_password() { Ok(value) => Ok(Some(value)), Err(keyring::Error::NoEntry) => Ok(None), Err(e) => Err(e.to_string()) } }

// Android stores provider credentials in its app-local WebView storage instead of linking a
// desktop keyring backend into the APK. The frontend uses these only for desktop builds.
#[cfg(target_os = "android")]
#[tauri::command]
fn credential_set(_service: String, _account: String, _secret: String) -> Result<(), String> { Err("Use Android app storage for provider credentials.".to_string()) }

#[cfg(target_os = "android")]
#[tauri::command]
fn credential_get(_service: String, _account: String) -> Result<Option<String>, String> { Ok(None) }

/// Fetch a provider's model catalog natively so desktop builds are not blocked by the provider's CORS policy.
#[tauri::command]
async fn provider_list_models(endpoint: String, api_key: String) -> Result<Vec<ProviderModel>, String> {
    let url = provider_url(&endpoint, "models")?;
    let mut request = provider_client(30)?.get(url);
    if !api_key.is_empty() { request = request.bearer_auth(api_key); }
    let response = request.send().await.map_err(|error| format!("Could not reach provider: {}", error.without_url()))?;
    let status = response.status();
    let text = bounded_provider_text(response, 4 * 1024 * 1024).await?;
    let payload: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("Provider returned invalid JSON (HTTP {}).", status.as_u16()))?;
    if !status.is_success() {
        let detail = payload.get("error").and_then(|error| error.get("message")).and_then(serde_json::Value::as_str).unwrap_or("");
        return Err(if detail.is_empty() { format!("Provider returned HTTP {}.", status.as_u16()) } else { format!("Provider returned HTTP {}: {}", status.as_u16(), detail) });
    }
    let rows = payload.get("data").and_then(serde_json::Value::as_array).ok_or_else(|| "Provider response did not contain a model list.".to_string())?;
    Ok(rows.iter().filter_map(|model| {
        let id = model.get("id")?.as_str()?.to_string();
        let name = model.get("name").and_then(serde_json::Value::as_str).unwrap_or(&id).to_string();
        let context_window = ["context_window", "contextWindow", "context_length", "max_context_length", "max_model_len"]
            .iter().find_map(|key| model.get(*key).and_then(serde_json::Value::as_u64).filter(|value| *value > 0));
        Some(ProviderModel { id, name, context_window })
    }).collect())
}

/// Android WebView cannot reliably call arbitrary OpenAI-compatible endpoints because of CORS.
/// Use the native HTTP client there and return one completed assistant message to the shared UI.
#[tauri::command]
async fn provider_chat(endpoint: String, api_key: String, mut request: serde_json::Value) -> Result<String, String> {
    let body = request.as_object_mut().ok_or_else(|| "Chat request must be a JSON object.".to_string())?;
    body.insert("stream".to_string(), serde_json::Value::Bool(false));
    let url = provider_url(&endpoint, "chat/completions")?;
    let mut builder = provider_client(120)?.post(url).json(&request);
    if !api_key.is_empty() { builder = builder.bearer_auth(api_key); }
    let response = builder.send().await.map_err(|error| format!("Could not reach provider: {}", error.without_url()))?;
    let status = response.status();
    let text = bounded_provider_text(response, 16 * 1024 * 1024).await?;
    let payload: serde_json::Value = serde_json::from_str(&text).map_err(|_| format!("Provider returned invalid JSON (HTTP {}).", status.as_u16()))?;
    if !status.is_success() {
        let detail = payload.get("error").and_then(|error| error.get("message")).and_then(serde_json::Value::as_str).unwrap_or("");
        return Err(if detail.is_empty() { format!("Provider returned HTTP {}.", status.as_u16()) } else { format!("Provider returned HTTP {}: {}", status.as_u16(), detail) });
    }
    let content = payload.get("choices").and_then(serde_json::Value::as_array).and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message")).and_then(|message| message.get("content"))
        .ok_or_else(|| "Provider response did not contain assistant content.".to_string())?;
    if let Some(text) = content.as_str() { return Ok(text.to_string()); }
    if let Some(parts) = content.as_array() {
        return Ok(parts.iter().filter_map(|part| part.get("text").and_then(serde_json::Value::as_str)).collect::<String>());
    }
    Err("Provider returned an unsupported assistant content format.".to_string())
}

/// Persist one chat turn: conversation metadata plus the message that was just produced.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn conversation_save(id: String, world: String, time_slice: String, player: String, updated_at: String, message: conversations::StoredMessage) -> Result<(), String> {
    let connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::upsert_conversation(&connection, &conversations::ConversationMeta { id, world, time_slice, player, updated_at }).map_err(|e| e.to_string())?;
    conversations::append_message(&connection, &message).map_err(|e| e.to_string())
}

/// Restore a saved conversation so a session can continue after restart.
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn conversation_load(conversation_id: String) -> Result<Vec<conversations::StoredMessage>, String> {
    let connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::list_messages(&connection, &conversation_id).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn conversation_list(world: String) -> Result<Vec<conversations::ConversationMeta>, String> {
    let connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::list_conversations(&connection, &world).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn conversation_delete(conversation_id: String) -> Result<(), String> {
    let mut connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::remove_conversation(&mut connection, &conversation_id).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn conversation_remove_message(conversation_id: String, message_id: String) -> Result<(), String> {
    let mut connection = open_database()?;
    conversations::create_conversations(&connection).map_err(|e| e.to_string())?;
    conversations::remove_message(&mut connection, &conversation_id, &message_id).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn fts5_status() -> Result<Vec<(String, String)>, String> {
    let connection = open_database()?;
    search::search_entities(&connection, "World", 10).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![runtime_status, world_index, world_search, conversation_save, conversation_load, conversation_list, conversation_delete, conversation_remove_message, fts5_status, credential_set, credential_get, provider_list_models, provider_chat]);
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![runtime_status, credential_set, credential_get, provider_list_models, provider_chat]);
    builder.run(tauri::generate_context!())
        .expect("error while running World Player");
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::*;

    fn mock_provider(body: &str, content_length: Option<usize>) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", content_length.unwrap_or(body.len()));
        let worker = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut connection, _) = listener.accept().unwrap();
            connection.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut buffer = [0u8; 4096];
            connection.read(&mut buffer).unwrap();
            connection.write_all(reply.as_bytes()).unwrap();
        });
        (endpoint, worker)
    }

    #[test]
    fn native_provider_reads_models_and_assistant_content() {
        let (endpoint, worker) = mock_provider(r#"{"data":[{"id":"local-model","context_window":8192}]}"#, None);
        let models = tauri::async_runtime::block_on(provider_list_models(endpoint, String::new())).unwrap();
        assert_eq!(models[0].id, "local-model");
        assert_eq!(models[0].context_window, Some(8192));
        worker.join().unwrap();

        let (endpoint, worker) = mock_provider(r#"{"choices":[{"message":{"content":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}}]}"#, None);
        let request = serde_json::json!({"model":"local-model", "messages":[]});
        assert_eq!(tauri::async_runtime::block_on(provider_chat(endpoint, String::new(), request)).unwrap(), "Hello world");
        worker.join().unwrap();
    }

    #[test]
    fn native_provider_rejects_oversized_responses_before_reading_the_body() {
        let (endpoint, worker) = mock_provider("{}", Some(20 * 1024 * 1024));
        let error = tauri::async_runtime::block_on(provider_list_models(endpoint, String::new())).unwrap_err();
        assert_eq!(error, "Provider response is too large.");
        worker.join().unwrap();
    }

    #[test]
    fn native_provider_reports_invalid_json_and_rejects_non_object_chat_requests() {
        let (endpoint, worker) = mock_provider("not-json", None);
        let error = tauri::async_runtime::block_on(provider_list_models(endpoint, String::new())).unwrap_err();
        assert!(error.contains("invalid JSON"));
        worker.join().unwrap();
        assert!(tauri::async_runtime::block_on(provider_chat("http://localhost/v1".to_string(), String::new(), serde_json::Value::Null)).unwrap_err().contains("JSON object"));
    }

    #[test]
    fn provider_endpoints_reject_unsafe_urls_and_keep_local_servers_available() {
        for endpoint in ["file:///etc", "ftp://example.com", "https://user:secret@example.com", "https://example.com?key=secret", "https://example.com#fragment", "invalid"] {
            assert!(provider_url(endpoint, "models").is_err(), "accepted {endpoint}");
        }
        assert_eq!(provider_url(" http://127.0.0.1:5301/v1/ ", "models").unwrap().as_str(), "http://127.0.0.1:5301/v1/models");
        assert_eq!(provider_url("https://example.com/v1", "chat/completions").unwrap().path(), "/v1/chat/completions");
    }

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
