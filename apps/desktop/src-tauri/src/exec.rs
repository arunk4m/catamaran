//! Interactive exec bridge: spawns kube-rs exec sessions, streams stdout to
//! the WebView over Tauri events, and forwards stdin from the WebView.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use catamaran_kube::client_cache::ClientCache;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

struct Session {
    handle: JoinHandle<()>,
    input: mpsc::Sender<String>,
}

/// Tauri-managed state owning running exec sessions (keyed by numeric id).
pub struct ExecManager {
    cache: Arc<ClientCache>,
    next_id: AtomicU64,
    sessions: Mutex<HashMap<u64, Session>>,
}

impl ExecManager {
    pub fn new(cache: Arc<ClientCache>) -> Self {
        Self {
            cache,
            next_id: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// Open an interactive shell into a pod. Returns the session id; stdout streams
/// on `exec:out:<id>` and an `exec:exit:<id>` event fires (with an optional
/// error string) when the session ends.
#[tauri::command]
pub async fn start_pod_exec(
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    shell: Option<String>,
    app: AppHandle,
    manager: State<'_, ExecManager>,
) -> Result<u64, String> {
    let id = manager.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel::<String>(64);
    let cache = manager.cache.clone();
    let out_channel = format!("exec:out:{id}");
    let exit_channel = format!("exec:exit:{id}");
    let app_out = app.clone();

    let handle = tokio::spawn(async move {
        let result = catamaran_kube::exec::exec_shell(
            cache,
            context,
            namespace,
            pod,
            container,
            shell,
            move |chunk| {
                let _ = app_out.emit(&out_channel, chunk);
            },
            rx,
        )
        .await;
        let _ = app.emit(&exit_channel, result.err());
    });

    manager
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { handle, input: tx });
    Ok(id)
}

/// Forward a keystroke / input string to an exec session's stdin.
#[tauri::command]
pub async fn exec_input(
    session: u64,
    data: String,
    manager: State<'_, ExecManager>,
) -> Result<(), String> {
    let sender = manager
        .sessions
        .lock()
        .unwrap()
        .get(&session)
        .map(|s| s.input.clone());
    if let Some(tx) = sender {
        let _ = tx.send(data).await;
    }
    Ok(())
}

/// Close an exec session and abort its task.
#[tauri::command]
pub async fn exec_close(session: u64, manager: State<'_, ExecManager>) -> Result<(), String> {
    if let Some(s) = manager.sessions.lock().unwrap().remove(&session) {
        s.handle.abort();
    }
    Ok(())
}
