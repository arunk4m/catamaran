//! The `k8s.podLogs` capability — fetch recent logs for a pod via kube-rs.

use std::sync::Arc;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Pod;
use kube::api::LogParams;
use kube::Api;
use futures::{AsyncBufReadExt, StreamExt};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

const DEFAULT_TAIL_LINES: i64 = 200;

/// Follow a pod/container's logs, invoking `on_line` for each line as it
/// arrives. Runs until the stream closes (pod exits) or the task is aborted.
/// Tauri-agnostic so the streaming logic stays reusable.
pub async fn stream_pod_logs<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    tail_lines: i64,
    mut on_line: F,
    mut on_connected: G,
) -> Result<(), String>
where
    F: FnMut(String) + Send,
    G: FnMut() + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let params = LogParams {
        container,
        follow: true,
        tail_lines: Some(tail_lines),
        ..Default::default()
    };
    let reader = tokio::time::timeout(request_timeout(), api.log_stream(&pod, &params))
        .await
        .map_err(|_| "open log stream timed out".to_string())?
        .map_err(|e| e.to_string())?;
    on_connected();
    let mut lines = reader.lines();
    while let Some(line) = lines.next().await {
        on_line(line.map_err(|e| e.to_string())?);
    }
    Ok(())
}

/// Backoff between log reconnect attempts.
const LOG_RECONNECT_SECS: u64 = 2;

/// Follow a pod/container's logs, transparently reconnecting when the stream
/// ends (pod restart, network blip). Unlike a resource watch, a log stream is
/// one-shot, so we loop: the first connect tails `tail_lines`; reconnects tail
/// `0` (only new lines) to avoid re-printing history. `on_status` fires
/// "reconnecting"/"live" on transitions. Runs until the task is aborted.
pub async fn stream_pod_logs_resilient<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    tail_lines: i64,
    mut on_line: F,
    mut on_status: G,
) where
    F: FnMut(String) + Send,
    G: FnMut(&'static str) + Send,
{
    let mut first = true;
    loop {
        let tail = if first { tail_lines } else { 0 };
        let _ = stream_pod_logs(
            cache.clone(),
            context.clone(),
            namespace.clone(),
            pod.clone(),
            container.clone(),
            tail,
            |line| on_line(line),
            || on_status("live"),
        )
        .await;
        first = false;
        // Stream ended or errored — signal the outage, back off, then retry.
        on_status("reconnecting");
        tokio::time::sleep(std::time::Duration::from_secs(LOG_RECONNECT_SECS)).await;
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PodLogsIn {
    pub context: String,
    pub namespace: String,
    pub pod: String,
    /// Container name (optional; defaults to the pod's only/first container).
    #[serde(default)]
    pub container: Option<String>,
    /// Number of trailing lines to return (default 200).
    #[serde(default)]
    pub tail_lines: Option<i64>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct PodLogsOut {
    pub logs: String,
}

/// `k8s.podLogs` — return the last N lines of a pod's logs.
pub fn pod_logs_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodLogsIn, PodLogsOut, _, _>(
        "k8s.podLogs",
        "fetch recent logs for a pod in a connected kube context",
        Annotations::READ_ONLY,
        move |input: PodLogsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = Api::namespaced(client, &input.namespace);
                let params = LogParams {
                    container: input.container.clone(),
                    tail_lines: Some(input.tail_lines.unwrap_or(DEFAULT_TAIL_LINES)),
                    ..Default::default()
                };
                let logs = tokio::time::timeout(request_timeout(), api.logs(&input.pod, &params))
                    .await
                    .map_err(|_| CapabilityError::Handler("fetch logs timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(PodLogsOut { logs })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id_and_annotations() {
        let cap = pod_logs_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.podLogs");
        assert!(cap.annotations.read_only);
    }
}
