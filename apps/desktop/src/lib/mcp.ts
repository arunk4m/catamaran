import { invokeCommand } from "../transport/transport";

/** Start (or restart) the in-app MCP HTTP server on `port`; returns its URL. */
export async function startMcpHttp(port: number): Promise<string> {
  return invokeCommand<string>("mcp_http_start", { port });
}

/** Stop the in-app MCP HTTP server. */
export async function stopMcpHttp(): Promise<void> {
  await invokeCommand("mcp_http_stop");
}

/** The MCP HTTP server's URL if it's running, else null. */
export async function mcpHttpStatus(): Promise<string | null> {
  return invokeCommand<string | null>("mcp_http_status");
}

export interface CliStatus {
  installed: boolean;
  path: string;
  links_to: string | null;
  /** Whether the install directory (~/.local/bin) is on the current $PATH. */
  on_path: boolean;
}

/** Symlink the catamaran binary onto PATH; returns the install path. */
export async function installCatamaranCli(): Promise<string> {
  return invokeCommand<string>("install_catamaran_cli");
}

/** Whether the `catamaran` CLI is installed on PATH and where it points. */
export async function catamaranCliStatus(): Promise<CliStatus> {
  return invokeCommand<CliStatus>("catamaran_cli_status");
}
