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
