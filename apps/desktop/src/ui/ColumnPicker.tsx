import React from "react";
import { Columns3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "./Button";

export interface ColumnOption {
  key: string;
  label: string;
}

/**
 * Toolbar control for choosing which table columns are visible. Each column is a
 * checkbox; the `pinnedKey` column (the row identifier) is always shown and
 * can't be toggled off. Visibility state is owned by the caller so it can be
 * persisted and applied to the table.
 */
export function ColumnPicker({
  columns,
  hidden,
  onToggle,
  pinnedKey,
  label = "Columns",
}: {
  columns: ColumnOption[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  pinnedKey?: string;
  label?: string;
}) {
  const hiddenCount = columns.filter((c) => c.key !== pinnedKey && hidden.has(c.key)).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Choose columns">
          <Columns3 data-icon="inline-start" />
          {label}
          {hiddenCount > 0 && <span className="tabular-nums opacity-70">({columns.length - hiddenCount})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <div role="group" aria-label="Toggle columns" className="cat-column-picker">
          {columns.map((column) => {
            const pinned = column.key === pinnedKey;
            const checked = pinned || !hidden.has(column.key);
            return (
              <label
                key={column.key}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent aria-disabled:opacity-60"
                aria-disabled={pinned}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pinned}
                  onChange={() => onToggle(column.key)}
                />
                <span>{column.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
