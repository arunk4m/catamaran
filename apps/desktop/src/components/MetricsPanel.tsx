import React, { useEffect, useRef, useState } from "react";
import { podMetrics } from "../lib/workloads";
import { nodeMetrics } from "../lib/manifest";
import { Sparkline } from "../ui";

interface Sample {
  cpu: number; // millicores
  mem: number; // MiB
}

const MAX_POINTS = 30;

/**
 * A live metrics chart for a Pod or Node. The Metrics Server only reports the
 * current value, so — like Lens — we poll and build the series over time. CPU
 * and memory each get their own area chart; the latest value is labelled.
 *
 * `podMetricsFn`/`nodeMetricsFn` are injectable for testing.
 */
export function MetricsPanel({
  kind,
  context,
  namespace,
  name,
  intervalMs = 10000,
  podMetricsFn = podMetrics,
  nodeMetricsFn = nodeMetrics,
}: {
  kind: "Pod" | "Node";
  context: string;
  namespace: string | null;
  name: string;
  intervalMs?: number;
  podMetricsFn?: typeof podMetrics;
  nodeMetricsFn?: typeof nodeMetrics;
}) {
  const [series, setSeries] = useState<Sample[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "unavailable">("loading");
  const gotData = useRef(false);

  useEffect(() => {
    let active = true;
    gotData.current = false;
    setSeries([]);
    setStatus("loading");

    async function sample(): Promise<Sample | null> {
      if (kind === "Node") {
        const out = await nodeMetricsFn(context);
        const m = out.metrics?.find((x) => x.name === name);
        return m ? { cpu: m.cpuMillicores, mem: m.memoryMiB } : null;
      }
      const out = await podMetricsFn(context, namespace ?? "");
      const m = out.metrics?.find((x) => x.name === name);
      return m ? { cpu: m.cpuMillicores, mem: m.memoryMiB } : null;
    }

    async function tick() {
      const s = await sample();
      if (!active) return;
      if (s === null) {
        // A transient miss shouldn't wipe an existing series; only show the
        // empty state if we've never received a sample.
        if (!gotData.current) setStatus("unavailable");
        return;
      }
      gotData.current = true;
      setStatus("ok");
      setSeries((prev) => [...prev, s].slice(-MAX_POINTS));
    }

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [kind, context, namespace, name, intervalMs, podMetricsFn, nodeMetricsFn]);

  if (status === "unavailable") {
    return (
      <section className="cat-metrics">
        <h4 className="cat-detail-section__title">Metrics</h4>
        <p className="cat-detail-empty" style={{ margin: 0 }}>
          No metrics available — the cluster needs the Kubernetes Metrics Server.
        </p>
      </section>
    );
  }

  const latest = series[series.length - 1];
  const cores = latest ? (latest.cpu / 1000).toFixed(3) : "—";

  return (
    <section className="cat-metrics">
      <h4 className="cat-detail-section__title">Metrics</h4>
      <p className="cat-metrics__source">Live from the Kubernetes Metrics Server</p>

      <div className="cat-metric">
        <div className="cat-metric__head">
          <span className="cat-metric__name">CPU</span>
          <span className="cat-metric__value">{latest ? `${cores} cores` : "—"}</span>
        </div>
        <Sparkline values={series.map((s) => s.cpu)} color="var(--cat-color-accent)" ariaLabel="CPU usage" />
      </div>

      <div className="cat-metric">
        <div className="cat-metric__head">
          <span className="cat-metric__name">Memory</span>
          <span className="cat-metric__value">{latest ? `${latest.mem} MiB` : "—"}</span>
        </div>
        <Sparkline values={series.map((s) => s.mem)} color="#7aa2f7" ariaLabel="Memory usage" />
      </div>
    </section>
  );
}
