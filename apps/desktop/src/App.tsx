import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeftRight, Columns2, Link2, X } from "lucide-react";
import { ClusterHotbar } from "./components/ClusterHotbar";
import { ResourceTabs, type TabDescriptor } from "./components/ResourceTabs";
import { Sidebar } from "./components/Sidebar";
import {
  ResourceBrowser,
  K8S_KIND,
  RESOURCE_LABELS,
  type ResourceKind,
} from "./components/ResourceBrowser";
import { CustomResourceBrowser } from "./components/CustomResourceBrowser";
import { ClusterOverview } from "./components/ClusterOverview";
import { PortForwardsView } from "./components/PortForwardsView";
import { HelmReleasesView } from "./components/HelmReleasesView";
import { NewResourceEditor } from "./components/NewResourceEditor";
import { EditResourceTab } from "./components/EditResourceTab";
import { SettingsView } from "./components/SettingsView";
import { CommandPalette } from "./components/CommandPalette";
import { Toaster } from "./components/ui/sonner";
import { Dock, type DockSession, type DockKind } from "./components/Dock";
import { StatusBar } from "./components/StatusBar";
import { LandingPage } from "./components/LandingPage";
import { getInitialTheme, applyTheme, IconButton, type Theme, type ThemeMode, type ThemeName } from "./ui";
import type { CrdRef } from "./lib/crds";
import type { ResourceTarget } from "./lib/resourceNavigation";
import {
  loadClusterNamespaces,
  saveClusterNamespaces,
  getDefaultNamespace,
  setDefaultNamespace,
  loadWorkspaceLayout,
  saveWorkspaceLayout,
  type WorkspaceLayoutSettings,
  loadContextProfiles,
  saveContextProfiles,
  contextDisplayName,
  type ContextProfiles,
  loadKubeconfigFiles,
  saveKubeconfigFiles,
  loadContextOrder,
  saveContextOrder,
  orderContexts,
  loadUpdateChannel,
  loadMcpSettings,
  loadDeckLayout,
  saveDeckLayout,
} from "./lib/settings";
import {
  createDeck,
  splitDeck,
  closePane,
  focusPane,
  focusedPane,
  otherPane,
  isSplit,
  swapPanes,
  setRatio,
  setLinked,
  updatePane,
  clampRatio,
  type Deck,
  type Pane,
} from "./lib/panes";
import { startMcpHttp } from "./lib/mcp";
import { checkForUpdateAndNotify } from "./lib/updateNotifier";
import { notify } from "./lib/notify";
import type { SettingsSection } from "./components/SettingsView";

interface ViewTab {
  id: number;
  cluster: string | null;
  kind: ResourceKind;
  /** Present when the tab is a custom-resource (CRD) view. */
  crd?: CrdRef;
  /** Deep-link target from global search (opens the resource's detail). */
  focus?: { name: string; namespace: string | null; nonce: number };
  /** For a "new resource" tab: the template kind to start from. */
  create?: { initialKind?: string };
  /** For an "edit resource" tab: the resource to preload and apply back. */
  edit?: { kind: string; namespace: string | null; name: string };
  /** Selected namespace filter (empty = all), preserved per tab. */
  namespace?: string;
}

type AppPane = Pane<ViewTab, DockSession>;
type AppDeck = Deck<ViewTab, DockSession>;

/** The active tab of a pane, if any. */
function activeTabOf(pane: AppPane | null): ViewTab | null {
  if (!pane) return null;
  return pane.tabs.find((t) => t.id === pane.activeTabId) ?? null;
}

/** Kinds that make sense to mirror across linked panes. */
function isMirrorableKind(kind: ResourceKind): boolean {
  return kind !== "settings" && kind !== "newresource" && kind !== "editresource";
}

export function App() {
  // The deck: one or two panes (the two hulls), each a full workspace with its
  // own tab stack and bottom dock. All tab/dock operations are deck transforms.
  const tabIdRef = useRef(1);
  const paneIdRef = useRef(2);
  const [deck, setDeck] = useState<AppDeck>(() => {
    const persisted = loadDeckLayout();
    let d = createDeck<ViewTab, DockSession>(0);
    d = { ...d, ratio: persisted.ratio, linked: persisted.linked };
    if (persisted.split) d = splitDeck(d, 1);
    return d;
  });
  // Per-pane search query for the resource browser toolbar.
  const [paneQuery, setPaneQuery] = useState<Record<number, string>>({});
  const [layout, setLayout] = useState(loadWorkspaceLayout);
  const [sidebarWidth, setSidebarWidth] = useState(layout.leftSidebarWidth);
  const [contextProfiles, setContextProfiles] = useState(loadContextProfiles);
  const [kubeconfigFiles, setKubeconfigFiles] = useState(loadKubeconfigFiles);
  const [contextOrder, setContextOrder] = useState(loadContextOrder);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Last-used namespace per cluster (persisted across restarts).
  const [clusterNs, setClusterNs] = useState<Record<string, string>>(loadClusterNamespaces);
  // Global fallback namespace for clusters with no remembered selection.
  const [defaultNs, setDefaultNs] = useState(getDefaultNamespace);
  const dockIdRef = useRef(1);
  const focusNonce = useRef(0);
  // Mirror the deck into a ref so once-registered listeners (Cmd+W menu event,
  // keyboard shortcuts) always see the latest state without re-subscribing.
  const deckRef = useRef(deck);
  deckRef.current = deck;
  // Deep-link the Settings tab to a section (e.g. from the update toast). The
  // nonce bumps to remount SettingsView at the requested section when asked.
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("appearance");
  const [settingsSectionNonce, setSettingsSectionNonce] = useState(0);

  // Persist per-cluster namespace whenever it changes.
  useEffect(() => saveClusterNamespaces(clusterNs), [clusterNs]);

  // Persist the deck shape (split / ratio / linked) whenever it changes.
  useEffect(
    () => saveDeckLayout({ split: isSplit(deck), ratio: deck.ratio, linked: deck.linked }),
    [deck],
  );

  /** The namespace a new tab in `cluster` should start on. */
  const namespaceFor = (cluster: string) => clusterNs[cluster] ?? defaultNs;

  /** Update a tab's namespace filter and remember it as the cluster's default. */
  function setTabNamespace(paneId: number, tabId: number, cluster: string, ns: string) {
    setDeck((d) => {
      let next = updatePane(d, paneId, (p) => ({
        ...p,
        tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, namespace: ns } : t)),
      }));
      // Linked cruising: mirror the namespace onto the other pane's active tab.
      if (next.linked && isSplit(next)) {
        const other = otherPane(next, paneId);
        const otherActive = activeTabOf(other);
        if (other && otherActive?.cluster) {
          next = updatePane(next, other.id, (p) => ({
            ...p,
            tabs: p.tabs.map((t) => (t.id === otherActive.id ? { ...t, namespace: ns } : t)),
          }));
          setClusterNs((m) => ({ ...m, [otherActive.cluster as string]: ns }));
        }
      }
      return next;
    });
    setClusterNs((m) => ({ ...m, [cluster]: ns }));
  }

  /** Change the saved default namespace (settings). */
  function changeDefaultNamespace(ns: string) {
    setDefaultNs(ns);
    setDefaultNamespace(ns);
  }

  function changeWorkspaceLayout(next: WorkspaceLayoutSettings) {
    setLayout(next);
    setSidebarWidth(next.leftSidebarWidth);
    saveWorkspaceLayout(next);
  }

  function changeContextProfiles(next: ContextProfiles) {
    setContextProfiles(next);
    saveContextProfiles(next);
  }

  function changeKubeconfigFiles(next: string[]) {
    setKubeconfigFiles(next);
    saveKubeconfigFiles(next);
  }

  function changeContextOrder(next: string[]) {
    setContextOrder(next);
    saveContextOrder(next);
  }

  useEffect(() => {
    applyTheme(theme);
    if (theme.mode !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyTheme(theme);
    mediaQuery.addEventListener("change", syncSystemTheme);
    return () => mediaQuery.removeEventListener("change", syncSystemTheme);
  }, [theme]);

  function setThemeMode(mode: ThemeMode) {
    setTheme((current) => ({ ...current, mode }));
  }

  function setThemeName(name: ThemeName) {
    setTheme((current) => ({ ...current, name }));
  }

  function toggleThemeMode() {
    setTheme((current) => ({
      ...current,
      mode: current.mode === "dark" ? "light" : "dark",
    }));
  }

  /** Split the deck (seeding the new pane with the current view) or collapse it. */
  function toggleSplit() {
    setDeck((d) => {
      if (isSplit(d)) {
        const other = otherPane(d, d.focusedPaneId);
        return other ? closePane(d, other.id) : d;
      }
      const source = focusedPane(d);
      const active = activeTabOf(source);
      const seed: ViewTab[] =
        active && active.cluster && isMirrorableKind(active.kind) && !active.edit && !active.create
          ? [
              {
                id: tabIdRef.current++,
                cluster: active.cluster,
                kind: active.kind,
                crd: active.crd,
                namespace: active.namespace,
              },
            ]
          : [];
      return splitDeck(d, paneIdRef.current++, seed);
    });
  }

  // Global shortcuts: Cmd/Ctrl-K palette, Cmd/Ctrl-\ split, Cmd/Ctrl-Alt-←/→ focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "\\") {
        e.preventDefault();
        toggleSplit();
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        setDeck((d) => {
          if (!isSplit(d)) return d;
          const target = e.key === "ArrowLeft" ? d.panes[0] : d.panes[1];
          return focusPane(d, target.id);
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // toggleSplit only touches refs + functional setDeck, so this stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On macOS the native menu routes Cmd+W to a custom "Close" item (see
  // src-tauri) which emits `close-active-tab`. Close the focused pane's active
  // tab here; an empty split pane closes itself, and the window only closes
  // when nothing is left — mirroring browser-style tab behavior.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlistenPromise = listen("close-active-tab", () => {
      const d = deckRef.current;
      const pane = focusedPane(d);
      if (pane.activeTabId != null) {
        const totalTabs = d.panes.reduce((n, p) => n + p.tabs.length, 0);
        closeView(pane.id, pane.activeTabId);
        if (totalTabs === 1 && !isSplit(d)) void getCurrentWindow().close();
      } else if (isSplit(d)) {
        setDeck((dd) => closePane(dd, focusedPane(dd).id));
      } else {
        void getCurrentWindow().close();
      }
    }).catch(() => () => {});
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const pane = focusedPane(deck);
  const activeTab = activeTabOf(pane);
  const activeCluster = activeTab?.cluster ?? null;
  const activeKind: ResourceKind = activeTab?.kind ?? "pods";
  // Every cluster with an open tab, across both panes (drives the sidebar tree).
  const clusters = orderContexts(
    [...new Set(deck.panes.flatMap((p) => p.tabs.flatMap((t) => (t.cluster ? [t.cluster] : []))))].map(
      (name) => ({ name }),
    ),
    contextOrder,
  ).map(({ name }) => name);

  /** Pure transform: open (or focus) a (cluster, kind) view inside one pane. */
  function openViewOn(d: AppDeck, paneId: number, cluster: string, kind: ResourceKind): AppDeck {
    const target = d.panes.find((p) => p.id === paneId);
    if (!target) return d;
    const existing = target.tabs.find((t) => t.cluster === cluster && t.kind === kind && !t.crd);
    if (existing) {
      return updatePane(d, paneId, (p) => ({ ...p, activeTabId: existing.id }));
    }
    const id = tabIdRef.current++;
    const tab: ViewTab = { id, cluster, kind, namespace: namespaceFor(cluster) };
    return updatePane(d, paneId, (p) => ({ ...p, tabs: [...p.tabs, tab], activeTabId: id }));
  }

  /** Open (or focus) a resource view for a cluster + kind in a pane (default: focused). */
  function openView(cluster: string, kind: ResourceKind, target?: { paneId?: number }) {
    if (kind === "settings") {
      openSettings();
      return;
    }
    const paneId = target?.paneId ?? deck.focusedPaneId;
    setDeck((d) => {
      let next = openViewOn(d, paneId, cluster, kind);
      next = focusPane(next, paneId);
      // Linked cruising: the other pane follows onto the same kind.
      if (next.linked && isSplit(next) && isMirrorableKind(kind)) {
        const other = otherPane(next, paneId);
        const otherCluster =
          activeTabOf(other)?.cluster ?? other?.tabs.find((t) => t.cluster)?.cluster ?? null;
        if (other && otherCluster) next = openViewOn(next, other.id, otherCluster, kind);
      }
      return next;
    });
    setPaneQuery((q) => ({ ...q, [paneId]: "" }));
  }

  /** Open the single workspace-level Settings tab, optionally at a section. */
  function openSettings(section?: SettingsSection) {
    if (section) {
      setSettingsInitialSection(section);
      // Remount SettingsView so it opens at the requested section even if the
      // tab is already open on another section.
      setSettingsSectionNonce((n) => n + 1);
    }
    setDeck((d) => {
      // Settings lives once per workspace: focus it wherever it's open.
      for (const p of d.panes) {
        const existing = p.tabs.find((t) => t.kind === "settings" && !t.cluster);
        if (existing) {
          return focusPane(
            updatePane(d, p.id, (x) => ({ ...x, activeTabId: existing.id })),
            p.id,
          );
        }
      }
      const id = tabIdRef.current++;
      return updatePane(d, d.focusedPaneId, (p) => ({
        ...p,
        tabs: [...p.tabs, { id, cluster: null, kind: "settings" as ResourceKind }],
        activeTabId: id,
      }));
    });
  }
  // Keep a stable handle to openSettings so the update-check effect's toast
  // action always uses the current tab state, not a stale closure.
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;

  // Automatically check for updates on startup and periodically, surfacing a
  // small toast (with a link to the Updates section) when one is available —
  // rather than only when the user opens Settings and clicks "check".
  const notifiedVersionRef = useRef<string | null>(null);
  useEffect(() => {
    const channel = loadUpdateChannel();
    const run = () =>
      void checkForUpdateAndNotify(
        channel,
        (update) => {
          notifiedVersionRef.current = update.version;
          notify.updateAvailable(update.version, () => openSettingsRef.current("updates"));
        },
        { alreadyNotified: (v) => notifiedVersionRef.current === v },
      );
    run();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const timer = setInterval(run, SIX_HOURS);
    return () => clearInterval(timer);
  }, []);

  // Start the in-app MCP HTTP server on launch if the user left it enabled, so
  // agents can connect without opening Settings first.
  useEffect(() => {
    const mcp = loadMcpSettings();
    if (mcp.enabled) void startMcpHttp(mcp.port).catch(() => {});
  }, []);

  /** Open a resource's kind view in a pane and deep-link to its detail. */
  function openResource(
    kind: ResourceKind,
    namespace: string | null,
    name: string,
    target?: { paneId?: number },
  ) {
    const paneId = target?.paneId ?? deck.focusedPaneId;
    const sourcePane = deck.panes.find((p) => p.id === paneId) ?? pane;
    const cluster = activeTabOf(sourcePane)?.cluster ?? null;
    if (!cluster) return;
    const focus = { name, namespace, nonce: ++focusNonce.current };
    // Filter the list to the resource's namespace so its row is present to focus.
    const ns = namespace ?? "";
    setDeck((d) =>
      focusPane(
        updatePane(d, paneId, (p) => {
          const existing = p.tabs.find((t) => t.cluster === cluster && t.kind === kind && !t.crd);
          if (existing) {
            return {
              ...p,
              tabs: p.tabs.map((t) => (t.id === existing.id ? { ...t, focus, namespace: ns } : t)),
              activeTabId: existing.id,
            };
          }
          const id = tabIdRef.current++;
          return {
            ...p,
            tabs: [...p.tabs, { id, cluster, kind, focus, namespace: ns }],
            activeTabId: id,
          };
        }),
        paneId,
      ),
    );
    setClusterNs((m) => ({ ...m, [cluster]: ns }));
    setPaneQuery((q) => ({ ...q, [paneId]: "" }));
  }

  /** Resolve a canonical Kubernetes kind from a detail link to its product view. */
  function openLinkedResource(target: ResourceTarget, paneId?: number) {
    const entry = Object.entries(K8S_KIND).find(([, k8sKind]) => k8sKind === target.kind);
    if (!entry) return;
    openResource(entry[0] as ResourceKind, target.namespace, target.name, { paneId });
  }

  /** Open a fresh "new resource" editor tab, optionally seeded with a template. */
  function openNewResource(initialKind?: string, paneId?: number) {
    const targetPaneId = paneId ?? deck.focusedPaneId;
    const cluster = activeTabOf(deck.panes.find((p) => p.id === targetPaneId) ?? pane)?.cluster;
    if (!cluster) return;
    const id = tabIdRef.current++;
    setDeck((d) =>
      updatePane(d, targetPaneId, (p) => ({
        ...p,
        tabs: [...p.tabs, { id, cluster, kind: "newresource" as ResourceKind, create: { initialKind } }],
        activeTabId: id,
      })),
    );
  }

  /** Open (or focus) a full-tab editor preloaded with a resource's manifest. */
  function openEditResource(kind: string, namespace: string | null, name: string, paneId?: number) {
    const targetPaneId = paneId ?? deck.focusedPaneId;
    const cluster = activeTabOf(deck.panes.find((p) => p.id === targetPaneId) ?? pane)?.cluster;
    if (!cluster) return;
    setDeck((d) =>
      updatePane(d, targetPaneId, (p) => {
        const existing = p.tabs.find(
          (t) =>
            t.kind === "editresource" &&
            t.cluster === cluster &&
            t.edit?.kind === kind &&
            (t.edit?.namespace ?? null) === (namespace ?? null) &&
            t.edit?.name === name,
        );
        if (existing) return { ...p, activeTabId: existing.id };
        const id = tabIdRef.current++;
        return {
          ...p,
          tabs: [
            ...p.tabs,
            { id, cluster, kind: "editresource" as ResourceKind, edit: { kind, namespace, name } },
          ],
          activeTabId: id,
        };
      }),
    );
  }

  /** Open (or focus) a custom-resource view for a cluster + CRD. */
  function openCrdView(cluster: string, crd: CrdRef, target?: { paneId?: number }) {
    const paneId = target?.paneId ?? deck.focusedPaneId;
    setDeck((d) =>
      focusPane(
        updatePane(d, paneId, (p) => {
          const existing = p.tabs.find((t) => t.cluster === cluster && t.crd?.name === crd.name);
          if (existing) return { ...p, activeTabId: existing.id };
          const id = tabIdRef.current++;
          return {
            ...p,
            tabs: [...p.tabs, { id, cluster, kind: "overview" as ResourceKind, crd }],
            activeTabId: id,
          };
        }),
        paneId,
      ),
    );
    setPaneQuery((q) => ({ ...q, [paneId]: "" }));
  }

  function closeView(paneId: number, id: number) {
    setDeck((d) =>
      updatePane(d, paneId, (p) => {
        const remaining = p.tabs.filter((t) => t.id !== id);
        return {
          ...p,
          tabs: remaining,
          activeTabId: p.activeTabId === id ? (remaining.at(-1)?.id ?? null) : p.activeTabId,
        };
      }),
    );
  }
  /** Close every tab except `id` in a pane, then focus it. */
  function closeOtherViews(paneId: number, id: number) {
    setDeck((d) =>
      updatePane(d, paneId, (p) => ({ ...p, tabs: p.tabs.filter((t) => t.id === id), activeTabId: id })),
    );
  }
  /** Close every tab to the right of `id` in a pane. */
  function closeViewsToRight(paneId: number, id: number) {
    setDeck((d) =>
      updatePane(d, paneId, (p) => {
        const idx = p.tabs.findIndex((t) => t.id === id);
        if (idx < 0) return p;
        const remaining = p.tabs.slice(0, idx + 1);
        return {
          ...p,
          tabs: remaining,
          activeTabId: remaining.some((t) => t.id === p.activeTabId) ? p.activeTabId : id,
        };
      }),
    );
  }
  function closeAllViews(paneId: number) {
    setDeck((d) => updatePane(d, paneId, (p) => ({ ...p, tabs: [], activeTabId: null })));
  }

  // Bottom dock (terminals + logs) — per pane, so two log streams can race
  // side by side when the deck is split.
  function openDock(
    paneId: number,
    kind: DockKind,
    s: {
      context: string;
      namespace: string;
      pod?: string;
      container?: string;
      workload?: { kind: string; name: string };
    },
  ) {
    const id = dockIdRef.current++;
    setDeck((d) =>
      updatePane(d, paneId, (p) => ({
        ...p,
        dockSessions: [...p.dockSessions, { id, kind, ...s }],
        activeDockId: id,
      })),
    );
  }
  function closeDockTab(paneId: number, id: number) {
    setDeck((d) =>
      updatePane(d, paneId, (p) => {
        const remaining = p.dockSessions.filter((x) => x.id !== id);
        return {
          ...p,
          dockSessions: remaining,
          activeDockId: p.activeDockId === id ? (remaining.at(-1)?.id ?? null) : p.activeDockId,
        };
      }),
    );
  }
  function closeDock(paneId: number) {
    setDeck((d) =>
      updatePane(d, paneId, (p) => ({ ...p, dockSessions: [], activeDockId: null })),
    );
  }

  // Drag-to-resize the split ratio.
  const deckElRef = useRef<HTMLDivElement | null>(null);
  const [dividerDragging, setDividerDragging] = useState(false);
  function startDividerDrag(e: React.MouseEvent) {
    e.preventDefault();
    const el = deckElRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDividerDragging(true);
    function onMove(ev: MouseEvent) {
      const ratio = clampRatio((ev.clientX - rect.left) / rect.width);
      setDeck((d) => setRatio(d, ratio));
    }
    function onUp() {
      setDividerDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    }
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const split = isSplit(deck);

  /** Everything a pane needs to render its content views. */
  function renderPane(p: AppPane, index: number) {
    const paneActiveTab = activeTabOf(p);
    const paneCluster = paneActiveTab?.cluster ?? null;
    const paneKind: ResourceKind = paneActiveTab?.kind ?? "pods";
    const paneCrd = paneActiveTab?.crd ?? null;
    const focused = p.id === deck.focusedPaneId;
    const side = index === 0 ? "port" : "starboard";
    const query = paneQuery[p.id] ?? "";
    const setQuery = (q: string) => setPaneQuery((m) => ({ ...m, [p.id]: q }));

    const tabDescriptors: TabDescriptor[] = p.tabs.map((t) => ({
      id: t.id,
      label: t.edit
        ? `edit: ${t.edit.kind}/${t.edit.name}`
        : t.cluster
          ? `${t.crd ? t.crd.kind : RESOURCE_LABELS[t.kind]} · ${contextDisplayName(t.cluster, contextProfiles[t.cluster])}`
          : RESOURCE_LABELS[t.kind],
    }));

    return (
      <section
        key={p.id}
        data-testid={`pane-${side}`}
        className={`cat-pane${split && focused ? " cat-pane--focused" : ""}`}
        style={split ? { flexGrow: index === 0 ? deck.ratio : 1 - deck.ratio, flexBasis: 0 } : undefined}
        onMouseDownCapture={() => setDeck((d) => focusPane(d, p.id))}
      >
        {split && (
          <header className="cat-pane-header">
            <span className="cat-pane-header__side">{side}</span>
            <span className="cat-pane-header__ctx">
              <span
                className={`size-2 shrink-0 rounded-full ${paneCluster ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              />
              <span className="truncate">
                {paneCluster ? contextDisplayName(paneCluster, contextProfiles[paneCluster]) : "No context"}
              </span>
              {paneActiveTab && (
                <small className="truncate">
                  {paneActiveTab.crd ? paneActiveTab.crd.kind : RESOURCE_LABELS[paneKind]}
                </small>
              )}
            </span>
            <span className="cat-pane-header__actions">
              <button
                type="button"
                className={`cat-pane-header__action${deck.linked ? " cat-pane-header__action--on" : ""}`}
                aria-label={deck.linked ? "Unlink panes" : "Link panes"}
                aria-pressed={deck.linked}
                title="Link panes: navigation mirrors across the deck"
                onClick={() => setDeck((d) => setLinked(d, !d.linked))}
              >
                <Link2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className="cat-pane-header__action"
                aria-label="Swap panes"
                title="Swap port and starboard"
                onClick={() => setDeck((d) => swapPanes(d))}
              >
                <ArrowLeftRight aria-hidden="true" />
              </button>
              <button
                type="button"
                className="cat-pane-header__action"
                aria-label={`Close ${side} pane`}
                title="Close this pane"
                onClick={() => setDeck((d) => closePane(d, p.id))}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          </header>
        )}
        {p.tabs.length > 0 ? (
          <>
            <ResourceTabs
              tabs={tabDescriptors}
              activeId={p.activeTabId}
              onActivate={(id) =>
                setDeck((d) => focusPane(updatePane(d, p.id, (x) => ({ ...x, activeTabId: id })), p.id))
              }
              onClose={(id) => closeView(p.id, id)}
              onCloseOthers={(id) => closeOtherViews(p.id, id)}
              onCloseToRight={(id) => closeViewsToRight(p.id, id)}
              onCloseAll={() => closeAllViews(p.id)}
              trailing={
                !split ? (
                  <IconButton
                    icon={Columns2}
                    label="Split the deck (⌘\)"
                    onClick={toggleSplit}
                  />
                ) : undefined
              }
            />
            {paneActiveTab && (
              <>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
                  {paneKind === "settings" ? (
                    <SettingsView
                      key={`${paneActiveTab.id}:${settingsSectionNonce}`}
                      initialSection={settingsInitialSection}
                      theme={theme}
                      onThemeNameChange={setThemeName}
                      onThemeModeChange={setThemeMode}
                      defaultNamespace={defaultNs}
                      onDefaultNamespaceChange={changeDefaultNamespace}
                      layout={layout}
                      onLayoutChange={changeWorkspaceLayout}
                      contextProfiles={contextProfiles}
                      onContextProfilesChange={changeContextProfiles}
                      kubeconfigFiles={kubeconfigFiles}
                      onKubeconfigFilesChange={changeKubeconfigFiles}
                      contextOrder={contextOrder}
                      onContextOrderChange={changeContextOrder}
                    />
                  ) : paneActiveTab.crd && paneCluster ? (
                    <CustomResourceBrowser
                      key={paneActiveTab.id}
                      context={paneCluster}
                      crd={paneActiveTab.crd}
                      query={query}
                      onQueryChange={setQuery}
                      detailDrawerWidth={layout.rightSidebarWidth}
                    />
                  ) : paneCluster && paneKind === "overview" ? (
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      <ClusterOverview
                        key={paneActiveTab.id}
                        context={paneCluster}
                        onOpenView={(kind) => openView(paneCluster, kind, { paneId: p.id })}
                      />
                    </div>
                  ) : paneCluster && paneKind === "portforwards" ? (
                    <PortForwardsView key={paneActiveTab.id} context={paneCluster} />
                  ) : paneCluster && paneKind === "helmreleases" ? (
                    <HelmReleasesView
                      key={paneActiveTab.id}
                      context={paneCluster}
                      detailDrawerWidth={layout.rightSidebarWidth}
                    />
                  ) : paneCluster && paneKind === "newresource" ? (
                    <NewResourceEditor
                      key={paneActiveTab.id}
                      context={paneCluster}
                      initialKind={paneActiveTab.create?.initialKind}
                    />
                  ) : paneCluster && paneKind === "editresource" && paneActiveTab.edit ? (
                    <EditResourceTab
                      key={paneActiveTab.id}
                      context={paneCluster}
                      kind={paneActiveTab.edit.kind}
                      namespace={paneActiveTab.edit.namespace}
                      name={paneActiveTab.edit.name}
                    />
                  ) : paneCluster ? (
                    <ResourceBrowser
                      key={paneActiveTab.id}
                      context={paneCluster}
                      kind={paneKind}
                      query={query}
                      onQueryChange={setQuery}
                      onOpenTerminal={(s) => openDock(p.id, "terminal", s)}
                      onOpenLogs={(s) => openDock(p.id, "logs", s)}
                      onOpenEdit={(kind, namespace, name) => openEditResource(kind, namespace, name, p.id)}
                      onOpenWorkloadLogs={(s) =>
                        openDock(p.id, "logs", {
                          context: s.context,
                          namespace: s.namespace,
                          workload: { kind: s.kind, name: s.name },
                        })
                      }
                      onOpenNew={(initialKind) => openNewResource(initialKind, p.id)}
                      onOpenResource={(target) => openLinkedResource(target, p.id)}
                      focus={paneActiveTab.focus}
                      initialNamespace={paneActiveTab.namespace ?? ""}
                      onNamespaceChange={(ns) => setTabNamespace(p.id, paneActiveTab.id, paneCluster, ns)}
                      detailDrawerWidth={layout.rightSidebarWidth}
                    />
                  ) : (
                    <LandingPage
                      onOpenContext={(ctx) => openView(ctx, "overview", { paneId: p.id })}
                      onOpenSettings={openSettings}
                      contextProfiles={contextProfiles}
                      kubeconfigFiles={kubeconfigFiles}
                      contextOrder={contextOrder}
                    />
                  )}
                </div>
                {p.dockSessions.length > 0 && (
                  <Dock
                    sessions={p.dockSessions}
                    activeId={p.activeDockId}
                    height={p.dockHeight}
                    onActivate={(id) =>
                      setDeck((d) => updatePane(d, p.id, (x) => ({ ...x, activeDockId: id })))
                    }
                    onCloseTab={(id) => closeDockTab(p.id, id)}
                    onClose={() => closeDock(p.id)}
                    onResize={(h) => setDeck((d) => updatePane(d, p.id, (x) => ({ ...x, dockHeight: h })))}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <LandingPage
            onOpenContext={(ctx) => openView(ctx, "overview", { paneId: p.id })}
            onOpenSettings={openSettings}
            contextProfiles={contextProfiles}
            kubeconfigFiles={kubeconfigFiles}
            contextOrder={contextOrder}
          />
        )}
      </section>
    );
  }

  const anyCluster = clusters.length > 0;

  return (
    <div
      className={`cat-app${anyCluster ? "" : " cat-app--no-cluster"}`}
      style={anyCluster ? { gridTemplateColumns: `75px ${sidebarWidth}px 1fr` } : undefined}
    >
      <ClusterHotbar
        openContext={activeCluster}
        onOpenContext={(ctx) => openView(ctx, "overview")}
        theme={theme}
        onToggleTheme={toggleThemeMode}
        onOpenSettings={openSettings}
        contextProfiles={contextProfiles}
        kubeconfigFiles={kubeconfigFiles}
        contextOrder={contextOrder}
      />
      {anyCluster && (
        <Sidebar
          clusters={clusters}
          activeCluster={activeCluster}
          activeKind={activeKind}
          activeCrd={activeTab?.crd ?? null}
          onSelect={(c, k) => openView(c, k)}
          onSelectCrd={(c, crd) => openCrdView(c, crd)}
          contextProfiles={contextProfiles}
          width={sidebarWidth}
          onResize={setSidebarWidth}
        />
      )}
      <div className="cat-main">
        {split ? (
          <div className="cat-deck" ref={deckElRef}>
            {renderPane(deck.panes[0], 0)}
            <div
              className={`cat-pane-divider${dividerDragging ? " cat-pane-divider--dragging" : ""}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
              onMouseDown={startDividerDrag}
              onDoubleClick={() => setDeck((d) => setRatio(d, 0.5))}
            />
            {renderPane(deck.panes[1], 1)}
          </div>
        ) : (
          renderPane(deck.panes[0], 0)
        )}
      </div>
      <StatusBar
        panes={deck.panes.map((p, i) => ({
          context: activeTabOf(p)?.cluster ?? null,
          focused: p.id === deck.focusedPaneId,
          side: i === 0 ? ("port" as const) : ("starboard" as const),
        }))}
        activeLabel={
          activeTab ? (activeTab.crd ? activeTab.crd.kind : RESOURCE_LABELS[activeKind]) : undefined
        }
        tabCount={pane.tabs.length}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        context={activeCluster}
        onOpenView={(kind) => (kind === "settings" ? openSettings() : activeCluster && openView(activeCluster, kind))}
        onOpenResource={openResource}
        onOpenCrd={(crd) => activeCluster && openCrdView(activeCluster, crd)}
      />
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
