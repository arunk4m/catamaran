import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ResourceTabs } from "./ResourceTabs";

// jsdom stubs scrollIntoView on HTMLElement.prototype; replace it with a spy so
// the active-tab effect is observable.
const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

const tabs = [
  { id: 1, label: "Pods · dev" },
  { id: 2, label: "Services · dev" },
  { id: 3, label: "Nodes · dev" },
];

function setup(overrides = {}) {
  const handlers = {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCloseAll: vi.fn(),
    ...overrides,
  };
  render(<ResourceTabs tabs={tabs} activeId={2} {...handlers} />);
  return handlers;
}

describe("ResourceTabs", () => {
  it("activates a tab on click and closes via the ✕", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("tab", { name: /Pods/ }));
    expect(h.onActivate).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText("Close Services · dev"));
    expect(h.onClose).toHaveBeenCalledWith(2);
  });

  it("offers close / close others / close to the right / close all on right-click", async () => {
    const h = setup();
    fireEvent.contextMenu(screen.getByRole("tab", { name: /Services/ }));
    await waitFor(() => expect(screen.getByText("Close Others")).toBeDefined());

    fireEvent.click(screen.getByText("Close to the Right"));
    expect(h.onCloseToRight).toHaveBeenCalledWith(2);
  });

  it("scrolls the active tab into view", () => {
    setup(); // activeId=2
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("disables Close to the Right on the last tab", async () => {
    const h = setup();
    fireEvent.contextMenu(screen.getByRole("tab", { name: /Nodes/ }));
    await waitFor(() => expect(screen.getByText("Close to the Right")).toBeDefined());
    fireEvent.click(screen.getByText("Close to the Right"));
    expect(h.onCloseToRight).not.toHaveBeenCalled();
  });
});

describe("trailing controls", () => {
  it("renders trailing content pinned to the strip", () => {
    render(
      <ResourceTabs
        tabs={tabs}
        activeId={1}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseToRight={vi.fn()}
        onCloseAll={vi.fn()}
        trailing={<button aria-label="Split the deck">split</button>}
      />,
    );
    expect(screen.getByLabelText("Split the deck")).toBeDefined();
  });
});
