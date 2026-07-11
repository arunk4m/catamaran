// Small persisted-settings helpers (localStorage). Survives app restarts.

const CLUSTER_NS_KEY = "catamaran.clusterNamespaces";
const DEFAULT_NS_KEY = "catamaran.defaultNamespace";
const WORKSPACE_LAYOUT_KEY = "catamaran.workspaceLayout";
const CONTEXT_PROFILES_KEY = "catamaran.contextProfiles";
const KUBECONFIG_FILES_KEY = "catamaran.kubeconfigFiles";
const CONTEXT_ORDER_KEY = "catamaran.contextOrder";
const REQUEST_TIMEOUT_KEY = "catamaran.requestTimeoutSecs";

/** Per-request timeout budget (connect + list/get/apply), in seconds. */
export const REQUEST_TIMEOUT = { MIN: 1, MAX: 30, DEFAULT: 8 } as const;

/** Clamp any value to the supported timeout range; fall back to the default. */
export function clampTimeoutSecs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return REQUEST_TIMEOUT.DEFAULT;
  return Math.round(Math.max(REQUEST_TIMEOUT.MIN, Math.min(REQUEST_TIMEOUT.MAX, n)));
}

/** The persisted request timeout in seconds, or the default when unset/invalid. */
export function getRequestTimeoutSecs(): number {
  try {
    const raw = stored(REQUEST_TIMEOUT_KEY);
    return raw === null ? REQUEST_TIMEOUT.DEFAULT : clampTimeoutSecs(JSON.parse(raw));
  } catch {
    return REQUEST_TIMEOUT.DEFAULT;
  }
}

/** Persist the request timeout (clamped). Returns the clamped value stored. */
export function setRequestTimeoutSecs(secs: number): number {
  const clamped = clampTimeoutSecs(secs);
  try {
    localStorage.setItem(REQUEST_TIMEOUT_KEY, JSON.stringify(clamped));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
  return clamped;
}

function stored(key: string): string | null {
  return localStorage.getItem(key);
}

export type ContextLogo = "initials" | "cluster" | "cloud" | "shield" | "database" | "globe" | "custom";

export interface ContextProfile {
  displayName?: string;
  shortName?: string;
  color?: string;
  logo?: ContextLogo;
  logoUrl?: string;
}

export type ContextProfiles = Record<string, ContextProfile>;

export interface WorkspaceLayoutSettings {
  leftSidebarWidth: number;
  rightSidebarWidth: number;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutSettings = {
  leftSidebarWidth: 208,
  rightSidebarWidth: 480,
};

function boundedWidth(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : fallback;
}

/** Last-selected namespace per cluster, remembered across restarts. */
export function loadClusterNamespaces(): Record<string, string> {
  try {
    const raw = stored(CLUSTER_NS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveClusterNamespaces(map: Record<string, string>): void {
  try {
    localStorage.setItem(CLUSTER_NS_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

/** Global fallback namespace for a cluster with no remembered selection ("" = all). */
export function getDefaultNamespace(): string {
  try {
    return stored(DEFAULT_NS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDefaultNamespace(ns: string): void {
  try {
    localStorage.setItem(DEFAULT_NS_KEY, ns);
  } catch {
    // ignore
  }
}

export function loadWorkspaceLayout(): WorkspaceLayoutSettings {
  try {
    const raw = stored(WORKSPACE_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_WORKSPACE_LAYOUT };
    const value = JSON.parse(raw) as Partial<WorkspaceLayoutSettings>;
    return {
      leftSidebarWidth: boundedWidth(value.leftSidebarWidth, DEFAULT_WORKSPACE_LAYOUT.leftSidebarWidth, 160, 420),
      rightSidebarWidth: boundedWidth(value.rightSidebarWidth, DEFAULT_WORKSPACE_LAYOUT.rightSidebarWidth, 320, 960),
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_LAYOUT };
  }
}

export function saveWorkspaceLayout(layout: WorkspaceLayoutSettings): void {
  try {
    localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function loadContextProfiles(): ContextProfiles {
  try {
    const raw = stored(CONTEXT_PROFILES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ContextProfiles;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveContextProfiles(profiles: ContextProfiles): void {
  try {
    localStorage.setItem(CONTEXT_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function contextDisplayName(context: string, profile?: ContextProfile): string {
  return profile?.displayName?.trim() || context;
}

export function loadKubeconfigFiles(): string[] {
  try {
    const parsed = JSON.parse(stored(KUBECONFIG_FILES_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((path): path is string => typeof path === "string" && path.trim().length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function saveKubeconfigFiles(paths: string[]): void {
  try {
    localStorage.setItem(KUBECONFIG_FILES_KEY, JSON.stringify([...new Set(paths)]));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

const HIDDEN_COLUMNS_KEY = "catamaran.hiddenColumns";

/** Column keys the user has hidden for a given table view (keyed by view id). */
export function loadHiddenColumns(view: string): string[] {
  try {
    const parsed = JSON.parse(stored(HIDDEN_COLUMNS_KEY) ?? "{}") as unknown;
    const map = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const keys = map[view];
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Persist the hidden column keys for a view, merging into the per-view map. */
export function saveHiddenColumns(view: string, keys: string[]): void {
  try {
    const parsed = JSON.parse(stored(HIDDEN_COLUMNS_KEY) ?? "{}") as unknown;
    const map = parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
    map[view] = [...new Set(keys)];
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function loadContextOrder(): string[] {
  try {
    const parsed = JSON.parse(stored(CONTEXT_ORDER_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((name): name is string => typeof name === "string" && name.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function saveContextOrder(order: string[]): void {
  try {
    localStorage.setItem(CONTEXT_ORDER_KEY, JSON.stringify([...new Set(order)]));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

const AWS_PORTAL_KEY = "catamaran.awsPortalUrl";

/**
 * The configured AWS access-portal URL ("" = not configured). Only http(s)
 * values are accepted; anything else is treated as unset.
 */
export function loadAwsPortalUrl(): string {
  try {
    const raw = stored(AWS_PORTAL_KEY) ?? "";
    return /^https?:\/\//.test(raw) ? raw : "";
  } catch {
    return "";
  }
}

export function saveAwsPortalUrl(url: string): void {
  try {
    localStorage.setItem(AWS_PORTAL_KEY, url.trim());
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

const OBSERVABILITY_KEY = "catamaran.observability";

/** The observability tools the spyglass can open. */
export type SpyglassTool = "kiali" | "grafana" | "airflow" | "redpanda" | "temporal" | "tusklens";

/** Static metadata for a spyglass tool — the single source of truth. */
export interface SpyglassToolMeta {
  id: SpyglassTool;
  label: string;
  blurb: string;
  /** True for the mesh graph tool (Kiali): opens on the animated traffic graph. */
  mesh?: boolean;
  /**
   * Template used when a tool is pinned to a service in Settings (and shown as
   * a hint). Auto-detect overrides these per cluster; they reflect how the
   * tools ship on Tuskira EKS.
   */
  defaultTarget: { namespace: string; service: string; port: number };
}

/** Known tools in display order (mirrors the backend TOOL_CATALOG). */
export const SPYGLASS_CATALOG: SpyglassToolMeta[] = [
  {
    id: "kiali",
    label: "Kiali",
    blurb: "Service mesh topology and traffic",
    mesh: true,
    defaultTarget: { namespace: "istio-system", service: "kiali", port: 20001 },
  },
  {
    id: "grafana",
    label: "Grafana",
    blurb: "Metrics dashboards",
    defaultTarget: { namespace: "infra", service: "grafana", port: 80 },
  },
  {
    id: "airflow",
    label: "Airflow",
    blurb: "Workflow DAGs and runs",
    defaultTarget: { namespace: "airflow", service: "airflow-webserver", port: 8080 },
  },
  {
    id: "redpanda",
    label: "Redpanda",
    blurb: "Streaming topics and console",
    defaultTarget: { namespace: "infra", service: "redpanda-console", port: 8080 },
  },
  {
    id: "temporal",
    label: "Temporal",
    blurb: "Workflow executions",
    defaultTarget: { namespace: "temporal", service: "temporal-web", port: 8080 },
  },
  {
    id: "tusklens",
    label: "Tusk Lens",
    blurb: "Tusk observability",
    defaultTarget: { namespace: "default", service: "tusk-lens-frontend", port: 3000 },
  },
];

export const SPYGLASS_TOOL_IDS: SpyglassTool[] = SPYGLASS_CATALOG.map((t) => t.id);

export function spyglassMeta(tool: SpyglassTool): SpyglassToolMeta {
  return SPYGLASS_CATALOG.find((t) => t.id === tool) ?? SPYGLASS_CATALOG[0];
}

/**
 * Where a tool lives: `auto` discovers it in the focused cluster on open,
 * `service` pins a namespace/service/port to port-forward, `url` uses an
 * already-exposed address as-is. `savedPath` is an in-tool view (path +
 * query, e.g. a Kiali graph) the embedded page reopens on.
 */
export type SpyglassSource = (
  | { mode: "auto" }
  | { mode: "service"; namespace: string; service: string; port: number }
  | { mode: "url"; url: string }
) & { savedPath?: string };

export type ObservabilityConfig = Record<SpyglassTool, SpyglassSource>;

export const DEFAULT_OBSERVABILITY: ObservabilityConfig = Object.fromEntries(
  SPYGLASS_TOOL_IDS.map((id) => [id, { mode: "auto" }]),
) as ObservabilityConfig;

/** A savable in-tool view: an absolute path (+ query/hash), never a full URL. */
export function validSavedPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("://") &&
    value.length <= 2048
  );
}

function sanitizeSource(value: unknown): SpyglassSource {
  let source: SpyglassSource = { mode: "auto" };
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (
      v.mode === "service" &&
      typeof v.namespace === "string" &&
      typeof v.service === "string" &&
      typeof v.port === "number" &&
      Number.isInteger(v.port) &&
      v.port > 0 &&
      v.port <= 65535
    ) {
      source = { mode: "service", namespace: v.namespace, service: v.service, port: v.port };
    } else if (v.mode === "url" && typeof v.url === "string" && /^https?:\/\//.test(v.url)) {
      source = { mode: "url", url: v.url };
    }
    if (validSavedPath(v.savedPath)) {
      source.savedPath = v.savedPath;
    }
  }
  return source;
}

export function loadObservabilityConfig(): ObservabilityConfig {
  try {
    const raw = stored(OBSERVABILITY_KEY);
    if (!raw) return { ...DEFAULT_OBSERVABILITY };
    const value = JSON.parse(raw) as Partial<Record<SpyglassTool, unknown>>;
    return Object.fromEntries(
      SPYGLASS_TOOL_IDS.map((id) => [id, sanitizeSource(value[id])]),
    ) as ObservabilityConfig;
  } catch {
    return { ...DEFAULT_OBSERVABILITY };
  }
}

export function saveObservabilityConfig(config: ObservabilityConfig): void {
  try {
    localStorage.setItem(OBSERVABILITY_KEY, JSON.stringify(config));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

const DECK_KEY = "catamaran.deck";

/** Persisted split-screen deck layout: split on/off, pane ratio, linked nav. */
export interface DeckLayoutSettings {
  split: boolean;
  ratio: number;
  linked: boolean;
}

export const DEFAULT_DECK_LAYOUT: DeckLayoutSettings = { split: false, ratio: 0.5, linked: false };

function boundedRatio(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0.2, Math.min(0.8, value))
    : DEFAULT_DECK_LAYOUT.ratio;
}

export function loadDeckLayout(): DeckLayoutSettings {
  try {
    const raw = stored(DECK_KEY);
    if (!raw) return { ...DEFAULT_DECK_LAYOUT };
    const value = JSON.parse(raw) as Partial<DeckLayoutSettings>;
    return {
      split: value.split === true,
      ratio: boundedRatio(value.ratio),
      linked: value.linked === true,
    };
  } catch {
    return { ...DEFAULT_DECK_LAYOUT };
  }
}

export function saveDeckLayout(layout: DeckLayoutSettings): void {
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(layout));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

/** Which release channel the in-app updater follows. */
export type UpdateChannel = "stable" | "dev";

const UPDATE_CHANNEL_KEY = "catamaran.updateChannel";

export function loadUpdateChannel(): UpdateChannel {
  try {
    const value = stored(UPDATE_CHANNEL_KEY);
    return value === "dev" ? "dev" : "stable";
  } catch {
    return "stable";
  }
}

export function saveUpdateChannel(channel: UpdateChannel): void {
  try {
    localStorage.setItem(UPDATE_CHANNEL_KEY, channel);
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function orderContexts<T extends { name: string }>(contexts: T[], order: string[]): T[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return contexts
    .map((context, index) => ({ context, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.context.name);
      const rightRank = rank.get(right.context.name);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return left.index - right.index;
    })
    .map(({ context }) => context);
}

const MCP_SETTINGS_KEY = "catamaran.mcp";

/** In-app MCP HTTP server preferences. */
export interface McpSettings {
  /** Run the loopback MCP HTTP server while the app is open. */
  enabled: boolean;
  /** Port for the loopback server. */
  port: number;
}

export const DEFAULT_MCP_SETTINGS: McpSettings = { enabled: false, port: 8765 };

export function loadMcpSettings(): McpSettings {
  try {
    const raw = stored(MCP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MCP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<McpSettings>;
    const port = Number(parsed.port);
    return {
      enabled: parsed.enabled === true,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_MCP_SETTINGS.port,
    };
  } catch {
    return { ...DEFAULT_MCP_SETTINGS };
  }
}

export function saveMcpSettings(settings: McpSettings): void {
  try {
    localStorage.setItem(MCP_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}
