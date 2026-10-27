//! Topological naming — persistent identifiers for faces/edges across regens.
//!
//! See `NAMING.md` for the algorithm. This module is the source of truth for
//! the encoding; bumping `NAMING_SCHEMA_VERSION` in `main.rs` whenever the
//! rules change is non-optional (BRep cache invalidates on schema bump).

use serde::{Deserialize, Serialize};

/// A face/edge identifier that survives regenerations.
///
/// Two entities that should be "the same edge" across regens (e.g., the top
/// circular edge of a cylinder before and after changing the extrude depth)
/// produce identical `PersistentName`s. The JSON encoding is what ships to
/// the client and gets stored in feature references.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PersistentName {
    /// Which feature produced this entity.
    pub feature_id: String,
    /// What role within the feature. Encoded with `lowercase-kebab` to keep
    /// the on-wire form readable for debugging.
    pub role: Role,
    /// Disambiguates when role isn't unique (e.g., side N of a polygon
    /// profile uses `sub_index = profile-edge-index`).
    #[serde(default)]
    pub sub_index: u32,
    /// Names of upstream entities this depends on, in stable lexical order.
    /// Boolean cuts and fillets populate this; primitive extrudes leave it
    /// empty.
    #[serde(default)]
    pub upstream_refs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    CapTop,
    CapBottom,
    Side,
    EdgeTop,
    EdgeBottom,
    EdgeVertical,
    // Reserved for Phase 2 feature kinds. Adding variants here doesn't
    // invalidate existing names; renaming one does — bump the schema version.
    FilletFace,
    FilletCap,
}

impl PersistentName {
    pub fn encode(&self) -> String {
        // Serialize as a compact JSON string. Deterministic field order
        // because serde uses the struct's declaration order.
        serde_json::to_string(self).expect("PersistentName must round-trip via serde")
    }

    /// Convenience constructors keep call sites readable.
    pub fn cap_top(feature_id: impl Into<String>) -> Self {
        Self { feature_id: feature_id.into(), role: Role::CapTop, sub_index: 0, upstream_refs: vec![] }
    }
    pub fn cap_bottom(feature_id: impl Into<String>) -> Self {
        Self { feature_id: feature_id.into(), role: Role::CapBottom, sub_index: 0, upstream_refs: vec![] }
    }
    pub fn side(feature_id: impl Into<String>, profile_edge_index: u32) -> Self {
        Self {
            feature_id: feature_id.into(),
            role: Role::Side,
            sub_index: profile_edge_index,
            upstream_refs: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_through_json() {
        let n = PersistentName::side("f1", 2);
        let s = n.encode();
        let decoded: PersistentName = serde_json::from_str(&s).unwrap();
        assert_eq!(decoded, n);
    }
}
