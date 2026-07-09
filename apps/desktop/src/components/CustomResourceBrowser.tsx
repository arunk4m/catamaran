import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { listCustomResource, type CrdRef, type CustomRow } from "../lib/crds";
import { listNamespaces } from "../lib/workloads";
import { loadHiddenColumns, saveHiddenColumns } from "../lib/settings";
import { YamlView } from "./YamlView";
import {
  Table,
  filterTableData,
  Select,
  Button,
  ColumnPicker,
  Spinner,
  Drawer,
  TextInput,
  type Column,
  type ColumnOption,
} from "../ui";

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
  // Hidden columns, persisted per CRD (its metadata.name is unique per cluster).
  const columnStoreKey = `crd:${crd.name}`;
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(loadHiddenColumns(columnStoreKey)),
  );
  useEffect(() => {
    setHiddenColumns(new Set(loadHiddenColumns(`crd:${crd.name}`)));
  }, [crd.name]);

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

  const columns: Column<CustomRow>[] = useMemo(
    () => [
      { key: "name", header: crd.kind, render: (r: CustomRow) => <strong>{r.name}</strong> },
      ...(crd.namespaced
        ? [
            {
              key: "namespace",
              header: "Namespace",
              render: (r: CustomRow) => <span className="cat-link">{r.namespace}</span>,
            },
          ]
        : []),
      {
        key: "age",
        header: "Age",
        render: (r: CustomRow) => <span className="text-muted-foreground">{r.age}</span>,
      },
    ],
    [crd.kind, crd.namespaced],
  );

  // The name column identifies the row and is always shown.
  const pinnedColumnKey = "name";
  const visibleColumns = useMemo(
    () => columns.filter((column) => column.key === pinnedColumnKey || !hiddenColumns.has(column.key)),
    [columns, hiddenColumns],
  );
  const columnOptions: ColumnOption[] = columns.map((column) => ({
    key: column.key,
    label: typeof column.header === "string" ? column.header : column.key,
  }));
  function toggleColumn(key: string) {
    if (key === pinnedColumnKey) return;
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveHiddenColumns(columnStoreKey, [...next]);
      return next;
    });
    // A hidden column can't stay the active search filter.
    setFilterColumn((current) => (current === key ? null : current));
  }

  const filtered = useMemo(
    () => filterTableData(rows ?? [], visibleColumns, query, filterColumn),
    [visibleColumns, filterColumn, query, rows],
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
          <ColumnPicker
            columns={columnOptions}
            hidden={hiddenColumns}
            onToggle={toggleColumn}
            pinnedKey={pinnedColumnKey}
          />
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
              columns={visibleColumns}
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
