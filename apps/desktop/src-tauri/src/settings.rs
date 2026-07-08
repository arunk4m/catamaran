//! Runtime settings the WebView can adjust.
//!
//! Currently just the per-request timeout budget shared by every capability.
//! The value lives in the kube crate (a process-wide atomic); the frontend
//! persists it in localStorage and re-applies it here on each startup.

use catamaran_kube::connect::{request_timeout_secs, set_request_timeout_secs, MAX_TIMEOUT_SECS, MIN_TIMEOUT_SECS};

/// The request-timeout bounds, so the UI can render/validate the same range.
#[derive(serde::Serialize)]
pub struct TimeoutBounds {
    pub secs: u64,
    pub min: u64,
    pub max: u64,
}

/// Set the per-request timeout (seconds). The value is clamped to the supported
/// range; the applied value is returned so the UI can reflect any clamping.
#[tauri::command]
pub fn set_request_timeout(secs: u64) -> u64 {
    set_request_timeout_secs(secs)
}

/// Read the current per-request timeout and its supported bounds.
#[tauri::command]
pub fn get_request_timeout() -> TimeoutBounds {
    TimeoutBounds {
        secs: request_timeout_secs(),
        min: MIN_TIMEOUT_SECS,
        max: MAX_TIMEOUT_SECS,
    }
}
