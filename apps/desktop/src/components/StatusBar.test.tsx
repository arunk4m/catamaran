import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Usage polls metrics; stub it so the status-bar tests stay focused.
vi.mock("./ClusterUsage", () => ({ ClusterUsage: () => <span data-testid="usage" /> }));

import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it("shows the active cluster, view, and tab count", () => {
    render(<StatusBar activeCluster="kind-dev" activeLabel="Pods" tabCount={3} />);
    expect(screen.getByText("kind-dev")).toBeDefined();
    expect(screen.getByText("Pods")).toBeDefined();
    expect(screen.getByText("3 tabs")).toBeDefined();
  });

  it("shows a not-connected state with no cluster", () => {
    render(<StatusBar activeCluster={null} tabCount={0} />);
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.getByText("0 tabs")).toBeDefined();
  });

  it("uses the singular for a single tab", () => {
    render(<StatusBar activeCluster="dev" tabCount={1} />);
    expect(screen.getByText("1 tab")).toBeDefined();
  });
});
