//! Kubeconfig discovery and parsing.

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub struct ContextInfo {
    pub name: String,
    pub cluster: String,
    pub server: String,
    pub is_current: bool,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum KubeError {
    #[error("kubeconfig parse error: {0}")]
    Parse(String),
}

#[derive(Deserialize)]
struct Raw {
    #[serde(default)]
    clusters: Vec<RawCluster>,
    #[serde(default)]
    contexts: Vec<RawContext>,
    #[serde(default, rename = "current-context")]
    current_context: String,
}
#[derive(Deserialize)]
struct RawCluster {
    name: String,
    cluster: RawClusterData,
}
#[derive(Deserialize)]
struct RawClusterData {
    #[serde(default)]
    server: String,
}
#[derive(Deserialize)]
struct RawContext {
    name: String,
    context: RawContextData,
}
#[derive(Deserialize)]
struct RawContextData {
    #[serde(default)]
    cluster: String,
}

/// Parse the contexts out of a kubeconfig YAML document, resolving each
/// context's cluster server. Unknown fields are ignored.
pub fn list_contexts(yaml: &str) -> Result<Vec<ContextInfo>, KubeError> {
    let raw: Raw = serde_yaml::from_str(yaml).map_err(|e| KubeError::Parse(e.to_string()))?;
    let server_of = |cluster: &str| {
        raw.clusters
            .iter()
            .find(|c| c.name == cluster)
            .map(|c| c.cluster.server.clone())
            .unwrap_or_default()
    };
    Ok(raw
        .contexts
        .iter()
        .map(|c| ContextInfo {
            name: c.name.clone(),
            cluster: c.context.cluster.clone(),
            server: server_of(&c.context.cluster),
            is_current: c.name == raw.current_context,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
apiVersion: v1
kind: Config
clusters:
  - name: kind-dev
    cluster:
      server: https://127.0.0.1:6443
      certificate-authority-data: abc
contexts:
  - name: kind-dev
    context:
      cluster: kind-dev
      user: kind-dev
current-context: kind-dev
"#;

    #[test]
    fn lists_contexts_with_resolved_server() {
        let ctxs = list_contexts(SAMPLE).unwrap();
        assert_eq!(
            ctxs,
            vec![ContextInfo {
                name: "kind-dev".into(),
                cluster: "kind-dev".into(),
                server: "https://127.0.0.1:6443".into(),
                is_current: true,
            }]
        );
    }

    #[test]
    fn ignores_unknown_fields_and_handles_multiple_contexts() {
        let yaml = r#"
clusters:
  - name: a
    cluster: { server: https://a }
  - name: b
    cluster: { server: https://b }
contexts:
  - name: ctx-a
    context: { cluster: a }
  - name: ctx-b
    context: { cluster: b }
"#;
        let ctxs = list_contexts(yaml).unwrap();
        assert_eq!(ctxs.len(), 2);
        assert_eq!(ctxs[1].server, "https://b");
        // no current-context set -> none marked current
        assert!(ctxs.iter().all(|c| !c.is_current));
    }

    #[test]
    fn bad_yaml_is_parse_error() {
        assert!(matches!(list_contexts(": not yaml ::"), Err(KubeError::Parse(_))));
    }
}
