import React, { useEffect, useMemo, useState } from "react";
import { Braces } from "lucide-react";
import { listCrdsCached, crdGroupMatches, type CrdRef } from "../lib/crds";
import { cn } from "@/lib/utils";

/**
 * A curated sidebar group that surfaces a specific operator's CRDs (e.g. KEDA's
 * ScaledObjects, Karpenter's NodePools) as first-class entries instead of
 * leaving them buried in the generic Custom Resources tree. It discovers the
 * cluster's CRDs (shared cache) and shows only those whose API group matches;
 * if none are installed it says so rather than vanishing, so the capability is
 * still discoverable.
 */
export function CuratedCrdGroup({
  cluster,
  groups,
  open,
  activeCrd,
  onSelectCrd,
  renderTrigger,
  listCrdsFn = listCrdsCached,
}: {
  cluster: string;
  /** API groups whose CRDs belong here (e.g. `["keda.sh"]`). */
  groups: string[];
  open: boolean;
  activeCrd?: CrdRef | null;
  onSelectCrd: (crd: CrdRef) => void;
  renderTrigger: (open: boolean, onToggle: () => void) => React.ReactNode;
  listCrdsFn?: typeof listCrdsCached;
}) {
  const [allCrds, setAllCrds] = useState<CrdRef[] | null>(null);
  const [error, setError] = useState("");
  const [localOpen, setLocalOpen] = useState(open);

  useEffect(() => setLocalOpen(open), [open]);

  useEffect(() => {
    if (!localOpen || allCrds !== null) return; // load once, when first opened
    let active = true;
    void listCrdsFn(cluster).then((out) => {
      if (!active) return;
      if (out.error) setError(out.error);
      else setAllCrds(out.crds ?? []);
    });
    return () => {
      active = false;
    };
  }, [localOpen, cluster, allCrds, listCrdsFn]);

  const matches = useMemo(
    () =>
      (allCrds ?? [])
        .filter((c) => crdGroupMatches(c, groups))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    [allCrds, groups],
  );

  return (
    <div>
      {renderTrigger(localOpen, () => setLocalOpen((o) => !o))}
      {localOpen && (
        <div className="flex flex-col">
          {allCrds === null && !error && (
            <span className="py-0.5 pl-7 text-xs text-muted-foreground">Loading…</span>
          )}
          {error && <span className="py-0.5 pl-7 text-xs text-muted-foreground">Unavailable</span>}
          {allCrds !== null && !error && matches.length === 0 && (
            <span className="py-0.5 pl-7 text-xs text-muted-foreground">Not installed</span>
          )}
          {matches.map((crd) => {
            const active = activeCrd?.name === crd.name;
            return (
              <button
                key={crd.name}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelectCrd(crd)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md py-0.5 pr-2 pl-7 text-left text-xs transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Braces className="cat-crd-icon" aria-hidden="true" />
                <span className="truncate" title={`${crd.kind}.${crd.group}`}>
                  {crd.kind}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
