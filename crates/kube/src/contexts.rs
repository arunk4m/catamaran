//! The `k8s.listContexts` capability — reads the kubeconfig and returns its
//! contexts. Surfaced to both the UI and MCP via the shared registry.

use std::path::PathBuf;
use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::load_kubeconfigs;

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(default)]
pub struct ListContextsIn {
    /// Additional kubeconfig files merged after the default files.
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct ContextDto {
    pub name: String,
    pub cluster: String,
    pub server: String,
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListContextsOut {
    pub contexts: Vec<ContextDto>,
}

/// Build the capability over the shared cache. Supplying `paths` replaces the
/// additional kubeconfig files and invalidates authenticated clients.
pub fn list_contexts_capability(cache: Arc<ClientCache>, default_paths: Vec<PathBuf>) -> Capability {
    Capability::typed::<ListContextsIn, ListContextsOut, _, _>(
        "k8s.listContexts",
        "list the kube contexts available in the kubeconfig",
        Annotations::READ_ONLY,
        move |input: ListContextsIn| {
            let cache = cache.clone();
            let default_paths = default_paths.clone();
            async move {
                if let Some(additional) = input.paths {
                    let mut paths = default_paths;
                    for path in additional.into_iter().map(PathBuf::from) {
                        if !paths.contains(&path) {
                            paths.push(path);
                        }
                    }
                    cache.set_paths(paths).await;
                }
                let config = load_kubeconfigs(&cache.paths().await)
                    .map_err(CapabilityError::Handler)?;
                let current = config.current_context.unwrap_or_default();
                let clusters = config.clusters;
                let contexts = config.contexts.into_iter().map(|named| {
                    let context = named.context.unwrap_or_default();
                    let cluster_name = context.cluster;
                    let server = clusters.iter()
                        .find(|cluster| cluster.name == cluster_name)
                        .and_then(|cluster| cluster.cluster.as_ref())
                        .and_then(|cluster| cluster.server.clone())
                        .unwrap_or_default();
                    ContextDto {
                        is_current: named.name == current,
                        name: named.name,
                        cluster: cluster_name,
                        server,
                    }
                }).collect();
                Ok(ListContextsOut { contexts })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use catamaran_capability::Registry;
    use serde_json::json;

    #[test]
    fn capability_has_expected_id_and_annotations() {
        let path = PathBuf::from("/nonexistent");
        let cap = list_contexts_capability(ClientCache::new(path.clone()), vec![path]);
        assert_eq!(cap.id, "k8s.listContexts");
        assert!(cap.annotations.read_only);
    }

    #[tokio::test]
    async fn reads_and_parses_a_kubeconfig_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("catamaran-test-kubeconfig.yaml");
        tokio::fs::write(
            &path,
            "clusters:\n  - name: a\n    cluster: { server: https://a }\ncontexts:\n  - name: ctx-a\n    context: { cluster: a, user: user-a }\n",
        )
        .await
        .unwrap();

        let mut reg = Registry::new();
        reg.register(list_contexts_capability(ClientCache::new(path.clone()), vec![path.clone()]));
        let out = reg.invoke("k8s.listContexts", json!({})).await.unwrap();

        assert_eq!(out["contexts"][0]["name"], "ctx-a");
        assert_eq!(out["contexts"][0]["server"], "https://a");
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn missing_file_is_a_handler_error() {
        let mut reg = Registry::new();
        let path = PathBuf::from("/no/such/kubeconfig");
        reg.register(list_contexts_capability(ClientCache::new(path.clone()), vec![path]));
        let err = reg.invoke("k8s.listContexts", json!({})).await.unwrap_err();
        assert!(matches!(err, CapabilityError::Handler(_)));
    }

    #[tokio::test]
    async fn merges_additional_kubeconfig_files() {
        let dir = std::env::temp_dir();
        let first = dir.join("catamaran-contexts-first.yaml");
        let second = dir.join("catamaran-contexts-second.yaml");
        tokio::fs::write(
            &first,
            "clusters:\n- name: a\n  cluster: { server: https://a }\ncontexts:\n- name: ctx-a\n  context: { cluster: a, user: user-a }\n",
        ).await.unwrap();
        tokio::fs::write(
            &second,
            "clusters:\n- name: b\n  cluster: { server: https://b }\ncontexts:\n- name: ctx-b\n  context: { cluster: b, user: user-b }\n",
        ).await.unwrap();

        let cache = ClientCache::new(first.clone());
        let mut reg = Registry::new();
        reg.register(list_contexts_capability(cache, vec![first.clone()]));
        let out = reg.invoke(
            "k8s.listContexts",
            json!({ "paths": [second.to_string_lossy()] }),
        ).await.unwrap();
        assert_eq!(out["contexts"].as_array().unwrap().len(), 2);
        assert_eq!(out["contexts"][1]["name"], "ctx-b");

        let _ = tokio::fs::remove_file(first).await;
        let _ = tokio::fs::remove_file(second).await;
    }
}
