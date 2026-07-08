import React, { Suspense, lazy, useState } from "react";
import { CircleCheck, Undo2, Upload } from "lucide-react";
import { applyManifest, validateManifest } from "../lib/manifest";
import { notify } from "../lib/notify";
import { openApiSchema } from "../lib/schema";
import { Spinner, Button, ConfirmDialog } from "../ui";

// CodeMirror is heavy and only needed where a manifest is edited — load on demand.
const CodeEditor = lazy(() => import("../ui/CodeEditor").then((m) => ({ default: m.CodeEditor })));

/**
 * The one YAML manifest editor shared by the New-resource tab, the Edit tab,
 * and the drawer YAML view. Wraps CodeMirror (YAML highlighting + schema
 * validation/completion for the context) with a server-side apply that
 * optionally confirms first and always toasts the result.
 *
 * `yaml` is controlled by the parent so callers can swap templates (create) or
 * load from the cluster (edit). `fill` pins the editor to fill a tab; otherwise
 * it grows within a bounded height for the drawer.
 */
export function ManifestEditor({
  context,
  yaml,
  onYamlChange,
  ariaLabel = "Manifest YAML",
  fill = false,
  applyLabel = "Apply",
  applyingLabel = "Applying…",
  applyIcon,
  confirm,
  resetTo,
  headerExtras,
  headerLabel,
  onApplied,
}: {
  context: string;
  yaml: string;
  onYamlChange: (yaml: string) => void;
  ariaLabel?: string;
  /** Fill the parent (tab); otherwise render at a bounded height (drawer). */
  fill?: boolean;
  applyLabel?: string;
  applyingLabel?: string;
  applyIcon?: React.ReactNode;
  /** When set, Apply opens a confirm dialog naming this resource first. */
  confirm?: { kind: string; name: string };
  /** When set, show a Reset button that reverts the draft to this text. */
  resetTo?: string;
  /** Extra header content on the left (e.g. a create-template picker). */
  headerExtras?: React.ReactNode;
  /** Short header title (e.g. "New resource" / "Edit ConfigMap/web"). */
  headerLabel?: string;
  /** Called with the applied object on success. */
  onApplied?: (result: { kind: string; name: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ kind: string; name: string } | null>(null);

  async function doApply() {
    setBusy(true);
    setError("");
    const out = await applyManifest(context, yaml);
    setBusy(false);
    if (out.error) {
      setError(out.error);
      notify.error(`Failed to apply ${confirm?.name ?? "resource"}`, out.error);
      return;
    }
    setConfirming(false);
    const applied = { kind: out.kind ?? "", name: out.name ?? "" };
    setResult(applied);
    notify.success(`Applied ${applied.kind || "resource"} ${applied.name}`.trim());
    onApplied?.(applied);
  }

  function onApplyClick() {
    if (confirm) setConfirming(true);
    else void doApply();
  }

  const editor = (
    <Suspense fallback={<Spinner label="Loading editor" />}>
      <CodeEditor
        value={yaml}
        onChange={onYamlChange}
        language="yaml"
        ariaLabel={ariaLabel}
        fill={fill}
        minHeight={fill ? undefined : 320}
        maxHeight={fill ? undefined : 520}
        schemaValidate={(y) =>
          validateManifest(context, y).then((r) => (r.valid === false ? r.errors ?? [] : []))
        }
        schemaSource={(apiVersion, kind) =>
          openApiSchema(context, apiVersion, kind).then((r) => ("error" in r ? null : r))
        }
      />
    </Suspense>
  );

  const applyButton = (
    <Button onClick={onApplyClick} disabled={busy || !yaml.trim() || (resetTo != null && yaml === resetTo)}>
      {busy ? <Spinner label={applyingLabel} data-icon="inline-start" /> : applyIcon ?? <Upload data-icon="inline-start" />}
      {busy ? applyingLabel : applyLabel}
    </Button>
  );

  const confirmDialog = confirming ? (
    <ConfirmDialog
      title="Apply manifest?"
      message={
        <>
          <p style={{ marginTop: 0 }}>
            Server-side apply the edited <code>{confirm?.kind}</code> <code>{confirm?.name}</code> to the cluster?
          </p>
          {error && <p style={{ color: "var(--cat-color-danger)" }}>Error: {error}</p>}
        </>
      }
      confirmLabel="Apply"
      busy={busy}
      onConfirm={() => void doApply()}
      onCancel={() => setConfirming(false)}
    />
  ) : null;

  if (fill) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
          {headerLabel && <span className="font-medium">{headerLabel}</span>}
          <span className="text-xs text-muted-foreground">on {context}</span>
          {headerExtras}
          <div className="ml-auto flex items-center gap-3">
            {result && (
              <span className="cat-apply-success">
                <CircleCheck aria-hidden="true" />
                Applied {result.kind} <code>{result.name}</code>
              </span>
            )}
            {error && !confirming && (
              <span className="max-w-md truncate text-destructive" title={error}>
                Error: {error}
              </span>
            )}
            {applyButton}
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* Absolute-inset pins CodeMirror to a definite-height box so it fills the tab. */}
          <div className="absolute inset-0">{editor}</div>
        </div>
        {confirmDialog}
      </div>
    );
  }

  const dirty = resetTo == null || yaml !== resetTo;
  return (
    <div>
      {editor}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        {applyButton}
        {resetTo != null && (
          <Button variant="ghost" onClick={() => onYamlChange(resetTo)} disabled={!dirty}>
            <Undo2 data-icon="inline-start" />
            Reset
          </Button>
        )}
        {result && !dirty && (
          <span className="cat-apply-success">
            <CircleCheck aria-hidden="true" /> Applied
          </span>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
