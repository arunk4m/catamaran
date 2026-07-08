//! The `k8s.listConfigMaps` capability.

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::ConfigMap;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListConfigMapsIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct ConfigMapSummary {
    pub name: String,
    pub namespace: String,
    /// Number of keys (`data` + `binaryData`).
    pub keys: i32,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListConfigMapsOut {
    pub configmaps: Vec<ConfigMapSummary>,
}

pub(crate) fn summarise(cm: ConfigMap) -> ConfigMapSummary {
    let data_keys = cm.data.as_ref().map_or(0, |d| d.len());
    let binary_keys = cm.binary_data.as_ref().map_or(0, |d| d.len());
    ConfigMapSummary {
        name: cm.metadata.name.clone().unwrap_or_default(),
        namespace: cm.metadata.namespace.clone().unwrap_or_default(),
        keys: (data_keys + binary_keys) as i32,
        age: crate::humanize_age(cm.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listConfigMaps` — list ConfigMaps in a namespace.
pub fn list_configmaps_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListConfigMapsIn, ListConfigMapsOut, _, _>(
        "k8s.listConfigMaps",
        "list ConfigMaps in a namespace of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListConfigMapsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<ConfigMap> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list configmaps timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListConfigMapsOut {
                    configmaps: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_configmaps_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listConfigMaps");
        assert!(cap.annotations.read_only);
    }

    #[test]
    fn counts_data_and_binary_keys() {
        let mut data = BTreeMap::new();
        data.insert("app.conf".to_string(), "level=info".to_string());
        data.insert("log.conf".to_string(), "json".to_string());
        let mut binary = BTreeMap::new();
        binary.insert("cert.der".to_string(), k8s_openapi::ByteString(vec![1, 2, 3]));
        let cm = ConfigMap {
            metadata: kube::core::ObjectMeta {
                name: Some("web-config".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            data: Some(data),
            binary_data: Some(binary),
            ..Default::default()
        };
        let s = summarise(cm);
        assert_eq!(s.name, "web-config");
        assert_eq!(s.namespace, "default");
        assert_eq!(s.keys, 3);
    }
}
