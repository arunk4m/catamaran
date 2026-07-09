import React, { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Radar, Square } from "lucide-react";
import { Button, Spinner, TextInput } from "../ui";
import { notify } from "../lib/notify";
import { openExternalUrl } from "../lib/aws";
import {
  discoverTools,
  listSpyglassForwards,
  spyglassForwardStop,
  SPYGLASS_LABELS,
  type DiscoveredTool,
  type SpyglassForward,
} from "../lib/spyglass";
import type { ObservabilityConfig, SpyglassSource, SpyglassTool } from "../lib/settings";

const TOOLS: SpyglassTool[] = ["kiali", "grafana"];

const MODE_CHOICES: Array<{ id: SpyglassSource["mode"]; label: string; description: string }> = [
  { id: "auto", label: "Auto-detect", description: "Find it in the focused cluster" },
  { id: "service", label: "Pinned service", description: "Port-forward a fixed service" },
  { id: "url", label: "External URL", description: "Open an exposed address as-is" },
];

/** Blank-but-valid shapes used when switching a tool's source mode. */
function defaultForMode(mode: SpyglassSource["mode"], tool: SpyglassTool): SpyglassSource {
  if (mode === "service") {
    return tool === "kiali"
      ? { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 }
      : { mode: "service", namespace: "", service: "grafana", port: 80 };
  }
  if (mode === "url") return { mode: "url", url: "" };
  return { mode: "auto" };
}

/**
 * Per-tool source configuration for the spyglass (Kiali / Grafana), plus the
 * tunnels it currently holds open. Lives in Settings → Observability.
 */
export function SpyglassSettings({
  config,
  onConfigChange,
  activeContext = null,
}: {
  config: ObservabilityConfig;
  onConfigChange: (config: ObservabilityConfig) => void;
  /** Context detection runs against (the focused pane's cluster). */
  activeContext?: string | null;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DiscoveredTool[] | null>(null);
  const [forwards, setForwards] = useState<SpyglassForward[] | null>(null);

  const refreshForwards = useCallback(async () => {
    const { forwards: rows } = await listSpyglassForwards();
    setForwards(rows ?? []);
  }, []);

  useEffect(() => {
    void refreshForwards();
  }, [refreshForwards]);

  async function runDetect() {
    if (!activeContext) return;
    setDetecting(true);
    const { tools, error } = await discoverTools(activeContext);
    setDetecting(false);
    if (error) {
      notify.error(error);
      return;
    }
    setDetected(tools ?? []);
    const next = { ...config };
    let hits = 0;
    for (const tool of TOOLS) {
      const found = (tools ?? []).find((t) => t.tool === tool);
      if (found) {
        hits += 1;
        next[tool] = {
          mode: "service",
          namespace: found.namespace,
          service: found.service,
          port: found.port,
        };
      }
    }
    if (hits > 0) {
      onConfigChange(next);
      notify.success(`Found ${hits === 2 ? "Kiali and Grafana" : hits === 1 ? "one tool" : ""} in ${activeContext}`);
    } else {
      notify.error(`No Kiali or Grafana services found in ${activeContext}`);
    }
  }

  function setSource(tool: SpyglassTool, source: SpyglassSource) {
    onConfigChange({ ...config, [tool]: source });
  }

  async function stopForward(row: SpyglassForward) {
    const { error } = await spyglassForwardStop({
      context: row.context,
      namespace: row.namespace,
      service: row.service,
      port: row.port,
    });
    if (error) notify.error(error);
    await refreshForwards();
  }

  return (
    <div className="cat-spyglass">
      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!activeContext || detecting}
          onClick={() => void runDetect()}
        >
          <Radar data-icon="inline-start" />
          {detecting
            ? "Scanning…"
            : activeContext
              ? `Detect in ${activeContext}`
              : "Detect (open a cluster first)"}
        </Button>
      </div>

      {TOOLS.map((tool) => {
        const source = config[tool];
        const hint = detected?.find((t) => t.tool === tool)?.ingressUrl ?? null;
        return (
          <div key={tool} className="cat-spyglass__tool">
            <span className="cat-spyglass__tool-name">
              <strong>{SPYGLASS_LABELS[tool]}</strong>
              <small>
                {tool === "kiali" ? "Service mesh topology and traffic" : "Metrics dashboards"}
              </small>
            </span>
            <div className="cat-settings-update__channels" role="group" aria-label={`${SPYGLASS_LABELS[tool]} source`}>
              {MODE_CHOICES.map(({ id, label, description }) => (
                <button
                  key={id}
                  type="button"
                  className={`cat-settings-mode${source.mode === id ? " cat-settings-mode--active" : ""}`}
                  onClick={() => source.mode !== id && setSource(tool, defaultForMode(id, tool))}
                  aria-pressed={source.mode === id}
                >
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  {source.mode === id && <Check aria-hidden="true" />}
                </button>
              ))}
            </div>
            {source.mode === "service" && (
              <div className="cat-spyglass__service">
                <label className="cat-settings-field">
                  <span>Namespace</span>
                  <TextInput
                    value={source.namespace}
                    onValueChange={(v) => setSource(tool, { ...source, namespace: v })}
                    aria-label={`${SPYGLASS_LABELS[tool]} namespace`}
                  />
                </label>
                <label className="cat-settings-field">
                  <span>Service</span>
                  <TextInput
                    value={source.service}
                    onValueChange={(v) => setSource(tool, { ...source, service: v })}
                    aria-label={`${SPYGLASS_LABELS[tool]} service`}
                  />
                </label>
                <label className="cat-settings-field">
                  <span>Port</span>
                  <TextInput
                    value={String(source.port)}
                    onValueChange={(v) => {
                      const port = Number.parseInt(v, 10);
                      if (Number.isInteger(port) && port > 0 && port <= 65535) {
                        setSource(tool, { ...source, port });
                      }
                    }}
                    aria-label={`${SPYGLASS_LABELS[tool]} port`}
                  />
                </label>
              </div>
            )}
            {source.mode === "url" && (
              <label className="cat-settings-field">
                <span>URL</span>
                <TextInput
                  value={source.url}
                  onValueChange={(v) => setSource(tool, { mode: "url", url: v })}
                  placeholder={
                    tool === "kiali" ? "https://kiali.your-org.example" : "https://grafana.your-org.example"
                  }
                  aria-label={`${SPYGLASS_LABELS[tool]} URL`}
                />
              </label>
            )}
            {hint && source.mode !== "url" && (
              <p className="cat-spyglass__hint">
                An ingress already serves this tool at <code>{hint}</code>
                <Button variant="ghost" size="sm" onClick={() => void openExternalUrl(hint)}>
                  <ExternalLink data-icon="inline-start" />
                  Open
                </Button>
              </p>
            )}
          </div>
        );
      })}

      <div className="cat-sso-profiles">
        <span>
          <strong>Active spyglass tunnels</strong>
          <small>Port-forwards held open for tool windows — stopped on quit, or here.</small>
        </span>
        {forwards === null ? (
          <Spinner label="Listing tunnels" />
        ) : forwards.length === 0 ? (
          <p className="cat-sso-profiles__empty">No spyglass port-forwards running.</p>
        ) : (
          <ul>
            {forwards.map((row) => (
              <li key={`${row.context}/${row.namespace}/${row.service}:${row.port}`}>
                <code>
                  {row.namespace}/{row.service}:{row.port} → 127.0.0.1:{row.localPort}
                </code>
                <small>{row.context}</small>
                <Button variant="ghost" size="sm" onClick={() => void stopForward(row)}>
                  <Square data-icon="inline-start" />
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
