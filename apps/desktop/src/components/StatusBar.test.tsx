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

const { ssoProfilesMock, ssoLoginMock, openExternalUrlMock, notifyMock } = vi.hoisted(() => ({
  ssoProfilesMock: vi.fn(),
  ssoLoginMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/aws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/aws")>();
  return {
    ...actual,
    ssoProfiles: ssoProfilesMock,
    ssoLogin: ssoLoginMock,
    openExternalUrl: openExternalUrlMock,
  };
});
vi.mock("../lib/notify", () => ({ notify: notifyMock }));

describe("AWS access button", () => {
  it("is hidden until a portal URL is configured", () => {
    render(<StatusBar panes={single("dev-eks")} tabCount={1} />);
    expect(screen.queryByLabelText("Refresh AWS access")).toBeNull();
  });

  it("refreshes the focused context's profile and reports success", async () => {
    ssoProfilesMock.mockResolvedValue({
      profiles: [
        { profile: "tusk-dev", contexts: ["dev-eks"] },
        { profile: "tusk-prod", contexts: ["prod-eks"] },
      ],
    });
    ssoLoginMock.mockResolvedValue({ ok: true });
    render(
      <StatusBar
        panes={single("dev-eks")}
        tabCount={1}
        awsPortalUrl="https://deepinsightai.awsapps.com/start/#/"
      />,
    );
    const { fireEvent, waitFor } = await import("@testing-library/react");
    fireEvent.click(screen.getByLabelText("Refresh AWS access"));
    await waitFor(() => expect(ssoLoginMock).toHaveBeenCalledWith("tusk-dev"));
    await waitFor(() => expect(notifyMock.success).toHaveBeenCalled());
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("opens the portal when no profile is pinned, and on login failure", async () => {
    const { fireEvent, waitFor, cleanup } = await import("@testing-library/react");

    ssoProfilesMock.mockResolvedValue({ profiles: [] });
    render(<StatusBar panes={single(null)} tabCount={0} awsPortalUrl="https://portal.example" />);
    fireEvent.click(screen.getByLabelText("Refresh AWS access"));
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith("https://portal.example"));
    expect(notifyMock.info).toHaveBeenCalled();
    cleanup();

    ssoProfilesMock.mockResolvedValue({ profiles: [{ profile: "tusk-dev", contexts: ["dev-eks"] }] });
    ssoLoginMock.mockResolvedValue({ error: "Token has expired and refresh failed" });
    openExternalUrlMock.mockClear();
    render(<StatusBar panes={single("dev-eks")} tabCount={1} awsPortalUrl="https://portal.example" />);
    fireEvent.click(screen.getByLabelText("Refresh AWS access"));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalled());
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith("https://portal.example"));
  });
});
