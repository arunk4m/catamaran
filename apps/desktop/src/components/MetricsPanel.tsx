import React, { useEffect, useRef, useState } from "react";
import { podMetrics } from "../lib/workloads";
import { nodeMetrics } from "../lib/manifest";
import { Sparkline } from "../ui";

interface Sample {
  cpu: number; // millicores
  mem: number; // MiB
  t: number; // capture time (ms)
}

/** Selectable timeline windows. Each picks a cadence keeping the series ~30 points. */
export type MetricsRange = "5m" | "10m" | "30m" | "1h";

const RANGES: { id: MetricsRange; label: string; windowMs: number; intervalMs: number }[] = [
  { id: "5m", label: "5m", windowMs: 5 * 60_000, intervalMs: 10_000 },
  { id: "10m", label: "10m", windowMs: 10 * 60_000, intervalMs: 20_000 },
  { id: "30m", label: "30m", windowMs: 30 * 60_000, intervalMs: 60_000 },
  { id: "1h", label: "1h", windowMs: 60 * 60_000, intervalMs: 120_000 },
];

// Hard cap on retained samples (safety against clock jumps / very short cadences).
const MAX_POINTS = 240;

/**
 * A live metrics chart for a Pod or Node. The Metrics Server only reports the
 * current value, so — like Lens — we poll and build the series over time. A
 * time-range picker (5m–1h) chooses the window and sampling cadence. CPU and
 * memory each get their own area chart; the latest value is labelled.
 *
 * `podMetricsFn`/`nodeMetricsFn` are injectable for testing; `intervalMs`, when
 * given, overrides the range's cadence (used by tests to pin ticks).
 */
export function MetricsPanel({
  kind,
  context,
  namespace,
  name,
  intervalMs,
  initialRange = "5m",
  podMetricsFn = podMetrics,
  nodeMetricsFn = nodeMetrics,
}: {
  kind: "Pod" | "Node";
  context: string;
  namespace: string | null;
  name: string;
  intervalMs?: number;
  initialRange?: MetricsRange;
  podMetricsFn?: typeof podMetrics;
  nodeMetricsFn?: typeof nodeMetrics;
}) {
  const [range, setRange] = useState<MetricsRange>(initialRange);
  const [series, setSeries] = useState<Sample[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "unavailable">("loading");
  const gotData = useRef(false);

  const cfg = RANGES.find((r) => r.id === range) ?? RANGES[0];
  const effectiveInterval = intervalMs ?? cfg.intervalMs;
  const windowMs = cfg.windowMs;

  useEffect(() => {
    let active = true;
    gotData.current = false;
    setSeries([]);
    setStatus("loading");

    async function sample(): Promise<Sample | null> {
      if (kind === "Node") {
        const out = await nodeMetricsFn(context);
        const m = out.metrics?.find((x) => x.name === name);
        return m ? { cpu: m.cpuMillicores, mem: m.memoryMiB, t: Date.now() } : null;
      }
      const out = await podMetricsFn(context, namespace ?? "");
      const m = out.metrics?.find((x) => x.name === name);
      return m ? { cpu: m.cpuMillicores, mem: m.memoryMiB, t: Date.now() } : null;
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
      setSeries((prev) => {
        const cutoff = s.t - windowMs;
        return [...prev, s].filter((x) => x.t >= cutoff).slice(-MAX_POINTS);
      });
    }

    void tick();
    const timer = setInterval(() => void tick(), effectiveInterval);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [kind, context, namespace, name, effectiveInterval, windowMs, podMetricsFn, nodeMetricsFn]);

  const rangePicker = (
    <div className="cat-metrics__range" role="group" aria-label="Metrics time range">
      {RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`cat-metrics__range-btn${range === r.id ? " cat-metrics__range-btn--active" : ""}`}
          aria-pressed={range === r.id}
          onClick={() => setRange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  if (status === "unavailable") {
    return (
      <section className="cat-metrics">
        <div className="cat-metrics__head">
          <h4 className="cat-detail-section__title">Metrics</h4>
          {rangePicker}
        </div>
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
      <div className="cat-metrics__head">
        <h4 className="cat-detail-section__title">Metrics</h4>
        {rangePicker}
      </div>
      <p className="cat-metrics__source">Live from the Kubernetes Metrics Server · last {cfg.label}</p>

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
