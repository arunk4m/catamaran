import React, { useEffect, useState } from "react";
import { Moon, Settings, Sun } from "lucide-react";
import { listContexts, type ClusterContext } from "../lib/clusters";
import {
  type Theme,
} from "../ui";
import { ContextAvatar } from "./ContextAvatar";
import { contextDisplayName, orderContexts, type ContextProfiles } from "../lib/settings";

const EMPTY_LIST: string[] = [];

/**
 * Far-left vertical strip of catamaran cluster avatars. Click an
 * avatar to enter that cluster.
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
}: {
  openContext: string | null;
  onOpenContext: (context: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  contextProfiles?: ContextProfiles;
  kubeconfigFiles?: string[];
  contextOrder?: string[];
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
      {contexts.map((c) => (
        (() => {
          const profile = contextProfiles[c.name];
          const displayName = contextDisplayName(c.name, profile);
          return (
        <button
          key={c.name}
          className={`cat-hotbar__item${openContext === c.name ? " cat-hotbar__item--active" : ""}`}
          title={displayName}
          aria-label={displayName}
          onClick={() => onOpenContext(c.name)}
        >
          <ContextAvatar context={c.name} profile={profile} />
        </button>
          );
        })()
      ))}
      <div className="cat-hotbar__spacer" aria-hidden="true" />
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
  );
}
