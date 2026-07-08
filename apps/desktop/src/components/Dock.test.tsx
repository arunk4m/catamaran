import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("./PodTerminal", () => ({
  PodTerminal: ({ pod }: { pod: string }) => <div data-testid="terminal">{pod}</div>,
}));
vi.mock("./LogsView", () => ({
  LogsView: ({ source }: { source: { pod?: string; name?: string } }) => (
    <div data-testid="logs">{source.pod ?? source.name}</div>
  ),
}));

import { Dock, type DockSession } from "./Dock";

const sessions: DockSession[] = [
  { id: 1, kind: "terminal", context: "c", namespace: "default", pod: "web-1" },
  { id: 2, kind: "logs", context: "c", namespace: "default", pod: "web-2" },
];

function renderDock(overrides: Partial<React.ComponentProps<typeof Dock>> = {}) {
  const props = {
    sessions,
    activeId: 1,
    height: 300,
    onActivate: vi.fn(),
    onCloseTab: vi.fn(),
    onClose: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
  render(<Dock {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

describe("Dock", () => {
  it("renders a tab per session and the active terminal", () => {
    renderDock();
    expect(screen.getByRole("tab", { name: /web-1/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /web-2/ })).toBeDefined();
    // active terminal (id 1) is web-1
    expect(screen.getByTestId("terminal").textContent).toBe("web-1");
  });

  it("renders the logs view when a logs tab is active", () => {
    renderDock({ activeId: 2 });
    expect(screen.getByTestId("logs").textContent).toBe("web-2");
    expect(screen.queryByTestId("terminal")).toBeNull();
  });

  it("activates a tab on click", () => {
    const props = renderDock();
    fireEvent.click(screen.getByRole("tab", { name: /web-2/ }));
    expect(props.onActivate).toHaveBeenCalledWith(2);
  });

  it("closes a single tab and the whole dock", () => {
    const props = renderDock();
    fireEvent.click(screen.getByLabelText("Close web-1 terminal"));
    expect(props.onCloseTab).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText("Close dock"));
    expect(props.onClose).toHaveBeenCalled();
  });
});
