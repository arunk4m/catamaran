import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MetricsPanel } from "./MetricsPanel";

describe("MetricsPanel", () => {
  it("polls pod metrics and shows the latest CPU and memory", async () => {
    const podMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "web-1", namespace: "default", cpuMillicores: 250, memoryMiB: 64 }],
    });
    render(
      <MetricsPanel
        kind="Pod"
        context="kind-dev"
        namespace="default"
        name="web-1"
        intervalMs={100000}
        podMetricsFn={podMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("0.250 cores")).toBeDefined());
    expect(screen.getByText("64 MiB")).toBeDefined();
    expect(podMetricsFn).toHaveBeenCalledWith("kind-dev", "default");
  });

  it("reads node metrics for a Node", async () => {
    const nodeMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "node-a", cpuMillicores: 1000, memoryMiB: 2048 }],
    });
    render(
      <MetricsPanel
        kind="Node"
        context="kind-dev"
        namespace={null}
        name="node-a"
        intervalMs={100000}
        nodeMetricsFn={nodeMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("1.000 cores")).toBeDefined());
    expect(screen.getByText("2048 MiB")).toBeDefined();
    expect(nodeMetricsFn).toHaveBeenCalledWith("kind-dev");
  });

  it("shows an empty state when the metrics server has no data", async () => {
    const podMetricsFn = vi.fn().mockResolvedValue({ metrics: [] });
    render(
      <MetricsPanel
        kind="Pod"
        context="kind-dev"
        namespace="default"
        name="web-1"
        intervalMs={100000}
        podMetricsFn={podMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText(/No metrics available/)).toBeDefined());
  });
});
