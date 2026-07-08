/**
 * Ready-to-paste MCP client configuration for the tools people connect to
 * catamaran. catamaran runs as an MCP server via its own binary — `catamaran
 * --mcp-stdio` for clients that spawn a subprocess, or the loopback HTTP
 * endpoint for clients that connect to a URL.
 */

export type McpTool = "claude-code" | "claude-desktop" | "cursor" | "codex" | "antigravity" | "generic";
export type McpTransport = "stdio" | "http";

export interface McpToolInfo {
  id: McpTool;
  label: string;
  /** Where the config lives / how to apply it. */
  hint: string;
}

export const MCP_TOOLS: McpToolInfo[] = [
  { id: "claude-code", label: "Claude Code", hint: "Run the command in your terminal." },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    hint: "Add to claude_desktop_config.json (Settings → Developer → Edit Config).",
  },
  { id: "cursor", label: "Cursor", hint: "Add to ~/.cursor/mcp.json (or a project .cursor/mcp.json)." },
  { id: "codex", label: "Codex", hint: "Add to ~/.codex/config.toml." },
  { id: "antigravity", label: "Antigravity", hint: "Add to the IDE's MCP config (mcpServers)." },
  { id: "generic", label: "Other (mcpServers JSON)", hint: "Most MCP clients accept this mcpServers block." },
];

export interface McpClientConfig {
  format: "shell" | "json" | "toml";
  snippet: string;
  hint: string;
}

const DEFAULT_URL = "http://127.0.0.1:8765/mcp";

/** Pretty mcpServers JSON block for a stdio or http entry. */
function mcpServersJson(entry: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers: { catamaran: entry } }, null, 2);
}

/** Config for connecting `tool` to catamaran over `transport`. */
export function mcpClientConfig(
  tool: McpTool,
  transport: McpTransport,
  opts: { url?: string },
): McpClientConfig {
  const url = opts.url || DEFAULT_URL;
  const hint = MCP_TOOLS.find((t) => t.id === tool)?.hint ?? "";

  if (tool === "claude-code") {
    const snippet =
      transport === "stdio"
        ? "claude mcp add catamaran -- catamaran --mcp-stdio"
        : `claude mcp add --transport http catamaran ${url}`;
    return { format: "shell", snippet, hint };
  }

  if (tool === "codex") {
    const snippet =
      transport === "stdio"
        ? `[mcp_servers.catamaran]\ncommand = "catamaran"\nargs = ["--mcp-stdio"]`
        : `[mcp_servers.catamaran]\nurl = "${url}"`;
    return { format: "toml", snippet, hint };
  }

  // JSON mcpServers tools: Claude Desktop, Cursor, Antigravity, generic.
  const entry = transport === "stdio" ? { command: "catamaran", args: ["--mcp-stdio"] } : { url };
  return { format: "json", snippet: mcpServersJson(entry), hint };
}
