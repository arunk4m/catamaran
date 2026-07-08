import React, { useEffect, useMemo, useState } from "react";
import { Braces, type LucideIcon } from "lucide-react";
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
import { getRecents, pushRecent, type RecentItem } from "../lib/recents";
import { iconForResourceKind } from "../ui/NavIcon";

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

/** Rank startsWith matches before substring matches, then alphabetically. */
function rankBy<T>(q: string, keyOf: (t: T) => string) {
  return (a: T, b: T) => {
    const A = keyOf(a).toLowerCase();
    const B = keyOf(b).toLowerCase();
    const as = A.startsWith(q) ? 0 : 1;
    const bs = B.startsWith(q) ? 0 : 1;
    return as !== bs ? as - bs : A.localeCompare(B);
  };
}

/**
 * Global command palette (Cmd/Ctrl-K): jump to any resource view, or fuzzy-find
 * a resource by name across kinds and open its detail. Resources are indexed
 * once when the palette opens; filtering is client-side for instant feedback.
 */
export function CommandPalette({
  open,
  onOpenChange,
  context,
  onOpenView,
  onOpenResource,
  onOpenCrd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: string | null;
  onOpenView: (kind: ResourceKind) => void;
  onOpenResource: (kind: ResourceKind, namespace: string | null, name: string) => void;
  onOpenCrd: (crd: CrdRef) => void;
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
  const navMatches = useMemo(() => {
    const kinds = NAV_KINDS.map((k) => ({
      id: `k:${k}`,
      label: RESOURCE_LABELS[k],
      recent: { type: "view", kind: k, label: RESOURCE_LABELS[k] } as RecentItem,
    }));
    const crdNav = crds.map((c) => ({
      id: `crd:${c.name}`,
      label: `${c.kind} (CRD)`,
      recent: { type: "crd", crd: c, label: `${c.kind} (CRD)` } as RecentItem,
    }));
    const all = [...kinds, ...crdNav];
    if (!q) return kinds.slice(0, 6);
    return all
      .filter((n) => n.label.toLowerCase().includes(q))
      .sort(rankBy(q, (n) => n.label))
      .slice(0, 8);
  }, [q, crds]);

  // Dispatch a chosen item, record it in recents, and close the palette.
  function pick(item: RecentItem) {
    pushRecent(item);
    if (item.type === "view") onOpenView(item.kind as ResourceKind);
    else if (item.type === "resource") onOpenResource(item.kind as ResourceKind, item.namespace, item.name);
    else onOpenCrd(item.crd);
    onOpenChange(false);
  }

  const resMatches = useMemo(() => {
    if (!q) return [];
    return items
      .filter((r) => r.name.toLowerCase().includes(q))
      .sort(rankBy(q, (r) => r.name))
      .slice(0, 50);
  }, [items, q]);

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
