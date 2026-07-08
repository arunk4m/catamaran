//! Save-to-disk bridge: a native "save file" dialog plus a plain write. The
//! WebView's `<a download>` doesn't trigger a save in a Tauri webview, so log
//! (and other text) downloads go through here.

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Prompt for a save location (pre-filled with `filename`) and write `content`
/// there. Returns the chosen path, or `None` if the user cancelled.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_file_name(&filename).blocking_save_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.as_path().ok_or("invalid save path")?.to_path_buf();
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Select one or more existing kubeconfig files and return filesystem paths.
#[tauri::command]
pub async fn pick_kubeconfig_files(app: AppHandle) -> Result<Vec<String>, String> {
    let picked = app.dialog().file().blocking_pick_files().unwrap_or_default();
    picked
        .into_iter()
        .map(|file| {
            file.as_path()
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or_else(|| "invalid kubeconfig path".to_string())
        })
        .collect()
}

/// Validate pasted kubeconfig YAML and persist it under the app config folder.
#[tauri::command]
pub async fn save_pasted_kubeconfig(
    app: AppHandle,
    content: String,
    name: Option<String>,
) -> Result<String, String> {
    if content.len() > 1024 * 1024 {
        return Err("kubeconfig must be smaller than 1 MB".to_string());
    }
    catamaran_kube::connect::validate_kubeconfig_yaml(&content)?;

    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("kubeconfigs");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let stem = name
        .unwrap_or_else(|| "pasted".to_string())
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() || character == '-' { character } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let file_name = format!("{}-{timestamp}.yaml", if stem.is_empty() { "pasted" } else { &stem });
    let path = directory.join(file_name);
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
