import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export type DashboardTone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("cat-page-shell", className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="cat-page-header">
      <div className="cat-page-header__copy">
        {eyebrow && <p className="cat-page-header__eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="cat-page-header__actions">{actions}</div>}
    </header>
  );
}

export function SectionPanel({
  title,
  description,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("cat-section-panel", className)}>
      {(title || description) && (
        <header className="cat-section-panel__header">
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </header>
      )}
      <div className="cat-section-panel__body">{children}</div>
    </section>
  );
}

export function MetricTile({
  label,
  value,
  description,
  tone = "neutral",
  action,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  description?: React.ReactNode;
  tone?: DashboardTone;
  action?: React.ReactNode;
}) {
  return (
    <article className={cn("cat-metric-tile", `cat-tone-${tone}`)}>
      <div className="cat-metric-tile__main">
        <p className="cat-metric-tile__label">{label}</p>
        <strong className="cat-metric-tile__value">{value}</strong>
        {description && <p className="cat-metric-tile__description">{description}</p>}
      </div>
      {action && <div className="cat-metric-tile__action">{action}</div>}
    </article>
  );
}

export function StatusMeter({
  label,
  value,
  detail,
  tone = "primary",
}: {
  label: React.ReactNode;
  value: number;
  detail?: React.ReactNode;
  tone?: DashboardTone;
}) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("cat-status-meter", `cat-tone-${tone}`)}>
      <div className="cat-status-meter__header">
        <span>{label}</span>
        <strong>{bounded.toFixed(0)}%</strong>
      </div>
      <div className="cat-status-meter__track">
        <span style={{ width: `${bounded}%` }} />
      </div>
      {detail && <p className="cat-status-meter__detail">{detail}</p>}
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("cat-toolbar", className)}>{children}</div>;
}

export function EmptyState({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="cat-empty-state">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

/** Error card for a failed load — a clear title, an actionable detail, and an optional retry. */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = "Retry",
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="cat-error-state" role="alert">
      <AlertTriangle className="cat-error-state__icon" aria-hidden />
      <strong className="cat-error-state__title">{title}</strong>
      {detail && <p className="cat-error-state__detail">{detail}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

// Backward-compatible aliases for older imports while surfaces are migrated.
export const DashboardPage = PageShell;
export const DashboardHero = SectionPanel;
export const DashboardCard = MetricTile;
export const DashboardMeter = StatusMeter;
export const DashboardChip = MetricTile;
export function DashboardSegmentBar({
  segments,
}: {
  segments: Array<{ value: number; tone: DashboardTone; label: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  return (
    <div className="cat-segment-bar" aria-label="Segmented status bar">
      {segments.map((segment) => {
        const width = total > 0 ? (segment.value / total) * 100 : 0;
        return (
          <span
            key={segment.label}
            className={cn("cat-segment-bar__item", `cat-tone-${segment.tone}`)}
            style={{ width: `${width}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        );
      })}
    </div>
  );
}
