import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ExternalLink, KeyRound, RotateCcw, RefreshCw, Settings2 } from "lucide-react";
import { Button, LoadingState } from "../ui";
import { notify } from "../lib/notify";
import { openExternalUrl, ssoProfiles, ssoLogin, profileForContext } from "../lib/aws";
import { prepareEmbed, type SpyglassEmbed } from "../lib/spyglass";
import { validSavedPath, type SpyglassSource, type SpyglassToolMeta } from "../lib/settings";
import { invokeCapability, type Invoker } from "../transport/transport";

type Phase =
  | { phase: "loading" }
  | { phase: "error"; message: string; auth: boolean }
  | { phase: "external"; url: string }
  | { phase: "ready"; embed: SpyglassEmbed; src: string; nonce: number };

/**
 * Does this failure look like expired cluster credentials (SSO token lapsed),
 * rather than a missing tool or a real outage? Those are recoverable in-app by
 * refreshing AWS access, so we surface that action.
 */
export function looksLikeAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("credential") ||
    m.includes("token") ||
    m.includes("expired") ||
    m.includes("unauthorized") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes("forbidden") ||
    m.includes("the server has asked for the client to provide credentials") ||
    m.includes("building the cluster client")
  );
}

/**
 * A spyglass tool (Kiali / Grafana) embedded in the workspace: the backend
 * relay strips the tool's frame blockers and injects a location reporter, so
 * the iframe both renders and tells us where the user navigated — which is
 * what makes "Save view" possible for a cross-origin page.
 */
export function SpyglassView({
  meta,
  context,
  source,
  active = true,
  onSaveView,
  onOpenSettings,
  invoke = invokeCapability,
}: {
  meta: SpyglassToolMeta;
  context: string | null;
  source: SpyglassSource;
  /**
   * Whether this view is the pane's active tab. The view stays mounted (and
   * keeps loading) when inactive — this only steers focus/accessibility away
   * from the hidden iframe so keyboard tabbing doesn't land inside it.
   */
  active?: boolean;
  /** Persist (or clear, with null) the tool's saved in-tool view. */
  onSaveView?: (path: string | null) => void;
  onOpenSettings?: () => void;
  invoke?: Invoker;
}) {
  const label = meta.label;
  const [state, setState] = useState<Phase>({ phase: "loading" });
  // Last in-tool location the embedded page reported (path + query + hash).
  const currentPath = useRef<string | null>(null);

  // The saved path only matters when (re)preparing; changing it must not
  // reload a live iframe, so it's threaded through a ref rather than the
  // effect key. Everything that changes WHERE the tool lives re-prepares.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const sourceKey =
    source.mode === "service"
      ? `service:${source.namespace}/${source.service}:${source.port}`
      : source.mode === "url"
        ? `url:${source.url}`
        : "auto";

  const [refreshingAws, setRefreshingAws] = useState(false);

  const prepare = useCallback(async () => {
    setState({ phase: "loading" });
    const { prep, error } = await prepareEmbed(meta, context, sourceRef.current, invoke);
    if (error || !prep) {
      const message = error ?? "The spyglass could not be prepared.";
      setState({ phase: "error", message, auth: looksLikeAuthError(message) });
      return;
    }
    if (prep.kind === "external") {
      setState({ phase: "external", url: prep.url });
      return;
    }
    const resume = currentPath.current;
    const src = resume && validSavedPath(resume) ? resume : prep.initialPath;
    currentPath.current = src;
    setState({ phase: "ready", embed: prep, src, nonce: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, context, invoke, sourceKey]);

  useEffect(() => {
    currentPath.current = null; // a new target starts from its saved/default view
    void prepare();
  }, [prepare]);

  // The relay-injected reporter posts route changes; trust only our relay.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (state.phase !== "ready") return;
      if (event.origin !== new URL(state.embed.base).origin) return;
      const href = (event.data as { catamaranSpyglass?: { href?: unknown } } | null)
        ?.catamaranSpyglass?.href;
      if (validSavedPath(href)) currentPath.current = href;
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [state]);

  function saveView() {
    const path = currentPath.current;
    if (!path || !onSaveView) return;
    onSaveView(path);
    notify.success(`${label} view saved`, path);
  }

  function resetView() {
    if (state.phase !== "ready") return;
    onSaveView?.(null);
    currentPath.current = state.embed.defaultPath;
    setState({ ...state, src: state.embed.defaultPath, nonce: state.nonce + 1 });
  }

  function openInBrowser() {
    if (state.phase === "external") {
      void openExternalUrl(state.url);
    } else if (state.phase === "ready") {
      void openExternalUrl(`${state.embed.base}${currentPath.current ?? state.src}`);
    }
  }

  /**
   * Recover from expired cluster credentials without leaving the tool: find
   * the SSO profile backing this context, run `aws sso login`, then re-prepare
   * — so a lapsed token is a two-click fix, not a dead tab.
   */
  async function refreshAwsAndReload() {
    setRefreshingAws(true);
    try {
      const { profiles } = await ssoProfiles();
      const profile = profileForContext(profiles ?? [], context);
      if (!profile) {
        notify.error(
          "No AWS SSO profile found",
          "This context isn't pinned to an AWS_PROFILE in your kubeconfig.",
        );
        return;
      }
      const { ok, error } = await ssoLogin(profile);
      if (!ok) {
        notify.error(error ?? "AWS SSO login failed");
        return;
      }
      notify.success(`AWS access refreshed for ${profile}`);
      await prepare();
    } finally {
      setRefreshingAws(false);
    }
  }

  return (
    <div className="cat-spyglass-view">
      <header className="cat-spyglass-view__bar">
        <span className="cat-spyglass-view__title">
          <strong>{label}</strong>
          {context && <small>{context}</small>}
          {state.phase === "ready" && meta.mesh && state.embed.meshNamespaces.length > 0 && (
            <small className="cat-spyglass-view__mesh">
              mesh: {state.embed.meshNamespaces.join(", ")}
            </small>
          )}
        </span>
        <span className="cat-spyglass-view__actions">
          {state.phase === "ready" && onSaveView && (
            <>
              <Button variant="ghost" size="sm" onClick={saveView} title="Reopen on the view you're looking at">
                <Bookmark data-icon="inline-start" />
                Save view
              </Button>
              {(source.savedPath || currentPath.current !== state.embed.defaultPath) && (
                <Button variant="ghost" size="sm" onClick={resetView} title="Back to the default view">
                  <RotateCcw data-icon="inline-start" />
                  Reset view
                </Button>
              )}
            </>
          )}
          {(state.phase === "ready" || state.phase === "external") && (
            <Button variant="ghost" size="sm" onClick={openInBrowser}>
              <ExternalLink data-icon="inline-start" />
              Open in browser
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void prepare()} title="Re-establish the tunnel and reload">
            <RefreshCw data-icon="inline-start" />
            Reload
          </Button>
          {onOpenSettings && (
            <Button variant="ghost" size="sm" onClick={onOpenSettings} title="Observability settings">
              <Settings2 data-icon="inline-start" />
            </Button>
          )}
        </span>
      </header>

      {state.phase === "loading" && (
        <div className="cat-spyglass-view__fill">
          <LoadingState label={`Hoisting the spyglass — reaching ${label}`} />
        </div>
      )}

      {state.phase === "error" && (
        <div className="cat-spyglass-view__fill">
          <div className="cat-spyglass-view__notice" role="alert">
            <strong>Couldn&apos;t reach {label}</strong>
            <p>{state.message}</p>
            {state.auth && (
              <p className="cat-spyglass-view__hint">
                This usually means your cluster credentials expired. Refresh AWS access and
                Catamaran will reconnect.
              </p>
            )}
            <span>
              {state.auth && (
                <Button size="sm" disabled={refreshingAws} onClick={() => void refreshAwsAndReload()}>
                  <KeyRound data-icon="inline-start" />
                  {refreshingAws ? "Waiting for approval…" : "Refresh AWS access"}
                </Button>
              )}
              <Button
                variant={state.auth ? "ghost" : "default"}
                size="sm"
                onClick={() => void prepare()}
              >
                <RefreshCw data-icon="inline-start" />
                Retry
              </Button>
              {onOpenSettings && (
                <Button variant="ghost" size="sm" onClick={onOpenSettings}>
                  Open Settings
                </Button>
              )}
            </span>
          </div>
        </div>
      )}

      {state.phase === "external" && (
        <div className="cat-spyglass-view__fill">
          <div className="cat-spyglass-view__notice">
            <strong>{label} is configured with an external URL</strong>
            <p>
              Remote origins keep their frame protections, so <code>{state.url}</code> can&apos;t be
              embedded — it opens in your browser instead. Switch the source to auto-detect or a
              pinned service in Settings to embed it here.
            </p>
            <span>
              <Button size="sm" onClick={openInBrowser}>
                <ExternalLink data-icon="inline-start" />
                Open in browser
              </Button>
              {onOpenSettings && (
                <Button variant="ghost" size="sm" onClick={onOpenSettings}>
                  Open Settings
                </Button>
              )}
            </span>
          </div>
        </div>
      )}

      {state.phase === "ready" && (
        <iframe
          key={`${state.embed.base}:${state.nonce}`}
          className="cat-spyglass-view__frame"
          src={`${state.embed.base}${state.src}`}
          title={`${label}${context ? ` — ${context}` : ""}`}
          allow="clipboard-read; clipboard-write; fullscreen"
          tabIndex={active ? undefined : -1}
          aria-hidden={active ? undefined : true}
        />
      )}
    </div>
  );
}
