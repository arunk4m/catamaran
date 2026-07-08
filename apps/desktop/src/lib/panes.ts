/**
 * The deck — Catamaran's split-screen workspace model.
 *
 * A deck holds one or two panes (the two hulls). Each pane is a complete
 * workspace: its own tab stack and its own bottom dock, so two cluster
 * contexts (or two pods' log streams) can sail side by side. Pure data
 * transforms live here; React state wiring stays in App.
 */

/** One workspace pane: an independent tab stack plus its bottom dock. */
export interface Pane<Tab, Dock> {
  id: number;
  tabs: Tab[];
  activeTabId: number | null;
  dockSessions: Dock[];
  activeDockId: number | null;
  dockHeight: number;
}

/** The whole split-screen workspace: up to two panes side by side. */
export interface Deck<Tab, Dock> {
  panes: Array<Pane<Tab, Dock>>;
  focusedPaneId: number;
  /** Fraction of the deck width the first (port) pane occupies when split. */
  ratio: number;
  /** Mirror kind/namespace navigation across panes. */
  linked: boolean;
}

export const DEFAULT_DOCK_HEIGHT = 300;
export const MIN_PANE_RATIO = 0.2;
export const MAX_PANE_RATIO = 0.8;

export function emptyPane<Tab, Dock>(id: number): Pane<Tab, Dock> {
  return {
    id,
    tabs: [],
    activeTabId: null,
    dockSessions: [],
    activeDockId: null,
    dockHeight: DEFAULT_DOCK_HEIGHT,
  };
}

/** A fresh single-pane deck (not split). */
export function createDeck<Tab, Dock>(paneId = 0): Deck<Tab, Dock> {
  return { panes: [emptyPane(paneId)], focusedPaneId: paneId, ratio: 0.5, linked: false };
}

export function isSplit<Tab, Dock>(deck: Deck<Tab, Dock>): boolean {
  return deck.panes.length > 1;
}

export function focusedPane<Tab, Dock>(deck: Deck<Tab, Dock>): Pane<Tab, Dock> {
  return deck.panes.find((pane) => pane.id === deck.focusedPaneId) ?? deck.panes[0];
}

/** The pane beside `paneId`, when the deck is split. */
export function otherPane<Tab, Dock>(deck: Deck<Tab, Dock>, paneId: number): Pane<Tab, Dock> | null {
  return deck.panes.find((pane) => pane.id !== paneId) ?? null;
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(MAX_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio));
}

/**
 * Split the deck: add a starboard pane and focus it. `seedTabs` (typically a
 * duplicate of the focused pane's active view) gives the new pane a starting
 * point; empty means it opens on the landing screen. No-op when already split.
 */
export function splitDeck<Tab extends { id: number }, Dock>(
  deck: Deck<Tab, Dock>,
  newPaneId: number,
  seedTabs: Tab[] = [],
): Deck<Tab, Dock> {
  if (isSplit(deck)) return deck;
  const starboard: Pane<Tab, Dock> = {
    ...emptyPane<Tab, Dock>(newPaneId),
    tabs: seedTabs,
    activeTabId: seedTabs.at(-1)?.id ?? null,
  };
  return { ...deck, panes: [...deck.panes, starboard], focusedPaneId: newPaneId, ratio: 0.5 };
}

/** Close one pane of a split deck, keeping the other. No-op when not split. */
export function closePane<Tab, Dock>(deck: Deck<Tab, Dock>, paneId: number): Deck<Tab, Dock> {
  if (!isSplit(deck)) return deck;
  const remaining = deck.panes.filter((pane) => pane.id !== paneId);
  if (remaining.length === deck.panes.length) return deck;
  return { ...deck, panes: remaining, focusedPaneId: remaining[0].id, ratio: 0.5 };
}

export function focusPane<Tab, Dock>(deck: Deck<Tab, Dock>, paneId: number): Deck<Tab, Dock> {
  if (deck.focusedPaneId === paneId || !deck.panes.some((pane) => pane.id === paneId)) return deck;
  return { ...deck, focusedPaneId: paneId };
}

/** Swap the port and starboard panes (keeps focus on the same pane id). */
export function swapPanes<Tab, Dock>(deck: Deck<Tab, Dock>): Deck<Tab, Dock> {
  if (!isSplit(deck)) return deck;
  return { ...deck, panes: [deck.panes[1], deck.panes[0]], ratio: clampRatio(1 - deck.ratio) };
}

export function setRatio<Tab, Dock>(deck: Deck<Tab, Dock>, ratio: number): Deck<Tab, Dock> {
  return { ...deck, ratio: clampRatio(ratio) };
}

export function setLinked<Tab, Dock>(deck: Deck<Tab, Dock>, linked: boolean): Deck<Tab, Dock> {
  return { ...deck, linked };
}

/** Apply `update` to the pane with `paneId`. */
export function updatePane<Tab, Dock>(
  deck: Deck<Tab, Dock>,
  paneId: number,
  update: (pane: Pane<Tab, Dock>) => Pane<Tab, Dock>,
): Deck<Tab, Dock> {
  return {
    ...deck,
    panes: deck.panes.map((pane) => (pane.id === paneId ? update(pane) : pane)),
  };
}

/** Apply `update` to the focused pane. */
export function updateFocusedPane<Tab, Dock>(
  deck: Deck<Tab, Dock>,
  update: (pane: Pane<Tab, Dock>) => Pane<Tab, Dock>,
): Deck<Tab, Dock> {
  return updatePane(deck, focusedPane(deck).id, update);
}
