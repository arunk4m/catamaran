//! Caches authenticated kube-rs clients per context so capabilities don't
//! re-parse the kubeconfig and rebuild TLS config on every invocation.
//!
//! Builds are single-flight per context: when several views request the same
//! context at once (e.g. right after credentials are refreshed and the cache
//! is flushed), they share ONE client build instead of racing — a build spawns
//! the kubeconfig's exec plugin, and a thundering herd of `aws eks get-token`
//! processes is slow enough to blow request budgets.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use kube::Client;
use tokio::sync::{Mutex, RwLock};

use crate::connect::build_client;

/// Upper bound for one client build (kubeconfig parse + exec plugin + TLS).
/// Frees the per-context slot if an exec plugin hangs indefinitely.
const BUILD_TIMEOUT: Duration = Duration::from_secs(20);

/// One context's cached client, behind its own async lock (the single-flight).
type Slot = Arc<Mutex<Option<Client>>>;

pub struct ClientCache {
    paths: RwLock<Vec<PathBuf>>,
    clients: Mutex<HashMap<String, Slot>>,
}

impl ClientCache {
    pub fn new(path: PathBuf) -> Arc<Self> {
        Self::new_many(vec![path])
    }

    pub fn new_many(paths: Vec<PathBuf>) -> Arc<Self> {
        Arc::new(Self {
            paths: RwLock::new(paths),
            clients: Mutex::new(HashMap::new()),
        })
    }

    pub async fn set_paths(&self, paths: Vec<PathBuf>) {
        let mut current = self.paths.write().await;
        if *current == paths {
            return;
        }
        *current = paths;
        drop(current);
        self.clients.lock().await.clear();
    }

    pub async fn paths(&self) -> Vec<PathBuf> {
        self.paths.read().await.clone()
    }

    /// The per-context slot, created on first use.
    async fn slot(&self, context: &str) -> Slot {
        self.clients
            .lock()
            .await
            .entry(context.to_string())
            .or_default()
            .clone()
    }

    /// Return a cached client for `context`, building one on a miss. Callers
    /// racing on the same context await the in-flight build rather than
    /// starting their own.
    pub async fn get(&self, context: &str) -> Result<Client, String> {
        let slot = self.slot(context).await;
        let mut guard = slot.lock().await;
        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }
        let paths = self.paths().await;
        let client = tokio::time::timeout(BUILD_TIMEOUT, build_client(&paths, context))
            .await
            .map_err(|_| "building the cluster client timed out".to_string())??;
        *guard = Some(client.clone());
        Ok(client)
    }

    /// Drop any cached client for a context (e.g. after a connection failure).
    pub async fn invalidate(&self, context: &str) {
        self.clients.lock().await.remove(context);
    }

    /// Drop every cached client — e.g. after credentials are refreshed, so all
    /// contexts rebuild from the kubeconfig and re-run their exec plugins.
    pub async fn invalidate_all(&self) {
        self.clients.lock().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn get_errors_for_unknown_context() {
        let dir = std::env::temp_dir();
        let path = dir.join("catamaran-cache-test-kubeconfig.yaml");
        tokio::fs::write(
            &path,
            "clusters:\n  - name: a\n    cluster: { server: https://127.0.0.1:1 }\ncontexts:\n  - name: ctx-a\n    context: { cluster: a }\n",
        )
        .await
        .unwrap();

        let cache = ClientCache::new(path.clone());
        assert!(cache.get("does-not-exist").await.is_err());
        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn concurrent_gets_for_one_context_share_the_slot() {
        // Both callers race the same missing context: they must serialize on
        // the slot (no deadlock, no panic) and both surface the build error.
        let cache = ClientCache::new(PathBuf::from("/nonexistent-kubeconfig"));
        let (a, b) = tokio::join!(cache.get("ctx"), cache.get("ctx"));
        assert!(a.is_err());
        assert!(b.is_err());
    }

    #[tokio::test]
    async fn invalidate_is_safe_on_empty_cache() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        cache.invalidate("nope").await; // must not panic
    }

    #[tokio::test]
    async fn invalidate_all_is_safe_on_empty_cache() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        cache.invalidate_all().await; // must not panic
    }
}
