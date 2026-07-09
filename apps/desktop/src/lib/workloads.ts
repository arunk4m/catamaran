import { invokeCapability, type Invoker } from "../transport/transport";

export interface PodSummary {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  node: string;
  age: string;
}

export interface NamespacesOutcome {
  namespaces?: string[];
  error?: string;
}

export interface PodsOutcome {
  pods?: PodSummary[];
  error?: string;
}

export interface LogsOutcome {
  logs?: string;
  error?: string;
}

export interface DeploymentSummary {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  age: string;
}

export interface ServiceSummary {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: string;
  age: string;
}

/** List namespaces in a connected context via `k8s.listNamespaces`. */
export async function listNamespaces(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<NamespacesOutcome> {
  try {
    const out = await invoke<{ namespaces: string[] }>("k8s.listNamespaces", { context });
    return { namespaces: out.namespaces };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List pods in a namespace of a connected context via `k8s.listPods`. */
export async function listPods(
  context: string,
  namespace: string,
  invoke: Invoker = invokeCapability,
): Promise<PodsOutcome> {
  try {
    const out = await invoke<{ pods: PodSummary[] }>("k8s.listPods", { context, namespace });
    return { pods: out.pods };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Pod phase tallies for a namespace ("" = cluster-wide). */
export interface PodCounts {
  total: number;
  running: number;
  pending: number;
  succeeded: number;
  failed: number;
  unknown: number;
}

/**
 * Count pods by phase via `k8s.podCounts` — dashboard-cheap: the tally happens
 * in the backend, so large clusters ship five integers instead of every pod row.
 */
export async function podCounts(
  context: string,
  namespace: string,
  invoke: Invoker = invokeCapability,
): Promise<{ counts?: PodCounts; error?: string }> {
  try {
    const counts = await invoke<PodCounts>("k8s.podCounts", { context, namespace });
    return { counts };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List deployments in a namespace via `k8s.listDeployments`. */
export async function listDeployments(
  context: string,
  namespace: string,
  invoke: Invoker = invokeCapability,
): Promise<{ deployments?: DeploymentSummary[]; error?: string }> {
  try {
    const out = await invoke<{ deployments: DeploymentSummary[] }>("k8s.listDeployments", {
      context,
      namespace,
    });
    return { deployments: out.deployments };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List services in a namespace via `k8s.listServices`. */
export async function listServices(
  context: string,
  namespace: string,
  invoke: Invoker = invokeCapability,
): Promise<{ services?: ServiceSummary[]; error?: string }> {
  try {
    const out = await invoke<{ services: ServiceSummary[] }>("k8s.listServices", {
      context,
      namespace,
    });
    return { services: out.services };
  } catch (e) {
    return { error: String(e) };
  }
}

export interface ReplicaSetSummary {
  name: string;
  revision: string;
  desired: number;
  ready: number;
  current: number;
  age: string;
}

export interface PodMetric {
  name: string;
  namespace: string;
  cpuMillicores: number;
  memoryMiB: number;
}

/** ReplicaSets owned by a Deployment (its revisions) via `k8s.listReplicaSets`. */
export async function listReplicaSets(
  context: string,
  namespace: string,
  ownerName: string,
  invoke: Invoker = invokeCapability,
): Promise<{ replicasets?: ReplicaSetSummary[]; error?: string }> {
  try {
    const out = await invoke<{ replicasets: ReplicaSetSummary[] }>("k8s.listReplicaSets", {
      context,
      namespace,
      ownerName,
    });
    return { replicasets: out.replicasets };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Pods matching a label selector (a workload's pods) via `k8s.podsForSelector`. */
export async function podsForSelector(
  context: string,
  namespace: string,
  selector: Record<string, string>,
  invoke: Invoker = invokeCapability,
): Promise<PodsOutcome> {
  try {
    const out = await invoke<{ pods: PodSummary[] }>("k8s.podsForSelector", {
      context,
      namespace,
      selector,
    });
    return { pods: out.pods };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Per-pod CPU/memory usage in a namespace via `k8s.podMetrics`. */
export async function podMetrics(
  context: string,
  namespace: string,
  invoke: Invoker = invokeCapability,
): Promise<{ metrics?: PodMetric[]; error?: string }> {
  try {
    const out = await invoke<{ metrics: PodMetric[] }>("k8s.podMetrics", { context, namespace });
    return { metrics: out.metrics };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Delete a pod via `k8s.deletePod` (destructive). */
export async function deletePod(
  context: string,
  namespace: string,
  pod: string,
  invoke: Invoker = invokeCapability,
): Promise<{ deleted?: boolean; error?: string }> {
  try {
    const out = await invoke<{ deleted: boolean }>("k8s.deletePod", { context, namespace, pod });
    return { deleted: out.deleted };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Evict a pod gracefully via `k8s.evictPod` (respects PDBs; destructive). */
export async function evictPod(
  context: string,
  namespace: string,
  pod: string,
  invoke: Invoker = invokeCapability,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const out = await invoke<{ ok: boolean }>("k8s.evictPod", { context, namespace, pod });
    return { ok: out.ok };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Log-window options shared by snapshot fetches and live tails. */
export interface LogWindowOptions {
  /** Trailing lines to fetch (ignored when sinceSeconds is set). */
  tailLines?: number;
  /** Read from this many seconds ago instead of a line count. */
  sinceSeconds?: number;
  /** Prefix each line with its RFC3339 timestamp. */
  timestamps?: boolean;
  /** Read the previous (crashed/restarted) container instance. */
  previous?: boolean;
}

/** Fetch recent logs for a pod (optionally a specific container) via `k8s.podLogs`. */
export async function podLogs(
  context: string,
  namespace: string,
  pod: string,
  invoke: Invoker = invokeCapability,
  container?: string,
  options: LogWindowOptions = {},
): Promise<LogsOutcome> {
  try {
    const out = await invoke<{ logs: string }>("k8s.podLogs", {
      context,
      namespace,
      pod,
      ...(container ? { container } : {}),
      ...(options.tailLines != null ? { tail_lines: options.tailLines } : {}),
      ...(options.sinceSeconds != null ? { since_seconds: options.sinceSeconds } : {}),
      ...(options.timestamps ? { timestamps: true } : {}),
      ...(options.previous ? { previous: true } : {}),
    });
    return { logs: out.logs };
  } catch (e) {
    return { error: String(e) };
  }
}
