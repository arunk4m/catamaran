import React from "react";
import { ClusterUsage } from "./ClusterUsage";
import { ForwardsIndicator } from "./ForwardsIndicator";

/** One pane's context, as shown in the status bar when the deck is split. */
export interface StatusPaneInfo {
  context: string | null;
  focused: boolean;
  side: "port" | "starboard";
}

/**
 * Thin status bar across the bottom of the app: connection state + active
 * context(s) on the left; live cluster CPU/memory, the current view, and the
 * open-tab count on the right. When the deck is split it shows a chip per
 * pane, highlighting the focused one.
 */
export function StatusBar({
  panes,
  activeLabel,
  tabCount,
}: {
  panes: StatusPaneInfo[];
  activeLabel?: string;
  tabCount: number;
}) {
  const focused = panes.find((pane) => pane.focused) ?? panes[0] ?? null;
  const split = panes.length > 1;
  const activeCluster = focused?.context ?? null;

  return (
    <footer className="cat-statusbar col-[1/-1] flex h-6 items-center gap-3 border-t border-border bg-card px-3 text-xs text-muted-foreground">
      {split ? (
        <span className="cat-statusbar__deck">
          {panes.map((pane) => (
            <span
              key={pane.side}
              className={`cat-statusbar__pane-chip${pane.focused ? " cat-statusbar__pane-chip--focused" : ""}`}
              title={`${pane.side === "port" ? "Port" : "Starboard"} pane${pane.focused ? " (focused)" : ""}`}
            >
              <span
                className={`size-2 shrink-0 rounded-full ${pane.context ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
              />
              <span className="truncate">{pane.context ?? "no context"}</span>
            </span>
          ))}
        </span>
      ) : activeCluster ? (
        <span className="cat-statusbar__cluster flex items-center gap-1.5">
          <span className="cat-statusbar__dot size-2 rounded-full bg-emerald-500" />
          <span className="truncate font-medium text-foreground">{activeCluster}</span>
        </span>
      ) : (
        <span className="cat-statusbar__cluster flex items-center gap-1.5">
          <span className="cat-statusbar__dot cat-statusbar__dot--muted size-2 rounded-full bg-muted-foreground/50" />
          Not connected
        </span>
      )}
      {activeLabel && <span className="cat-statusbar__label truncate">{activeLabel}</span>}

      <span className="cat-statusbar__meta ml-auto flex items-center gap-3">
        <ForwardsIndicator />
        {activeCluster && <ClusterUsage context={activeCluster} />}
        <span className="tabular-nums">
          {tabCount} {tabCount === 1 ? "tab" : "tabs"}
        </span>
        <span className="opacity-70">Catamaran</span>
      </span>
    </footer>
  );
}
