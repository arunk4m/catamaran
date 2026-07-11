//! Embed proxy: the loopback relay that makes Kiali and Grafana embeddable
//! inside the app.
//!
//! Both tools answer every request with `X-Frame-Options: deny`, so an
//! iframe pointed straight at the port-forward stays blank. This proxy sits
//! between the webview and the tunnel and (1) strips the frame-blocking
//! headers, (2) injects a tiny location-reporter script into HTML documents
//! so the shell can offer "save this view" for a cross-origin iframe it
//! could never read, and (3) passes WebSocket upgrades through untouched
//! (Grafana Live). It binds to 127.0.0.1 only and relays to a tunnel that
//! carries the user's own credentials — it widens nothing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;

use bytes::Bytes;
use catamaran_capability::{Annotations, Capability, CapabilityError};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderValue};
use hyper::{Request, Response, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::forward;
use crate::spyglass::ForwardRegistry;

/// Documents larger than this skip script injection and stream through
/// (a real HTML page from these tools is a few KB shell for a JS bundle).
const INJECT_LIMIT: usize = 8 * 1024 * 1024;

/// Reports SPA route changes to the embedding shell. Kiali and Grafana are
/// client-routed, so the proxy only sees a document request on hard loads —
/// this bridges pushState/popstate to `postMessage`, which crosses origins
/// by design. The parent validates the sender's origin before trusting it.
pub(crate) const LOCATION_REPORTER: &str = "<script>(function(){var post=function(){try{parent.postMessage({catamaranSpyglass:{href:location.pathname+location.search+location.hash}},\"*\")}catch(e){}};var p=history.pushState,r=history.replaceState;history.pushState=function(){var v=p.apply(this,arguments);post();return v};history.replaceState=function(){var v=r.apply(this,arguments);post();return v};addEventListener(\"popstate\",post);addEventListener(\"hashchange\",post);post();})();</script>";

/// Drop `frame-ancestors` from a CSP header value, keeping every other
/// directive. `None` means the whole header should be removed.
pub(crate) fn scrub_frame_ancestors(csp: &str) -> Option<String> {
    let kept: Vec<&str> = csp
        .split(';')
        .map(str::trim)
        .filter(|directive| {
            !directive.is_empty()
                && !directive
                    .split_whitespace()
                    .next()
                    .is_some_and(|name| name.eq_ignore_ascii_case("frame-ancestors"))
        })
        .collect();
    if kept.is_empty() {
        None
    } else {
        Some(kept.join("; "))
    }
}

/// Remove the headers that forbid embedding (X-Frame-Options, CSP
/// frame-ancestors) from an upstream response.
pub(crate) fn strip_embed_blockers(headers: &mut HeaderMap) {
    headers.remove("x-frame-options");
    let scrubbed = headers
        .get("content-security-policy")
        .and_then(|v| v.to_str().ok())
        .map(scrub_frame_ancestors);
    match scrubbed {
        Some(Some(kept)) => {
            if let Ok(value) = HeaderValue::from_str(&kept) {
                headers.insert("content-security-policy", value);
            } else {
                headers.remove("content-security-policy");
            }
        }
        Some(None) => {
            headers.remove("content-security-policy");
        }
        None => {}
    }
    sanitize_cookies_for_loopback(headers);
}

/// Make a tool's session cookies usable over the `http://127.0.0.1` relay.
///
/// Tools behind an HTTPS ingress (Grafana, Airflow, ...) set `Secure` session
/// cookies and often `SameSite=None`. A browser refuses to store a `Secure`
/// cookie from an `http://` origin, and `SameSite=None` requires `Secure` — so
/// login "succeeds" upstream but the session cookie is dropped and the user
/// bounces back to the login page. Since the relay is a private loopback hop
/// carrying the user's own credentials, we relax those flags: drop `Secure`,
/// downgrade `SameSite=None` to `Lax`, and drop any `Domain` (so the cookie is
/// host-only for 127.0.0.1). This is what makes admin/basic login work embedded.
pub(crate) fn rewrite_set_cookie(value: &str) -> String {
    let mut kept: Vec<String> = Vec::new();
    for attr in value.split(';') {
        let trimmed = attr.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower == "secure" {
            continue; // http loopback can't store Secure cookies
        }
        if lower.starts_with("domain=") {
            continue; // host-only cookie binds to 127.0.0.1
        }
        if lower.starts_with("samesite=") && lower != "samesite=lax" && lower != "samesite=strict" {
            kept.push("SameSite=Lax".to_string());
            continue;
        }
        kept.push(trimmed.to_string());
    }
    kept.join("; ")
}

/// Rewrite every `Set-Cookie` header in place for the loopback relay.
pub(crate) fn sanitize_cookies_for_loopback(headers: &mut HeaderMap) {
    let rewritten: Vec<HeaderValue> = headers
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|c| HeaderValue::from_str(&rewrite_set_cookie(c)).ok())
        .collect();
    if rewritten.is_empty() {
        return;
    }
    headers.remove("set-cookie");
    for value in rewritten {
        headers.append("set-cookie", value);
    }
}

/// Insert the location reporter before `</body>` (case-insensitive),
/// appending when a document has no closing body tag.
pub(crate) fn inject_reporter(html: &[u8]) -> Vec<u8> {
    let needle = b"</body>";
    let at = html
        .windows(needle.len())
        .rposition(|w| w.eq_ignore_ascii_case(needle));
    let mut out = Vec::with_capacity(html.len() + LOCATION_REPORTER.len());
    match at {
        Some(i) => {
            out.extend_from_slice(&html[..i]);
            out.extend_from_slice(LOCATION_REPORTER.as_bytes());
            out.extend_from_slice(&html[i..]);
        }
        None => {
            out.extend_from_slice(html);
            out.extend_from_slice(LOCATION_REPORTER.as_bytes());
        }
    }
    out
}

fn full_body(bytes: Vec<u8>) -> BoxBody<Bytes, hyper::Error> {
    Full::new(Bytes::from(bytes))
        .map_err(|never| match never {})
        .boxed()
}

fn empty_body() -> BoxBody<Bytes, hyper::Error> {
    Empty::new().map_err(|never| match never {}).boxed()
}

fn bad_gateway(reason: &str) -> Response<BoxBody<Bytes, hyper::Error>> {
    let mut resp = Response::new(full_body(
        format!("catamaran spyglass: {reason}").into_bytes(),
    ));
    *resp.status_mut() = StatusCode::BAD_GATEWAY;
    resp
}

/// Relay one request to `127.0.0.1:<upstream>`: strip embed blockers, inject
/// the reporter into HTML, splice upgraded (WebSocket) connections through.
async fn relay(
    req: Request<Incoming>,
    upstream: Arc<AtomicU16>,
) -> Result<Response<BoxBody<Bytes, hyper::Error>>, hyper::Error> {
    let port = upstream.load(Ordering::SeqCst);
    let stream = match TcpStream::connect(("127.0.0.1", port)).await {
        Ok(s) => s,
        Err(e) => return Ok(bad_gateway(&format!("tunnel not answering: {e}"))),
    };
    let (mut sender, conn) = match hyper::client::conn::http1::handshake(TokioIo::new(stream)).await
    {
        Ok(pair) => pair,
        Err(e) => return Ok(bad_gateway(&format!("upstream handshake failed: {e}"))),
    };
    tokio::spawn(async move {
        let _ = conn.with_upgrades().await;
    });

    let target: Uri = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .parse()
        .unwrap_or_else(|_| Uri::from_static("/"));
    let is_upgrade = req.headers().contains_key(hyper::header::UPGRADE);

    let mut builder = Request::builder().method(req.method()).uri(target);
    for (name, value) in req.headers() {
        // Identity encoding keeps HTML injectable; the proxy re-addresses Host.
        if name == hyper::header::ACCEPT_ENCODING || name == hyper::header::HOST {
            continue;
        }
        builder = builder.header(name, value);
    }
    builder = builder.header(hyper::header::HOST, format!("127.0.0.1:{port}"));

    if is_upgrade {
        // Keep the inbound request intact for its own upgrade handshake.
        let out = match builder.body(empty_body()) {
            Ok(r) => r,
            Err(e) => return Ok(bad_gateway(&format!("bad upgrade request: {e}"))),
        };
        let mut resp = sender.send_request(out).await?;
        if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
            let upstream_upgrade = hyper::upgrade::on(&mut resp);
            let client_upgrade = hyper::upgrade::on(req);
            tokio::spawn(async move {
                if let (Ok(up), Ok(down)) = (upstream_upgrade.await, client_upgrade.await) {
                    let mut up = TokioIo::new(up);
                    let mut down = TokioIo::new(down);
                    let _ = tokio::io::copy_bidirectional(&mut down, &mut up).await;
                }
            });
            let (mut parts, _) = resp.into_parts();
            strip_embed_blockers(&mut parts.headers);
            return Ok(Response::from_parts(parts, empty_body()));
        }
        let (mut parts, body) = resp.into_parts();
        strip_embed_blockers(&mut parts.headers);
        return Ok(Response::from_parts(parts, body.boxed()));
    }

    let out = match builder.body(req.into_body().boxed()) {
        Ok(r) => r,
        Err(e) => return Ok(bad_gateway(&format!("bad request: {e}"))),
    };
    let resp = sender.send_request(out).await?;
    let (mut parts, body) = resp.into_parts();
    strip_embed_blockers(&mut parts.headers);

    let is_html = parts
        .headers
        .get(hyper::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start().to_ascii_lowercase().starts_with("text/html"))
        .unwrap_or(false);
    let small_enough = parts
        .headers
        .get(hyper::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok())
        .map(|len| len <= INJECT_LIMIT)
        .unwrap_or(true);

    if is_html && small_enough {
        let collected = body.collect().await?.to_bytes();
        let injected = inject_reporter(&collected);
        parts.headers.remove(hyper::header::TRANSFER_ENCODING);
        parts
            .headers
            .insert(hyper::header::CONTENT_LENGTH, HeaderValue::from(injected.len()));
        return Ok(Response::from_parts(parts, full_body(injected)));
    }
    Ok(Response::from_parts(parts, body.boxed()))
}

/// Accept loop: serve the relay on every inbound webview connection.
pub(crate) async fn serve_embed_proxy(listener: TcpListener, upstream: Arc<AtomicU16>) {
    loop {
        let Ok((stream, _peer)) = listener.accept().await else {
            return;
        };
        let upstream = upstream.clone();
        tokio::spawn(async move {
            let service =
                hyper::service::service_fn(move |req| relay(req, upstream.clone()));
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .with_upgrades()
                .await;
        });
    }
}

type EmbedKey = (String, String, String, u16);

struct ProxyEntry {
    local_port: u16,
    upstream: Arc<AtomicU16>,
    task: JoinHandle<()>,
}

/// Keyed embed proxies, one per (context, namespace, service, port), layered
/// over the keyed tunnels: `ensure` revives a dead tunnel and re-points the
/// existing proxy at its new local port, so an iframe URL stays valid across
/// tunnel restarts.
pub struct EmbedRegistry {
    forwards: Arc<ForwardRegistry>,
    proxies: Mutex<HashMap<EmbedKey, ProxyEntry>>,
}

impl EmbedRegistry {
    pub fn new(forwards: Arc<ForwardRegistry>) -> Arc<Self> {
        Arc::new(Self {
            forwards,
            proxies: Mutex::new(HashMap::new()),
        })
    }

    /// A live proxy port for the keyed target (true = an existing proxy was
    /// reused). The underlying tunnel is ensured first, every time.
    pub async fn ensure(
        &self,
        context: &str,
        namespace: &str,
        service: &str,
        port: u16,
    ) -> Result<(u16, bool), String> {
        let (tunnel_port, _) = self
            .forwards
            .ensure(context, namespace, service, port, None)
            .await?;
        let key: EmbedKey = (
            context.to_string(),
            namespace.to_string(),
            service.to_string(),
            port,
        );
        let mut proxies = self.proxies.lock().await;
        if let Some(entry) = proxies.get(&key) {
            if !entry.task.is_finished() {
                entry.upstream.store(tunnel_port, Ordering::SeqCst);
                return Ok((entry.local_port, true));
            }
        }
        let listener = forward::bind_local(0).await?;
        let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let upstream = Arc::new(AtomicU16::new(tunnel_port));
        let task = tokio::spawn(serve_embed_proxy(listener, upstream.clone()));
        if let Some(old) = proxies.insert(
            key,
            ProxyEntry {
                local_port,
                upstream,
                task,
            },
        ) {
            old.task.abort();
        }
        Ok((local_port, false))
    }

    /// Stop the proxy AND its tunnel; `false` when neither was running.
    pub async fn stop(&self, context: &str, namespace: &str, service: &str, port: u16) -> bool {
        let key: EmbedKey = (
            context.to_string(),
            namespace.to_string(),
            service.to_string(),
            port,
        );
        let proxy_stopped = match self.proxies.lock().await.remove(&key) {
            Some(entry) => {
                entry.task.abort();
                true
            }
            None => false,
        };
        let tunnel_stopped = self.forwards.stop(context, namespace, service, port).await;
        proxy_stopped || tunnel_stopped
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmbedStartIn {
    pub context: String,
    pub namespace: String,
    pub service: String,
    pub port: u16,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmbedStartOut {
    /// Loopback base URL the webview may iframe (frame blockers stripped).
    pub url: String,
    pub local_port: u16,
    pub reused: bool,
}

/// `obs.embedStart` — start (or reuse) the embeddable relay for a service.
pub fn embed_start_capability(registry: Arc<EmbedRegistry>) -> Capability {
    Capability::typed::<EmbedStartIn, EmbedStartOut, _, _>(
        "obs.embedStart",
        "start (or reuse) a loopback embed relay to a service: a port-forward whose responses have frame-blocking headers stripped so the app can embed the tool",
        Annotations::default(),
        move |input: EmbedStartIn| {
            let registry = registry.clone();
            async move {
                let (local_port, reused) = registry
                    .ensure(&input.context, &input.namespace, &input.service, input.port)
                    .await
                    .map_err(CapabilityError::Handler)?;
                Ok(EmbedStartOut {
                    url: format!("http://127.0.0.1:{local_port}"),
                    local_port,
                    reused,
                })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmbedStopIn {
    pub context: String,
    pub namespace: String,
    pub service: String,
    pub port: u16,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EmbedStopOut {
    pub stopped: bool,
}

/// `obs.embedStop` — stop an embed relay and its underlying tunnel.
pub fn embed_stop_capability(registry: Arc<EmbedRegistry>) -> Capability {
    Capability::typed::<EmbedStopIn, EmbedStopOut, _, _>(
        "obs.embedStop",
        "stop an embed relay started by obs.embedStart, including its port-forward",
        Annotations::default(),
        move |input: EmbedStopIn| {
            let registry = registry.clone();
            async move {
                let stopped = registry
                    .stop(&input.context, &input.namespace, &input.service, input.port)
                    .await;
                Ok(EmbedStopOut { stopped })
            }
        },
    )
}

#[cfg(test)]
mod header_tests {
    use super::*;

    #[test]
    fn scrubs_only_frame_ancestors() {
        assert_eq!(
            scrub_frame_ancestors("default-src 'self'; frame-ancestors 'self'; img-src data:"),
            Some("default-src 'self'; img-src data:".to_string())
        );
        assert_eq!(scrub_frame_ancestors("frame-ancestors 'self'"), None);
        assert_eq!(
            scrub_frame_ancestors("default-src 'self'"),
            Some("default-src 'self'".to_string())
        );
    }

    #[test]
    fn strips_xfo_and_rewrites_csp() {
        let mut headers = HeaderMap::new();
        headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
        headers.insert(
            "content-security-policy",
            HeaderValue::from_static("default-src 'self'; frame-ancestors 'self'"),
        );
        headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
        strip_embed_blockers(&mut headers);
        assert!(headers.get("x-frame-options").is_none());
        assert_eq!(
            headers.get("content-security-policy").unwrap(),
            "default-src 'self'"
        );
        // Unrelated hardening headers survive.
        assert_eq!(headers.get("x-content-type-options").unwrap(), "nosniff");
    }

    #[test]
    fn set_cookie_is_relaxed_for_loopback() {
        // Grafana's shape: a Secure, SameSite=None session cookie from an HTTPS
        // ingress — unusable over http loopback until relaxed.
        assert_eq!(
            rewrite_set_cookie("grafana_session=abc; Path=/; Secure; HttpOnly; SameSite=None"),
            "grafana_session=abc; Path=/; HttpOnly; SameSite=Lax"
        );
        // Domain is dropped so the cookie binds to 127.0.0.1.
        assert_eq!(
            rewrite_set_cookie("s=1; Domain=grafana.example.com; Path=/; Secure"),
            "s=1; Path=/"
        );
        // Lax/Strict and non-Secure cookies pass through untouched.
        assert_eq!(
            rewrite_set_cookie("s=1; Path=/; HttpOnly; SameSite=Lax"),
            "s=1; Path=/; HttpOnly; SameSite=Lax"
        );
    }

    #[test]
    fn sanitize_cookies_rewrites_all_set_cookie_headers() {
        let mut headers = HeaderMap::new();
        headers.append("set-cookie", HeaderValue::from_static("a=1; Secure; SameSite=None"));
        headers.append("set-cookie", HeaderValue::from_static("b=2; Secure"));
        strip_embed_blockers(&mut headers);
        let cookies: Vec<&str> = headers.get_all("set-cookie").iter().map(|v| v.to_str().unwrap()).collect();
        assert_eq!(cookies, vec!["a=1; SameSite=Lax", "b=2"]);
    }

    #[test]
    fn injects_before_closing_body_case_insensitive() {
        let html = b"<html><BODY>hi</BODY></html>";
        let out = inject_reporter(html);
        let s = String::from_utf8(out).unwrap();
        assert!(s.contains("catamaranSpyglass"));
        assert!(s.find("catamaranSpyglass").unwrap() < s.find("</BODY>").unwrap());

        // No closing tag: appended.
        let out = String::from_utf8(inject_reporter(b"plain")).unwrap();
        assert!(out.starts_with("plain"));
        assert!(out.contains("catamaranSpyglass"));
    }
}

#[cfg(test)]
mod proxy_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A one-connection upstream serving a canned HTTP/1.1 response.
    async fn upstream_once(response: Vec<u8>) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let _ = sock.write_all(&response).await;
            }
        });
        port
    }

    async fn start_proxy(upstream_port: u16) -> u16 {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let upstream = Arc::new(AtomicU16::new(upstream_port));
        tokio::spawn(serve_embed_proxy(listener, upstream));
        port
    }

    async fn raw_get(port: u16, path: &str) -> String {
        let mut sock = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        sock.write_all(
            format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await
        .unwrap();
        let mut out = Vec::new();
        let _ = sock.read_to_end(&mut out).await;
        String::from_utf8_lossy(&out).to_string()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn strips_blockers_and_injects_reporter_into_html() {
        let html = "<html><body>kiali</body></html>";
        let upstream = upstream_once(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: default-src 'self'; frame-ancestors 'self'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            )
            .into_bytes(),
        )
        .await;
        let proxy = start_proxy(upstream).await;
        let resp = raw_get(proxy, "/").await;

        assert!(resp.starts_with("HTTP/1.1 200"), "{resp}");
        assert!(!resp.to_ascii_lowercase().contains("x-frame-options"), "{resp}");
        assert!(resp.contains("default-src 'self'"), "{resp}");
        assert!(!resp.contains("frame-ancestors"), "{resp}");
        assert!(resp.contains("catamaranSpyglass"), "{resp}");
        assert!(resp.contains("kiali"), "{resp}");
        // Content-Length was recomputed to cover the injected script.
        let cl: usize = resp
            .lines()
            .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
            .and_then(|l| l.split(':').nth(1))
            .and_then(|v| v.trim().parse().ok())
            .unwrap();
        assert!(cl > html.len());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn non_html_streams_through_untouched() {
        let upstream = upstream_once(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"ok\":\"json\"}".to_vec(),
        )
        .await;
        let proxy = start_proxy(upstream).await;
        let resp = raw_get(proxy, "/api").await;
        assert!(resp.contains("{\"ok\":\"json\"}"));
        assert!(!resp.contains("catamaranSpyglass"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn dead_upstream_yields_bad_gateway() {
        // Bind then drop: nothing listens there.
        let dead = {
            let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            l.local_addr().unwrap().port()
        };
        let proxy = start_proxy(dead).await;
        let resp = raw_get(proxy, "/").await;
        assert!(resp.starts_with("HTTP/1.1 502"), "{resp}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn websocket_upgrades_splice_through() {
        // Upstream: accept the upgrade, then echo one frame of bytes.
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let upstream_port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let _ = sock
                    .write_all(
                        b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n",
                    )
                    .await;
                let mut data = [0u8; 64];
                if let Ok(n) = sock.read(&mut data).await {
                    let _ = sock.write_all(&data[..n]).await;
                }
            }
        });
        let proxy = start_proxy(upstream_port).await;

        let mut sock = TcpStream::connect(("127.0.0.1", proxy)).await.unwrap();
        sock.write_all(
            b"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n",
        )
        .await
        .unwrap();
        // Read the 101 response head.
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            sock.read_exact(&mut byte).await.unwrap();
            head.push(byte[0]);
        }
        let head = String::from_utf8_lossy(&head).to_string();
        assert!(head.starts_with("HTTP/1.1 101"), "{head}");

        // Bytes now splice both ways.
        sock.write_all(b"ping-through-proxy").await.unwrap();
        let mut echo = [0u8; 18];
        tokio::time::timeout(std::time::Duration::from_secs(5), sock.read_exact(&mut echo))
            .await
            .expect("echo timed out")
            .unwrap();
        assert_eq!(&echo, b"ping-through-proxy");
    }
}
