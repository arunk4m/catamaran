//! The `k8s.listNodes` capability (cluster-scoped).

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Node;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListNodesIn {
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct NodeSummary {
    pub name: String,
    /// Readiness derived from the `Ready` condition: "Ready", "NotReady", or "Unknown".
    pub status: String,
    /// Whether the node is cordoned (`spec.unschedulable`) — shown as "SchedulingDisabled".
    pub unschedulable: bool,
    /// Number of taints on the node, excluding the auto-added unschedulable taint.
    pub taints: u32,
    pub version: String,
    pub roles: String,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListNodesOut {
    pub nodes: Vec<NodeSummary>,
}

fn summarise(node: Node) -> NodeSummary {
    let name = node.metadata.name.clone().unwrap_or_default();
    let status = node
        .status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .and_then(|conds| conds.iter().find(|c| c.type_ == "Ready"))
        .map(|c| if c.status == "True" { "Ready" } else { "NotReady" })
        .unwrap_or("Unknown")
        .to_string();
    let version = node
        .status
        .as_ref()
        .and_then(|s| s.node_info.as_ref())
        .map(|i| i.kubelet_version.clone())
        .unwrap_or_default();
    let roles = node
        .metadata
        .labels
        .as_ref()
        .map(|labels| {
            let roles: Vec<String> = labels
                .keys()
                .filter_map(|k| k.strip_prefix("node-role.kubernetes.io/"))
                .filter(|r| !r.is_empty())
                .map(String::from)
                .collect();
            if roles.is_empty() {
                "<none>".to_string()
            } else {
                roles.join(",")
            }
        })
        .unwrap_or_else(|| "<none>".to_string());
    let spec = node.spec.as_ref();
    let unschedulable = spec.and_then(|s| s.unschedulable).unwrap_or(false);
    // Count taints, ignoring the taint Kubernetes adds automatically when a node
    // is cordoned — that state is already conveyed by `unschedulable`.
    let taints = spec
        .and_then(|s| s.taints.as_ref())
        .map(|taints| {
            taints
                .iter()
                .filter(|taint| taint.key != "node.kubernetes.io/unschedulable")
                .count() as u32
        })
        .unwrap_or(0);
    NodeSummary {
        name,
        status,
        unschedulable,
        taints,
        version,
        roles,
        age: crate::humanize_age(node.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listNodes` — list cluster nodes.
pub fn list_nodes_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListNodesIn, ListNodesOut, _, _>(
        "k8s.listNodes",
        "list the nodes of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListNodesIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Node> = Api::all(client);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list nodes timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListNodesOut {
                    nodes: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::core::v1::{NodeCondition, NodeStatus, NodeSystemInfo};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_nodes_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listNodes");
    }

    #[test]
    fn summarises_ready_version_and_roles() {
        let mut labels = BTreeMap::new();
        labels.insert("node-role.kubernetes.io/control-plane".to_string(), "".to_string());
        let node = Node {
            metadata: kube::core::ObjectMeta {
                name: Some("cp-1".into()),
                labels: Some(labels),
                ..Default::default()
            },
            status: Some(NodeStatus {
                conditions: Some(vec![NodeCondition {
                    type_: "Ready".into(),
                    status: "True".into(),
                    ..Default::default()
                }]),
                node_info: Some(NodeSystemInfo {
                    kubelet_version: "v1.35.0".into(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise(node);
        assert_eq!(s.status, "Ready");
        assert_eq!(s.version, "v1.35.0");
        assert_eq!(s.roles, "control-plane");
        assert!(!s.unschedulable);
        assert_eq!(s.taints, 0);
    }

    #[test]
    fn reports_cordoned_and_taints_excluding_the_unschedulable_taint() {
        use k8s_openapi::api::core::v1::{NodeSpec, Taint};
        let node = Node {
            metadata: kube::core::ObjectMeta {
                name: Some("worker-1".into()),
                ..Default::default()
            },
            spec: Some(NodeSpec {
                unschedulable: Some(true),
                taints: Some(vec![
                    Taint {
                        key: "dedicated".into(),
                        effect: "NoSchedule".into(),
                        ..Default::default()
                    },
                    // Auto-added when cordoned — must not be counted as a taint.
                    Taint {
                        key: "node.kubernetes.io/unschedulable".into(),
                        effect: "NoSchedule".into(),
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }),
            status: Some(NodeStatus {
                conditions: Some(vec![NodeCondition {
                    type_: "Ready".into(),
                    status: "True".into(),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise(node);
        assert_eq!(s.status, "Ready");
        assert!(s.unschedulable);
        assert_eq!(s.taints, 1);
    }
}
