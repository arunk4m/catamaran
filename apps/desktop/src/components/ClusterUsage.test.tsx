import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { ClusterUsage } from "./ClusterUsage";

describe("ClusterUsage", () => {
  it("sums node metrics and formats CPU + memory", async () => {
    const nodeMetricsFn = vi.fn().mockResolvedValue({
      metrics: [
        { name: "a", cpuMillicores: 120, memoryMiB: 600 },
        { name: "b", cpuMillicores: 80, memoryMiB: 700 },
      ],
    });
    render(<ClusterUsage context="kind-dev" intervalMs={100000} nodeMetricsFn={nodeMetricsFn} />);
    await waitFor(() => expect(screen.getByText("CPU 200m")).toBeDefined());
    // 1300 MiB → GiB
    expect(screen.getByText("Mem 1.3 GiB")).toBeDefined();
    expect(nodeMetricsFn).toHaveBeenCalledWith("kind-dev");
  });

  it("renders nothing when no metrics are available", async () => {
    const nodeMetricsFn = vi.fn().mockResolvedValue({ error: "metrics-server not found" });
    const { container } = render(
      <ClusterUsage context="kind-dev" intervalMs={100000} nodeMetricsFn={nodeMetricsFn} />,
    );
    await waitFor(() => expect(nodeMetricsFn).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
