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

/// Shared log-window options: how far back to read, and line decoration.
#[derive(Debug, Clone, Copy, Default)]
pub struct LogOptions {
    /// Trailing lines to fetch (ignored when `since_seconds` is set).
    pub tail_lines: Option<i64>,
    /// Read from this many seconds ago instead of a line count.
    pub since_seconds: Option<i64>,
    /// Prefix each line with its RFC3339 timestamp.
    pub timestamps: bool,
}

/// Map shared options onto kube-rs `LogParams` for a follow stream. A `since`
/// window wins over a tail count (matching kubectl, where `--since` and
/// `--tail` are alternatives).
fn stream_params(container: Option<String>, opts: LogOptions) -> LogParams {
    LogParams {
        container,
        follow: true,
        tail_lines: if opts.since_seconds.is_some() {
            None
        } else {
            Some(opts.tail_lines.unwrap_or(DEFAULT_TAIL_LINES))
        },
        since_seconds: opts.since_seconds,
        timestamps: opts.timestamps,
        ..Default::default()
    }
}

/// Map snapshot inputs onto `LogParams` (no follow; `previous` supported).
fn snapshot_params(container: Option<String>, opts: LogOptions, previous: bool) -> LogParams {
    LogParams {
        container,
        previous,
        tail_lines: if opts.since_seconds.is_some() {
            None
        } else {
            Some(opts.tail_lines.unwrap_or(DEFAULT_TAIL_LINES))
        },
        since_seconds: opts.since_seconds,
        timestamps: opts.timestamps,
        ..Default::default()
    }
}

/// Follow a pod/container's logs, invoking `on_line` for each line as it
/// arrives. Runs until the stream closes (pod exits) or the task is aborted.
/// Tauri-agnostic so the streaming logic stays reusable.
pub async fn stream_pod_logs<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    opts: LogOptions,
    mut on_line: F,
    mut on_connected: G,
) -> Result<(), String>
where
    F: FnMut(String) + Send,
    G: FnMut() + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let params = stream_params(container, opts);
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
    opts: LogOptions,
    mut on_line: F,
    mut on_status: G,
) where
    F: FnMut(String) + Send,
    G: FnMut(&'static str) + Send,
{
    let mut first = true;
    loop {
        // The first connect honours the requested window; reconnects tail 0
        // (only new lines) so history isn't re-printed.
        let connect_opts = if first {
            opts
        } else {
            LogOptions { tail_lines: Some(0), since_seconds: None, timestamps: opts.timestamps }
        };
        let _ = stream_pod_logs(
            cache.clone(),
            context.clone(),
            namespace.clone(),
            pod.clone(),
            container.clone(),
            connect_opts,
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
    /// Return logs from the previous (crashed/restarted) container instance.
    #[serde(default)]
    pub previous: Option<bool>,
    /// Prefix each line with its RFC3339 timestamp.
    #[serde(default)]
    pub timestamps: Option<bool>,
    /// Return logs newer than this many seconds (overrides tail_lines).
    #[serde(default)]
    pub since_seconds: Option<i64>,
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
                let params = snapshot_params(
                    input.container.clone(),
                    LogOptions {
                        tail_lines: input.tail_lines,
                        since_seconds: input.since_seconds,
                        timestamps: input.timestamps.unwrap_or(false),
                    },
                    input.previous.unwrap_or(false),
                );
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

    #[test]
    fn stream_params_default_to_a_tail_window() {
        let p = stream_params(Some("app".into()), LogOptions::default());
        assert!(p.follow);
        assert_eq!(p.container.as_deref(), Some("app"));
        assert_eq!(p.tail_lines, Some(DEFAULT_TAIL_LINES));
        assert_eq!(p.since_seconds, None);
        assert!(!p.timestamps);
    }

    #[test]
    fn a_since_window_overrides_the_tail_count() {
        let p = stream_params(
            None,
            LogOptions { tail_lines: Some(500), since_seconds: Some(300), timestamps: true },
        );
        assert_eq!(p.tail_lines, None);
        assert_eq!(p.since_seconds, Some(300));
        assert!(p.timestamps);
    }

    #[test]
    fn snapshot_params_carry_previous_and_timestamps() {
        let p = snapshot_params(
            Some("app".into()),
            LogOptions { tail_lines: Some(1000), since_seconds: None, timestamps: true },
            true,
        );
        assert!(!p.follow);
        assert!(p.previous);
        assert!(p.timestamps);
        assert_eq!(p.tail_lines, Some(1000));
    }

    #[test]
    fn pod_logs_input_accepts_the_new_window_fields() {
        let input: PodLogsIn = serde_json::from_value(serde_json::json!({
            "context": "kind-dev",
            "namespace": "default",
            "pod": "web-1",
            "previous": true,
            "timestamps": true,
            "since_seconds": 600
        }))
        .unwrap();
        assert_eq!(input.previous, Some(true));
        assert_eq!(input.timestamps, Some(true));
        assert_eq!(input.since_seconds, Some(600));
        assert_eq!(input.tail_lines, None);
    }
}
