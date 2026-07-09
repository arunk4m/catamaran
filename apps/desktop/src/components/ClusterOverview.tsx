import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listNamespaces, podCounts, type PodCounts } from "../lib/workloads";
import { listNodes, listResource, listEvents } from "../lib/manifest";
import {
  DashboardSegmentBar,
  EmptyState,
  ErrorState,
  MetricTile,
  PageHeader,
  PageShell,
  SectionPanel,
  Spinner,
  StatusMeter,
} from "../ui";
import { describeError } from "../lib/errors";
import type { ResourceKind } from "./ResourceBrowser";

/**
 * Overview stats degrade per section: a slow or failing count renders as "—"
 * with a note, instead of taking the whole dashboard down. Only when every
 * section fails (the cluster is genuinely unreachable) does the page show the
 * full error state.
 */
interface Stats {
  nodes: { total: number; ready: number } | null;
  pods: { total: number; running: number; pending: number; other: number } | null;
  deployments: number | null;
  services: number | null;
  namespaces: number | null;
  events: { total: number; normal: number; warnings: number; recentWarnings: string[] } | null;
  /** Human-readable names of sections whose fetch failed. */
  unavailable: string[];
}

interface OverviewSnapshot {
  stats: Stats;
  updatedAt: number;
}

const CACHE_TTL_MS = 30_000;
const overviewCache = new Map<string, OverviewSnapshot>();
const overviewRequests = new Map<string, Promise<OverviewSnapshot>>();

/** Clear cached overview snapshots. Exported for deterministic tests and future logout/reset flows. */
export function clearClusterOverviewCache(context?: string) {
  if (context) {
    overviewCache.delete(context);
    overviewRequests.delete(context);
    return;
  }
  overviewCache.clear();
  overviewRequests.clear();
}

function formatUpdatedAt(updatedAt: number) {
  return new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(updatedAt));
}

function podStats(counts: PodCounts) {
  return {
    total: counts.total,
    running: counts.running,
    pending: counts.pending,
    other: counts.total - counts.running - counts.pending,
  };
}

async function fetchOverview(context: string): Promise<OverviewSnapshot> {
  const [nodes, pods, deps, svcs, ns, events] = await Promise.all([
    listNodes(context),
    podCounts(context, ""),
    listResource(context, "Deployment", ""),
    listResource(context, "Service", ""),
    listNamespaces(context),
    listEvents(context, null),
  ]);

  const failures: Array<{ section: string; error: string }> = [];
  if (nodes.error) failures.push({ section: "nodes", error: nodes.error });
  if (pods.error) failures.push({ section: "pods", error: pods.error });
  if (deps.error) failures.push({ section: "workloads", error: deps.error });
  if (svcs.error) failures.push({ section: "services", error: svcs.error });
  if (ns.error) failures.push({ section: "namespaces", error: ns.error });
  if (events.error) failures.push({ section: "events", error: events.error });

  // Everything failed → the cluster really is unreachable; surface the error.
  if (failures.length === 6) throw new Error(failures[0].error);

  const eventList = events.events ?? [];
  const warningEvents = eventList.filter((event) => event.type === "Warning");
  return {
    stats: {
      nodes: nodes.error
        ? null
        : {
            total: (nodes.nodes ?? []).length,
            ready: (nodes.nodes ?? []).filter((node) => node.status === "Ready").length,
          },
      pods: pods.error || !pods.counts ? null : podStats(pods.counts),
      deployments: deps.error ? null : (deps.items ?? []).length,
      services: svcs.error ? null : (svcs.items ?? []).length,
      namespaces: ns.error ? null : (ns.namespaces ?? []).length,
      events: events.error
        ? null
        : {
            total: eventList.length,
            normal: eventList.filter((event) => event.type !== "Warning").length,
            warnings: warningEvents.length,
            recentWarnings: warningEvents.slice(0, 2).map((event) => `${event.reason}: ${event.message}`),
          },
      unavailable: failures.map((failure) => failure.section),
    },
    updatedAt: Date.now(),
  };
}

function requestOverview(context: string, force: boolean): Promise<OverviewSnapshot> {
  const cached = overviewCache.get(context);
  if (!force && cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return Promise.resolve(cached);
  }

  const pending = overviewRequests.get(context);
  if (pending) return pending;

  const request = fetchOverview(context)
    .then((snapshot) => {
      overviewCache.set(context, snapshot);
      return snapshot;
    })
    .finally(() => {
      overviewRequests.delete(context);
    });
  overviewRequests.set(context, request);
  return request;
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

/** Cluster overview dashboard: at-a-glance counts and health. */
export function ClusterOverview({
  context,
  onOpenView,
}: {
  context: string;
  onOpenView?: (kind: ResourceKind) => void;
}) {
  const initialSnapshot = overviewCache.get(context);
  const [stats, setStats] = useState<Stats | null>(() => initialSnapshot?.stats ?? null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(() =>
    initialSnapshot ? formatUpdatedAt(initialSnapshot.updatedAt) : "",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const forceRefresh = useRef(false);

  useEffect(() => {
    let active = true;
    const cached = overviewCache.get(context);
    const force = forceRefresh.current;
    forceRefresh.current = false;

    setStats(cached?.stats ?? null);
    setError("");
    setLastUpdated(cached ? formatUpdatedAt(cached.updatedAt) : "");

    const fresh = cached && Date.now() - cached.updatedAt < CACHE_TTL_MS;
    if (fresh && !force) {
      return () => {
        active = false;
      };
    }

    setRefreshing(true);
    void requestOverview(context, force)
      .then((snapshot) => {
        if (!active) return;
        setStats(snapshot.stats);
        setLastUpdated(formatUpdatedAt(snapshot.updatedAt));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [context, reloadKey]);

  function refresh() {
    forceRefresh.current = true;
    setReloadKey((key) => key + 1);
  }

  if (error && !stats) {
    const friendly = describeError(error);
    return <ErrorState title={friendly.title} detail={friendly.detail} onRetry={refresh} />;
  }
  if (!stats) return <Spinner label="Loading overview" />;

  const nodeReadiness = stats.nodes ? percent(stats.nodes.ready, stats.nodes.total) : 0;
  const podHealth = stats.pods ? percent(stats.pods.running, stats.pods.total) : 0;
  const eventHealth = stats.events ? percent(stats.events.normal, stats.events.total) : 0;
  const degraded = stats.unavailable.length > 0;

  const headerBits = [
    stats.nodes ? `${stats.nodes.ready}/${stats.nodes.total} ready nodes` : null,
    stats.pods ? `${stats.pods.running}/${stats.pods.total} running pods` : null,
    `updated ${lastUpdated || "now"}`,
  ].filter(Boolean);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cluster overview"
        title={context}
        description={`${headerBits.join(" · ")}${
          degraded ? ` · ${stats.unavailable.join(", ")} unavailable — retry` : ""
        }${error ? " · refresh failed" : ""}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh cluster overview"
          >
            <RefreshCw data-icon="inline-start" className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      <div className="cat-metric-grid">
        <MetricTile
          label="Nodes"
          value={stats.nodes ? `${stats.nodes.ready} / ${stats.nodes.total}` : "—"}
          description={stats.nodes ? "Ready / total" : "Count unavailable"}
          tone={!stats.nodes ? "warning" : nodeReadiness === 100 ? "success" : "warning"}
        />
        <MetricTile
          label="Pods"
          value={stats.pods ? `${stats.pods.running} / ${stats.pods.total}` : "—"}
          description={stats.pods ? "Running / total" : "Count unavailable"}
          tone={!stats.pods ? "warning" : stats.pods.other > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Workloads"
          value={stats.deployments ?? "—"}
          description={stats.deployments != null ? "Deployments" : "Count unavailable"}
          tone="primary"
        />
        <MetricTile
          label="Services"
          value={stats.services ?? "—"}
          description={stats.services != null ? "Cluster services" : "Count unavailable"}
          tone="info"
        />
        <MetricTile
          label="Namespaces"
          value={stats.namespaces ?? "—"}
          description={stats.namespaces != null ? "Active namespaces" : "Count unavailable"}
        />
        <MetricTile
          label="Warnings"
          value={stats.events ? stats.events.warnings : "—"}
          description={stats.events ? "Recent events" : "Count unavailable"}
          tone={!stats.events ? "warning" : stats.events.warnings > 0 ? "warning" : "success"}
        />
      </div>

      <SectionPanel title="Cluster health" description="Readiness and recent event signal from Kubernetes API data.">
        <div className="cat-status-grid">
          {stats.nodes && (
            <StatusMeter
              label="Node readiness"
              value={nodeReadiness}
              detail={`${stats.nodes.ready} ready / ${stats.nodes.total} total`}
              tone={nodeReadiness === 100 ? "success" : "warning"}
            />
          )}
          {stats.pods && (
            <StatusMeter
              label="Pod health"
              value={podHealth}
              detail={`${stats.pods.running} running / ${stats.pods.total} total`}
              tone={stats.pods.other > 0 ? "warning" : "primary"}
            />
          )}
          {stats.events && (
            <StatusMeter
              label="Event health"
              value={eventHealth}
              detail={`${stats.events.normal} normal / ${stats.events.total} total`}
              tone={stats.events.warnings > 0 ? "warning" : "success"}
            />
          )}
          {!stats.nodes && !stats.pods && !stats.events && (
            <EmptyState title="Health signal unavailable" description="Counts did not load — retry to fetch them again." />
          )}
        </div>
      </SectionPanel>

      <div className="cat-overview-grid">
        <SectionPanel title="Pod distribution">
          {stats.pods ? (
            <DashboardSegmentBar
              segments={[
                { value: stats.pods.running, tone: "success", label: "Running" },
                { value: stats.pods.pending, tone: "warning", label: "Pending" },
                { value: stats.pods.other, tone: "danger", label: "Other" },
              ]}
            />
          ) : (
            <EmptyState
              title="Pod counts unavailable"
              description="The pod count didn't load in time — the rest of the overview is unaffected."
            />
          )}
          <div className="cat-inline-actions">
            <button type="button" className="cat-text-action" onClick={() => onOpenView?.("pods")}>View pods</button>
            <button type="button" className="cat-text-action" onClick={() => onOpenView?.("nodes")}>View nodes</button>
          </div>
        </SectionPanel>

        <SectionPanel title="Recent warnings">
          {stats.events && stats.events.recentWarnings.length > 0 ? (
            <ul className="cat-dashboard-events">
              {stats.events.recentWarnings.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : stats.events ? (
            <EmptyState title="No warning events" description="The API did not return recent warning events." />
          ) : (
            <EmptyState title="Events unavailable" description="Event data didn't load — retry to fetch it again." />
          )}
          <div className="cat-inline-actions">
            <button type="button" className="cat-text-action" onClick={() => onOpenView?.("events")}>View events</button>
          </div>
        </SectionPanel>
      </div>
    </PageShell>
  );
}
