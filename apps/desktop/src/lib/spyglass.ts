import { invokeCapability, type Invoker } from "../transport/transport";
import { validSavedPath, type SpyglassSource, type SpyglassTool } from "./settings";

export const SPYGLASS_LABELS: Record<SpyglassTool, string> = {
  kiali: "Kiali",
  grafana: "Grafana",
};

/** A tool found by `obs.discover`. */
export interface DiscoveredTool {
  tool: string;
  namespace: string;
  service: string;
  port: number;
  portName?: string | null;
  ingressUrl?: string | null;
}

/** What `obs.probe` reports about a URL. */
export interface ProbeResult {
  ok: boolean;
  status?: number | null;
  frameBlocked: boolean;
  authRedirect: boolean;
  error?: string | null;
}

export interface SpyglassForward {
  context: string;
  namespace: string;
  service: string;
  port: number;
  localPort: number;
}

export interface DiscoverOutcome {
  tools?: DiscoveredTool[];
  meshNamespaces?: string[];
  error?: string;
}

/** Find observability tools (and mesh namespaces) via `obs.discover`. */
export async function discoverTools(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<DiscoverOutcome> {
  try {
    const out = await invoke<{ tools: DiscoveredTool[]; meshNamespaces: string[] }>(
      "obs.discover",
      { context },
    );
    return { tools: out.tools, meshNamespaces: out.meshNamespaces };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Probe a URL's reachability and embedding headers via `obs.probe`. */
export async function probeUrl(
  url: string,
  invoke: Invoker = invokeCapability,
): Promise<{ probe?: ProbeResult; error?: string }> {
  try {
    const probe = await invoke<ProbeResult>("obs.probe", { url });
    return { probe };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Start (or reuse) a keyed service forward via `net.portForwardStart`. */
export async function spyglassForwardStart(
  context: string,
  namespace: string,
  service: string,
  port: number,
  invoke: Invoker = invokeCapability,
): Promise<{ localPort?: number; reused?: boolean; error?: string }> {
  try {
    const out = await invoke<{ localPort: number; reused: boolean }>("net.portForwardStart", {
      context,
      namespace,
      service,
      port,
    });
    return { localPort: out.localPort, reused: out.reused };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Stop a keyed service forward via `net.portForwardStop`. */
export async function spyglassForwardStop(
  forward: Omit<SpyglassForward, "localPort">,
  invoke: Invoker = invokeCapability,
): Promise<{ stopped?: boolean; error?: string }> {
  try {
    const out = await invoke<{ stopped: boolean }>("net.portForwardStop", { ...forward });
    return { stopped: out.stopped };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List keyed service forwards via `net.portForwardList`. */
export async function listSpyglassForwards(
  invoke: Invoker = invokeCapability,
): Promise<{ forwards?: SpyglassForward[]; error?: string }> {
  try {
    const out = await invoke<{ forwards: SpyglassForward[] }>("net.portForwardList", {});
    return { forwards: out.forwards };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Start (or reuse) the embeddable relay for a service via `obs.embedStart`. */
export async function embedStart(
  context: string,
  namespace: string,
  service: string,
  port: number,
  invoke: Invoker = invokeCapability,
): Promise<{ url?: string; localPort?: number; reused?: boolean; error?: string }> {
  try {
    const out = await invoke<{ url: string; localPort: number; reused: boolean }>(
      "obs.embedStart",
      { context, namespace, service, port },
    );
    return { url: out.url, localPort: out.localPort, reused: out.reused };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Stop an embed relay (and its tunnel) via `obs.embedStop`. */
export async function embedStop(
  forward: Omit<SpyglassForward, "localPort">,
  invoke: Invoker = invokeCapability,
): Promise<{ stopped?: boolean; error?: string }> {
  try {
    const out = await invoke<{ stopped: boolean }>("obs.embedStop", { ...forward });
    return { stopped: out.stopped };
  } catch (e) {
    return { error: String(e) };
  }
}

/** The discovered row for `tool`, if any (rows arrive ranked; first wins). */
export function pickDiscovered(tools: DiscoveredTool[], tool: SpyglassTool): DiscoveredTool | null {
  return tools.find((t) => t.tool === tool) ?? null;
}

/**
 * Kiali's traffic-graph console route: versioned-app graph over the mesh
 * namespaces with traffic animation enabled — the view you actually want
 * when you open a mesh tool, not an empty overview.
 */
export function kialiDefaultPath(prefix: string, meshNamespaces: string[]): string {
  const params = new URLSearchParams({
    graphType: "versionedApp",
    duration: "600",
    refresh: "15000",
    animation: "true",
  });
  if (meshNamespaces.length > 0) {
    params.set("namespaces", meshNamespaces.join(","));
  }
  return `${prefix}/console/graph/namespaces/?${params.toString()}`;
}

/** How an embed resolved: everything the view needs to render an iframe. */
export interface SpyglassEmbed {
  kind: "embed";
  /** Loopback base of the embed relay, e.g. `http://127.0.0.1:52123`. */
  base: string;
  /** Path the iframe should open on (saved view or the tool default). */
  initialPath: string;
  /** The tool's default view (Reset view returns here). */
  defaultPath: string;
  target: { namespace: string; service: string; port: number };
  meshNamespaces: string[];
}

export interface SpyglassExternal {
  kind: "external";
  /** Configured external URL — frame-blocked, so it opens in the browser. */
  url: string;
}

export type SpyglassPrep = SpyglassEmbed | SpyglassExternal;
export type SpyglassPrepOutcome = { prep?: SpyglassPrep; error?: string };

// Remember discovery per context so re-opens skip the cluster scan.
const discoveredCache = new Map<string, { tools: DiscoveredTool[]; meshNamespaces: string[] }>();

/** Test hook: forget cached discovery results. */
export function resetSpyglassCache(): void {
  discoveredCache.clear();
}

const PROBE_RETRIES = 3;
const PROBE_RETRY_DELAY_MS = 700;

async function probeWithRetry(url: string, invoke: Invoker): Promise<ProbeResult | undefined> {
  let last: ProbeResult | undefined;
  for (let attempt = 0; attempt < PROBE_RETRIES; attempt++) {
    const { probe } = await probeUrl(url, invoke);
    last = probe ?? last;
    if (probe?.ok) return probe;
    if (attempt < PROBE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, PROBE_RETRY_DELAY_MS));
    }
  }
  return last;
}

async function discoverCached(context: string, invoke: Invoker) {
  const hit = discoveredCache.get(context);
  if (hit) return { ...hit };
  const { tools, meshNamespaces, error } = await discoverTools(context, invoke);
  if (error) return { error };
  const entry = { tools: tools ?? [], meshNamespaces: meshNamespaces ?? [] };
  discoveredCache.set(context, entry);
  return { ...entry };
}

/**
 * Prepare `tool` for embedding against `context`: resolve where it lives
 * (pinned or discovered), start the embed relay, find the tool's path
 * prefix, and wait until the relay answers. URL-mode sources come back as
 * `external` — a remote origin still sends its frame blockers, so it cannot
 * be embedded.
 */
export async function prepareEmbed(
  tool: SpyglassTool,
  context: string | null,
  source: SpyglassSource,
  invoke: Invoker = invokeCapability,
): Promise<SpyglassPrepOutcome> {
  const label = SPYGLASS_LABELS[tool];
  if (source.mode === "url") {
    return { prep: { kind: "external", url: source.url } };
  }
  if (!context) {
    return { error: `Open a cluster first — ${label} is looked up in the focused context.` };
  }

  let target: { namespace: string; service: string; port: number };
  let meshNamespaces: string[] = [];
  if (source.mode === "service") {
    target = { namespace: source.namespace, service: source.service, port: source.port };
    if (tool === "kiali") {
      const found = await discoverCached(context, invoke);
      meshNamespaces = found.meshNamespaces ?? [];
    }
  } else {
    const found = await discoverCached(context, invoke);
    if (found.error) return { error: found.error };
    const row = pickDiscovered(found.tools ?? [], tool);
    if (!row) {
      return {
        error: `No ${label} service found in ${context}. Pin one in Settings → Observability.`,
      };
    }
    target = { namespace: row.namespace, service: row.service, port: row.port };
    meshNamespaces = found.meshNamespaces ?? [];
  }

  const { url: base, error } = await embedStart(
    context,
    target.namespace,
    target.service,
    target.port,
    invoke,
  );
  if (error || !base) {
    return { error: error ?? `Embed relay for ${target.service} failed to start.` };
  }

  // Path prefix: kiali usually serves under /kiali (its web_root); fall back
  // to the root for installs that serve at /.
  let prefix = "";
  if (tool === "kiali") {
    const { probe } = await probeUrl(`${base}/kiali/`, invoke);
    prefix = probe?.ok && probe.status === 200 ? "/kiali" : "";
  }
  const defaultPath = tool === "kiali" ? kialiDefaultPath(prefix, meshNamespaces) : "/";
  const initialPath = validSavedPath(source.savedPath) ? source.savedPath : defaultPath;

  const probe = await probeWithRetry(`${base}${tool === "kiali" ? `${prefix}/` : "/"}`, invoke);
  if (probe && !probe.ok) {
    return {
      error: `${label} is relayed at ${base} but not answering: ${probe.error ?? "no response"}`,
    };
  }

  return {
    prep: { kind: "embed", base, initialPath, defaultPath, target, meshNamespaces },
  };
}
