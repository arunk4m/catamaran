import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listNamespaces: vi.fn(),
  podCounts: vi.fn(),
  listNodes: vi.fn(),
  listResource: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock("../lib/workloads", () => ({
  listNamespaces: mocks.listNamespaces,
  podCounts: mocks.podCounts,
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
  mocks.podCounts.mockResolvedValue({
    counts: { total: 1, running: 1, pending: 0, succeeded: 0, failed: 0, unknown: 0 },
  });
  mocks.listResource.mockResolvedValue({ items: [{ name: "one" }] });
  mocks.listNamespaces.mockResolvedValue({ namespaces: ["default"] });
  mocks.listEvents.mockResolvedValue({ events: [] });
});

const TIMEOUT = "handler error: count pods timed out";

describe("ClusterOverview cache", () => {
  it("reuses a fresh per-context snapshot after the page remounts", async () => {
    const first = render(<ClusterOverview context="kind-dev" />);
    expect(await screen.findAllByText("1 / 1")).toHaveLength(2);
    first.unmount();

    render(<ClusterOverview context="kind-dev" />);
    expect(screen.getAllByText("1 / 1")).toHaveLength(2);
    expect(mocks.listNodes).toHaveBeenCalledTimes(1);
    expect(mocks.podCounts).toHaveBeenCalledTimes(1);
    expect(mocks.podCounts).toHaveBeenCalledWith("kind-dev", "");
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

describe("ClusterOverview partial degradation", () => {
  it("renders the dashboard with a dash when one count fails", async () => {
    mocks.podCounts.mockResolvedValue({ error: TIMEOUT });

    render(<ClusterOverview context="tusk-dev" />);

    // The rest of the dashboard still renders (nodes tile shows 1 / 1)…
    expect(await screen.findByText("1 / 1")).toBeDefined();
    // …the pods tile degrades to a dash with a note, not a full-page error…
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.getByText(/pods unavailable/)).toBeDefined();
    expect(screen.getByText("Pod counts unavailable")).toBeDefined();
    // …and the unreachable card never appears.
    expect(screen.queryByText("Can't reach the cluster")).toBeNull();
  });

  it("recovers the missing section on refresh", async () => {
    mocks.podCounts.mockResolvedValueOnce({ error: TIMEOUT });

    render(<ClusterOverview context="tusk-dev" />);
    expect(await screen.findByText(/pods unavailable/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Refresh cluster overview" }));
    await waitFor(() => expect(screen.getAllByText("1 / 1")).toHaveLength(2));
    expect(screen.queryByText(/pods unavailable/)).toBeNull();
  });
});

describe("ClusterOverview error handling", () => {
  function failEverything() {
    mocks.listNodes.mockResolvedValue({ error: TIMEOUT });
    mocks.podCounts.mockResolvedValue({ error: TIMEOUT });
    mocks.listResource.mockResolvedValue({ error: TIMEOUT });
    mocks.listNamespaces.mockResolvedValue({ error: TIMEOUT });
    mocks.listEvents.mockResolvedValue({ error: TIMEOUT });
  }

  it("shows the friendly connectivity card only when every section fails", async () => {
    failEverything();

    render(<ClusterOverview context="kind-unreachable" />);

    // Friendly title, not the raw backend string.
    expect(await screen.findByText("Can't reach the cluster")).toBeDefined();
    expect(screen.getByText(/didn't respond in time/)).toBeDefined();
    expect(screen.queryByText(/handler error/)).toBeNull();
  });

  it("retries the load when the user clicks Retry", async () => {
    failEverything();

    render(<ClusterOverview context="kind-flaky" />);
    expect(await screen.findByText("Can't reach the cluster")).toBeDefined();

    // Second attempt succeeds with healthy responses.
    mocks.listNodes.mockResolvedValue({ nodes: [{ status: "Ready" }] });
    mocks.podCounts.mockResolvedValue({
      counts: { total: 1, running: 1, pending: 0, succeeded: 0, failed: 0, unknown: 0 },
    });
    mocks.listResource.mockResolvedValue({ items: [{ name: "one" }] });
    mocks.listNamespaces.mockResolvedValue({ namespaces: ["default"] });
    mocks.listEvents.mockResolvedValue({ events: [] });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByText("1 / 1")).toHaveLength(2);
  });
});
