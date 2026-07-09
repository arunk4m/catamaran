import { describe, it, expect } from "vitest";
import {
  clampRatio,
  closePane,
  createDeck,
  emptyPane,
  focusPane,
  focusedPane,
  isSplit,
  otherPane,
  setLinked,
  setRatio,
  splitDeck,
  swapPanes,
  updateFocusedPane,
  updatePane,
  MIN_PANE_RATIO,
  MAX_PANE_RATIO,
} from "./panes";

interface Tab {
  id: number;
  label: string;
}

const tab = (id: number, label = `tab-${id}`): Tab => ({ id, label });

describe("deck model", () => {
  it("creates a single focused pane", () => {
    const deck = createDeck<Tab, never>(0);
    expect(deck.panes).toHaveLength(1);
    expect(isSplit(deck)).toBe(false);
    expect(focusedPane(deck).id).toBe(0);
    expect(deck.linked).toBe(false);
  });

  it("splits into two panes, seeds and focuses the starboard one", () => {
    let deck = createDeck<Tab, never>(0);
    deck = updatePane(deck, 0, (p) => ({ ...p, tabs: [tab(1)], activeTabId: 1 }));
    deck = splitDeck(deck, 7, [tab(2, "seeded")]);
    expect(isSplit(deck)).toBe(true);
    expect(deck.panes.map((p) => p.id)).toEqual([0, 7]);
    expect(focusedPane(deck).id).toBe(7);
    expect(focusedPane(deck).tabs).toEqual([tab(2, "seeded")]);
    expect(focusedPane(deck).activeTabId).toBe(2);
  });

  it("splitting an already-split deck is a no-op", () => {
    let deck = splitDeck(createDeck<Tab, never>(0), 1);
    const again = splitDeck(deck, 9);
    expect(again).toBe(deck);
  });

  it("an unseeded starboard pane starts empty (landing state)", () => {
    const deck = splitDeck(createDeck<Tab, never>(0), 1);
    expect(focusedPane(deck).tabs).toEqual([]);
    expect(focusedPane(deck).activeTabId).toBeNull();
  });

  it("closes a pane and refocuses the survivor", () => {
    let deck = splitDeck(createDeck<Tab, never>(0), 1);
    deck = updatePane(deck, 0, (p) => ({ ...p, tabs: [tab(5)], activeTabId: 5 }));
    deck = closePane(deck, 1);
    expect(isSplit(deck)).toBe(false);
    expect(focusedPane(deck).id).toBe(0);
    expect(focusedPane(deck).tabs).toEqual([tab(5)]);
  });

  it("closing the only pane is a no-op", () => {
    const deck = createDeck<Tab, never>(0);
    expect(closePane(deck, 0)).toBe(deck);
  });

  it("focuses panes by id and ignores unknown ids", () => {
    let deck = splitDeck(createDeck<Tab, never>(0), 1);
    deck = focusPane(deck, 0);
    expect(deck.focusedPaneId).toBe(0);
    expect(focusPane(deck, 99)).toBe(deck);
  });

  it("finds the pane across the deck", () => {
    const deck = splitDeck(createDeck<Tab, never>(0), 1);
    expect(otherPane(deck, 1)?.id).toBe(0);
    expect(otherPane(deck, 0)?.id).toBe(1);
    expect(otherPane(createDeck<Tab, never>(3), 3)).toBeNull();
  });

  it("swaps port and starboard and mirrors the ratio", () => {
    let deck = splitDeck(createDeck<Tab, never>(0), 1);
    deck = setRatio(deck, 0.7);
    deck = swapPanes(deck);
    expect(deck.panes.map((p) => p.id)).toEqual([1, 0]);
    expect(deck.ratio).toBeCloseTo(0.3);
    // Swapping a single-pane deck does nothing.
    const single = createDeck<Tab, never>(0);
    expect(swapPanes(single)).toBe(single);
  });

  it("clamps the split ratio to sane bounds", () => {
    expect(clampRatio(0.01)).toBe(MIN_PANE_RATIO);
    expect(clampRatio(0.99)).toBe(MAX_PANE_RATIO);
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(Number.NaN)).toBe(0.5);
  });

  it("updates only the targeted pane", () => {
    let deck = splitDeck(createDeck<Tab, never>(0), 1);
    deck = updatePane(deck, 0, (p) => ({ ...p, tabs: [tab(1)] }));
    expect(deck.panes[0].tabs).toEqual([tab(1)]);
    expect(deck.panes[1].tabs).toEqual([]);
  });

  it("updates the focused pane", () => {
    let deck = splitDeck(createDeck<Tab, never>(0), 1); // focus: 1
    deck = updateFocusedPane(deck, (p) => ({ ...p, dockHeight: 420 }));
    expect(deck.panes[1].dockHeight).toBe(420);
    expect(deck.panes[0].dockHeight).not.toBe(420);
  });

  it("toggles linked navigation", () => {
    const deck = setLinked(createDeck<Tab, never>(0), true);
    expect(deck.linked).toBe(true);
  });

  it("emptyPane starts with the default dock height and no sessions", () => {
    const pane = emptyPane<Tab, never>(4);
    expect(pane.dockSessions).toEqual([]);
    expect(pane.activeDockId).toBeNull();
    expect(pane.dockHeight).toBeGreaterThan(0);
  });
});
