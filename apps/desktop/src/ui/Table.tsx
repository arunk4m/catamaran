import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter } from "lucide-react";
import {
  Table as ShadTable,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState } from "./Dashboard";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Render the cell for a row; defaults to `String(row[key])`. */
  render?: (row: T) => React.ReactNode;
  /** Value used for sorting and filtering when it differs from `row[key]`. */
  getValue?: (row: T) => unknown;
  sortable?: boolean;
  filterable?: boolean;
  minWidth?: number;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Row key currently selected (highlighted). */
  selectedKey?: string;
  /** Shown when `data` is empty. */
  emptyText?: React.ReactNode;
  /** Column currently used by the toolbar search; null searches every column. */
  activeFilterKey?: string | null;
  onActiveFilterKeyChange?: (key: string | null) => void;
}

function getColumnValue<T>(row: T, column: Column<T>): unknown {
  return column.getValue ? column.getValue(row) : (row as Record<string, unknown>)[column.key];
}

/**
 * The slice of rows to render for a virtualized list. Returns the full range
 * when `rowHeight` is unknown (0) — e.g. before measurement or in jsdom — so the
 * table degrades to rendering everything rather than dividing by zero.
 */
export function computeVisibleRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  total,
  overscan,
}: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  total: number;
  overscan: number;
}): { start: number; end: number } {
  if (rowHeight <= 0) return { start: 0, end: total };
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const end = Math.min(total, firstVisible + visibleCount + overscan);
  const start = Math.min(Math.max(0, firstVisible - overscan), end);
  return { start, end };
}

/** Apply the toolbar query to one selected column, or all searchable columns. */
export function filterTableData<T>(
  data: T[],
  columns: Column<T>[],
  query: string,
  activeFilterKey: string | null,
): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return data;
  const searchable = activeFilterKey
    ? columns.filter((column) => column.key === activeFilterKey)
    : columns.filter((column) => column.filterable !== false);
  if (searchable.length === 0) return data;
  return data.filter((row) =>
    searchable.some((column) =>
      String(getColumnValue(row, column) ?? "").toLocaleLowerCase().includes(normalized),
    ),
  );
}

/** Generic data table used for every resource list in the app (shadcn Table). */
export function Table<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  selectedKey,
  emptyText = "No items",
  activeFilterKey = null,
  onActiveFilterKeyChange,
}: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const columnSignature = columns.map((column) => column.key).join("|");
  const rootRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: 0, rowHeight: 0 });

  useEffect(() => setColumnWidths({}), [columnSignature]);

  const visibleData = useMemo(() => {
    if (!sort) return data;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return data;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return data
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = getColumnValue(a.row, column);
        const right = getColumnValue(b.row, column);
        let result: number;
        if (typeof left === "number" && typeof right === "number") result = left - right;
        else result = collator.compare(String(left ?? ""), String(right ?? ""));
        return result ? result * (sort.direction === "asc" ? 1 : -1) : a.index - b.index;
      })
      .map(({ row }) => row);
  }, [columns, data, sort]);

  const cycleSort = (key: string) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const startColumnResize = (event: React.PointerEvent<HTMLDivElement>, column: Column<T>) => {
    event.preventDefault();
    event.stopPropagation();
    const table = event.currentTarget.closest("table");
    const headers = table?.querySelectorAll<HTMLTableCellElement>("thead tr:first-child th");
    const measured = Object.fromEntries(
      columns.map((candidate, index) => [
        candidate.key,
        Math.round(headers?.[index]?.getBoundingClientRect().width || columnWidths[candidate.key] || 120),
      ]),
    );
    const startWidth = measured[column.key];
    const startX = event.clientX;
    setColumnWidths(measured);

    const onMove = (moveEvent: PointerEvent) => {
      const minWidth = column.minWidth ?? 72;
      setColumnWidths((current) => ({
        ...current,
        [column.key]: Math.max(minWidth, startWidth + moveEvent.clientX - startX),
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("cat-is-resizing-column");
    };
    document.body.classList.add("cat-is-resizing-column");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const resizeColumnWithKeyboard = (
    event: React.KeyboardEvent<HTMLDivElement>,
    column: Column<T>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const table = event.currentTarget.closest("table");
    const headers = table?.querySelectorAll<HTMLTableCellElement>("thead tr:first-child th");
    const measured = Object.fromEntries(
      columns.map((candidate, index) => [
        candidate.key,
        Math.round(headers?.[index]?.getBoundingClientRect().width || columnWidths[candidate.key] || 120),
      ]),
    );
    const delta = event.key === "ArrowRight" ? 16 : -16;
    setColumnWidths((current) => {
      const baseline = Object.keys(current).length ? current : measured;
      return {
        ...baseline,
        [column.key]: Math.max(column.minWidth ?? 72, baseline[column.key] + delta),
      };
    });
  };

  const tableWidth = Object.keys(columnWidths).length
    ? Object.values(columnWidths).reduce((total, width) => total + width, 0)
    : undefined;

  // Virtualize long lists: render only the rows near the viewport plus spacer
  // rows that reserve the scroll height. Below the threshold — or before the row
  // height can be measured (jsdom, first paint) — render everything.
  const VIRTUALIZE_THRESHOLD = 60;
  const OVERSCAN = 8;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || visibleData.length <= VIRTUALIZE_THRESHOLD) return;
    let scrollParent: HTMLElement | null = root.parentElement;
    while (scrollParent && scrollParent !== document.body) {
      const overflowY = getComputedStyle(scrollParent).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    if (!scrollParent) return;
    const parent = scrollParent;
    const measure = () => {
      const firstRow = root.querySelector<HTMLElement>("tbody tr.cat-data-table__row");
      setMetrics({
        scrollTop: parent.scrollTop,
        viewportHeight: parent.clientHeight,
        rowHeight: firstRow ? firstRow.getBoundingClientRect().height : 0,
      });
    };
    measure();
    parent.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(parent);
    return () => {
      parent.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [visibleData.length]);

  const virtualize = visibleData.length > VIRTUALIZE_THRESHOLD && metrics.rowHeight > 0;
  const range = virtualize
    ? computeVisibleRange({
        scrollTop: metrics.scrollTop,
        viewportHeight: metrics.viewportHeight,
        rowHeight: metrics.rowHeight,
        total: visibleData.length,
        overscan: OVERSCAN,
      })
    : { start: 0, end: visibleData.length };
  const windowRows = virtualize ? visibleData.slice(range.start, range.end) : visibleData;
  const topPad = virtualize ? range.start * metrics.rowHeight : 0;
  const bottomPad = virtualize ? (visibleData.length - range.end) * metrics.rowHeight : 0;

  if (data.length === 0) {
    return <EmptyState title={emptyText} />;
  }
  return (
    <div ref={rootRef} style={{ display: "contents" }}>
    <ShadTable
      className={cn(
        "cat-data-table",
        tableWidth && "cat-data-table--resized",
        onRowClick && "cat-data-table--interactive",
      )}
      style={tableWidth ? { width: tableWidth, minWidth: "100%" } : undefined}
    >
      <colgroup>
        {columns.map((column) => (
          <col
            key={column.key}
            style={columnWidths[column.key] ? { width: columnWidths[column.key] } : undefined}
          />
        ))}
      </colgroup>
      <TableHeader className="sticky top-0 z-10">
        <TableRow className="hover:bg-transparent">
          {columns.map((c) => (
            <TableHead key={c.key} className="cat-data-table__head">
              <div className="cat-data-table__head-content">
                <button
                  type="button"
                  className="cat-data-table__sort"
                  onClick={() => cycleSort(c.key)}
                  disabled={c.sortable === false}
                  aria-label={`Sort by ${typeof c.header === "string" ? c.header : c.key}`}
                >
                  <span>{c.header}</span>
                  {c.sortable !== false &&
                    (sort?.key !== c.key ? (
                      <ArrowUpDown aria-hidden="true" />
                    ) : sort.direction === "asc" ? (
                      <ArrowUp aria-hidden="true" />
                    ) : (
                      <ArrowDown aria-hidden="true" />
                    ))}
                </button>
                {c.filterable !== false && onActiveFilterKeyChange && (
                  <button
                    type="button"
                    className={cn("cat-data-table__filter-toggle", activeFilterKey === c.key && "is-active")}
                    onClick={() => onActiveFilterKeyChange(activeFilterKey === c.key ? null : c.key)}
                    aria-label={`Filter search by ${typeof c.header === "string" ? c.header : c.key}`}
                    aria-pressed={activeFilterKey === c.key}
                  >
                    <Filter aria-hidden="true" />
                  </button>
                )}
              </div>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${typeof c.header === "string" ? c.header : c.key} column`}
                tabIndex={0}
                className="cat-data-table__resize-handle"
                onPointerDown={(event) => startColumnResize(event, c)}
                onKeyDown={(event) => resizeColumnWithKeyboard(event, c)}
                onDoubleClick={() => setColumnWidths({})}
                title="Drag to resize; double-click to reset"
              />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {topPad > 0 && (
          <tr aria-hidden="true" className="cat-data-table__spacer">
            <td colSpan={columns.length} style={{ height: topPad, padding: 0, border: 0 }} />
          </tr>
        )}
        {windowRows.map((row) => {
          const rowKey = getRowKey(row);
          const selected = selectedKey === rowKey;
          return (
            <TableRow
              key={rowKey}
              aria-selected={selected}
              data-state={selected ? "selected" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("cat-data-table__row", onRowClick && "cursor-pointer")}
            >
              {columns.map((c) => (
                <TableCell key={c.key} className="cat-data-table__cell">
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key])}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
        {bottomPad > 0 && (
          <tr aria-hidden="true" className="cat-data-table__spacer">
            <td colSpan={columns.length} style={{ height: bottomPad, padding: 0, border: 0 }} />
          </tr>
        )}
        {visibleData.length === 0 && (
          <TableRow>
            <TableCell colSpan={columns.length} className="cat-data-table__no-results">
              No matching items
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </ShadTable>
    </div>
  );
}
