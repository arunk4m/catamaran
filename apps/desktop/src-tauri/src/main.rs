// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

fn main() {
    // GUI launches (Finder/Dock) inherit launchd's minimal PATH, not the
    // user's shell PATH — kubeconfig exec plugins (kubectl, kubectl-oidc_login,
    // cloud CLIs) then fail to spawn with "No such file or directory". Resolve
    // the login-shell environment before anything creates a kube client.
    if let Err(e) = fix_path_env::fix() {
        eprintln!("warning: could not resolve login-shell PATH: {e}");
    }

    // Apply the CATAMARAN_TIMEOUT_SECS override up front so every mode — GUI, MCP
    // stdio, and MCP HTTP — honors it (the GUI can adjust it further at runtime).
    catamaran_kube::connect::init_timeout_from_env();

    let args: Vec<String> = std::env::args().collect();
    // `--mcp-stdio` / `--mcp-http [addr]` run the MCP server instead of the GUI,
    // so external MCP clients/agents can drive every capability.
    if args.iter().any(|a| a == "--mcp-stdio") {
        run_mcp_stdio();
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--mcp-http") {
        let addr = args.get(i + 1).cloned().unwrap_or_else(|| "127.0.0.1:8765".into());
        run_mcp_http(&addr);
        return;
    }
    catamaran_desktop_lib::run();
}

fn run_mcp_http(addr: &str) {
    let addr: std::net::SocketAddr = addr.parse().expect("invalid --mcp-http address");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    runtime.block_on(async {
        let registry = catamaran_desktop_lib::build_registry();
        let server = catamaran_mcp::McpServer::new(Arc::new(registry));
        eprintln!("MCP HTTP listening on http://{addr}/mcp (loopback; destructive tools need _confirm)");
        if let Err(e) = catamaran_mcp::http::serve_http(server, addr).await {
            eprintln!("mcp http server error: {e}");
        }
    });
}

fn run_mcp_stdio() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    runtime.block_on(async {
        let registry = catamaran_desktop_lib::build_registry();
        let server = catamaran_mcp::McpServer::new(Arc::new(registry));
        let reader = tokio::io::BufReader::new(tokio::io::stdin());
        let writer = tokio::io::stdout();
        if let Err(e) = catamaran_mcp::stdio::serve(server, reader, writer).await {
            eprintln!("mcp stdio server error: {e}");
        }
    });
}
