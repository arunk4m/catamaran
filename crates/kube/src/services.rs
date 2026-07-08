//! The `k8s.listServices` capability.

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Service;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListServicesIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct ServiceSummary {
    pub name: String,
    pub namespace: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(rename = "clusterIP")]
    pub cluster_ip: String,
    pub ports: String,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListServicesOut {
    pub services: Vec<ServiceSummary>,
}

pub(crate) fn summarise(svc: Service) -> ServiceSummary {
    let name = svc.metadata.name.clone().unwrap_or_default();
    let namespace = svc.metadata.namespace.clone().unwrap_or_default();
    let spec = svc.spec.as_ref();
    let type_ = spec
        .and_then(|s| s.type_.clone())
        .unwrap_or_else(|| "ClusterIP".into());
    let cluster_ip = spec
        .and_then(|s| s.cluster_ip.clone())
        .unwrap_or_else(|| "None".into());
    let ports = spec
        .and_then(|s| s.ports.as_ref())
        .map(|ports| {
            ports
                .iter()
                .map(|p| {
                    let proto = p.protocol.clone().unwrap_or_else(|| "TCP".into());
                    format!("{}/{}", p.port, proto)
                })
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    ServiceSummary {
        name,
        namespace,
        type_,
        cluster_ip,
        ports,
        age: crate::humanize_age(svc.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listServices` — list services in a namespace.
pub fn list_services_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListServicesIn, ListServicesOut, _, _>(
        "k8s.listServices",
        "list services in a namespace of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListServicesIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Service> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list services timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListServicesOut {
                    services: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::core::v1::{ServicePort, ServiceSpec};
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_services_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listServices");
        assert!(cap.annotations.read_only);
    }

    #[test]
    fn summarises_type_and_ports() {
        let svc = Service {
            metadata: kube::core::ObjectMeta {
                name: Some("api".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            spec: Some(ServiceSpec {
                type_: Some("ClusterIP".into()),
                cluster_ip: Some("10.0.0.1".into()),
                ports: Some(vec![ServicePort {
                    port: 80,
                    protocol: Some("TCP".into()),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise(svc);
        assert_eq!(s.type_, "ClusterIP");
        assert_eq!(s.cluster_ip, "10.0.0.1");
        assert_eq!(s.ports, "80/TCP");
    }
}
