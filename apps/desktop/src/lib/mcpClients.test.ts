import { describe, it, expect } from "vitest";
import { mcpClientConfig, MCP_TOOLS } from "./mcpClients";

describe("mcpClientConfig", () => {
  it("emits a `claude mcp add` command for Claude Code (stdio)", () => {
    const c = mcpClientConfig("claude-code", "stdio", {});
    expect(c.format).toBe("shell");
    expect(c.snippet).toBe("claude mcp add catamaran -- catamaran --mcp-stdio");
  });

  it("emits an http `claude mcp add` command with the url", () => {
    const c = mcpClientConfig("claude-code", "http", { url: "http://127.0.0.1:8765/mcp" });
    expect(c.snippet).toContain("--transport http");
    expect(c.snippet).toContain("http://127.0.0.1:8765/mcp");
  });

  it("emits an mcpServers JSON block for Claude Desktop / Cursor / Antigravity (stdio)", () => {
    for (const tool of ["claude-desktop", "cursor", "antigravity", "generic"] as const) {
      const c = mcpClientConfig(tool, "stdio", {});
      expect(c.format).toBe("json");
      const parsed = JSON.parse(c.snippet);
      expect(parsed.mcpServers.catamaran).toEqual({ command: "catamaran", args: ["--mcp-stdio"] });
    }
  });

  it("emits a url entry for JSON tools over http", () => {
    const c = mcpClientConfig("cursor", "http", { url: "http://127.0.0.1:9000/mcp" });
    expect(JSON.parse(c.snippet).mcpServers.catamaran).toEqual({ url: "http://127.0.0.1:9000/mcp" });
  });

  it("emits TOML for Codex", () => {
    const c = mcpClientConfig("codex", "stdio", {});
    expect(c.format).toBe("toml");
    expect(c.snippet).toContain("[mcp_servers.catamaran]");
    expect(c.snippet).toContain('command = "catamaran"');
    expect(c.snippet).toContain('args = ["--mcp-stdio"]');
  });

  it("carries a hint about where the config goes for each tool", () => {
    for (const tool of MCP_TOOLS) {
      expect(mcpClientConfig(tool.id, "stdio", {}).hint).toBeTruthy();
    }
  });
});
