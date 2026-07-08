import { invokeCapability, type Invoker } from "../transport/transport";

export interface HelmReleaseSummary {
  name: string;
  namespace: string;
  revision: number;
  status: string;
  chart: string;
  chartVersion: string;
  appVersion: string;
  updated: string;
}

export interface HelmRevision {
  revision: number;
  status: string;
  updated: string;
  chartVersion: string;
  description: string;
}

export interface HelmReleaseDetail extends HelmReleaseSummary {
  valuesYaml: string;
  manifest: string;
  notes: string;
  history: HelmRevision[];
}

/** List installed Helm releases (latest revision each) via `k8s.listHelmReleases`. */
export async function listHelmReleases(
  context: string,
  namespace: string | null = null,
  invoke: Invoker = invokeCapability,
): Promise<{ releases?: HelmReleaseSummary[]; error?: string }> {
  try {
    const out = await invoke<{ releases: HelmReleaseSummary[] }>("k8s.listHelmReleases", {
      context,
      namespace: namespace ?? "",
    });
    return { releases: out.releases };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Fetch a Helm release's values, manifest, and history via `k8s.getHelmRelease`. */
export async function getHelmRelease(
  context: string,
  namespace: string,
  name: string,
  invoke: Invoker = invokeCapability,
): Promise<{ release?: HelmReleaseDetail; error?: string }> {
  try {
    const release = await invoke<HelmReleaseDetail>("k8s.getHelmRelease", {
      context,
      namespace,
      name,
    });
    return { release };
  } catch (e) {
    return { error: String(e) };
  }
}
