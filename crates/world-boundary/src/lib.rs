//! Permissioned search boundary for World Player.
//!
//! This crate holds the parts of the Tauri backend that must not be bypassable from the
//! frontend: the Fog/Time-Slice permission resolver and the SQLite FTS5 index. It has no
//! Tauri dependency, so it is unit-testable without a desktop runtime.
pub mod conversations;
pub mod permissions;
pub mod search;
