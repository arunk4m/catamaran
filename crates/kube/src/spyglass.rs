//! Spyglass — in-cluster observability tools (Kiali, Grafana) integrated into
//! catamaran.
//!
//! Three pieces: `obs.discover` finds where a tool runs in a cluster (its
//! Service, the right port, and any Ingress URL); a keyed [`ForwardRegistry`]
//! keeps at most one local port-forward per (context, namespace, service,
//! port) so repeated opens reuse the same tunnel; and `obs.probe` fetches a
//! URL's headers so the shell knows how the tool may be presented — both
//! Kiali and Grafana ship `X-Frame-Options: deny`, which is why they open in
//! dedicated windows rather than embedded panes.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use catamaran_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::{Service, ServicePort};
use k8s_openapi::api::networking::v1::Ingress;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;
use crate::forward;

/// Tools the spyglass knows how to find.
pub const SPYGLASS_TOOLS: [&str; 2] = ["kiali", "grafana"];

/// Page size for the discovery walks (services, ingresses).
const DISCOVER_PAGE_SIZE: u32 = 200;

/// Upper bound for one URL probe (connect + TLS + first response).
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

/// Classify a Service as a spyglass tool by exact name or well-known labels.
///
/// Label matches are guarded against look-alikes that carry a tool's labels
/// or name fragment without being the tool itself (oauth2 proxies fronting
/// it, `grafana-agent-operator`, `grafana-mcp-server`, ...): only an exact
/// service name skips the guard.
pub(crate) fn classify_service(
    name: &str,
    labels: &std::collections::BTreeMap<String, String>,
) -> Option<&'static str> {
    for tool in SPYGLASS_TOOLS {
        if name == tool {
            return Some(tool);
        }
    }
    let lower = name.to_ascii_lowercase();
    let disguised = ["oauth", "proxy", "operator", "agent", "mcp"]
        .iter()
        .any(|fragment| lower.contains(fragment));
    if disguised {
        return None;
    }
    for tool in SPYGLASS_TOOLS {
        let labeled = ["app.kubernetes.io/name", "app"]
            .iter()
            .any(|key| labels.get(*key).map(String::as_str) == Some(tool));
        if labeled {
            return Some(tool);
        }
    }
    None
}

/// Pick the port to reach a tool's UI on: its well-known port numbers first,
/// then an http-ish port name, then the first declared port.
pub(crate) fn preferred_port<'a>(tool: &str, ports: &'a [ServicePort]) -> Option<&'a ServicePort> {
    let known: &[i32] = match tool {
        "kiali" => &[20001],
        "grafana" => &[3000, 80, 8080],
        _ => &[],
    };
    for number in known {
        if let Some(sp) = ports.iter().find(|sp| sp.port == *number) {
            return Some(sp);
        }
    }
    ports
        .iter()
        .find(|sp| {
            sp.name
                .as_deref()
                .map(|n| {
                    let n = n.to_ascii_lowercase();
                    n.contains("http") || n.contains("web") || n.contains("ui")
                })
                .unwrap_or(false)
        })
        .or_else(|| ports.first())
}

/// The Ingress URL serving `service` in `namespace`, if any: a same-namespace
/// ingress rule whose backend is the service itself or a sidecar named after
/// it (`kiali` is commonly fronted by `kiali-oauth2-proxy`). Scheme follows
/// the ingress TLS section for that host.
pub(crate) fn ingress_url_for(
    namespace: &str,
    service: &str,
    ingresses: &[Ingress],
) -> Option<String> {
    for ing in ingresses {
        if ing.metadata.namespace.as_deref() != Some(namespace) {
            continue;
        }
        let Some(spec) = ing.spec.as_ref() else { continue };
        for rule in spec.rules.iter().flatten() {
            let Some(host) = rule.host.as_deref().filter(|h| !h.is_empty()) else {
                continue;
            };
            let backends = rule
                .http
                .iter()
                .flat_map(|http| http.paths.iter())
                .filter_map(|path| path.backend.service.as_ref());
            for backend in backends {
                let name = backend.name.as_str();
                if name == service || name.starts_with(&format!("{service}-")) {
                    let tls_covers = spec
                        .tls
                        .iter()
                        .flatten()
                        .flat_map(|tls| tls.hosts.iter().flatten())
                        .any(|h| h == host);
                    let scheme = if tls_covers { "https" } else { "http" };
                    return Some(format!("{scheme}://{host}"));
                }
            }
        }
    }
    None
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DiscoverIn {
    pub context: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTool {
    /// Which tool this is ("kiali" or "grafana").
    pub tool: String,
    pub namespace: String,
    pub service: String,
    /// Service port the tool's UI listens on.
    pub port: i32,
    pub port_name: Option<String>,
    /// URL of an Ingress already exposing the tool, when one exists.
    pub ingress_url: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct DiscoverOut {
    pub tools: Vec<DiscoveredTool>,
}

fn handler_err<E: std::fmt::Display>(e: E) -> CapabilityError {
    CapabilityError::Handler(e.to_string())
}

/// Stable discovery order: kiali before grafana; within a tool the exact-name
/// service outranks label-matched extras (a cluster can host several grafanas
/// — `grafana` in infra must beat `fedsoc-grafana` for the auto-open pick),
/// then namespace for determinism.
pub(crate) fn sort_tools(tools: &mut [DiscoveredTool]) {
    tools.sort_by(|a, b| {
        a.tool
            .cmp(&b.tool)
            .reverse()
            .then((a.service != a.tool).cmp(&(b.service != b.tool)))
            .then(a.namespace.cmp(&b.namespace))
    });
}

/// `obs.discover` — find observability tools (Kiali, Grafana) in a cluster.
pub fn discover_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<DiscoverIn, DiscoverOut, _, _>(
        "obs.discover",
        "find observability tools (kiali, grafana) in a connected kube context: their service, UI port and ingress URL",
        Annotations::READ_ONLY,
        move |input: DiscoverIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;

                let walk = async {
                    // Pass 1: classify services.
                    let svc_api: Api<Service> = Api::all(client.clone());
                    let mut found: Vec<DiscoveredTool> = Vec::new();
                    let mut continue_token: Option<String> = None;
                    loop {
                        let mut params = ListParams::default().limit(DISCOVER_PAGE_SIZE);
                        if let Some(token) = &continue_token {
                            params = params.continue_token(token);
                        }
                        let page = tokio::time::timeout(
                            request_timeout().saturating_mul(2),
                            svc_api.list(&params),
                        )
                        .await
                        .map_err(|_| CapabilityError::Handler("service discovery timed out".into()))?
                        .map_err(handler_err)?;
                        for svc in &page.items {
                            let name = svc.metadata.name.clone().unwrap_or_default();
                            let namespace = svc.metadata.namespace.clone().unwrap_or_default();
                            let labels = svc.metadata.labels.clone().unwrap_or_default();
                            let Some(tool) = classify_service(&name, &labels) else { continue };
                            let ports = svc
                                .spec
                                .as_ref()
                                .and_then(|s| s.ports.clone())
                                .unwrap_or_default();
                            let Some(sp) = preferred_port(tool, &ports) else { continue };
                            found.push(DiscoveredTool {
                                tool: tool.to_string(),
                                namespace,
                                service: name,
                                port: sp.port,
                                port_name: sp.name.clone(),
                                ingress_url: None,
                            });
                        }
                        match page.metadata.continue_ {
                            Some(token) if !token.is_empty() => continue_token = Some(token),
                            _ => break,
                        }
                    }

                    // Pass 2: attach ingress URLs (only worth the walk if pass 1 hit).
                    if !found.is_empty() {
                        let ing_api: Api<Ingress> = Api::all(client);
                        let mut ingresses: Vec<Ingress> = Vec::new();
                        let mut continue_token: Option<String> = None;
                        loop {
                            let mut params = ListParams::default().limit(DISCOVER_PAGE_SIZE);
                            if let Some(token) = &continue_token {
                                params = params.continue_token(token);
                            }
                            let page = tokio::time::timeout(
                                request_timeout().saturating_mul(2),
                                ing_api.list(&params),
                            )
                            .await
                            .map_err(|_| {
                                CapabilityError::Handler("ingress discovery timed out".into())
                            })?
                            .map_err(handler_err)?;
                            ingresses.extend(page.items);
                            match page.metadata.continue_ {
                                Some(token) if !token.is_empty() => continue_token = Some(token),
                                _ => break,
                            }
                        }
                        for tool in &mut found {
                            tool.ingress_url =
                                ingress_url_for(&tool.namespace, &tool.service, &ingresses);
                        }
                    }

                    sort_tools(&mut found);
                    Ok::<_, CapabilityError>(DiscoverOut { tools: found })
                };

                let budget = request_timeout().saturating_mul(4);
                tokio::time::timeout(budget, walk)
                    .await
                    .map_err(|_| CapabilityError::Handler("tool discovery timed out".into()))?
            }
        },
    )
}

/// One keyed forward: which (context, namespace, service, port) it serves.
type ForwardKey = (String, String, String, u16);

struct ForwardEntry {
    local_port: u16,
    task: JoinHandle<()>,
}

/// Keyed port-forwards for spyglass tools: at most one live forward per
/// (context, namespace, service, port). `ensure` reuses a live tunnel, so
/// clicking "Open Kiali" twice doesn't stack listeners.
pub struct ForwardRegistry {
    cache: Arc<ClientCache>,
    forwards: Mutex<HashMap<ForwardKey, ForwardEntry>>,
}

/// A row in `net.portForwardList`.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForwardRow {
    pub context: String,
    pub namespace: String,
    pub service: String,
    pub port: u16,
    pub local_port: u16,
}

impl ForwardRegistry {
    pub fn new(cache: Arc<ClientCache>) -> Arc<Self> {
        Arc::new(Self {
            cache,
            forwards: Mutex::new(HashMap::new()),
        })
    }

    /// Return a live local port for the keyed target, starting a forward on
    /// first use (or after the previous one died). The boolean is `true` when
    /// an existing tunnel was reused.
    pub async fn ensure(
        &self,
        context: &str,
        namespace: &str,
        service: &str,
        port: u16,
        preferred_local: Option<u16>,
    ) -> Result<(u16, bool), String> {
        let key: ForwardKey = (
            context.to_string(),
            namespace.to_string(),
            service.to_string(),
            port,
        );
        // Held across the build so concurrent opens share one resolution.
        let mut forwards = self.forwards.lock().await;
        if let Some(entry) = forwards.get(&key) {
            if !entry.task.is_finished() {
                return Ok((entry.local_port, true));
            }
        }

        let (pod, target_port) = forward::resolve_service_target(
            self.cache.clone(),
            context,
            namespace,
            service,
            Some(i32::from(port)),
        )
        .await?;

        // A busy preferred port falls back to an OS-assigned one rather than
        // failing the open.
        let listener = match preferred_local {
            Some(p) if p != 0 => match forward::bind_local(p).await {
                Ok(l) => l,
                Err(_) => forward::bind_local(0).await?,
            },
            _ => forward::bind_local(0).await?,
        };
        let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let cache = self.cache.clone();
        let (ctx, ns) = (context.to_string(), namespace.to_string());
        let task = tokio::spawn(async move {
            let _ = forward::serve_pod_forward(listener, cache, ctx, ns, pod, target_port).await;
        });

        if let Some(old) = forwards.insert(key, ForwardEntry { local_port, task }) {
            old.task.abort();
        }
        Ok((local_port, false))
    }

    /// Stop the keyed forward; `false` when none was running.
    pub async fn stop(&self, context: &str, namespace: &str, service: &str, port: u16) -> bool {
        let key: ForwardKey = (
            context.to_string(),
            namespace.to_string(),
            service.to_string(),
            port,
        );
        match self.forwards.lock().await.remove(&key) {
            Some(entry) => {
                entry.task.abort();
                true
            }
            None => false,
        }
    }

    /// Live forwards, pruning entries whose serve task has ended.
    pub async fn list(&self) -> Vec<ForwardRow> {
        let mut forwards = self.forwards.lock().await;
        forwards.retain(|_, entry| !entry.task.is_finished());
        let mut rows: Vec<ForwardRow> = forwards
            .iter()
            .map(|((context, namespace, service, port), entry)| ForwardRow {
                context: context.clone(),
                namespace: namespace.clone(),
                service: service.clone(),
                port: *port,
                local_port: entry.local_port,
            })
            .collect();
        rows.sort_by(|a, b| {
            (&a.context, &a.namespace, &a.service, a.port)
                .cmp(&(&b.context, &b.namespace, &b.service, b.port))
        });
        rows
    }

    #[cfg(test)]
    async fn insert_test_entry(&self, key: ForwardKey, local_port: u16, task: JoinHandle<()>) {
        self.forwards
            .lock()
            .await
            .insert(key, ForwardEntry { local_port, task });
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStartIn {
    pub context: String,
    pub namespace: String,
    pub service: String,
    /// Service port to forward to (resolved to the backing pod's target port).
    pub port: u16,
    /// Preferred local port; omitted or 0 lets the OS pick a free one.
    #[serde(default)]
    pub local_port: Option<u16>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStartOut {
    pub local_port: u16,
    /// True when an already-running forward for the same target was reused.
    pub reused: bool,
}

/// `net.portForwardStart` — start (or reuse) a keyed local forward to a service.
pub fn port_forward_start_capability(registry: Arc<ForwardRegistry>) -> Capability {
    Capability::typed::<ForwardStartIn, ForwardStartOut, _, _>(
        "net.portForwardStart",
        "start (or reuse) a local port-forward to a service in a connected kube context; returns the bound local port",
        Annotations::default(),
        move |input: ForwardStartIn| {
            let registry = registry.clone();
            async move {
                let (local_port, reused) = registry
                    .ensure(
                        &input.context,
                        &input.namespace,
                        &input.service,
                        input.port,
                        input.local_port,
                    )
                    .await
                    .map_err(CapabilityError::Handler)?;
                Ok(ForwardStartOut { local_port, reused })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForwardStopIn {
    pub context: String,
    pub namespace: String,
    pub service: String,
    pub port: u16,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ForwardStopOut {
    pub stopped: bool,
}

/// `net.portForwardStop` — stop a keyed forward started by `net.portForwardStart`.
pub fn port_forward_stop_capability(registry: Arc<ForwardRegistry>) -> Capability {
    Capability::typed::<ForwardStopIn, ForwardStopOut, _, _>(
        "net.portForwardStop",
        "stop a local port-forward started by net.portForwardStart",
        Annotations::default(),
        move |input: ForwardStopIn| {
            let registry = registry.clone();
            async move {
                let stopped = registry
                    .stop(&input.context, &input.namespace, &input.service, input.port)
                    .await;
                Ok(ForwardStopOut { stopped })
            }
        },
    )
}

/// `net.portForwardList` — the keyed forwards currently running.
pub fn port_forward_list_capability(registry: Arc<ForwardRegistry>) -> Capability {
    Capability::read_only(
        "net.portForwardList",
        "list local port-forwards started by net.portForwardStart",
        move |_input| {
            let registry = registry.clone();
            async move {
                let forwards = registry.list().await;
                serde_json::to_value(serde_json::json!({ "forwards": forwards }))
                    .map_err(|e| CapabilityError::Handler(e.to_string()))
            }
        },
    )
}

/// True when response headers forbid embedding the page in an iframe.
pub(crate) fn frame_blocked_from(x_frame_options: Option<&str>, csp: Option<&str>) -> bool {
    if let Some(value) = x_frame_options {
        let value = value.trim().to_ascii_uppercase();
        if value.starts_with("DENY") || value.starts_with("SAMEORIGIN") {
            return true;
        }
    }
    if let Some(csp) = csp {
        for directive in csp.split(';') {
            let mut tokens = directive.split_whitespace();
            if tokens.next().is_some_and(|d| d.eq_ignore_ascii_case("frame-ancestors")) {
                return !tokens.any(|source| source == "*");
            }
        }
    }
    false
}

/// True when a redirect looks like a login/OAuth hand-off rather than an
/// in-app path redirect (Kiali's `/` → `/kiali/` must not count).
pub(crate) fn looks_like_auth_redirect(status: u16, location: Option<&str>) -> bool {
    if !(300..400).contains(&status) {
        return false;
    }
    let Some(location) = location else { return false };
    let location = location.to_ascii_lowercase();
    ["oauth", "login", "signin", "sso", "auth"]
        .iter()
        .any(|marker| location.contains(marker))
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ProbeIn {
    pub url: String,
}

#[derive(Debug, Default, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOut {
    /// True when the URL answered with any HTTP response.
    pub ok: bool,
    pub status: Option<u16>,
    /// Response headers forbid iframe embedding (X-Frame-Options / CSP).
    pub frame_blocked: bool,
    /// The URL redirects to a login/OAuth flow.
    pub auth_redirect: bool,
    pub error: Option<String>,
}

/// `obs.probe` — fetch a URL's headers without following redirects.
pub fn probe_capability() -> Capability {
    Capability::typed::<ProbeIn, ProbeOut, _, _>(
        "obs.probe",
        "probe an http(s) URL: reachability, HTTP status, whether it blocks iframe embedding, whether it redirects to a login",
        Annotations::READ_ONLY,
        |input: ProbeIn| async move {
            if !crate::sso::valid_external_url(&input.url) {
                return Err(CapabilityError::InvalidInput(
                    "only http(s) URLs can be probed".into(),
                ));
            }
            // reqwest is built with `rustls-no-provider` (see Cargo.toml), so a
            // process-level provider must exist before the first Client build.
            // Idempotent: loses gracefully if kube-rs's TLS stack won the race.
            let _ = rustls::crypto::ring::default_provider().install_default();
            let client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(PROBE_TIMEOUT)
                .build()
                .map_err(handler_err)?;
            match client.get(&input.url).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let header = |name: &str| {
                        resp.headers()
                            .get(name)
                            .and_then(|v| v.to_str().ok())
                            .map(str::to_string)
                    };
                    Ok(ProbeOut {
                        ok: true,
                        status: Some(status),
                        frame_blocked: frame_blocked_from(
                            header("x-frame-options").as_deref(),
                            header("content-security-policy").as_deref(),
                        ),
                        auth_redirect: looks_like_auth_redirect(
                            status,
                            header("location").as_deref(),
                        ),
                        error: None,
                    })
                }
                Err(e) => Ok(ProbeOut {
                    ok: false,
                    error: Some(e.to_string()),
                    ..Default::default()
                }),
            }
        },
    )
}

#[cfg(test)]
mod classify_tests {
    use super::*;
    use std::collections::BTreeMap;

    fn labels(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn exact_names_classify() {
        assert_eq!(classify_service("kiali", &labels(&[])), Some("kiali"));
        assert_eq!(classify_service("grafana", &labels(&[])), Some("grafana"));
        assert_eq!(classify_service("prometheus", &labels(&[])), None);
    }

    #[test]
    fn label_matches_classify_renamed_services() {
        assert_eq!(
            classify_service("obs-dashboards", &labels(&[("app.kubernetes.io/name", "grafana")])),
            Some("grafana")
        );
        assert_eq!(
            classify_service("mesh-console", &labels(&[("app", "kiali")])),
            Some("kiali")
        );
    }

    #[test]
    fn look_alikes_are_not_classified() {
        // The oauth2 proxy fronting kiali often carries kiali labels.
        assert_eq!(
            classify_service("kiali-oauth2-proxy", &labels(&[("app.kubernetes.io/name", "kiali")])),
            None
        );
        assert_eq!(
            classify_service(
                "loki-grafana-agent-operator",
                &labels(&[("app.kubernetes.io/name", "grafana")])
            ),
            None
        );
        assert_eq!(
            classify_service("grafana-mcp-server", &labels(&[("app", "grafana")])),
            None
        );
    }

    fn port(number: i32, name: Option<&str>) -> ServicePort {
        ServicePort {
            port: number,
            name: name.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn exact_name_services_outrank_label_matched_extras() {
        let row = |tool: &str, namespace: &str, service: &str| DiscoveredTool {
            tool: tool.into(),
            namespace: namespace.into(),
            service: service.into(),
            port: 80,
            port_name: None,
            ingress_url: None,
        };
        // The tuskira shape: a second grafana (fedsoc-grafana) matched via
        // labels, in a namespace that sorts before infra.
        let mut tools = vec![
            row("grafana", "fedsoc-poc", "fedsoc-grafana"),
            row("grafana", "infra", "grafana"),
            row("kiali", "istio-system", "kiali"),
        ];
        sort_tools(&mut tools);
        let order: Vec<(&str, &str)> = tools.iter().map(|t| (t.tool.as_str(), t.service.as_str())).collect();
        assert_eq!(
            order,
            vec![
                ("kiali", "kiali"),
                ("grafana", "grafana"),
                ("grafana", "fedsoc-grafana"),
            ]
        );
    }

    #[test]
    fn preferred_port_picks_known_then_named_then_first() {
        // Kiali's real shape: UI on 20001, metrics on 9090.
        let kiali = vec![port(9090, Some("http-metrics")), port(20001, Some("http"))];
        assert_eq!(preferred_port("kiali", &kiali).unwrap().port, 20001);

        // Grafana behind a plain :80 service.
        let grafana = vec![port(80, Some("service"))];
        assert_eq!(preferred_port("grafana", &grafana).unwrap().port, 80);

        // No known number: an http-ish name wins over declaration order.
        let custom = vec![port(9000, Some("grpc")), port(9001, Some("http-web"))];
        assert_eq!(preferred_port("grafana", &custom).unwrap().port, 9001);

        // Nothing http-ish: first declared.
        let opaque = vec![port(9000, Some("grpc")), port(9100, None)];
        assert_eq!(preferred_port("kiali", &opaque).unwrap().port, 9000);

        assert!(preferred_port("kiali", &[]).is_none());
    }
}

#[cfg(test)]
mod ingress_tests {
    use super::*;
    use k8s_openapi::api::networking::v1::{
        HTTPIngressPath, HTTPIngressRuleValue, IngressBackend, IngressRule,
        IngressServiceBackend, IngressSpec, IngressTLS,
    };

    fn ingress(namespace: &str, host: &str, backend: &str, tls: bool) -> Ingress {
        Ingress {
            metadata: kube::core::ObjectMeta {
                namespace: Some(namespace.into()),
                ..Default::default()
            },
            spec: Some(IngressSpec {
                tls: tls.then(|| {
                    vec![IngressTLS {
                        hosts: Some(vec![host.into()]),
                        ..Default::default()
                    }]
                }),
                rules: Some(vec![IngressRule {
                    host: Some(host.into()),
                    http: Some(HTTPIngressRuleValue {
                        paths: vec![HTTPIngressPath {
                            backend: IngressBackend {
                                service: Some(IngressServiceBackend {
                                    name: backend.into(),
                                    port: None,
                                }),
                                ..Default::default()
                            },
                            path_type: "Prefix".into(),
                            ..Default::default()
                        }],
                    }),
                }]),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn direct_backend_matches_with_tls_scheme() {
        let ings = vec![ingress("infra", "grafana.example.com", "grafana", true)];
        assert_eq!(
            ingress_url_for("infra", "grafana", &ings),
            Some("https://grafana.example.com".into())
        );
    }

    #[test]
    fn prefixed_sidecar_backend_matches_without_tls() {
        // The tuskira shape: kiali's ingress routes to kiali-oauth2-proxy.
        let ings = vec![ingress("istio-system", "kiali.dev.example", "kiali-oauth2-proxy", false)];
        assert_eq!(
            ingress_url_for("istio-system", "kiali", &ings),
            Some("http://kiali.dev.example".into())
        );
    }

    #[test]
    fn other_namespaces_and_unrelated_backends_do_not_match() {
        // grafana-mcp-server lives in another namespace: must not claim it.
        let ings = vec![ingress("aiapp", "mcp-grafana.dev.example", "grafana-mcp-server", false)];
        assert_eq!(ingress_url_for("infra", "grafana", &ings), None);
        // Same namespace, unrelated service name.
        let ings = vec![ingress("infra", "loki.dev.example", "loki-gateway", false)];
        assert_eq!(ingress_url_for("infra", "grafana", &ings), None);
    }
}

#[cfg(test)]
mod probe_tests {
    use super::*;

    #[test]
    fn frame_blocking_headers_are_recognized() {
        assert!(frame_blocked_from(Some("DENY"), None));
        assert!(frame_blocked_from(Some("deny"), None));
        assert!(frame_blocked_from(Some("SAMEORIGIN"), None));
        assert!(!frame_blocked_from(Some("ALLOWALL"), None));
        assert!(!frame_blocked_from(None, None));
        // CSP frame-ancestors without a wildcard blocks embedding.
        assert!(frame_blocked_from(None, Some("default-src 'self'; frame-ancestors 'self'")));
        assert!(!frame_blocked_from(None, Some("frame-ancestors *")));
        assert!(!frame_blocked_from(None, Some("default-src 'self'")));
    }

    #[test]
    fn auth_redirects_are_distinguished_from_path_redirects() {
        // Kiali serves its UI under /kiali/ — a plain path hop, not a login.
        assert!(!looks_like_auth_redirect(302, Some("/kiali/")));
        assert!(looks_like_auth_redirect(302, Some("https://x.auth.us-east-1.amazoncognito.com/oauth2/authorize?x=1")));
        assert!(looks_like_auth_redirect(302, Some("/login")));
        assert!(!looks_like_auth_redirect(200, Some("/login")));
        assert!(!looks_like_auth_redirect(302, None));
    }

    /// Serve one canned HTTP response on a loopback port, then close.
    async fn one_shot_http(response: &'static str) -> u16 {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let _ = sock.write_all(response.as_bytes()).await;
            }
        });
        port
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn probe_reports_frame_blocking() {
        let port = one_shot_http(
            "HTTP/1.1 200 OK\r\nX-Frame-Options: deny\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await;
        let cap = probe_capability();
        let out = (cap.handler)(serde_json::json!({ "url": format!("http://127.0.0.1:{port}/") }))
            .await
            .unwrap();
        assert_eq!(out["ok"], true);
        assert_eq!(out["status"], 200);
        assert_eq!(out["frameBlocked"], true);
        assert_eq!(out["authRedirect"], false);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn probe_reports_auth_redirects() {
        let port = one_shot_http(
            "HTTP/1.1 302 Found\r\nLocation: https://idp.example/oauth2/authorize\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )
        .await;
        let cap = probe_capability();
        let out = (cap.handler)(serde_json::json!({ "url": format!("http://127.0.0.1:{port}/") }))
            .await
            .unwrap();
        assert_eq!(out["ok"], true);
        assert_eq!(out["status"], 302);
        assert_eq!(out["authRedirect"], true);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn probe_reports_unreachable_urls() {
        // Bind then drop, so the port is (almost certainly) refusing.
        let port = {
            let l = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            l.local_addr().unwrap().port()
        };
        let cap = probe_capability();
        let out = (cap.handler)(serde_json::json!({ "url": format!("http://127.0.0.1:{port}/") }))
            .await
            .unwrap();
        assert_eq!(out["ok"], false);
        assert!(out["error"].as_str().is_some());
    }

    #[tokio::test]
    async fn probe_rejects_non_web_urls() {
        let cap = probe_capability();
        let err = (cap.handler)(serde_json::json!({ "url": "file:///etc/passwd" }))
            .await
            .unwrap_err();
        assert!(matches!(err, CapabilityError::InvalidInput(_)));
    }
}

#[cfg(test)]
mod registry_tests {
    use super::*;

    fn key(context: &str) -> ForwardKey {
        (context.into(), "ns".into(), "svc".into(), 80)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn list_reports_live_and_prunes_dead_forwards() {
        let registry = ForwardRegistry::new(ClientCache::new(std::path::PathBuf::from("/x")));
        registry
            .insert_test_entry(key("alive"), 12345, tokio::spawn(std::future::pending()))
            .await;
        let done = tokio::spawn(async {});
        while !done.is_finished() {
            tokio::task::yield_now().await;
        }
        registry.insert_test_entry(key("dead"), 12346, done).await;

        let rows = registry.list().await;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].context, "alive");
        assert_eq!(rows[0].local_port, 12345);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn stop_aborts_and_reports() {
        let registry = ForwardRegistry::new(ClientCache::new(std::path::PathBuf::from("/x")));
        registry
            .insert_test_entry(key("ctx"), 1, tokio::spawn(std::future::pending()))
            .await;
        assert!(registry.stop("ctx", "ns", "svc", 80).await);
        assert!(!registry.stop("ctx", "ns", "svc", 80).await);
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn ensure_surfaces_resolution_errors() {
        // No kubeconfig behind the cache: ensure must fail cleanly, not hang.
        let registry = ForwardRegistry::new(ClientCache::new(std::path::PathBuf::from(
            "/nonexistent-kubeconfig",
        )));
        let err = registry.ensure("ctx", "ns", "svc", 80, None).await.unwrap_err();
        assert!(!err.is_empty());
    }
}
