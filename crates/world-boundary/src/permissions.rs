use std::collections::{HashMap, HashSet};
use serde::Deserialize;

/// One Fog rule handed to the Tauri search boundary. The frontend must ship its rules, not a bare
/// allow-list, so the boundary can re-derive permissions instead of trusting the caller's filter.
#[derive(Debug, Clone, Deserialize)]
pub struct FogGrant {
    pub target: String,
    pub access: String,
    pub time_slice: Option<String>,
}

/// Resolve the visible entity ids for `slice`: last rule per target wins, `hidden` denies,
/// and a rule bound to another time slice does not apply.
pub fn resolve_allowed(grants: &[FogGrant], slice: &str) -> HashSet<String> {
    let mut latest: HashMap<&str, &FogGrant> = HashMap::new();
    for grant in grants { latest.insert(grant.target.as_str(), grant); }
    latest
        .into_values()
        .filter(|grant| grant.access != "hidden")
        .filter(|grant| grant.time_slice.as_deref().map(|value| value == slice).unwrap_or(true))
        .map(|grant| grant.target.clone())
        .collect()
}

#[cfg(test)] mod tests {
    use super::*;

    fn grant(target: &str, access: &str, time_slice: Option<&str>) -> FogGrant {
        FogGrant { target: target.to_string(), access: access.to_string(), time_slice: time_slice.map(str::to_string) }
    }

    #[test] fn empty_rules_are_deny_all() { assert!(resolve_allowed(&[], "now").is_empty()); }

    #[test] fn hidden_entity_cannot_bypass_fog() {
        let resolved = resolve_allowed(&[grant("location:harbor", "public", None), grant("location:secret-vault", "hidden", None)], "now");
        assert!(resolved.contains("location:harbor"));
        assert!(!resolved.contains("location:secret-vault"));
    }

    #[test] fn other_time_slice_rules_do_not_apply() {
        let resolved = resolve_allowed(&[grant("character:borin", "full", Some("past")), grant("character:aria", "full", Some("now"))], "now");
        assert_eq!(resolved.len(), 1);
        assert!(resolved.contains("character:aria"));
    }

    #[test] fn later_rule_overrides_earlier_one() {
        let resolved = resolve_allowed(&[grant("location:harbor", "full", None), grant("location:harbor", "hidden", None)], "now");
        assert!(resolved.is_empty());
    }
}
