import React, { Suspense, lazy, useEffect, useState } from "react";
import { listHelmReleases, getHelmRelease, type HelmReleaseSummary, type HelmReleaseDetail } from "../lib/helm";
import { ageFromTimestamp } from "./ResourceOverview";
import { Table, Spinner, Badge, StatusPill, Drawer, Tabs, type Column, type StatusKind } from "../ui";

const CodeEditor = lazy(() => import("../ui/CodeEditor").then((m) => ({ default: m.CodeEditor })));

/** Map a Helm status to a status-pill colour. */
function statusKind(status: string): StatusKind {
  if (status === "deployed" || status === "superseded") return "success";
  if (status === "failed" || status === "unknown") return "danger";
  if (status.startsWith("pending") || status === "uninstalling") return "warning";
  return "neutral";
}

/** Overview of Helm releases across the cluster, with a values/manifest/history drawer. */
export function HelmReleasesView({
  context,
  detailDrawerWidth = 480,
}: {
  context: string;
  detailDrawerWidth?: number;
}) {
  const [releases, setReleases] = useState<HelmReleaseSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HelmReleaseSummary | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listHelmReleases(context).then((o) => {
      if (!active) return;
      setReleases(o.releases ?? []);
      setError(o.error ?? "");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [context]);

  const now = Date.now();
  const columns: Column<HelmReleaseSummary>[] = [
    { key: "name", header: "Name", render: (r) => <span className="cat-mono">{r.name}</span> },
    { key: "namespace", header: "Namespace", render: (r) => r.namespace },
    { key: "chart", header: "Chart", render: (r) => `${r.chart}-${r.chartVersion}` },
    { key: "app", header: "App", render: (r) => r.appVersion || "—" },
    { key: "rev", header: "Rev", render: (r) => <span className="tabular-nums">{r.revision}</span> },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} kind={statusKind(r.status)} /> },
    { key: "updated", header: "Updated", render: (r) => ageFromTimestamp(r.updated, now) },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm">
          <span className="font-medium">Helm Releases</span>
          <Badge variant="info">{releases.length}</Badge>
          {loading && <Spinner label="Loading releases" />}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <div className="p-3 text-destructive">Error: {error}</div>
          ) : releases.length === 0 && !loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No Helm releases found in this cluster.
            </div>
          ) : (
            <Table
              columns={columns}
              data={releases}
              getRowKey={(r) => `${r.namespace}/${r.name}`}
              onRowClick={setSelected}
              selectedKey={selected ? `${selected.namespace}/${selected.name}` : undefined}
            />
          )}
        </div>
      </div>

      <Drawer
        open={!!selected}
        defaultWidth={detailDrawerWidth}
        title={selected ? <>Release: <code>{selected.name}</code></> : null}
        onClose={() => setSelected(null)}
      >
        {selected && <HelmReleaseDetailPanel context={context} release={selected} />}
      </Drawer>
    </div>
  );
}

function HelmReleaseDetailPanel({ context, release }: { context: string; release: HelmReleaseSummary }) {
  const [detail, setDetail] = useState<HelmReleaseDetail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("values");

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError("");
    void getHelmRelease(context, release.namespace, release.name).then((o) => {
      if (!active) return;
      if (o.error) setError(o.error);
      else setDetail(o.release ?? null);
    });
    return () => {
      active = false;
    };
  }, [context, release.namespace, release.name]);

  if (error) return <div className="text-destructive">Error: {error}</div>;
  if (!detail) return <Spinner label="Loading release" />;

  const info: Array<[string, React.ReactNode]> = [
    ["Status", <StatusPill key="s" status={detail.status} kind={statusKind(detail.status)} />],
    ["Namespace", <span className="cat-mono">{detail.namespace}</span>],
    ["Chart", `${detail.chart}-${detail.chartVersion}`],
    ["App version", detail.appVersion || "—"],
    ["Revision", String(detail.revision)],
    ["Updated", detail.updated || "—"],
  ];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {info.map(([k, v]) => (
          <React.Fragment key={String(k)}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate">{v}</dd>
          </React.Fragment>
        ))}
      </dl>

      <Tabs
        tabs={[
          { id: "values", label: "Values" },
          { id: "manifest", label: "Manifest" },
          { id: "history", label: `History (${detail.history.length})` },
          ...(detail.notes ? [{ id: "notes", label: "Notes" }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "values" && (
        <Suspense fallback={<Spinner label="Loading editor" />}>
          <CodeEditor value={detail.valuesYaml || "# no user-supplied values\n"} readOnly ariaLabel="Release values" />
        </Suspense>
      )}
      {tab === "manifest" && (
        <Suspense fallback={<Spinner label="Loading editor" />}>
          <CodeEditor value={detail.manifest || "# empty manifest\n"} readOnly ariaLabel="Release manifest" />
        </Suspense>
      )}
      {tab === "history" && (
        <Table
          columns={[
            { key: "revision", header: "Rev", render: (h) => <span className="tabular-nums">{h.revision}</span> },
            { key: "status", header: "Status", render: (h) => h.status },
            { key: "chart", header: "Chart ver", render: (h) => h.chartVersion },
            { key: "updated", header: "Updated", render: (h) => h.updated || "—" },
            { key: "description", header: "Description", render: (h) => h.description },
          ]}
          data={detail.history}
          getRowKey={(h) => String(h.revision)}
        />
      )}
      {tab === "notes" && (
        <pre className="whitespace-pre-wrap rounded border border-border bg-muted/40 p-2 text-xs">{detail.notes}</pre>
      )}
    </div>
  );
}
