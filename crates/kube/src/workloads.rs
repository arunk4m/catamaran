//! Workload-listing capabilities backed by kube-rs: `k8s.listNamespaces` and
//! `k8s.listPods` for a connected context.

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::{Namespace, Pod};
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListNamespacesIn {
    pub context: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListNamespacesOut {
    pub namespaces: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListPodsIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct PodSummary {
    pub name: String,
    pub namespace: String,
    pub phase: String,
    pub ready: String,
    pub restarts: i32,
    pub node: String,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListPodsOut {
    pub pods: Vec<PodSummary>,
}

fn handler_err(e: impl ToString) -> CapabilityError {
    CapabilityError::Handler(e.to_string())
}

/// `k8s.listNamespaces` — list namespace names in a connected context.
pub fn list_namespaces_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListNamespacesIn, ListNamespacesOut, _, _>(
        "k8s.listNamespaces",
        "list namespaces in a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListNamespacesIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Namespace> = Api::all(client);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list namespaces timed out".into()))?
                    .map_err(handler_err)?;
                let namespaces = list
                    .items
                    .into_iter()
                    .filter_map(|ns| ns.metadata.name)
                    .collect();
                Ok(ListNamespacesOut { namespaces })
            }
        },
    )
}

/// Summarise a pod's ready count, total restarts, and phase.
pub(crate) fn summarise_pod(pod: Pod) -> PodSummary {
    let name = pod.metadata.name.clone().unwrap_or_default();
    let namespace = pod.metadata.namespace.clone().unwrap_or_default();
    let node = pod
        .spec
        .as_ref()
        .and_then(|s| s.node_name.clone())
        .unwrap_or_default();
    let phase = pod
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".into());

    let statuses = pod
        .status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref());
    let (ready_count, restarts) = match statuses {
        Some(cs) => (
            cs.iter().filter(|c| c.ready).count(),
            cs.iter().map(|c| c.restart_count).sum(),
        ),
        None => (0, 0),
    };
    let total = statuses.map(|cs| cs.len()).unwrap_or(0);

    PodSummary {
        name,
        namespace,
        phase,
        ready: format!("{ready_count}/{total}"),
        restarts,
        node,
        age: crate::humanize_age(pod.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listPods` — list pods in a namespace of a connected context.
pub fn list_pods_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListPodsIn, ListPodsOut, _, _>(
        "k8s.listPods",
        "list pods in a namespace of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListPodsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list pods timed out".into()))?
                    .map_err(handler_err)?;
                let pods = list.items.into_iter().map(summarise_pod).collect();
                Ok(ListPodsOut { pods })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PodsForSelectorIn {
    pub context: String,
    pub namespace: String,
    /// Equality label selector as a map, e.g. `{ "app": "web" }`.
    pub selector: std::collections::BTreeMap<String, String>,
}

/// Build a kube equality label selector string ("k1=v1,k2=v2") from a map.
pub(crate) fn label_selector(selector: &std::collections::BTreeMap<String, String>) -> String {
    selector
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// `k8s.podsForSelector` — pods in a namespace matching a label selector, used
/// to show the pods a workload (Deployment/StatefulSet) manages.
pub fn pods_for_selector_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodsForSelectorIn, ListPodsOut, _, _>(
        "k8s.podsForSelector",
        "list pods matching a label selector (a workload's managed pods)",
        Annotations::READ_ONLY,
        move |input: PodsForSelectorIn| {
            let cache = cache.clone();
            async move {
                // An empty selector would match every pod; return nothing instead.
                if input.selector.is_empty() {
                    return Ok(ListPodsOut { pods: vec![] });
                }
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = crate::scoped_api(client, &input.namespace);
                let params = ListParams::default().labels(&label_selector(&input.selector));
                let list = tokio::time::timeout(request_timeout(), api.list(&params))
                    .await
                    .map_err(|_| CapabilityError::Handler("list pods timed out".into()))?
                    .map_err(handler_err)?;
                let pods = list.items.into_iter().map(summarise_pod).collect();
                Ok(ListPodsOut { pods })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::core::v1::{ContainerStatus, PodSpec, PodStatus};

    #[test]
    fn capabilities_have_expected_ids() {
        use std::path::PathBuf;
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(
            list_namespaces_capability(cache.clone()).id,
            "k8s.listNamespaces"
        );
        assert_eq!(list_pods_capability(cache.clone()).id, "k8s.listPods");
        assert_eq!(pods_for_selector_capability(cache).id, "k8s.podsForSelector");
    }

    #[test]
    fn builds_label_selector_string() {
        let mut m = std::collections::BTreeMap::new();
        m.insert("app".to_string(), "web".to_string());
        m.insert("tier".to_string(), "frontend".to_string());
        assert_eq!(label_selector(&m), "app=web,tier=frontend");
    }

    #[test]
    fn summarises_ready_and_restarts() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("web-1".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            spec: Some(PodSpec {
                node_name: Some("node-a".into()),
                ..Default::default()
            }),
            status: Some(PodStatus {
                phase: Some("Running".into()),
                container_statuses: Some(vec![
                    ContainerStatus {
                        ready: true,
                        restart_count: 1,
                        ..Default::default()
                    },
                    ContainerStatus {
                        ready: false,
                        restart_count: 2,
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }),
        };
        let s = summarise_pod(pod);
        assert_eq!(s.name, "web-1");
        assert_eq!(s.phase, "Running");
        assert_eq!(s.ready, "1/2");
        assert_eq!(s.restarts, 3);
        assert_eq!(s.node, "node-a");
    }

    #[test]
    fn summarises_pod_with_no_status() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("pending".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let s = summarise_pod(pod);
        assert_eq!(s.phase, "Unknown");
        assert_eq!(s.ready, "0/0");
        assert_eq!(s.restarts, 0);
    }
}
