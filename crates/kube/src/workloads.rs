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
pub struct PodCountsIn {
    pub context: String,
    /// Namespace to count in ("" = all namespaces).
    #[serde(default)]
    pub namespace: String,
}

#[derive(Debug, Default, Serialize, JsonSchema)]
pub struct PodCountsOut {
    pub total: usize,
    pub running: usize,
    pub pending: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub unknown: usize,
}

/// Fold pod phases into an existing tally.
pub(crate) fn tally_into<'a>(counts: &mut PodCountsOut, phases: impl Iterator<Item = Option<&'a str>>) {
    for phase in phases {
        counts.total += 1;
        match phase {
            Some("Running") => counts.running += 1,
            Some("Pending") => counts.pending += 1,
            Some("Succeeded") => counts.succeeded += 1,
            Some("Failed") => counts.failed += 1,
            _ => counts.unknown += 1,
        }
    }
}

/// Tally pod phases from a typed list without building per-pod summaries.
pub(crate) fn tally_pod_phases<'a>(phases: impl Iterator<Item = Option<&'a str>>) -> PodCountsOut {
    let mut counts = PodCountsOut::default();
    tally_into(&mut counts, phases);
    counts
}

/// Page size for phase counting: modest pages keep per-request work small so
/// the walk survives a degraded or scaling control plane, where one giant
/// unpaginated LIST (or a too-big page) stalls past any interactive budget.
const COUNT_PAGE_SIZE: u32 = 250;

/// `k8s.podCounts` — phase counts for a namespace (or the whole cluster).
///
/// Purpose-built for at-a-glance dashboards: on large clusters, shipping every
/// pod row across the bridge just to count phases is megabytes of overhead —
/// the count happens here (paginated) and five integers cross instead. The
/// page walk gets a wider budget than one interactive request: dashboards
/// tolerate a slow count, and each page is still individually bounded.
pub fn pod_counts_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodCountsIn, PodCountsOut, _, _>(
        "k8s.podCounts",
        "count pods by phase in a namespace (\"\" = cluster-wide) of a connected kube context",
        Annotations::READ_ONLY,
        move |input: PodCountsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = crate::scoped_api(client, &input.namespace);

                let walk = async {
                    let mut counts = PodCountsOut::default();
                    let mut continue_token: Option<String> = None;
                    loop {
                        let mut params = ListParams::default().limit(COUNT_PAGE_SIZE);
                        if let Some(token) = &continue_token {
                            params = params.continue_token(token);
                        }
                        // A page is size-bounded, so its cost is one apiserver
                        // round trip — give it slack for a slow replica rather
                        // than failing the whole count on one cold request.
                        let page = tokio::time::timeout(
                            request_timeout().saturating_mul(2),
                            api.list(&params),
                        )
                        .await
                        .map_err(|_| CapabilityError::Handler("count pods timed out".into()))?
                        .map_err(handler_err)?;
                        tally_into(
                            &mut counts,
                            page.items.iter().map(|pod| {
                                pod.status.as_ref().and_then(|status| status.phase.as_deref())
                            }),
                        );
                        match page.metadata.continue_ {
                            Some(token) if !token.is_empty() => continue_token = Some(token),
                            _ => break,
                        }
                    }
                    Ok::<_, CapabilityError>(counts)
                };

                let budget = request_timeout().saturating_mul(4);
                tokio::time::timeout(budget, walk)
                    .await
                    .map_err(|_| CapabilityError::Handler("count pods timed out".into()))?
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
        assert_eq!(pod_counts_capability(cache.clone()).id, "k8s.podCounts");
        assert!(pod_counts_capability(cache.clone()).annotations.read_only);
        assert_eq!(pods_for_selector_capability(cache).id, "k8s.podsForSelector");
    }

    #[test]
    fn tallies_pod_phases_including_unknowns() {
        let phases = [
            Some("Running"),
            Some("Running"),
            Some("Pending"),
            Some("Succeeded"),
            Some("Failed"),
            Some("SomethingNew"),
            None,
        ];
        let counts = tally_pod_phases(phases.into_iter());
        assert_eq!(counts.total, 7);
        assert_eq!(counts.running, 2);
        assert_eq!(counts.pending, 1);
        assert_eq!(counts.succeeded, 1);
        assert_eq!(counts.failed, 1);
        assert_eq!(counts.unknown, 2);
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
