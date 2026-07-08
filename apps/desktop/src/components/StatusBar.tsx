import React from "react";
import { ClusterUsage } from "./ClusterUsage";
import { ForwardsIndicator } from "./ForwardsIndicator";

/**
 * Thin status bar across the bottom of the app: connection state + active
 * cluster on the left; live cluster CPU/memory, the current view, and the
 * open-tab count on the right.
 */
export function StatusBar({
  activeCluster,
  activeLabel,
  tabCount,
}: {
  activeCluster: string | null;
  activeLabel?: string;
  tabCount: number;
}) {
  return (
    <footer className="cat-statusbar col-[1/-1] flex h-6 items-center gap-3 border-t border-border bg-card px-3 text-xs text-muted-foreground">
      {activeCluster ? (
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
        <span className="opacity-70">catamaran · Tauri</span>
      </span>
    </footer>
  );
}
