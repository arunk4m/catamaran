import { invokeCapability, invokeCommand, type Invoker } from "../transport/transport";
import type { SpyglassSource, SpyglassTool } from "./settings";

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

/** Find observability tools in a context via `obs.discover`. */
export async function discoverTools(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<{ tools?: DiscoveredTool[]; error?: string }> {
  try {
    const out = await invoke<{ tools: DiscoveredTool[] }>("obs.discover", { context });
    return { tools: out.tools };
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

/** The discovered row for `tool`, if any (first match wins). */
export function pickDiscovered(tools: DiscoveredTool[], tool: SpyglassTool): DiscoveredTool | null {
  return tools.find((t) => t.tool === tool) ?? null;
}

/** Window title for a tool opened against a context. */
export function spyglassTitle(tool: SpyglassTool, context: string | null): string {
  const label = SPYGLASS_LABELS[tool];
  return context ? `${label} — ${context}` : label;
}

/** How an open resolved: the URL plus how we got there. */
export interface SpyglassOpening {
  url: string;
  via: "url" | "forward";
  localPort?: number;
  probe?: ProbeResult;
}

export type SpyglassOutcome = { opening?: SpyglassOpening; error?: string };

// Remember what discovery found per (tool, context) so re-opens skip the scan.
const discoveredCache = new Map<string, DiscoveredTool>();

/** Test hook: forget cached discovery results. */
export function resetSpyglassCache(): void {
  discoveredCache.clear();
}

/** Give a just-started forward a beat to come up before probing. */
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

/**
 * Resolve where `tool` should open for `context`: a configured URL is used
 * as-is; otherwise the tool's service (configured or discovered) is
 * port-forwarded and the local address is probed until it answers.
 */
export async function resolveSpyglassOpening(
  tool: SpyglassTool,
  context: string | null,
  source: SpyglassSource,
  invoke: Invoker = invokeCapability,
): Promise<SpyglassOutcome> {
  const label = SPYGLASS_LABELS[tool];
  if (source.mode === "url") {
    const { probe } = await probeUrl(source.url, invoke);
    return { opening: { url: source.url, via: "url", probe } };
  }

  if (!context) {
    return { error: `Open a cluster first — ${label} is looked up in the focused context.` };
  }

  let target: { namespace: string; service: string; port: number };
  if (source.mode === "service") {
    target = source;
  } else {
    const cacheKey = `${tool}:${context}`;
    let found = discoveredCache.get(cacheKey) ?? null;
    if (!found) {
      const { tools, error } = await discoverTools(context, invoke);
      if (error) return { error };
      found = pickDiscovered(tools ?? [], tool);
      if (found) discoveredCache.set(cacheKey, found);
    }
    if (!found) {
      return {
        error: `No ${label} service found in ${context}. Pin one in Settings → Observability.`,
      };
    }
    target = found;
  }

  const { localPort, error } = await spyglassForwardStart(
    context,
    target.namespace,
    target.service,
    target.port,
    invoke,
  );
  if (error || localPort == null) {
    return { error: error ?? `Port-forward to ${target.service} failed.` };
  }

  const url = `http://127.0.0.1:${localPort}`;
  const probe = await probeWithRetry(url, invoke);
  if (probe && !probe.ok) {
    return {
      error: `${label} is forwarded to ${url} but not answering: ${probe.error ?? "no response"}`,
    };
  }
  return { opening: { url, via: "forward", localPort, probe } };
}

/**
 * Open `tool` in its dedicated window: resolve the URL (forwarding if
 * needed), then hand it to the shell. Returns the opening for status text.
 */
export async function openSpyglassTool(
  tool: SpyglassTool,
  context: string | null,
  source: SpyglassSource,
  invoke: Invoker = invokeCapability,
  command: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> = invokeCommand,
): Promise<SpyglassOutcome> {
  const outcome = await resolveSpyglassOpening(tool, context, source, invoke);
  if (!outcome.opening) return outcome;
  try {
    await command("open_tool_window", {
      tool,
      url: outcome.opening.url,
      title: spyglassTitle(tool, context),
    });
  } catch (e) {
    return { error: String(e) };
  }
  return outcome;
}
