import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export interface TabDescriptor {
  id: number;
  label: string;
}

/**
 * Top strip of open resource views — each tab is a (cluster, resource-kind)
 * pair, like browser tabs. Left-click switches, the ✕ closes, and right-click
 * opens a context menu (close / close others / close to the right / close all).
 */
export function ResourceTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
  trailing,
}: {
  tabs: TabDescriptor[];
  activeId: number | null;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  onCloseOthers: (id: number) => void;
  onCloseToRight: (id: number) => void;
  onCloseAll: () => void;
  /** Optional controls pinned to the right edge of the strip (e.g. split toggle). */
  trailing?: React.ReactNode;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible — opening the 15th tab shouldn't leave it
  // off-screen to the right. Query the strip (rather than hold a ref) since the
  // tab is wrapped by Radix's asChild trigger, which owns the child ref.
  useEffect(() => {
    stripRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId, tabs.length]);

  // Translate vertical wheel gestures into horizontal scroll so a plain mouse
  // (no shift, no trackpad) can reach overflowed tabs.
  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    const strip = stripRef.current;
    if (!strip || e.deltaX !== 0 || e.deltaY === 0) return;
    strip.scrollLeft += e.deltaY;
  }

  return (
    <div
      ref={stripRef}
      role="tablist"
      className="cat-ctabs"
      onWheel={onWheel}
    >
      {tabs.map((t, i) => {
        const active = t.id === activeId;
        const isLast = i === tabs.length - 1;
        return (
          <ContextMenu key={t.id}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={active}
                onClick={() => onActivate(t.id)}
                className={cn(
                  "cat-ctab",
                  active ? "cat-ctab--active" : "cat-ctab--inactive",
                )}
              >
                <span>{t.label}</span>
                <button
                  aria-label={`Close ${t.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  className="cat-ctab__close"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onClose(t.id)}>Close</ContextMenuItem>
              <ContextMenuItem disabled={tabs.length <= 1} onSelect={() => onCloseOthers(t.id)}>
                Close Others
              </ContextMenuItem>
              <ContextMenuItem disabled={isLast} onSelect={() => onCloseToRight(t.id)}>
                Close to the Right
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onCloseAll}>Close All</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {trailing && <div className="cat-ctabs__trailing">{trailing}</div>}
    </div>
  );
}
