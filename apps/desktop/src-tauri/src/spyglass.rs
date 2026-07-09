//! Spyglass windows: Kiali and Grafana open as dedicated native windows.
//!
//! Both tools ship `X-Frame-Options: deny`, so they cannot be embedded in the
//! main webview — but a top-level window navigation is exempt from frame
//! rules. One window per tool: re-opening navigates and refocuses instead of
//! stacking windows.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Window label for a tool ("kiali" → "spyglass-kiali"), rejecting unknown
/// tools and non-web URLs before anything touches the window manager.
pub(crate) fn tool_window_target(tool: &str, url: &str) -> Result<(String, Url), String> {
    if !catamaran_kube::spyglass::SPYGLASS_TOOLS.contains(&tool) {
        return Err(format!("unknown spyglass tool: {tool}"));
    }
    let parsed = Url::parse(url).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http(s) URLs can open in a spyglass window".into());
    }
    Ok((format!("spyglass-{tool}"), parsed))
}

/// Open (or refocus) the dedicated window for a spyglass tool.
#[tauri::command]
pub async fn open_tool_window(
    app: AppHandle,
    tool: String,
    url: String,
    title: String,
) -> Result<(), String> {
    let (label, parsed) = tool_window_target(&tool, &url)?;

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_title(&title);
        if window.url().map(|u| u != parsed).unwrap_or(true) {
            window.navigate(parsed).map_err(|e| e.to_string())?;
        }
        let _ = window.unminimize();
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(&title)
        .inner_size(1380.0, 900.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_tools_with_web_urls_are_accepted() {
        let (label, url) = tool_window_target("kiali", "http://127.0.0.1:20099/").unwrap();
        assert_eq!(label, "spyglass-kiali");
        assert_eq!(url.scheme(), "http");
        let (label, _) = tool_window_target("grafana", "https://grafana.example.com").unwrap();
        assert_eq!(label, "spyglass-grafana");
    }

    #[test]
    fn unknown_tools_are_rejected() {
        assert!(tool_window_target("prometheus", "http://x/").is_err());
        assert!(tool_window_target("", "http://x/").is_err());
    }

    #[test]
    fn non_web_urls_are_rejected() {
        assert!(tool_window_target("kiali", "file:///etc/passwd").is_err());
        assert!(tool_window_target("kiali", "javascript:alert(1)").is_err());
        assert!(tool_window_target("kiali", "not a url").is_err());
    }
}
