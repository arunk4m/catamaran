//! In-app MCP HTTP server lifecycle and `catamaran` CLI install, driven from the
//! Settings → MCP section. The HTTP server shares the app's authenticated
//! client cache, so an MCP client can drive the same clusters the GUI sees.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use catamaran_kube::client_cache::ClientCache;
use tauri::State;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::capabilities::build_registry_with;

struct Running {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    handle: JoinHandle<()>,
}

/// Tauri-managed state owning the running MCP HTTP server (if any).
pub struct McpHttpManager {
    cache: Arc<ClientCache>,
    running: Mutex<Option<Running>>,
}

impl McpHttpManager {
    pub fn new(cache: Arc<ClientCache>) -> Self {
        Self {
            cache,
            running: Mutex::new(None),
        }
    }
}

fn stop_running(manager: &McpHttpManager) {
    if let Some(mut running) = manager.running.lock().unwrap().take() {
        if let Some(tx) = running.shutdown.take() {
            let _ = tx.send(());
        }
        running.handle.abort();
    }
}

fn url_for(addr: SocketAddr) -> String {
    format!("http://{addr}/mcp")
}

/// Start (or restart) the loopback MCP HTTP server on `port`. Returns its URL.
#[tauri::command]
pub async fn mcp_http_start(port: u16, manager: State<'_, McpHttpManager>) -> Result<String, String> {
    stop_running(&manager);

    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    // Bind up front so a port conflict is reported to the UI immediately.
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Could not bind {addr}: {e}"))?;

    let registry = build_registry_with(manager.cache.clone());
    let server = catamaran_mcp::McpServer::new(Arc::new(registry));
    let (tx, rx) = oneshot::channel();
    let handle = tokio::spawn(async move {
        let _ = catamaran_mcp::http::serve_http_with_shutdown(server, listener, async {
            let _ = rx.await;
        })
        .await;
    });

    *manager.running.lock().unwrap() = Some(Running {
        addr,
        shutdown: Some(tx),
        handle,
    });
    Ok(url_for(addr))
}

/// Stop the MCP HTTP server if running.
#[tauri::command]
pub fn mcp_http_stop(manager: State<'_, McpHttpManager>) -> Result<(), String> {
    stop_running(&manager);
    Ok(())
}

/// The MCP HTTP server's URL if it's currently running.
#[tauri::command]
pub fn mcp_http_status(manager: State<'_, McpHttpManager>) -> Option<String> {
    manager
        .running
        .lock()
        .unwrap()
        .as_ref()
        .map(|running| url_for(running.addr))
}

/// Where the `catamaran` CLI symlink is installed, and whether it points at us.
#[derive(Debug, Serialize)]
pub struct CliStatus {
    installed: bool,
    /// The install path (`/usr/local/bin/catamaran`).
    path: String,
    /// What the symlink resolves to, if present.
    links_to: Option<String>,
}

const CLI_PATH: &str = "/usr/local/bin/catamaran";

/// Report whether the `catamaran` CLI is installed on PATH and where it points.
#[tauri::command]
pub fn catamaran_cli_status() -> CliStatus {
    let path = std::path::Path::new(CLI_PATH);
    CliStatus {
        installed: path.exists(),
        path: CLI_PATH.to_string(),
        links_to: std::fs::read_link(path)
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

/// Symlink the running executable to `/usr/local/bin/catamaran` so MCP clients can
/// spawn `catamaran --mcp-stdio`. Returns the install path on success; on a write
/// failure returns a message with the manual command to run.
#[tauri::command]
pub fn install_catamaran_cli() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        let target = std::path::Path::new(CLI_PATH);
        // Replace any existing symlink/file at the target.
        if target.exists() || std::fs::symlink_metadata(target).is_ok() {
            let _ = std::fs::remove_file(target);
        }
        match std::os::unix::fs::symlink(&exe, target) {
            Ok(()) => Ok(CLI_PATH.to_string()),
            Err(e) => Err(format!(
                "Could not write {CLI_PATH} ({e}). Run this in a terminal:\n  sudo ln -sf \"{}\" {CLI_PATH}",
                exe.display()
            )),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = exe;
        Err("Installing the catamaran CLI is only supported on macOS/Linux.".to_string())
    }
}
