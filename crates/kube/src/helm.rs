//! Helm 3 release capabilities. Helm stores each release revision as a Secret
//! (type `helm.sh/release.v1`, label `owner=helm`) whose `release` field is
//! `base64(gzip(json))`. We list those secrets, decode them, and expose release
//! summaries and details (values, manifest, history) — no Helm binary needed.

use std::collections::BTreeMap;
use std::io::Read;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use flate2::read::GzDecoder;
use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Secret;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client_cache::ClientCache;

fn handler_err(e: impl ToString) -> CapabilityError {
    CapabilityError::Handler(e.to_string())
}

/// Decode a Helm release Secret's `release` field: `base64(gzip(json))`. Older
/// releases may be un-gzipped, so we sniff the gzip magic bytes.
pub fn decode_release(raw: &[u8]) -> Result<Value, String> {
    let decoded = STANDARD.decode(raw).map_err(|e| e.to_string())?;
    let bytes = if decoded.len() >= 2 && decoded[0] == 0x1f && decoded[1] == 0x8b {
        let mut gz = GzDecoder::new(&decoded[..]);
        let mut out = Vec::new();
        gz.read_to_end(&mut out).map_err(|e| e.to_string())?;
        out
    } else {
        decoded
    };
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn s(v: &Value, path: &[&str]) -> String {
    let mut cur = v;
    for p in path {
        cur = match cur.get(p) {
            Some(next) => next,
            None => return String::new(),
        };
    }
    cur.as_str().unwrap_or("").to_string()
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HelmReleaseSummary {
    pub name: String,
    pub namespace: String,
    pub revision: i64,
    pub status: String,
    pub chart: String,
    pub chart_version: String,
    pub app_version: String,
    pub updated: String,
}

/// Summarise a decoded release object into list-view fields.
pub fn summarise_release(v: &Value) -> HelmReleaseSummary {
    HelmReleaseSummary {
        name: s(v, &["name"]),
        namespace: s(v, &["namespace"]),
        revision: v.get("version").and_then(Value::as_i64).unwrap_or(0),
        status: s(v, &["info", "status"]),
        chart: s(v, &["chart", "metadata", "name"]),
        chart_version: s(v, &["chart", "metadata", "version"]),
        app_version: s(v, &["chart", "metadata", "appVersion"]),
        updated: s(v, &["info", "last_deployed"]),
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListHelmReleasesIn {
    pub context: String,
    /// Namespace to scope to; empty/absent means all namespaces.
    #[serde(default)]
    pub namespace: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListHelmReleasesOut {
    pub releases: Vec<HelmReleaseSummary>,
}

async fn list_release_secrets(
    cache: &Arc<ClientCache>,
    context: &str,
    namespace: &str,
    label: &str,
) -> Result<Vec<Secret>, CapabilityError> {
    let client = cache.get(context).await.map_err(CapabilityError::Handler)?;
    let api: Api<Secret> = if namespace.is_empty() {
        Api::all(client)
    } else {
        Api::namespaced(client, namespace)
    };
    let list = api
        .list(&ListParams::default().labels(label))
        .await
        .map_err(handler_err)?;
    Ok(list.items)
}

/// `k8s.listHelmReleases` — latest revision of each Helm release in scope.
pub fn list_helm_releases_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListHelmReleasesIn, ListHelmReleasesOut, _, _>(
        "k8s.listHelmReleases",
        "list installed Helm releases (latest revision of each)",
        Annotations::READ_ONLY,
        move |input: ListHelmReleasesIn| {
            let cache = cache.clone();
            async move {
                let ns = input.namespace.unwrap_or_default();
                let secrets = list_release_secrets(&cache, &input.context, &ns, "owner=helm").await?;
                // Keep the highest revision per (namespace, name).
                let mut latest: BTreeMap<(String, String), HelmReleaseSummary> = BTreeMap::new();
                for secret in &secrets {
                    let Some(raw) = secret.data.as_ref().and_then(|d| d.get("release")) else {
                        continue;
                    };
                    let Ok(rel) = decode_release(&raw.0) else { continue };
                    let sum = summarise_release(&rel);
                    let key = (sum.namespace.clone(), sum.name.clone());
                    match latest.get(&key) {
                        Some(existing) if existing.revision >= sum.revision => {}
                        _ => {
                            latest.insert(key, sum);
                        }
                    }
                }
                Ok(ListHelmReleasesOut {
                    releases: latest.into_values().collect(),
                })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetHelmReleaseIn {
    pub context: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HelmRevision {
    pub revision: i64,
    pub status: String,
    pub updated: String,
    pub chart_version: String,
    pub description: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HelmReleaseDetail {
    pub name: String,
    pub namespace: String,
    pub revision: i64,
    pub status: String,
    pub chart: String,
    pub chart_version: String,
    pub app_version: String,
    pub updated: String,
    /// User-supplied values, rendered as YAML.
    pub values_yaml: String,
    /// The rendered manifest for the current revision.
    pub manifest: String,
    pub notes: String,
    /// All revisions, newest first.
    pub history: Vec<HelmRevision>,
}

/// `k8s.getHelmRelease` — full detail of a release: values, manifest, history.
pub fn get_helm_release_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<GetHelmReleaseIn, HelmReleaseDetail, _, _>(
        "k8s.getHelmRelease",
        "fetch a Helm release's values, manifest, and revision history",
        Annotations::READ_ONLY,
        move |input: GetHelmReleaseIn| {
            let cache = cache.clone();
            async move {
                let label = format!("owner=helm,name={}", input.name);
                let secrets =
                    list_release_secrets(&cache, &input.context, &input.namespace, &label).await?;
                let mut revisions: Vec<Value> = secrets
                    .iter()
                    .filter_map(|s| s.data.as_ref().and_then(|d| d.get("release")))
                    .filter_map(|b| decode_release(&b.0).ok())
                    .collect();
                if revisions.is_empty() {
                    return Err(CapabilityError::Handler(format!(
                        "no Helm release named {} in {}",
                        input.name, input.namespace
                    )));
                }
                // Newest revision first.
                revisions.sort_by_key(|v| -v.get("version").and_then(Value::as_i64).unwrap_or(0));
                let history = revisions
                    .iter()
                    .map(|v| HelmRevision {
                        revision: v.get("version").and_then(Value::as_i64).unwrap_or(0),
                        status: s(v, &["info", "status"]),
                        updated: s(v, &["info", "last_deployed"]),
                        chart_version: s(v, &["chart", "metadata", "version"]),
                        description: s(v, &["info", "description"]),
                    })
                    .collect();

                let current = &revisions[0];
                let sum = summarise_release(current);
                let values_yaml = match current.get("config") {
                    Some(cfg) if !cfg.is_null() => serde_yaml::to_string(cfg).unwrap_or_default(),
                    _ => String::new(),
                };
                Ok(HelmReleaseDetail {
                    name: sum.name,
                    namespace: sum.namespace,
                    revision: sum.revision,
                    status: sum.status,
                    chart: sum.chart,
                    chart_version: sum.chart_version,
                    app_version: sum.app_version,
                    updated: sum.updated,
                    values_yaml,
                    manifest: s(current, &["manifest"]),
                    notes: s(current, &["info", "notes"]),
                    history,
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn encode(json: &str) -> Vec<u8> {
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(json.as_bytes()).unwrap();
        let gzipped = gz.finish().unwrap();
        STANDARD.encode(gzipped).into_bytes()
    }

    #[test]
    fn decodes_gzipped_release() {
        let raw = encode(r#"{"name":"redis","version":3}"#);
        let v = decode_release(&raw).unwrap();
        assert_eq!(v["name"], "redis");
        assert_eq!(v["version"], 3);
    }

    #[test]
    fn decodes_plain_base64_release() {
        // Older Helm data may not be gzipped — plain base64(json).
        let raw = STANDARD.encode(r#"{"name":"nginx","version":1}"#).into_bytes();
        let v = decode_release(&raw).unwrap();
        assert_eq!(v["name"], "nginx");
    }

    #[test]
    fn summarises_release_fields() {
        let v: Value = serde_json::from_str(
            r#"{
                "name":"redis","namespace":"cache","version":2,
                "info":{"status":"deployed","last_deployed":"2026-07-01T00:00:00Z"},
                "chart":{"metadata":{"name":"redis","version":"19.0.1","appVersion":"7.2.4"}}
            }"#,
        )
        .unwrap();
        let sum = summarise_release(&v);
        assert_eq!(sum.name, "redis");
        assert_eq!(sum.namespace, "cache");
        assert_eq!(sum.revision, 2);
        assert_eq!(sum.status, "deployed");
        assert_eq!(sum.chart, "redis");
        assert_eq!(sum.chart_version, "19.0.1");
        assert_eq!(sum.app_version, "7.2.4");
    }
}
