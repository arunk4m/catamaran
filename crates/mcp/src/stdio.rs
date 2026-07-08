//! Minimal MCP server over a newline-delimited JSON-RPC 2.0 stream (the MCP
//! stdio transport). Implements `initialize`, `tools/list`, and `tools/call`
//! against the capability registry — so an external MCP client (Claude
//! Desktop, agents, IDEs) can list and call every capability.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt};

use crate::McpServer;

const PROTOCOL_VERSION: &str = "2024-11-05";

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Handle a single JSON-RPC request. Returns `None` for notifications (no id),
/// which must not produce a response.
pub async fn handle_request(server: &McpServer, req: &Value) -> Option<Value> {
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    let id = req.get("id").cloned();

    match method {
        "initialize" => Some(ok(
            id?,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "catamaran", "version": env!("CARGO_PKG_VERSION") }
            }),
        )),
        "ping" => Some(ok(id?, json!({}))),
        "notifications/initialized" | "initialized" => None,
        "tools/list" => {
            let tools: Vec<Value> = server
                .list_tools()
                .into_iter()
                .map(|t| {
                    let schema = if t.input_schema.is_null() {
                        json!({ "type": "object" })
                    } else {
                        t.input_schema
                    };
                    json!({ "name": t.name, "description": t.description, "inputSchema": schema })
                })
                .collect();
            Some(ok(id?, json!({ "tools": tools })))
        }
        "tools/call" => {
            let params = req.get("params");
            let name = params
                .and_then(|p| p.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let mut args = params
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));

            // Consent gate: a mutating tool must carry `"_confirm": true`.
            let confirmed = args.get("_confirm").and_then(Value::as_bool).unwrap_or(false);
            if let Some(obj) = args.as_object_mut() {
                obj.remove("_confirm");
            }
            if server.requires_confirm(name) && !confirmed {
                return Some(ok(
                    id?,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": format!(
                                "Tool `{name}` mutates the cluster and requires confirmation. \
                                 Re-send the call with \"_confirm\": true in arguments."
                            )
                        }],
                        "isError": true
                    }),
                ));
            }

            let result = match server.call_tool(name, args).await {
                Ok(v) => json!({
                    "content": [{ "type": "text", "text": v.to_string() }],
                    "isError": false
                }),
                Err(e) => json!({
                    "content": [{ "type": "text", "text": e.to_string() }],
                    "isError": true
                }),
            };
            Some(ok(id?, result))
        }
        _ => id.map(|id| err(id, -32601, "method not found")),
    }
}

/// Run the MCP stdio loop: read newline-delimited JSON-RPC requests from
/// `reader`, write responses to `writer`, until EOF.
pub async fn serve<R, W>(server: McpServer, reader: R, mut writer: W) -> std::io::Result<()>
where
    R: AsyncBufReadExt + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut lines = reader.lines();
    while let Some(line) = lines.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(resp) = handle_request(&server, &req).await {
            let s = serde_json::to_string(&resp)?;
            writer.write_all(s.as_bytes()).await?;
            writer.write_all(b"\n").await?;
            writer.flush().await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use catamaran_capability::{Capability, Registry};
    use std::sync::Arc;
    use tokio::io::BufReader;

    fn server_with_ping() -> McpServer {
        let mut reg = Registry::new();
        reg.register(Capability::read_only("ping", "health check", |v| async move {
            Ok(json!({ "echo": v }))
        }));
        McpServer::new(Arc::new(reg))
    }

    #[tokio::test]
    async fn initialize_returns_protocol_and_server_info() {
        let resp = handle_request(&server_with_ping(), &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}))
            .await
            .unwrap();
        assert_eq!(resp["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(resp["result"]["serverInfo"]["name"], "catamaran");
    }

    #[tokio::test]
    async fn tools_list_includes_registry_capabilities() {
        let resp = handle_request(&server_with_ping(), &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .await
            .unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "ping");
        assert_eq!(tools[0]["inputSchema"]["type"], "object");
    }

    #[tokio::test]
    async fn tools_call_invokes_capability() {
        let resp = handle_request(
            &server_with_ping(),
            &json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":"hi"}}),
        )
        .await
        .unwrap();
        assert_eq!(resp["result"]["isError"], false);
        let text = resp["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("echo"));
    }

    fn server_with_destructive() -> McpServer {
        use catamaran_capability::{Annotations, Capability};
        let mut reg = Registry::new();
        let mut cap = Capability::read_only("danger", "destructive", |_| async {
            Ok(json!({ "done": true }))
        });
        cap.annotations = Annotations::DESTRUCTIVE;
        reg.register(cap);
        McpServer::new(Arc::new(reg))
    }

    #[tokio::test]
    async fn destructive_tool_is_gated_without_confirm() {
        let server = server_with_destructive();
        let resp = handle_request(
            &server,
            &json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"danger","arguments":{}}}),
        )
        .await
        .unwrap();
        assert_eq!(resp["result"]["isError"], true);
        assert!(resp["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("_confirm"));
    }

    #[tokio::test]
    async fn destructive_tool_runs_with_confirm() {
        let server = server_with_destructive();
        let resp = handle_request(
            &server,
            &json!({"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"danger","arguments":{"_confirm":true}}}),
        )
        .await
        .unwrap();
        assert_eq!(resp["result"]["isError"], false);
    }

    #[tokio::test]
    async fn notification_produces_no_response() {
        let resp = handle_request(
            &server_with_ping(),
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        )
        .await;
        assert!(resp.is_none());
    }

    #[tokio::test]
    async fn serve_processes_a_session_over_the_stream() {
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#,
            "\n",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":"yo"}}"#,
            "\n",
        );
        let mut out: Vec<u8> = Vec::new();
        serve(server_with_ping(), BufReader::new(input.as_bytes()), &mut out)
            .await
            .unwrap();
        let text = String::from_utf8(out).unwrap();
        // Two responses (initialize + tools/call); the notification yields none.
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("protocolVersion"));
        assert!(lines[1].contains("echo"));
    }
}
