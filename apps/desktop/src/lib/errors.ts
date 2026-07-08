/**
 * User-facing error formatting.
 *
 * Backend capability errors reach the UI as raw strings — e.g. the
 * `CapabilityError` Display prefix (`handler error: …`) wrapped around a
 * hand-written message like `list namespaces timed out`. Rendering those
 * verbatim looks broken and tells the user nothing actionable.
 *
 * `describeError` turns a raw error into a short title + an actionable detail,
 * classifying the common cluster-connectivity failure modes. Everything is
 * pure and string-based, so it works for both thrown `Error`s and the
 * `{ error: string }` shapes the lib layer returns.
 */

export interface FriendlyError {
  /** Short, human headline for the failure. */
  title: string;
  /** One or two sentences on what happened and what to check. */
  detail: string;
  /** The original message, cleaned of internal prefixes — kept for diagnostics. */
  raw: string;
}

/** `CapabilityError`'s Display prefix; internal noise the user shouldn't see. */
const HANDLER_PREFIX = /^\s*handler error:\s*/i;

/** Normalize any thrown value to a clean message, stripping internal prefixes. */
export function cleanErrorMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? "");
  return raw.replace(HANDLER_PREFIX, "").trim();
}

/** Classify a raw error into a friendly, actionable message. */
export function describeError(input: unknown): FriendlyError {
  const raw = cleanErrorMessage(input);
  const lower = raw.toLowerCase();

  if (/timed out|timeout|deadline exceeded/.test(lower)) {
    return {
      title: "Can't reach the cluster",
      detail:
        "The Kubernetes API server didn't respond in time. Check that the cluster is running and reachable — if it's remote, confirm your VPN or network connection and that the current context points at the right server.",
      raw,
    };
  }
  if (/connection refused|failed to connect|connect error|no route to host|network is unreachable|unreachable/.test(lower)) {
    return {
      title: "Can't reach the cluster",
      detail:
        "The connection to the API server was refused. Make sure the cluster is running and the server address in your kubeconfig context is correct.",
      raw,
    };
  }
  if (/no such host|failed to lookup|name or service not known|dns|could not resolve|cannot resolve/.test(lower)) {
    return {
      title: "Cluster address not found",
      detail:
        "The API server hostname couldn't be resolved. Check the server URL in your kubeconfig context and your DNS or network connection.",
      raw,
    };
  }
  if (/unauthorized|\b401\b|invalid bearer|expired token/.test(lower)) {
    return {
      title: "Not authorized",
      detail:
        "The cluster rejected your credentials. Your token or client certificate may have expired — refresh your kubeconfig credentials and try again.",
      raw,
    };
  }
  if (/forbidden|\b403\b/.test(lower)) {
    return {
      title: "Access denied",
      detail:
        "Your account doesn't have permission for this on the cluster. Check your RBAC roles, or switch to a context with the right access.",
      raw,
    };
  }
  if (/certificate|x509|\btls\b|self.signed|unknown authority/.test(lower)) {
    return {
      title: "Couldn't verify the cluster",
      detail:
        "The cluster's TLS certificate couldn't be verified. It may be self-signed or expired, or the certificate-authority data in your kubeconfig may be missing or wrong.",
      raw,
    };
  }

  return {
    title: "Something went wrong",
    detail: raw || "An unexpected error occurred.",
    raw,
  };
}
