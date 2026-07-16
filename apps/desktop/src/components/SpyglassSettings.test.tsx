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
  it("renders every catalog tool with auto-detect active by default", async () => {
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={() => {}} activeContext="tusk-dev" />,
    );
    await waitFor(() => expect(screen.getByText("No spyglass port-forwards running.")).toBeDefined());
    for (const label of ["Kiali", "Grafana", "Airflow", "Redpanda", "Temporal", "Tusk Lens"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(6);
    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((b) => b.textContent ?? "");
    expect(pressed.filter((t) => t.includes("Auto-detect"))).toHaveLength(6);
  });

  it("switches a tool to URL mode with a blank url", async () => {
    const onConfigChange = vi.fn();
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={onConfigChange} activeContext="tusk-dev" />,
    );
    const kialiGroup = screen.getByRole("group", { name: "Kiali source" });
    fireEvent.click(Array.from(kialiGroup.querySelectorAll("button")).find((b) => b.textContent?.includes("External URL"))!);
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ kiali: { mode: "url", url: "" } }),
    );
  });

  it("detect pins discovered services (incl. the newer tools) and shows the ingress hint", async () => {
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
        { tool: "temporal", namespace: "temporal", service: "temporal-web", port: 8080, ingressUrl: null },
      ],
    });
    const onConfigChange = vi.fn();
    render(
      <SpyglassSettings config={DEFAULT_OBSERVABILITY} onConfigChange={onConfigChange} activeContext="tusk-dev" />,
    );
    fireEvent.click(screen.getByText("Detect in tusk-dev"));
    await waitFor(() => expect(onConfigChange).toHaveBeenCalled());
    expect(discoverMock).toHaveBeenCalledWith("tusk-dev");
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kiali: { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
        grafana: { mode: "service", namespace: "infra", service: "grafana", port: 80 },
        temporal: { mode: "service", namespace: "temporal", service: "temporal-web", port: 8080 },
        // Undetected tools keep their prior (auto) source.
        airflow: { mode: "auto" },
      }),
    );
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
          ...DEFAULT_OBSERVABILITY,
          kiali: { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
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

describe("SpyglassSettings custom tools", () => {
  it("adds, edits, picks an icon for, and removes a custom tool", () => {
    const onCustomToolsChange = vi.fn();
    const custom = [
      {
        id: "custom-jaeger",
        label: "Jaeger",
        icon: "scan-eye" as const,
        namespace: "observability",
        service: "jaeger-query",
        port: 16686,
      },
    ];
    const { rerender } = render(
      <SpyglassSettings
        config={DEFAULT_OBSERVABILITY}
        onConfigChange={() => {}}
        customTools={custom}
        onCustomToolsChange={onCustomToolsChange}
        activeContext="tusk-dev"
      />,
    );

    // Existing custom tool's fields render and edit.
    expect((screen.getByLabelText("Jaeger namespace") as HTMLInputElement).value).toBe("observability");
    fireEvent.change(screen.getByLabelText("Jaeger service"), { target: { value: "jaeger-ui" } });
    expect(onCustomToolsChange).toHaveBeenCalledWith([{ ...custom[0], service: "jaeger-ui" }]);

    // Icon picker switches the icon.
    onCustomToolsChange.mockClear();
    const iconGroup = screen.getByRole("group", { name: "Jaeger icon" });
    fireEvent.click(iconGroup.querySelector('[aria-label="workflow"]')!);
    expect(onCustomToolsChange).toHaveBeenCalledWith([{ ...custom[0], icon: "workflow" }]);

    // Add appends a blank tool.
    onCustomToolsChange.mockClear();
    fireEvent.click(screen.getByText("Add tool"));
    expect(onCustomToolsChange).toHaveBeenCalledTimes(1);
    const added = onCustomToolsChange.mock.calls[0][0];
    expect(added).toHaveLength(2);
    expect(added[1].id).toMatch(/^custom-/);

    // Remove asks for confirmation, then drops it.
    onCustomToolsChange.mockClear();
    fireEvent.click(screen.getByLabelText("Remove Jaeger"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" })); // confirm
    expect(onCustomToolsChange).toHaveBeenCalledWith([]);

    // Empty state when there are none.
    rerender(
      <SpyglassSettings
        config={DEFAULT_OBSERVABILITY}
        onConfigChange={() => {}}
        customTools={[]}
        onCustomToolsChange={onCustomToolsChange}
        activeContext="tusk-dev"
      />,
    );
    expect(screen.getByText("No custom tools yet.")).toBeDefined();
  });

  it("hides a built-in tool after confirmation and restores it", () => {
    const onHiddenToolsChange = vi.fn();
    const { rerender } = render(
      <SpyglassSettings
        config={DEFAULT_OBSERVABILITY}
        onConfigChange={() => {}}
        hiddenTools={[]}
        onHiddenToolsChange={onHiddenToolsChange}
        activeContext="tusk-dev"
      />,
    );
    // Remove Tusk Lens (built-in) → confirm.
    fireEvent.click(screen.getByLabelText("Remove Tusk Lens"));
    expect(screen.getByText(/will be removed from the Observability menu/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onHiddenToolsChange).toHaveBeenCalledWith(["tusklens"]);

    // With it hidden, its card is gone and it shows in the restore list.
    rerender(
      <SpyglassSettings
        config={DEFAULT_OBSERVABILITY}
        onConfigChange={() => {}}
        hiddenTools={["tusklens"]}
        onHiddenToolsChange={onHiddenToolsChange}
        activeContext="tusk-dev"
      />,
    );
    expect(screen.queryByLabelText("Tusk Lens namespace")).toBeNull();
    expect(screen.getByText("Hidden built-in tools")).toBeDefined();
    onHiddenToolsChange.mockClear();
    fireEvent.click(screen.getByText("Restore"));
    expect(onHiddenToolsChange).toHaveBeenCalledWith([]);
  });

  it("cancelling removal keeps the tool", () => {
    const onHiddenToolsChange = vi.fn();
    render(
      <SpyglassSettings
        config={DEFAULT_OBSERVABILITY}
        onConfigChange={() => {}}
        hiddenTools={[]}
        onHiddenToolsChange={onHiddenToolsChange}
        activeContext="tusk-dev"
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove Grafana"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onHiddenToolsChange).not.toHaveBeenCalled();
  });
});
