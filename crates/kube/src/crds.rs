//! Custom Resource Definition discovery + dynamic listing, so the UI can browse
//! any installed CRD (Gateway API, cert-manager, …) without a static GVK table.

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use futures::StreamExt;
use kube::api::{Api, DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListCrdsIn {
    pub context: String,
}

/// A discovered CustomResourceDefinition, enough to list its instances.
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct CrdDescriptor {
    /// Metadata name, e.g. "gateways.gateway.networking.k8s.io".
    pub name: String,
    pub group: String,
    pub version: String,
    pub kind: String,
    pub plural: String,
    pub namespaced: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListCrdsOut {
    pub crds: Vec<CrdDescriptor>,
}

fn handler_err(e: impl ToString) -> CapabilityError {
    CapabilityError::Handler(e.to_string())
}

/// Split a CRD metadata name ("<plural>.<group>") into (plural, group).
pub(crate) fn split_crd_name(name: &str) -> Option<(String, String)> {
    let (plural, group) = name.split_once('.')?;
    if plural.is_empty() || group.is_empty() {
        return None;
    }
    Some((plural.to_string(), group.to_string()))
}

/// `k8s.listCRDs` — discover installed CustomResourceDefinitions.
pub fn list_crds_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListCrdsIn, ListCrdsOut, _, _>(
        "k8s.listCRDs",
        "list installed CustomResourceDefinitions (group, kind, plural, scope)",
        Annotations::READ_ONLY,
        move |input: ListCrdsIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let gvk =
                    GroupVersionKind::gvk("apiextensions.k8s.io", "v1", "CustomResourceDefinition");
                let ar = ApiResource::from_gvk(&gvk);
                let api: Api<DynamicObject> = Api::all_with(client.clone(), &ar);

                // CRD objects embed their full OpenAPI schemas — tens of MB
                // cluster-wide, enough to stall or sever the connection on a
                // VPN. No schema ever needs to cross the wire: a CRD's NAME is
                // "<plural>.<group>" (metadata-only pages, tiny), and the
                // discovery API supplies kind/version/scope in kilobytes.
                let budget = request_timeout().saturating_mul(3);
                let walk = async {
                    let mut names: Vec<String> = Vec::new();
                    let mut continue_token: Option<String> = None;
                    loop {
                        let mut params = ListParams::default().limit(500);
                        if let Some(token) = &continue_token {
                            params = params.continue_token(token);
                        }
                        let page = tokio::time::timeout(request_timeout(), api.list_metadata(&params))
                            .await
                            .map_err(|_| CapabilityError::Handler("list CRDs timed out".into()))?
                            .map_err(handler_err)?;
                        names.extend(page.items.into_iter().filter_map(|item| item.metadata.name));
                        match page.metadata.continue_ {
                            Some(token) if !token.is_empty() => continue_token = Some(token),
                            _ => break,
                        }
                    }
                    Ok::<_, CapabilityError>(names)
                };
                let names = tokio::time::timeout(budget, walk)
                    .await
                    .map_err(|_| CapabilityError::Handler("list CRDs timed out".into()))??;

                // (group, plural) -> CRD metadata name
                let mut wanted: std::collections::BTreeMap<(String, String), String> =
                    std::collections::BTreeMap::new();
                for name in names {
                    if let Some((plural, group)) = split_crd_name(&name) {
                        wanted.insert((group, plural), name);
                    }
                }
                let wanted_groups: std::collections::BTreeSet<String> =
                    wanted.keys().map(|(group, _)| group.clone()).collect();

                // One tiny call lists every API group + its preferred version;
                // then the per-group resource lists are fetched in parallel
                // (sequential discovery is ~one VPN round-trip per group).
                let group_list = tokio::time::timeout(request_timeout(), client.list_api_groups())
                    .await
                    .map_err(|_| CapabilityError::Handler("CRD discovery timed out".into()))?
                    .map_err(handler_err)?;
                let group_versions: Vec<(String, String)> = group_list
                    .groups
                    .into_iter()
                    .filter(|group| wanted_groups.contains(&group.name))
                    .filter_map(|group| {
                        let version = group
                            .preferred_version
                            .map(|v| v.group_version)
                            .or_else(|| group.versions.first().map(|v| v.group_version.clone()))?;
                        Some((group.name, version))
                    })
                    .collect();

                let resource_lists: Vec<_> = futures::stream::iter(group_versions.into_iter().map(
                    |(group_name, group_version)| {
                        let client = client.clone();
                        async move {
                            let list = tokio::time::timeout(
                                request_timeout(),
                                client.list_api_group_resources(&group_version),
                            )
                            .await
                            .ok()?
                            .ok()?;
                            Some((group_name, group_version, list))
                        }
                    },
                ))
                .buffer_unordered(8)
                .filter_map(|entry| async move { entry })
                .collect()
                .await;

                let mut crds: Vec<CrdDescriptor> = Vec::new();
                for (group_name, group_version, list) in resource_lists {
                    let version = group_version.split('/').nth(1).unwrap_or_default().to_string();
                    for resource in list.resources.iter().filter(|r| !r.name.contains('/')) {
                        let key = (group_name.clone(), resource.name.clone());
                        let Some(name) = wanted.get(&key) else { continue };
                        crds.push(CrdDescriptor {
                            name: name.clone(),
                            group: group_name.clone(),
                            version: version.clone(),
                            kind: resource.kind.clone(),
                            plural: resource.name.clone(),
                            namespaced: resource.namespaced,
                        });
                    }
                }
                crds.sort_by(|a, b| (&a.group, &a.kind).cmp(&(&b.group, &b.kind)));
                Ok(ListCrdsOut { crds })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListCustomIn {
    pub context: String,
    pub group: String,
    pub version: String,
    pub plural: String,
    pub kind: String,
    pub namespaced: bool,
    #[serde(default)]
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct CustomRow {
    pub name: String,
    pub namespace: String,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListCustomOut {
    pub items: Vec<CustomRow>,
}

/// Build a dynamic ApiResource for an arbitrary CRD GVK + plural.
pub(crate) fn custom_api_resource(group: &str, version: &str, kind: &str, plural: &str) -> ApiResource {
    let api_version = if group.is_empty() {
        version.to_string()
    } else {
        format!("{group}/{version}")
    };
    ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version,
        kind: kind.to_string(),
        plural: plural.to_string(),
    }
}

/// `k8s.listCustomResource` — list instances of a CRD by its GVK + plural.
pub fn list_custom_resource_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListCustomIn, ListCustomOut, _, _>(
        "k8s.listCustomResource",
        "list instances of a custom resource by group/version/plural",
        Annotations::READ_ONLY,
        move |input: ListCustomIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let ar = custom_api_resource(&input.group, &input.version, &input.kind, &input.plural);
                let api: Api<DynamicObject> = if input.namespaced && !input.namespace.is_empty() {
                    Api::namespaced_with(client, &input.namespace, &ar)
                } else {
                    Api::all_with(client, &ar)
                };
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list custom resource timed out".into()))?
                    .map_err(handler_err)?;
                let items = list
                    .items
                    .into_iter()
                    .map(|o| CustomRow {
                        name: o.metadata.name.unwrap_or_default(),
                        namespace: o.metadata.namespace.unwrap_or_default(),
                        age: crate::humanize_age(o.metadata.creation_timestamp.as_ref()),
                    })
                    .collect();
                Ok(ListCustomOut { items })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn capabilities_have_ids() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(list_crds_capability(cache.clone()).id, "k8s.listCRDs");
        assert_eq!(list_custom_resource_capability(cache).id, "k8s.listCustomResource");
    }

    #[test]
    fn splits_crd_names_into_plural_and_group() {
        assert_eq!(
            split_crd_name("gateways.gateway.networking.k8s.io"),
            Some(("gateways".to_string(), "gateway.networking.k8s.io".to_string()))
        );
        assert_eq!(
            split_crd_name("widgets.example.com"),
            Some(("widgets".to_string(), "example.com".to_string()))
        );
        assert_eq!(split_crd_name("nodot"), None);
        assert_eq!(split_crd_name(".group.only"), None);
    }

    #[test]
    fn builds_namespaced_api_version() {
        let ar = custom_api_resource("gateway.networking.k8s.io", "v1", "Gateway", "gateways");
        assert_eq!(ar.api_version, "gateway.networking.k8s.io/v1");
        assert_eq!(ar.plural, "gateways");
    }
}
