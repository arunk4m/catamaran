//! AWS access-portal integration.
//!
//! Kubeconfig exec blocks that pin `AWS_PROFILE` name the SSO profile a
//! context authenticates with. These capabilities discover those profiles,
//! refresh one via `aws sso login` (the CLI opens the access portal in the
//! browser for approval), and open the configured portal URL — so expired
//! SSO sessions can be fixed from inside the app, after which cached clients
//! are dropped and every pane reconnects with fresh credentials.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use kube::config::Kubeconfig;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::load_kubeconfigs;

/// How long `aws sso login` may wait for the user to approve in the browser.
const SSO_LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

/// Map exec-pinned `AWS_PROFILE` values to the contexts that use them.
pub(crate) fn pinned_profiles(config: &Kubeconfig) -> BTreeMap<String, Vec<String>> {
    // user name -> pinned profile
    let mut user_profile: BTreeMap<&str, &str> = BTreeMap::new();
    for named in &config.auth_infos {
        let Some(exec) = named.auth_info.as_ref().and_then(|a| a.exec.as_ref()) else {
            continue;
        };
        let Some(profile) = exec.env.iter().flatten().find_map(|entry| {
            (entry.get("name").map(String::as_str) == Some("AWS_PROFILE"))
                .then(|| entry.get("value").map(String::as_str))
                .flatten()
        }) else {
            continue;
        };
        user_profile.insert(named.name.as_str(), profile);
    }

    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for ctx in &config.contexts {
        let Some(user) = ctx.context.as_ref().map(|c| c.user.as_str()) else { continue };
        if let Some(profile) = user_profile.get(user) {
            out.entry((*profile).to_string()).or_default().push(ctx.name.clone());
        }
    }
    out
}

/// Profile names come from the user's own kubeconfig, but keep spawn args
/// tidy: AWS profile names are word-ish tokens.
pub(crate) fn valid_profile_name(profile: &str) -> bool {
    !profile.is_empty()
        && profile.len() <= 128
        && profile
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '/'))
}

/// Only web URLs may be opened externally.
pub(crate) fn valid_external_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

/// Platform command that opens `url` in the default browser.
pub(crate) fn opener_command(url: &str) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "macos")]
    return ("open", vec![url.to_string()]);
    #[cfg(target_os = "windows")]
    return ("cmd", vec!["/C".into(), "start".into(), String::new(), url.to_string()]);
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    return ("xdg-open", vec![url.to_string()]);
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SsoProfilesIn {
    /// Additional kubeconfig files to scan besides the defaults.
    #[serde(default)]
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SsoProfileOut {
    pub profile: String,
    pub contexts: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SsoProfilesOut {
    pub profiles: Vec<SsoProfileOut>,
}

/// `aws.ssoProfiles` — AWS SSO profiles pinned by kubeconfig exec blocks.
pub fn sso_profiles_capability(default_paths: Vec<PathBuf>) -> Capability {
    Capability::typed::<SsoProfilesIn, SsoProfilesOut, _, _>(
        "aws.ssoProfiles",
        "list AWS SSO profiles pinned by kubeconfig exec blocks, with the contexts that use them",
        Annotations::READ_ONLY,
        move |input: SsoProfilesIn| {
            let mut paths = default_paths.clone();
            async move {
                for path in input.paths.unwrap_or_default().into_iter().map(PathBuf::from) {
                    if !paths.contains(&path) {
                        paths.push(path);
                    }
                }
                let config = load_kubeconfigs(&paths).map_err(CapabilityError::Handler)?;
                let profiles = pinned_profiles(&config)
                    .into_iter()
                    .map(|(profile, contexts)| SsoProfileOut { profile, contexts })
                    .collect();
                Ok(SsoProfilesOut { profiles })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SsoLoginIn {
    /// The AWS profile to refresh (as pinned in the kubeconfig exec env).
    pub profile: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct SsoLoginOut {
    pub ok: bool,
}

/// After a refresh, pre-build clients for this many of the profile's contexts
/// so the UI's next request doesn't pay the exec plugin's cold start.
const WARM_CONTEXTS: usize = 4;

/// `aws.ssoLogin` — run `aws sso login --profile <p>`; the CLI opens the
/// access portal in the browser for approval. On success every cached kube
/// client is dropped so the next request authenticates with fresh
/// credentials, and the refreshed profile's contexts are re-warmed in the
/// background (single-flight with any UI request for the same context).
pub fn sso_login_capability(cache: Arc<ClientCache>, default_paths: Vec<PathBuf>) -> Capability {
    Capability::typed::<SsoLoginIn, SsoLoginOut, _, _>(
        "aws.ssoLogin",
        "refresh an AWS SSO session via `aws sso login` (opens the access portal in a browser), then reconnect clusters",
        Annotations::default(),
        move |input: SsoLoginIn| {
            let cache = cache.clone();
            let default_paths = default_paths.clone();
            async move {
                if !valid_profile_name(&input.profile) {
                    return Err(CapabilityError::Handler(format!(
                        "invalid AWS profile name: {:?}",
                        input.profile
                    )));
                }
                let output = tokio::time::timeout(
                    SSO_LOGIN_TIMEOUT,
                    tokio::process::Command::new("aws")
                        .args(["sso", "login", "--profile", &input.profile])
                        .stdin(std::process::Stdio::null())
                        .output(),
                )
                .await
                .map_err(|_| {
                    CapabilityError::Handler(
                        "aws sso login timed out waiting for browser approval".into(),
                    )
                })?
                .map_err(|e| CapabilityError::Handler(format!("could not run `aws`: {e}")))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let tail = stderr.trim().lines().last().unwrap_or("aws sso login failed");
                    return Err(CapabilityError::Handler(tail.to_string()));
                }
                // Fresh SSO session: drop every cached client so panes reconnect.
                cache.invalidate_all().await;
                // Warm the refreshed profile's contexts in the background: the
                // first token mint after a login is the slowest (CLI cold start
                // + role-credential exchange), so pay it here instead of on the
                // user's next click.
                if let Ok(config) = load_kubeconfigs(&default_paths) {
                    if let Some(contexts) = pinned_profiles(&config).get(&input.profile) {
                        for context in contexts.iter().take(WARM_CONTEXTS).cloned() {
                            let cache = cache.clone();
                            tokio::spawn(async move {
                                let _ = cache.get(&context).await;
                            });
                        }
                    }
                }
                Ok(SsoLoginOut { ok: true })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OpenUrlIn {
    /// The http(s) URL to open in the default browser.
    pub url: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct OpenUrlOut {
    pub ok: bool,
}

/// `system.openUrl` — open an http(s) URL in the default browser.
pub fn open_url_capability() -> Capability {
    Capability::typed::<OpenUrlIn, OpenUrlOut, _, _>(
        "system.openUrl",
        "open an http(s) URL in the system's default browser",
        Annotations::default(),
        move |input: OpenUrlIn| async move {
            if !valid_external_url(&input.url) {
                return Err(CapabilityError::Handler(format!(
                    "only http(s) URLs may be opened, got {:?}",
                    input.url
                )));
            }
            let (cmd, args) = opener_command(&input.url);
            tokio::process::Command::new(cmd)
                .args(&args)
                .stdin(std::process::Stdio::null())
                .spawn()
                .map_err(|e| CapabilityError::Handler(format!("could not open browser: {e}")))?;
            Ok(OpenUrlOut { ok: true })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo_config() -> Kubeconfig {
        Kubeconfig::from_yaml(
            r#"
apiVersion: v1
clusters:
  - name: dev-cluster
    cluster: { server: "https://dev.example" }
  - name: prod-cluster
    cluster: { server: "https://prod.example" }
contexts:
  - name: dev-eks
    context: { cluster: dev-cluster, user: dev-user }
  - name: tusk-dev
    context: { cluster: dev-cluster, user: dev-user }
  - name: prod-eks
    context: { cluster: prod-cluster, user: prod-user }
  - name: local
    context: { cluster: dev-cluster, user: cert-user }
users:
  - name: dev-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: aws
        env:
          - name: AWS_PROFILE
            value: tusk-dev
  - name: prod-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: aws
        env:
          - name: AWS_PROFILE
            value: tusk-prod
  - name: cert-user
    user: { token: not-a-real-token }
"#,
        )
        .unwrap()
    }

    #[test]
    fn discovers_profiles_and_their_contexts() {
        let profiles = pinned_profiles(&demo_config());
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles["tusk-dev"], vec!["dev-eks", "tusk-dev"]);
        assert_eq!(profiles["tusk-prod"], vec!["prod-eks"]);
    }

    #[test]
    fn ignores_users_without_a_pinned_profile() {
        let profiles = pinned_profiles(&demo_config());
        assert!(profiles.values().flatten().all(|ctx| ctx != "local"));
    }

    #[test]
    fn validates_profile_names() {
        assert!(valid_profile_name("tusk-dev"));
        assert!(valid_profile_name("team/role.name_1"));
        assert!(!valid_profile_name(""));
        assert!(!valid_profile_name("has space"));
        assert!(!valid_profile_name("uh;oh"));
        assert!(!valid_profile_name(&"x".repeat(200)));
    }

    #[test]
    fn validates_external_urls() {
        assert!(valid_external_url("https://deepinsightai.awsapps.com/start/#/"));
        assert!(valid_external_url("http://localhost:8080"));
        assert!(!valid_external_url("file:///etc/passwd"));
        assert!(!valid_external_url("javascript:alert(1)"));
        assert!(!valid_external_url("awsapps.com/start"));
    }

    #[test]
    fn capabilities_have_expected_ids_and_annotations() {
        let profiles = sso_profiles_capability(vec![]);
        assert_eq!(profiles.id, "aws.ssoProfiles");
        assert!(profiles.annotations.read_only);

        let login = sso_login_capability(ClientCache::new(PathBuf::from("/x")), vec![]);
        assert_eq!(login.id, "aws.ssoLogin");
        assert!(!login.annotations.read_only);
        assert!(!login.annotations.destructive);

        let open = open_url_capability();
        assert_eq!(open.id, "system.openUrl");
        assert!(!open.annotations.destructive);
    }

    #[tokio::test]
    async fn open_url_rejects_non_web_schemes() {
        let mut reg = catamaran_capability::Registry::new();
        reg.register(open_url_capability());
        let err = reg
            .invoke("system.openUrl", serde_json::json!({ "url": "file:///etc/hosts" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("http"));
    }

    #[tokio::test]
    async fn sso_login_rejects_malformed_profiles_before_spawning() {
        let mut reg = catamaran_capability::Registry::new();
        reg.register(sso_login_capability(ClientCache::new(PathBuf::from("/x")), vec![]));
        let err = reg
            .invoke("aws.ssoLogin", serde_json::json!({ "profile": "bad profile; rm" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("invalid AWS profile"));
    }
}
