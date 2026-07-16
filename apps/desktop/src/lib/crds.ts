import { invokeCapability, type Invoker } from "../transport/transport";

/** A discovered CustomResourceDefinition, enough to list/view its instances. */
export interface CrdRef {
  name: string;
  group: string;
  version: string;
  kind: string;
  plural: string;
  namespaced: boolean;
}

export interface CustomRow {
  name: string;
  namespace: string;
  age: string;
}

/** Discover installed CRDs in a cluster via `k8s.listCRDs`. */
export async function listCrds(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<{ crds?: CrdRef[]; error?: string }> {
  try {
    const out = await invoke<{ crds: CrdRef[] }>("k8s.listCRDs", { context });
    return { crds: out.crds };
  } catch (e) {
    return { error: String(e) };
  }
}

// One in-flight CRD discovery per context, shared by the sidebar's curated
// (KEDA / Karpenter) groups and the generic Custom Resources group — so
// opening several of them doesn't re-scan the cluster each time.
const crdCache = new Map<string, Promise<{ crds?: CrdRef[]; error?: string }>>();

/** `listCrds` memoized per context (one discovery shared across callers). */
export function listCrdsCached(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<{ crds?: CrdRef[]; error?: string }> {
  const hit = crdCache.get(context);
  if (hit) return hit;
  const p = listCrds(context, invoke).then((out) => {
    // Don't cache failures — let the next open retry.
    if (out.error) crdCache.delete(context);
    return out;
  });
  crdCache.set(context, p);
  return p;
}

/** Forget a context's cached CRD discovery (e.g. after reconnect). */
export function resetCrdCache(context?: string): void {
  if (context) crdCache.delete(context);
  else crdCache.clear();
}

/**
 * Match a CRD to a curated tool by API group suffix. KEDA CRDs live under
 * `keda.sh`; Karpenter under `karpenter.sh` and `karpenter.k8s.aws`.
 */
export function crdGroupMatches(crd: CrdRef, groups: string[]): boolean {
  return groups.some((g) => crd.group === g || crd.group.endsWith(`.${g}`));
}

/** List instances of a custom resource via `k8s.listCustomResource`. */
export async function listCustomResource(
  context: string,
  crd: CrdRef,
  namespace: string | null,
  invoke: Invoker = invokeCapability,
): Promise<{ items?: CustomRow[]; error?: string }> {
  try {
    const out = await invoke<{ items: CustomRow[] }>("k8s.listCustomResource", {
      context,
      group: crd.group,
      version: crd.version,
      plural: crd.plural,
      kind: crd.kind,
      namespaced: crd.namespaced,
      namespace: namespace ?? "",
    });
    return { items: out.items };
  } catch (e) {
    return { error: String(e) };
  }
}
