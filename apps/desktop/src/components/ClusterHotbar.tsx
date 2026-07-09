import React, { useEffect, useState } from "react";
import { Moon, Settings, Sun } from "lucide-react";
import catamaranMark from "../assets/catamaran-mark.svg";
import { listContexts, type ClusterContext } from "../lib/clusters";
import {
  type Theme,
} from "../ui";
import { ContextAvatar } from "./ContextAvatar";
import { contextDisplayName, orderContexts, type ContextProfiles } from "../lib/settings";

const EMPTY_LIST: string[] = [];

/**
 * The cluster rail: the brand mast on top, then the fleet — one labeled,
 * soft-tint avatar per kube context. The context open in the focused pane
 * carries a gradient ring; every context that's aboard (open in any pane)
 * shows a green dot. Theme and settings live at the foot of the mast.
 */
export function ClusterHotbar({
  openContext,
  onOpenContext,
  theme,
  onToggleTheme,
  onOpenSettings,
  contextProfiles = {},
  kubeconfigFiles = EMPTY_LIST,
  contextOrder = EMPTY_LIST,
  openContexts = EMPTY_LIST,
}: {
  openContext: string | null;
  onOpenContext: (context: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  contextProfiles?: ContextProfiles;
  kubeconfigFiles?: string[];
  contextOrder?: string[];
  /** Contexts open in any pane of the deck (shown with an aboard dot). */
  openContexts?: string[];
}) {
  const [contexts, setContexts] = useState<ClusterContext[]>([]);

  useEffect(() => {
    let active = true;
    void listContexts(kubeconfigFiles).then((o) => {
      if (active && o.contexts) setContexts(orderContexts(o.contexts, contextOrder));
    });
    return () => {
      active = false;
    };
  }, [contextOrder, kubeconfigFiles]);

  return (
    <div className="cat-hotbar">
      <div className="cat-hotbar__brand" aria-hidden="true">
        <img src={catamaranMark} alt="" />
      </div>
      <div className="cat-hotbar__fleet">
        {contexts.map((c) => {
          const profile = contextProfiles[c.name];
          const displayName = contextDisplayName(c.name, profile);
          const active = openContext === c.name;
          const aboard = openContexts.includes(c.name);
          return (
            <button
              key={c.name}
              className={`cat-hotbar__item${active ? " cat-hotbar__item--active" : ""}`}
              title={displayName}
              aria-label={displayName}
              onClick={() => onOpenContext(c.name)}
            >
              <span className="cat-hotbar__ring">
                <span className="cat-hotbar__ring-gap">
                  <ContextAvatar context={c.name} profile={profile} />
                  {aboard && <span className="cat-hotbar__dot" data-testid={`aboard-${c.name}`} aria-hidden="true" />}
                </span>
              </span>
              <span className="cat-hotbar__name">{displayName}</span>
            </button>
          );
        })}
      </div>
      <div className="cat-hotbar__actions">
        <button
          className="cat-hotbar__theme"
          aria-label={theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title="Toggle light/dark mode"
          onClick={onToggleTheme}
        >
          {theme.mode === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        <button
          className="cat-hotbar__theme"
          aria-label="Open settings"
          title="Open settings"
          onClick={onOpenSettings}
        >
          <Settings aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
