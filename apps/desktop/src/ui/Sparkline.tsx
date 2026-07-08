import React from "react";

export interface SparklineProps {
  /** Series values, oldest → newest. */
  values: number[];
  width?: number;
  height?: number;
  /** Line/area colour (any CSS colour or var). */
  color?: string;
  ariaLabel?: string;
}

/**
 * A compact area chart for a numeric time series. The Y axis starts at zero
 * (like the Metrics Server charts in Lens), so bar heights are comparable.
 * Pure SVG — no chart dependency.
 */
export function Sparkline({
  values,
  width = 600,
  height = 72,
  color = "var(--cat-color-accent)",
  ariaLabel,
}: SparklineProps) {
  const pad = 2;
  const max = Math.max(1, ...values) * 1.15; // headroom; avoid divide-by-zero
  const innerH = height - pad * 2;
  const n = values.length;

  const x = (i: number) => (n <= 1 ? width : (i / (n - 1)) * width);
  const y = (v: number) => pad + innerH - (v / max) * innerH;

  // For a single sample, draw a flat line so the chart reads as "steady".
  const pts = n === 1 ? [`0,${y(values[0])}`, `${width},${y(values[0])}`] : values.map((v, i) => `${x(i)},${y(v)}`);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      className="cat-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* baseline + mid gridlines */}
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} className="cat-sparkline__grid" />
      <line x1="0" y1={pad + innerH / 2} x2={width} y2={pad + innerH / 2} className="cat-sparkline__grid" />
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
