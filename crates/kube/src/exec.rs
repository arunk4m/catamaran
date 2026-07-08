//! Interactive in-pod exec via kube-rs. Opens a TTY exec session to a
//! container and pumps stdout to a callback while forwarding stdin from a
//! channel — Tauri-agnostic so the streaming logic stays reusable.

use std::sync::Arc;

use k8s_openapi::api::core::v1::Pod;
use kube::api::AttachParams;
use kube::Api;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc::Receiver;

use crate::client_cache::ClientCache;

/// Candidate shells to try, in order — busybox images often lack bash.
pub fn shell_command(requested: Option<&str>) -> Vec<String> {
    match requested {
        Some(s) if !s.is_empty() => vec![s.to_string()],
        _ => vec!["/bin/sh".to_string()],
    }
}

/// Open an interactive exec session. `on_output` receives stdout chunks
/// (lossy UTF-8); `input_rx` yields stdin keystrokes. Runs until either side
/// closes or the task is aborted.
#[allow(clippy::too_many_arguments)]
pub async fn exec_shell<F>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    pod: String,
    container: Option<String>,
    shell: Option<String>,
    mut on_output: F,
    mut input_rx: Receiver<String>,
) -> Result<(), String>
where
    F: FnMut(String) + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<Pod> = Api::namespaced(client, &namespace);
    let mut params = AttachParams::default()
        .stdin(true)
        .stdout(true)
        .stderr(false)
        .tty(true);
    // Target a specific container when asked (multi-container / sidecar pods);
    // otherwise the API defaults to the pod's first container.
    if let Some(container) = container.filter(|c| !c.is_empty()) {
        params = params.container(container);
    }

    let command = shell_command(shell.as_deref());
    let mut attached = api
        .exec(&pod, command, &params)
        .await
        .map_err(|e| e.to_string())?;

    let mut stdout = attached.stdout().ok_or_else(|| "exec: no stdout".to_string())?;
    let mut stdin = attached.stdin().ok_or_else(|| "exec: no stdin".to_string())?;
    let mut buf = vec![0u8; 8192];

    loop {
        tokio::select! {
            read = stdout.read(&mut buf) => match read {
                Ok(0) => break,
                Ok(n) => on_output(String::from_utf8_lossy(&buf[..n]).to_string()),
                Err(_) => break,
            },
            msg = input_rx.recv() => match msg {
                Some(data) => {
                    if stdin.write_all(data.as_bytes()).await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
                None => break,
            },
        }
    }

    let _ = attached.join().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_command_defaults_to_sh() {
        assert_eq!(shell_command(None), vec!["/bin/sh".to_string()]);
        assert_eq!(shell_command(Some("")), vec!["/bin/sh".to_string()]);
        assert_eq!(shell_command(Some("/bin/bash")), vec!["/bin/bash".to_string()]);
    }
}
