import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Braces,
  Columns2,
  FilePlus2,
  Link2,
  PanelRight,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import { RESOURCE_LABELS, K8S_KIND, type ResourceKind } from "./ResourceBrowser";
import { listResource } from "../lib/manifest";
import { listCrds, type CrdRef } from "../lib/crds";
import { getRecents, pushRecent, recentId, type RecentItem } from "../lib/recents";
import { rankItems } from "../lib/paletteRank";
import { iconForResourceKind, spyglassIcon } from "../ui/NavIcon";
import { SPYGLASS_CATALOG, type SpyglassTool, type SpyglassToolMeta } from "../lib/settings";

/** Workspace-level commands the palette can run. */
export interface PaletteActions {
  split: boolean;
  linked: boolean;
  hasContext: boolean;
  onToggleSplit: () => void;
  onFocusOtherPane: () => void;
  onToggleLinked: () => void;
  onSwapPanes: () => void;
  onToggleTheme: () => void;
  onNewResource: () => void;
  /** Open an observability tool against the focused context. */
  onOpenSpyglass?: (tool: SpyglassTool) => void;
  /** Tools offered in the palette (built-in + user-added). */
  spyglassTools?: SpyglassToolMeta[];
}

interface ActionItem {
  id: string;
  label: string;
  /** Extra match text so e.g. "pane" finds every deck command. */
  keywords: string;
  icon: LucideIcon;
  run: () => void;
}

function buildActions(actions: PaletteActions): ActionItem[] {
  const items: ActionItem[] = [
    {
      id: "act:split",
      label: actions.split ? "Close Split View" : "Split the Deck",
      keywords: "split view pane deck side by side",
      icon: Columns2,
      run: actions.onToggleSplit,
    },
  ];
  if (actions.split) {
    items.push(
      {
        id: "act:focus-other",
        label: "Focus Other Pane",
        keywords: "pane switch focus port starboard",
        icon: PanelRight,
        run: actions.onFocusOtherPane,
      },
      {
        id: "act:link",
        label: actions.linked ? "Unlink Panes" : "Link Panes",
        keywords: "link mirror navigation panes deck",
        icon: Link2,
        run: actions.onToggleLinked,
      },
      {
        id: "act:swap",
        label: "Swap Panes",
        keywords: "swap panes port starboard exchange",
        icon: ArrowLeftRight,
        run: actions.onSwapPanes,
      },
    );
  }
  items.push({
    id: "act:theme",
    label: "Toggle Light/Dark Theme",
    keywords: "theme dark light mode appearance",
    icon: SunMoon,
    run: actions.onToggleTheme,
  });
  if (actions.hasContext) {
    items.push({
      id: "act:new",
      label: "New Resource…",
      keywords: "create new resource yaml apply editor",
      icon: FilePlus2,
      run: actions.onNewResource,
    });
  }
  const openSpyglass = actions.onOpenSpyglass;
  if (openSpyglass) {
    for (const tool of actions.spyglassTools ?? SPYGLASS_CATALOG) {
      items.push({
        id: `act:${tool.id}`,
        label: `Open ${tool.label}`,
        keywords: `${tool.label} ${tool.blurb} observability spyglass tool`.toLowerCase(),
        icon: spyglassIcon(tool.icon),
        run: () => openSpyglass(tool.id),
      });
    }
  }
  return items;
}

/** Kinds indexed for name search when the palette opens. */
const SEARCH_KINDS: ResourceKind[] = [
  "pods",
  "deployments",
  "statefulsets",
  "daemonsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "services",
  "ingresses",
  "configmaps",
  "secrets",
  "persistentvolumeclaims",
  "serviceaccounts",
  "nodes",
];

// Views you can jump to. "portforwards" is a virtual view, still navigable.
const NAV_KINDS = (Object.keys(RESOURCE_LABELS) as ResourceKind[]).filter((k) => k !== "overview");

interface ResItem {
  kind: ResourceKind;
  namespace: string;
  name: string;
}

function iconForRecent(item: RecentItem): LucideIcon {
  return item.type === "crd" ? Braces : iconForResourceKind(item.kind as ResourceKind);
}

function PaletteIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" />;
}

/**
 * Global command palette (Cmd/Ctrl-K): jump to any resource view, fuzzy-find
 * a resource by name across kinds and open its detail, or run a workspace
 * action (split view, theme, …). Resources are indexed once when the palette
 * opens; filtering is client-side (fuzzy subsequence + frecency) for instant
 * feedback.
 */
export function CommandPalette({
  open,
  onOpenChange,
  context,
  onOpenView,
  onOpenResource,
  onOpenCrd,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: string | null;
  onOpenView: (kind: ResourceKind) => void;
  onOpenResource: (kind: ResourceKind, namespace: string | null, name: string) => void;
  onOpenCrd: (crd: CrdRef) => void;
  /** Workspace actions surfaced in the Actions group (optional in tests). */
  actions?: PaletteActions;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ResItem[]>([]);
  const [crds, setCrds] = useState<CrdRef[]>([]);
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Index resources + CRDs, and read recents, each time the palette opens.
  useEffect(() => {
    if (!open || !context) return;
    let active = true;
    setLoading(true);
    setRecents(getRecents());
    void listCrds(context).then((o) => active && setCrds(o.crds ?? []));
    void Promise.all(
      SEARCH_KINDS.map((k) =>
        listResource(context, K8S_KIND[k], "").then((o) =>
          (o.items ?? []).map((r) => ({ kind: k, namespace: r.namespace, name: r.name })),
        ),
      ),
    ).then((lists) => {
      if (!active) return;
      setItems(lists.flat());
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [open, context]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();

  // "Go to": resource kinds plus discovered CRDs (opened as custom-resource views).
  // Ids of recent targets, most-recent-first, for the frecency boost.
  const recentIds = useMemo(() => recents.map((r) => recentId(r)), [recents]);

  const navMatches = useMemo(() => {
    const kinds = NAV_KINDS.map((k) => ({
      id: `view:${k}`,
      label: RESOURCE_LABELS[k],
      recent: { type: "view", kind: k, label: RESOURCE_LABELS[k] } as RecentItem,
    }));
    const crdNav = crds.map((c) => ({
      id: `crd:${c.name}`,
      label: `${c.kind} (CRD)`,
      recent: { type: "crd", crd: c, label: `${c.kind} (CRD)` } as RecentItem,
    }));
    if (!q) return rankItems(kinds, "", (n) => n.label, (n) => n.id, recentIds).slice(0, 6);
    return rankItems([...kinds, ...crdNav], q, (n) => n.label, (n) => n.id, recentIds).slice(0, 8);
  }, [q, crds, recentIds]);

  const actionMatches = useMemo(() => {
    if (!actions) return [];
    const all = buildActions(actions);
    if (!q) return all;
    return rankItems(all, q, (a) => `${a.label} ${a.keywords}`, (a) => a.id).slice(0, 6);
  }, [actions, q]);

  // Dispatch a chosen item, record it in recents, and close the palette.
  function pick(item: RecentItem) {
    pushRecent(item);
    if (item.type === "view") onOpenView(item.kind as ResourceKind);
    else if (item.type === "resource") onOpenResource(item.kind as ResourceKind, item.namespace, item.name);
    else onOpenCrd(item.crd);
    onOpenChange(false);
  }

  function runAction(action: ActionItem) {
    action.run();
    onOpenChange(false);
  }

  const resMatches = useMemo(() => {
    if (!q) return [];
    return rankItems(items, q, (r) => r.name, (r) => `res:${r.kind}:${r.namespace}:${r.name}`, recentIds).slice(
      0,
      50,
    );
  }, [items, q, recentIds]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to a view or resource">
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search resources and views…" />
        <CommandList>
          <CommandEmpty>{loading ? "Indexing…" : "No results"}</CommandEmpty>

          {!q && recents.length > 0 && (
            <CommandGroup heading="Recent">
              {recents.map((r) => (
                <CommandItem key={`recent:${r.type}:${r.label}`} value={`recent:${r.label}`} onSelect={() => pick(r)}>
                  <PaletteIcon icon={iconForRecent(r)} />
                  <span className="truncate">{r.label}</span>
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {r.type === "resource" ? K8S_KIND[r.kind as ResourceKind] : r.type === "crd" ? "CRD" : "view"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {navMatches.length > 0 && (
            <CommandGroup heading="Go to">
              {navMatches.map((n) => (
                <CommandItem key={n.id} value={`nav:${n.id}`} onSelect={() => pick(n.recent)}>
                  <PaletteIcon icon={iconForRecent(n.recent)} />
                  {n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {actionMatches.length > 0 && (
            <CommandGroup heading="Actions">
              {actionMatches.map((a) => (
                <CommandItem key={a.id} value={`action:${a.id}`} onSelect={() => runAction(a)}>
                  <PaletteIcon icon={a.icon} />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {resMatches.length > 0 && (
            <CommandGroup heading={loading ? "Resources (indexing…)" : "Resources"}>
              {resMatches.map((r, i) => (
                <CommandItem
                  key={`${r.kind}/${r.namespace}/${r.name}/${i}`}
                  value={`res:${i}`}
                  onSelect={() =>
                    pick({ type: "resource", kind: r.kind, namespace: r.namespace || null, name: r.name, label: r.name })
                  }
                >
                  <PaletteIcon icon={iconForResourceKind(r.kind)} />
                  <span className="truncate">{r.name}</span>
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {K8S_KIND[r.kind]}
                  </span>
                  {r.namespace && (
                    <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{r.namespace}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
