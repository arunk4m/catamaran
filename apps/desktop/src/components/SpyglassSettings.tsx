import React, { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Plus, Radar, RotateCcw, Square, Trash2, X } from "lucide-react";
import { Button, ConfirmDialog, Spinner, TextInput } from "../ui";
import { notify } from "../lib/notify";
import { openExternalUrl } from "../lib/aws";
import { spyglassIcon } from "../ui/NavIcon";
import {
  discoverTools,
  listSpyglassForwards,
  spyglassForwardStop,
  SPYGLASS_LABELS,
  type DiscoveredTool,
  type SpyglassForward,
} from "../lib/spyglass";
import {
  spyglassMeta,
  hiddenBuiltinMetas,
  makeCustomToolId,
  SPYGLASS_ICON_CHOICES,
  SPYGLASS_TOOL_IDS,
  type CustomSpyglassTool,
  type ObservabilityConfig,
  type SpyglassIconName,
  type SpyglassSource,
  type SpyglassTool,
} from "../lib/settings";

const TOOLS: SpyglassTool[] = SPYGLASS_TOOL_IDS;

/** A tool queued for removal, awaiting confirmation. */
type PendingRemoval =
  | { kind: "builtin"; id: string; label: string }
  | { kind: "custom"; id: string; label: string };

/** A grid of selectable lucide icons for a custom tool. */
function IconPicker({
  value,
  onChange,
  label,
}: {
  value: SpyglassIconName;
  onChange: (icon: SpyglassIconName) => void;
  label: string;
}) {
  return (
    <div className="cat-spyglass__icons" role="group" aria-label={label}>
      {SPYGLASS_ICON_CHOICES.map((name) => {
        const Icon = spyglassIcon(name);
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            className={`cat-spyglass__icon${active ? " cat-spyglass__icon--active" : ""}`}
            aria-label={name}
            aria-pressed={active}
            title={name}
            onClick={() => onChange(name)}
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

const MODE_CHOICES: Array<{ id: SpyglassSource["mode"]; label: string; description: string }> = [
  { id: "auto", label: "Auto-detect", description: "Find it in the focused cluster" },
  { id: "service", label: "Pinned service", description: "Port-forward a fixed service" },
  { id: "url", label: "External URL", description: "Open an exposed address as-is" },
];

/**
 * Blank-but-valid shapes used when switching a tool's source mode. The saved
 * in-tool view survives a mode switch — it describes a place inside the
 * tool, not where the tool lives.
 */
function defaultForMode(
  mode: SpyglassSource["mode"],
  tool: SpyglassTool,
  savedPath?: string,
): SpyglassSource {
  const base: SpyglassSource =
    mode === "service"
      ? { mode: "service", ...spyglassMeta(tool).defaultTarget }
      : mode === "url"
        ? { mode: "url", url: "" }
        : { mode: "auto" };
  if (savedPath) base.savedPath = savedPath;
  return base;
}

/**
 * Per-tool source configuration for the spyglass (Kiali / Grafana), plus the
 * tunnels it currently holds open. Lives in Settings → Observability.
 */
export function SpyglassSettings({
  config,
  onConfigChange,
  customTools = [],
  onCustomToolsChange = () => {},
  hiddenTools = [],
  onHiddenToolsChange = () => {},
  activeContext = null,
}: {
  config: ObservabilityConfig;
  onConfigChange: (config: ObservabilityConfig) => void;
  /** User-added tools (pinned service + icon). */
  customTools?: CustomSpyglassTool[];
  onCustomToolsChange?: (tools: CustomSpyglassTool[]) => void;
  /** Built-in tools hidden from the launcher/palette. */
  hiddenTools?: string[];
  onHiddenToolsChange?: (ids: string[]) => void;
  /** Context detection runs against (the focused pane's cluster). */
  activeContext?: string | null;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DiscoveredTool[] | null>(null);
  const [forwards, setForwards] = useState<SpyglassForward[] | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const visibleBuiltins = TOOLS.filter((t) => !hiddenTools.includes(t));
  const hiddenMetas = hiddenBuiltinMetas(hiddenTools);

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
      notify.success(`Found ${hits} observability ${hits === 1 ? "tool" : "tools"} in ${activeContext}`);
    } else {
      notify.error(`No known observability tools found in ${activeContext}`);
    }
  }

  function setSource(tool: SpyglassTool, source: SpyglassSource) {
    onConfigChange({ ...config, [tool]: source });
  }

  function addCustomTool() {
    const label = "New tool";
    const id = makeCustomToolId(label, customTools);
    onCustomToolsChange([
      ...customTools,
      { id, label, icon: "telescope", namespace: activeContext ? "" : "", service: "", port: 8080 },
    ]);
  }

  function updateCustomTool(id: string, patch: Partial<CustomSpyglassTool>) {
    onCustomToolsChange(customTools.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function removeCustomTool(id: string) {
    onCustomToolsChange(customTools.filter((t) => t.id !== id));
  }

  /** Apply the pending removal: hide a built-in, or delete a custom tool. */
  function confirmRemoval() {
    if (!pendingRemoval) return;
    if (pendingRemoval.kind === "builtin") {
      onHiddenToolsChange([...hiddenTools, pendingRemoval.id]);
    } else {
      removeCustomTool(pendingRemoval.id);
    }
    setPendingRemoval(null);
  }

  function restoreBuiltin(id: string) {
    onHiddenToolsChange(hiddenTools.filter((t) => t !== id));
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

      {visibleBuiltins.map((tool) => {
        const source: SpyglassSource = config[tool] ?? { mode: "auto" };
        const hint = detected?.find((t) => t.tool === tool)?.ingressUrl ?? null;
        return (
          <div key={tool} className="cat-spyglass__tool">
            <div className="cat-spyglass__tool-head">
              <span className="cat-spyglass__tool-name">
                <strong>{SPYGLASS_LABELS[tool]}</strong>
                <small>{spyglassMeta(tool).blurb}</small>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${SPYGLASS_LABELS[tool]}`}
                title="Remove this tool from the Observability menu"
                onClick={() =>
                  setPendingRemoval({ kind: "builtin", id: tool, label: SPYGLASS_LABELS[tool] })
                }
              >
                <X data-icon="inline-start" />
                Remove
              </Button>
            </div>
            <div className="cat-settings-update__channels" role="group" aria-label={`${SPYGLASS_LABELS[tool]} source`}>
              {MODE_CHOICES.map(({ id, label, description }) => (
                <button
                  key={id}
                  type="button"
                  className={`cat-settings-mode${source.mode === id ? " cat-settings-mode--active" : ""}`}
                  onClick={() =>
                    source.mode !== id && setSource(tool, defaultForMode(id, tool, source.savedPath))
                  }
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
            {source.savedPath && (
              <p className="cat-spyglass__hint">
                Saved view: <code>{source.savedPath}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const { savedPath: _cleared, ...rest } = source;
                    setSource(tool, rest as SpyglassSource);
                  }}
                >
                  Clear
                </Button>
              </p>
            )}
          </div>
        );
      })}

      <div className="cat-spyglass__custom">
        <div className="cat-spyglass__custom-head">
          <span>
            <strong>Your tools</strong>
            <small>
              Add any in-cluster web UI — give it a name, namespace, service and port, pick an
              icon, and it appears in the Observability menu.
            </small>
          </span>
          <Button variant="ghost" size="sm" onClick={addCustomTool}>
            <Plus data-icon="inline-start" />
            Add tool
          </Button>
        </div>
        {customTools.length === 0 ? (
          <p className="cat-sso-profiles__empty">No custom tools yet.</p>
        ) : (
          customTools.map((tool) => (
            <div key={tool.id} className="cat-spyglass__tool cat-spyglass__tool--custom">
              <div className="cat-spyglass__custom-row">
                <label className="cat-settings-field cat-spyglass__custom-name">
                  <span>Name</span>
                  <TextInput
                    value={tool.label}
                    onValueChange={(v) => updateCustomTool(tool.id, { label: v })}
                    aria-label={`Custom tool ${tool.id} name`}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setPendingRemoval({ kind: "custom", id: tool.id, label: tool.label })
                  }
                  aria-label={`Remove ${tool.label}`}
                  title="Delete this tool"
                >
                  <Trash2 data-icon="inline-start" />
                  Remove
                </Button>
              </div>
              <div className="cat-spyglass__service">
                <label className="cat-settings-field">
                  <span>Namespace</span>
                  <TextInput
                    value={tool.namespace}
                    onValueChange={(v) => updateCustomTool(tool.id, { namespace: v })}
                    aria-label={`${tool.label} namespace`}
                  />
                </label>
                <label className="cat-settings-field">
                  <span>Service</span>
                  <TextInput
                    value={tool.service}
                    onValueChange={(v) => updateCustomTool(tool.id, { service: v })}
                    aria-label={`${tool.label} service`}
                  />
                </label>
                <label className="cat-settings-field">
                  <span>Port</span>
                  <TextInput
                    value={String(tool.port)}
                    onValueChange={(v) => {
                      const port = Number.parseInt(v, 10);
                      if (Number.isInteger(port) && port > 0 && port <= 65535) {
                        updateCustomTool(tool.id, { port });
                      }
                    }}
                    aria-label={`${tool.label} port`}
                  />
                </label>
              </div>
              <IconPicker
                value={tool.icon}
                onChange={(icon) => updateCustomTool(tool.id, { icon })}
                label={`${tool.label} icon`}
              />
            </div>
          ))
        )}
      </div>

      {hiddenMetas.length > 0 && (
        <div className="cat-sso-profiles">
          <span>
            <strong>Hidden built-in tools</strong>
            <small>Removed from the Observability menu — restore any time.</small>
          </span>
          <ul>
            {hiddenMetas.map((meta) => (
              <li key={meta.id}>
                <code>{meta.label}</code>
                <small>{meta.blurb}</small>
                <Button variant="ghost" size="sm" onClick={() => restoreBuiltin(meta.id)}>
                  <RotateCcw data-icon="inline-start" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove ${pendingRemoval.label}?`}
          message={
            pendingRemoval.kind === "builtin"
              ? `${pendingRemoval.label} will be removed from the Observability menu. You can restore it from the "Hidden built-in tools" list below.`
              : `${pendingRemoval.label} will be permanently deleted from your observability tools.`
          }
          confirmLabel="Remove"
          danger
          onConfirm={confirmRemoval}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}
