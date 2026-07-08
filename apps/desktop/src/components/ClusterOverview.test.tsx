import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listNamespaces: vi.fn(),
  listPods: vi.fn(),
  listNodes: vi.fn(),
  listResource: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("../lib/workloads", () => ({
  listNamespaces: mocks.listNamespaces,
  listPods: mocks.listPods,
}));

vi.mock("../lib/manifest", () => ({
  listNodes: mocks.listNodes,
  listResource: mocks.listResource,
  listEvents: mocks.listEvents,
}));

import { ClusterOverview, clearClusterOverviewCache } from "./ClusterOverview";

beforeEach(() => {
  clearClusterOverviewCache();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.listNodes.mockResolvedValue({ nodes: [{ status: "Ready" }] });
  mocks.listPods.mockResolvedValue({ pods: [{ phase: "Running" }] });
  mocks.listResource.mockResolvedValue({ items: [{ name: "one" }] });
  mocks.listNamespaces.mockResolvedValue({ namespaces: ["default"] });
  mocks.listEvents.mockResolvedValue({ events: [] });
});

describe("ClusterOverview cache", () => {
  it("reuses a fresh per-context snapshot after the page remounts", async () => {
    const first = render(<ClusterOverview context="kind-dev" />);
    expect(await screen.findAllByText("1 / 1")).toHaveLength(2);
    first.unmount();

    render(<ClusterOverview context="kind-dev" />);
    expect(screen.getAllByText("1 / 1")).toHaveLength(2);
    expect(mocks.listNodes).toHaveBeenCalledTimes(1);
    expect(mocks.listPods).toHaveBeenCalledTimes(1);
    expect(mocks.listResource).toHaveBeenCalledTimes(2);
  });

  it("forces a refresh while keeping the cached dashboard visible", async () => {
    render(<ClusterOverview context="kind-dev" />);
    expect(await screen.findAllByText("1 / 1")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Refresh cluster overview" }));
    expect(screen.getAllByText("1 / 1")).toHaveLength(2);
    await waitFor(() => expect(mocks.listNodes).toHaveBeenCalledTimes(2));
  });
});

describe("ClusterOverview error handling", () => {
  it("renders a friendly connectivity message on a connection timeout", async () => {
    mocks.listNamespaces.mockResolvedValue({ error: "handler error: list namespaces timed out" });

    render(<ClusterOverview context="kind-unreachable" />);

    // Friendly title, not the raw backend string.
    expect(await screen.findByText("Can't reach the cluster")).toBeDefined();
    expect(screen.getByText(/didn't respond in time/)).toBeDefined();
    expect(screen.queryByText(/handler error/)).toBeNull();
  });

  it("retries the load when the user clicks Retry", async () => {
    mocks.listNamespaces.mockResolvedValueOnce({
      error: "handler error: list namespaces timed out",
    });

    render(<ClusterOverview context="kind-flaky" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    // Second attempt succeeds with the default healthy mocks.
    expect(await screen.findAllByText("1 / 1")).toHaveLength(2);
  });
});
