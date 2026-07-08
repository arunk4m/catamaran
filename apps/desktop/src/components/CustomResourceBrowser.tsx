import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { listCustomResource, type CrdRef, type CustomRow } from "../lib/crds";
import { listNamespaces } from "../lib/workloads";
import { YamlView } from "./YamlView";
import { Table, filterTableData, Select, Button, Spinner, Drawer, TextInput, type Column } from "../ui";

interface Selected {
  name: string;
  namespace: string;
}

/**
 * Lists instances of a custom resource (CRD-backed kind) for a cluster, with a
 * namespace filter, search, and a YAML detail drawer. Uses the dynamic
 * `k8s.listCustomResource` + CRD-aware `k8s.getManifest`.
 */
export function CustomResourceBrowser({
  context,
  crd,
  query = "",
  onQueryChange,
  detailDrawerWidth = 480,
}: {
  context: string;
  crd: CrdRef;
  query?: string;
  onQueryChange?: (q: string) => void;
  detailDrawerWidth?: number;
}) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [rows, setRows] = useState<CustomRow[] | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);

  useEffect(() => {
    if (!crd.namespaced) return;
    void listNamespaces(context).then((o) => setNamespaces(o.namespaces ?? []));
  }, [context, crd.namespaced]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError("");
    setSelected(null);
    void listCustomResource(context, crd, crd.namespaced ? namespace : null).then((o) => {
      if (!active) return;
      if (o.error) setError(o.error);
      else setRows(o.items ?? []);
    });
    return () => {
      active = false;
    };
  }, [context, crd, namespace, reloadKey]);

  const columns: Column<CustomRow>[] = [
    { key: "name", header: crd.kind, render: (r) => <strong>{r.name}</strong> },
    ...(crd.namespaced
      ? [
          {
            key: "namespace",
            header: "Namespace",
            render: (r: CustomRow) => <span className="cat-link">{r.namespace}</span>,
          },
        ]
      : []),
    { key: "age", header: "Age", render: (r) => <span className="text-muted-foreground">{r.age}</span> },
  ];

  const filtered = useMemo(
    () => filterTableData(rows ?? [], columns, query, filterColumn),
    [columns, filterColumn, query, rows],
  );
  const filterLabel = filterColumn
    ? columns.find((column) => column.key === filterColumn)?.header
    : null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-2">
          {crd.namespaced && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Namespace</span>
              <Select
                value={namespace}
                onValueChange={setNamespace}
                options={[{ value: "", label: "All namespaces" }, ...namespaces.map((n) => ({ value: n }))]}
                aria-label="Namespace"
                className="min-w-44"
              />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={rows === null}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
          {rows === null && <Spinner label="Loading resources" />}
          <div className="ml-auto w-56">
            <TextInput
              value={query}
              onValueChange={(q) => onQueryChange?.(q)}
              type="search"
              placeholder={typeof filterLabel === "string" ? `Search ${filterLabel}…` : "Search all columns…"}
              aria-label="Search resources"
            />
          </div>
          {!error && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {filtered.length} {filtered.length === 1 ? "item" : "items"}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="px-3 py-2 text-sm text-destructive">Error: {error}</p>}
          {!error && (
            <Table
              columns={columns}
              data={filtered}
              getRowKey={(r) => r.name}
              selectedKey={selected?.name}
              onRowClick={(r) => setSelected({ name: r.name, namespace: r.namespace })}
              activeFilterKey={filterColumn}
              onActiveFilterKeyChange={setFilterColumn}
              emptyText={query ? "No matches" : `No ${crd.kind} resources`}
            />
          )}
        </div>
      </div>

      <Drawer
        open={!!selected}
        defaultWidth={detailDrawerWidth}
        title={selected ? <>{crd.kind}: <code>{selected.name}</code></> : null}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <YamlView
            context={context}
            kind={crd.kind}
            namespace={crd.namespaced ? selected.namespace : null}
            name={selected.name}
            crd={{ group: crd.group, version: crd.version, plural: crd.plural }}
          />
        )}
      </Drawer>
    </div>
  );
}
