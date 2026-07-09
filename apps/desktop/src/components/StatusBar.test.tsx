import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Usage polls metrics; stub it so the status-bar tests stay focused.
vi.mock("./ClusterUsage", () => ({ ClusterUsage: () => <span data-testid="usage" /> }));

import { StatusBar, type StatusPaneInfo } from "./StatusBar";

const single = (context: string | null): StatusPaneInfo[] => [
  { context, focused: true, side: "port" },
];

describe("StatusBar", () => {
  it("shows the active cluster, view, and tab count", () => {
    render(<StatusBar panes={single("kind-dev")} activeLabel="Pods" tabCount={3} />);
    expect(screen.getByText("kind-dev")).toBeDefined();
    expect(screen.getByText("Pods")).toBeDefined();
    expect(screen.getByText("3 tabs")).toBeDefined();
  });

  it("shows a not-connected state with no cluster", () => {
    render(<StatusBar panes={single(null)} tabCount={0} />);
    expect(screen.getByText("Not connected")).toBeDefined();
    expect(screen.getByText("0 tabs")).toBeDefined();
  });

  it("uses the singular for a single tab", () => {
    render(<StatusBar panes={single("dev")} tabCount={1} />);
    expect(screen.getByText("1 tab")).toBeDefined();
  });

  it("shows a chip per pane when split, marking the focused one", () => {
    render(
      <StatusBar
        panes={[
          { context: "prod", focused: false, side: "port" },
          { context: "staging", focused: true, side: "starboard" },
        ]}
        activeLabel="Deployments"
        tabCount={2}
      />,
    );
    expect(screen.getByText("prod")).toBeDefined();
    expect(screen.getByText("staging")).toBeDefined();
    expect(screen.getByTitle("Starboard pane (focused)")).toBeDefined();
    expect(screen.getByTitle("Port pane")).toBeDefined();
  });

  it("labels a split pane with no open context", () => {
    render(
      <StatusBar
        panes={[
          { context: "prod", focused: true, side: "port" },
          { context: null, focused: false, side: "starboard" },
        ]}
        tabCount={1}
      />,
    );
    expect(screen.getByText("no context")).toBeDefined();
  });
});
