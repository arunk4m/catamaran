//! The `k8s.listEvents` capability — cluster events with type/reason/object.

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Event;
use kube::api::ListParams;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListEventsIn {
    pub context: String,
    #[serde(default)]
    pub namespace: String,
    #[serde(default, rename = "objectKind")]
    pub object_kind: String,
    #[serde(default, rename = "objectName")]
    pub object_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct EventSummary {
    /// The Event's own object name — a stable unique key for the watch/table.
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub reason: String,
    pub object: String,
    pub message: String,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListEventsOut {
    pub events: Vec<EventSummary>,
}

pub(crate) fn summarise(ev: Event) -> EventSummary {
    let object = format!(
        "{}/{}",
        ev.involved_object.kind.clone().unwrap_or_default(),
        ev.involved_object.name.clone().unwrap_or_default()
    );
    let age = crate::humanize_age(ev.last_timestamp.as_ref());
    let name = ev
        .metadata
        .namespace
        .as_deref()
        .map(|ns| format!("{ns}/{}", ev.metadata.name.clone().unwrap_or_default()))
        .unwrap_or_else(|| ev.metadata.name.clone().unwrap_or_default());
    EventSummary {
        name,
        type_: ev.type_.clone().unwrap_or_default(),
        reason: ev.reason.clone().unwrap_or_default(),
        object,
        message: ev.message.clone().unwrap_or_default(),
        age,
    }
}

fn event_list_params(object_kind: &str, object_name: &str) -> ListParams {
    if object_name.is_empty() {
        return ListParams::default();
    }
    let mut selectors = vec![format!("involvedObject.name={object_name}")];
    if !object_kind.is_empty() {
        selectors.push(format!("involvedObject.kind={object_kind}"));
    }
    ListParams::default().fields(&selectors.join(","))
}

/// `k8s.listEvents` — list events (optionally namespaced).
pub fn list_events_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListEventsIn, ListEventsOut, _, _>(
        "k8s.listEvents",
        "list events in a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListEventsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: kube::Api<Event> = crate::scoped_api(client, &input.namespace);
                let params = event_list_params(&input.object_kind, &input.object_name);
                let list = tokio::time::timeout(request_timeout(), api.list(&params))
                    .await
                    .map_err(|_| CapabilityError::Handler("list events timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListEventsOut {
                    events: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_events_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listEvents");
    }

    #[test]
    fn summarises_object_ref() {
        let ev = Event {
            type_: Some("Warning".into()),
            reason: Some("BackOff".into()),
            message: Some("Back-off restarting".into()),
            involved_object: k8s_openapi::api::core::v1::ObjectReference {
                kind: Some("Pod".into()),
                name: Some("web-1".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let s = summarise(ev);
        assert_eq!(s.type_, "Warning");
        assert_eq!(s.object, "Pod/web-1");
    }

    #[test]
    fn filters_events_by_exact_involved_object() {
        let params = event_list_params("Pod", "web-1");
        assert_eq!(
            params.field_selector.as_deref(),
            Some("involvedObject.name=web-1,involvedObject.kind=Pod")
        );
        assert_eq!(event_list_params("", "").field_selector, None);
    }
}
