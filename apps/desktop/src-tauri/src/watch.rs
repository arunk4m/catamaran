//! Live-watch bridge: spawns kube-rs resource watches (pods, deployments,
//! services) and pushes full snapshots to the WebView over Tauri events.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use catamaran_kube::client_cache::ClientCache;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinHandle;

/// Tauri-managed state owning the running watch tasks (keyed by channel).
pub struct WatchManager {
    cache: Arc<ClientCache>,
    tasks: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl WatchManager {
    pub fn new(cache: Arc<ClientCache>) -> Self {
        Self {
            cache,
            tasks: Mutex::new(HashMap::new()),
        }
    }

    fn abort(&self, channel: &str) {
        if let Some(handle) = self.tasks.lock().unwrap().remove(channel) {
            handle.abort();
        }
    }
}

/// Start watching a watchable resource kind ("pods" | "deployments" |
/// "services") in a namespace, emitting each full sorted snapshot on the
/// caller-provided `channel`. The WebView subscribes to `channel` first, then
/// invokes this, so the initial snapshot can't race ahead of the listener.
#[tauri::command]
pub async fn start_resource_watch(
    context: String,
    namespace: String,
    kind: String,
    channel: String,
    app: AppHandle,
    manager: State<'_, WatchManager>,
) -> Result<String, String> {
    manager.abort(&channel);

    let cache = manager.cache.clone();
    let emit_channel = channel.clone();
    let app_out = app.clone();

    let handle = tokio::spawn(async move {
        // Each watch emits either a snapshot (JSON array) or a `{status}` object
        // on the same channel; the WebView distinguishes by shape. `status_of`
        // builds the status closure (identical across kinds).
        macro_rules! status_of {
            () => {{
                let (a, c) = (app_out.clone(), emit_channel.clone());
                move |st: catamaran_kube::watch::WatchStatus| {
                    let _ = a.emit(&c, serde_json::json!({ "status": st.as_str() }));
                }
            }};
        }

        let result = match kind.as_str() {
            "pods" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_pods(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "deployments" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_deployments(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "statefulsets" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_statefulsets(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "daemonsets" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_daemonsets(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "jobs" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_jobs(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "cronjobs" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_cronjobs(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "configmaps" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_configmaps(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "secrets" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_secrets(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "resourcequotas" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_resourcequotas(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "limitranges" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_limitranges(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "services" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_services(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "ingresses" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_ingresses(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "endpointslices" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_endpointslices(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "networkpolicies" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_networkpolicies(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "persistentvolumeclaims" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_pvcs(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "persistentvolumes" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_persistentvolumes(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "storageclasses" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_storageclasses(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "serviceaccounts" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_serviceaccounts(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "roles" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_roles(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "clusterroles" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_clusterroles(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "rolebindings" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_rolebindings(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "clusterrolebindings" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_clusterrolebindings(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            "events" => {
                let (a, c) = (app_out.clone(), emit_channel.clone());
                catamaran_kube::watch::watch_events(
                    cache,
                    context,
                    namespace,
                    move |rows| {
                        let _ = a.emit(&c, rows);
                    },
                    status_of!(),
                )
                .await
            }
            other => Err(format!("kind not watchable: {other}")),
        };
        if let Err(e) = result {
            eprintln!("resource watch error: {e}");
        }
    });

    manager
        .tasks
        .lock()
        .unwrap()
        .insert(channel.clone(), handle);
    Ok(channel)
}

/// Stop a running watch by its channel.
#[tauri::command]
pub async fn stop_watch(channel: String, manager: State<'_, WatchManager>) -> Result<(), String> {
    manager.abort(&channel);
    Ok(())
}
