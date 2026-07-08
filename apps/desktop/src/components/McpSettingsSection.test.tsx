import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const { mcp } = vi.hoisted(() => ({
  mcp: {
    startMcpHttp: vi.fn(),
    stopMcpHttp: vi.fn(),
    mcpHttpStatus: vi.fn(),
    installCatamaranCli: vi.fn(),
    catamaranCliStatus: vi.fn(),
  },
}));
vi.mock("../lib/mcp", () => mcp);
vi.mock("../lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { McpSettingsSection } from "./McpSettingsSection";

beforeEach(() => {
  localStorage.clear();
  Object.values(mcp).forEach((m) => m.mockReset());
  mcp.mcpHttpStatus.mockResolvedValue(null);
  mcp.catamaranCliStatus.mockResolvedValue({ installed: false, path: "/usr/local/bin/catamaran", links_to: null });
});

describe("McpSettingsSection", () => {
  it("starts the MCP HTTP server when toggled on and shows the URL", async () => {
    mcp.startMcpHttp.mockResolvedValue("http://127.0.0.1:8765/mcp");
    render(<McpSettingsSection />);
    fireEvent.click(screen.getByLabelText("Run MCP HTTP server"));
    await waitFor(() => expect(mcp.startMcpHttp).toHaveBeenCalledWith(8765));
    expect(await screen.findByText("http://127.0.0.1:8765/mcp")).toBeDefined();
  });

  it("surfaces a bind error and leaves the toggle off", async () => {
    mcp.startMcpHttp.mockRejectedValue("Could not bind 127.0.0.1:8765: address in use");
    render(<McpSettingsSection />);
    fireEvent.click(screen.getByLabelText("Run MCP HTTP server"));
    expect(await screen.findByText(/address in use/)).toBeDefined();
    expect((screen.getByLabelText("Run MCP HTTP server") as HTMLInputElement).checked).toBe(false);
  });

  it("installs the catamaran CLI", async () => {
    mcp.installCatamaranCli.mockResolvedValue("/usr/local/bin/catamaran");
    mcp.catamaranCliStatus.mockResolvedValue({ installed: true, path: "/usr/local/bin/catamaran", links_to: "/x" });
    render(<McpSettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Install catamaran CLI/ }));
    await waitFor(() => expect(mcp.installCatamaranCli).toHaveBeenCalled());
    // After install the button relabels to Reinstall and the path is shown.
    expect(await screen.findByRole("button", { name: /Reinstall catamaran CLI/ })).toBeDefined();
    expect(screen.getAllByText(/Installed at/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows the client config for the selected tool and transport", async () => {
    render(<McpSettingsSection />);
    // Default tool is Claude Code (stdio) → a `claude mcp add` command.
    expect(screen.getByText("claude mcp add catamaran -- catamaran --mcp-stdio")).toBeDefined();
    // Switch to Codex → TOML block.
    fireEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByText(/\[mcp_servers\.catamaran\]/)).toBeDefined();
  });
});
