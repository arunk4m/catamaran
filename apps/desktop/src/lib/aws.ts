import { invokeCapability, type Invoker } from "../transport/transport";

/** An AWS SSO profile pinned by kubeconfig exec blocks. */
export interface SsoProfileInfo {
  profile: string;
  contexts: string[];
}

/** Discover the SSO profiles the kubeconfig pins, via `aws.ssoProfiles`. */
export async function ssoProfiles(
  paths: string[] = [],
  invoke: Invoker = invokeCapability,
): Promise<{ profiles?: SsoProfileInfo[]; error?: string }> {
  try {
    const out = await invoke<{ profiles: SsoProfileInfo[] }>("aws.ssoProfiles", { paths });
    return { profiles: out.profiles };
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Refresh an SSO session via `aws.ssoLogin` (the CLI opens the access portal
 * in the browser for approval). On success the backend drops every cached
 * kube client, so panes reconnect with fresh credentials.
 */
export async function ssoLogin(
  profile: string,
  invoke: Invoker = invokeCapability,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const out = await invoke<{ ok: boolean }>("aws.ssoLogin", { profile });
    return { ok: out.ok };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Open an http(s) URL in the system browser via `system.openUrl`. */
export async function openExternalUrl(
  url: string,
  invoke: Invoker = invokeCapability,
): Promise<{ ok?: boolean; error?: string }> {
  try {
    const out = await invoke<{ ok: boolean }>("system.openUrl", { url });
    return { ok: out.ok };
  } catch (e) {
    return { error: String(e) };
  }
}

/** The profile to refresh for a context: its own, else the first known. */
export function profileForContext(
  profiles: SsoProfileInfo[],
  context: string | null,
): string | null {
  if (context) {
    const match = profiles.find((p) => p.contexts.includes(context));
    if (match) return match.profile;
  }
  return profiles[0]?.profile ?? null;
}
