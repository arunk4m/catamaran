//! Port-forward bridge: binds a local loopback port, pipes it to a pod (or a
//! service's backing pod) via kube-rs, and tracks the running forwards so the
//! WebView can list and stop them.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use catamaran_kube::client_cache::ClientCache;
use catamaran_kube::forward;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinHandle;

struct Forward {
    handle: JoinHandle<()>,
}

/// Tauri-managed state owning running port-forwards (keyed by numeric id).
pub struct ForwardManager {
    cache: Arc<ClientCache>,
    next_id: AtomicU64,
    forwards: Mutex<HashMap<u64, Forward>>,
}

impl ForwardManager {
    pub fn new(cache: Arc<ClientCache>) -> Self {
        Self {
            cache,
            next_id: AtomicU64::new(1),
            forwards: Mutex::new(HashMap::new()),
        }
    }
}

/// What `start_port_forward` returns: the forward's id and the actual local
/// port it bound to (the OS picks one when the caller passes no preference).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInfo {
    pub id: u64,
    pub local_port: u16,
}

/// Start forwarding a local port to a Pod or Service. `kind` is "Pod" or
/// "Service"; a Service is resolved to a backing pod and target port first.
/// Returns the id + bound local port; a `forward:closed:<id>` event fires
/// (with an optional error string) if the forward loop ends on its own.
#[tauri::command]
pub async fn start_port_forward(
    context: String,
    namespace: String,
    kind: String,
    name: String,
    remote_port: u16,
    local_port: Option<u16>,
    app: AppHandle,
    manager: State<'_, ForwardManager>,
) -> Result<ForwardInfo, String> {
    let cache = manager.cache.clone();

    // Resolve a Service down to a concrete pod + container port to forward to.
    let (pod, target_port) = if kind.eq_ignore_ascii_case("service") {
        forward::resolve_service_target(
            cache.clone(),
            &context,
            &namespace,
            &name,
            Some(i32::from(remote_port)),
        )
        .await?
    } else {
        (name, remote_port)
    };

    let listener = forward::bind_local(local_port.unwrap_or(0)).await?;
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();

    let id = manager.next_id.fetch_add(1, Ordering::SeqCst);
    let closed_channel = format!("forward:closed:{id}");
    let handle = tokio::spawn(async move {
        let result =
            forward::serve_pod_forward(listener, cache, context, namespace, pod, target_port).await;
        let _ = app.emit(&closed_channel, result.err());
    });

    manager
        .forwards
        .lock()
        .unwrap()
        .insert(id, Forward { handle });
    Ok(ForwardInfo {
        id,
        local_port: bound,
    })
}

/// Stop a port-forward and abort its task.
#[tauri::command]
pub async fn stop_port_forward(id: u64, manager: State<'_, ForwardManager>) -> Result<(), String> {
    if let Some(f) = manager.forwards.lock().unwrap().remove(&id) {
        f.handle.abort();
    }
    Ok(())
}
