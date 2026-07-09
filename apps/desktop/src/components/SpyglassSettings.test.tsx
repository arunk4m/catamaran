import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const { discoverMock, listMock, stopMock, notifyMock } = vi.hoisted(() => ({
  discoverMock: vi.fn(),
  listMock: vi.fn(),
  stopMock: vi.fn(),
  notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/spyglass", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/spyglass")>();
  return {
    ...actual,
    discoverTools: discoverMock,
    listSpyglassForwards: listMock,
    spyglassForwardStop: stopMock,
  };
});
vi.mock("../lib/notify", () => ({ notify: notifyMock }));

import { SpyglassSettings } from "./SpyglassSettings";
import { DEFAULT_OBSERVABILITY } from "../lib/settings";

beforeEach(() => {
  discoverMock.mockReset();
  listMock.mockReset().mockResolvedValue({ forwards: [] });
  stopMock.mockReset();
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
});

describe("SpyglassSettings", () => {
  it("renders both tools with auto-detect active by default", async () => {
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={() => {}} activeContext="tusk-dev" />,
    );
    await waitFor(() => expect(screen.getByText("No spyglass port-forwards running.")).toBeDefined());
    expect(screen.getByText("Kiali")).toBeDefined();
    expect(screen.getByText("Grafana")).toBeDefined();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((b) => b.textContent ?? "");
    expect(pressed.filter((t) => t.includes("Auto-detect"))).toHaveLength(2);
  });

  it("switches a tool to URL mode with a blank url", async () => {
    const onConfigChange = vi.fn();
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={onConfigChange} activeContext="tusk-dev" />,
    );
    const kialiGroup = screen.getByRole("group", { name: "Kiali source" });
    fireEvent.click(Array.from(kialiGroup.querySelectorAll("button")).find((b) => b.textContent?.includes("External URL"))!);
    expect(onConfigChange).toHaveBeenCalledWith({
      ...DEFAULT_OBSERVABILITY,
      kiali: { mode: "url", url: "" },
    });
  });

  it("detect pins discovered services and shows the ingress hint", async () => {
    discoverMock.mockResolvedValue({
      tools: [
        {
          tool: "kiali",
          namespace: "istio-system",
          service: "kiali",
          port: 20001,
          ingressUrl: "http://kiali.dev.example",
        },
        { tool: "grafana", namespace: "infra", service: "grafana", port: 80, ingressUrl: null },
      ],
    });
    const onConfigChange = vi.fn();
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={onConfigChange} activeContext="tusk-dev" />,
    );
    fireEvent.click(screen.getByText("Detect in tusk-dev"));
    await waitFor(() => expect(onConfigChange).toHaveBeenCalled());
    expect(discoverMock).toHaveBeenCalledWith("tusk-dev");
    expect(onConfigChange).toHaveBeenCalledWith({
      kiali: { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
      grafana: { mode: "service", namespace: "infra", service: "grafana", port: 80 },
    });
    expect(notifyMock.success).toHaveBeenCalled();
    expect(await screen.findByText("http://kiali.dev.example")).toBeDefined();
  });

  it("reports when nothing was found", async () => {
    discoverMock.mockResolvedValue({ tools: [] });
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={() => {}} activeContext="kind-local" />,
    );
    fireEvent.click(screen.getByText("Detect in kind-local"));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalled());
  });

  it("disables detection without a focused cluster", () => {
    render(<SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={() => {}} activeContext={null} />);
    const button = screen.getByText("Detect (open a cluster first)").closest("button")!;
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("lists active tunnels and stops one", async () => {
    listMock.mockResolvedValue({
      forwards: [
        { context: "tusk-dev", namespace: "infra", service: "grafana", port: 80, localPort: 50123 },
      ],
    });
    stopMock.mockResolvedValue({ stopped: true });
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={() => {}} activeContext="tusk-dev" />,
    );
    expect(await screen.findByText("infra/grafana:80 → 127.0.0.1:50123")).toBeDefined();
    fireEvent.click(screen.getByText("Stop"));
    await waitFor(() =>
      expect(stopMock).toHaveBeenCalledWith({
        context: "tusk-dev",
        namespace: "infra",
        service: "grafana",
        port: 80,
      }),
    );
    // The list refreshes after stopping.
    expect(listMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("edits pinned service fields", () => {
    const onConfigChange = vi.fn();
    render(
      <SpyglassSettings
        config={{
          kiali: { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
          grafana: { mode: "auto" },
        }}
        onConfigChange={onConfigChange}
        activeContext="tusk-dev"
      />,
    );
    fireEvent.change(screen.getByLabelText("Kiali namespace"), { target: { value: "mesh" } });
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kiali: { mode: "service", namespace: "mesh", service: "kiali", port: 20001 },
      }),
    );
    // Out-of-range ports are ignored rather than persisted.
    onConfigChange.mockClear();
    fireEvent.change(screen.getByLabelText("Kiali port"), { target: { value: "99999" } });
    expect(onConfigChange).not.toHaveBeenCalled();
  });
});
