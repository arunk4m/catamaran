import React, { useEffect, useRef } from "react";
import { Logs, SquareTerminal, X } from "lucide-react";
import { PodTerminal } from "./PodTerminal";
import { LogsView, type LogsSource } from "./LogsView";

export type DockKind = "terminal" | "logs";

export interface DockSession {
  id: number;
  kind: DockKind;
  context: string;
  namespace: string;
  /** Present for terminals and single-pod logs. */
  pod?: string;
  /** Preselect this container in single-pod logs (from a per-container action). */
  container?: string;
  /** Present for workload (e.g. Deployment) logs that span many pods. */
  workload?: { kind: string; name: string };
}

/** Tab/session label: the pod name, or the workload kind/name. */
function sessionLabel(s: DockSession): string {
  if (s.pod) return s.pod;
  if (s.workload) return `${s.workload.kind}/${s.workload.name}`;
  return "session";
}

/**
 * catamaran bottom dock: a resizable panel with a tab per session —
 * in-pod shells (kube-rs exec) and pod/workload logs both live here.
 */
export function Dock({
  sessions,
  activeId,
  height,
  onActivate,
  onCloseTab,
  onClose,
  onResize,
}: {
  sessions: DockSession[];
  activeId: number | null;
  height: number;
  onActivate: (id: number) => void;
  onCloseTab: (id: number) => void;
  onClose: () => void;
  onResize: (height: number) => void;
}) {
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const startY = useRef(0);
  const startH = useRef(0);
  const heightRef = useRef(height);
  heightRef.current = height;
  const handleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    function onMove(e: MouseEvent) {
      const delta = startY.current - e.clientY;
      onResize(Math.max(120, Math.min(720, startH.current + delta)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    }
    function startDrag(e: MouseEvent) {
      e.preventDefault();
      startY.current = e.clientY;
      startH.current = heightRef.current;
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    handle.addEventListener("mousedown", startDrag);
    return () => {
      handle.removeEventListener("mousedown", startDrag);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, [onResize]);

  return (
    <div className="cat-dock" style={{ height }}>
      <div className="cat-dock__resize" ref={handleRef} role="separator" aria-orientation="horizontal" aria-label="Resize logs panel">
        <span className="cat-dock__grip" />
      </div>
      <div className="cat-dock__tabs">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="tab"
            aria-selected={s.id === activeId}
            className={`cat-dock__tab${s.id === activeId ? " cat-dock__tab--active" : ""}`}
            onClick={() => onActivate(s.id)}
          >
            <span>
              {s.kind === "terminal" ? <SquareTerminal aria-hidden="true" /> : <Logs aria-hidden="true" />}
              {sessionLabel(s)}
            </span>
            <button
              className="cat-dock__tab-close"
              aria-label={`Close ${sessionLabel(s)} ${s.kind}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(s.id);
              }}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="cat-dock__spacer" />
        <button className="cat-dock__close" aria-label="Close dock" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="cat-dock__body">
        {active &&
          (active.kind === "terminal" && active.pod ? (
            <PodTerminal
              key={active.id}
              context={active.context}
              namespace={active.namespace}
              pod={active.pod}
              container={active.container}
            />
          ) : (
            <LogsView
              key={active.id}
              context={active.context}
              namespace={active.namespace}
              initialContainer={active.container}
              source={
                (active.pod
                  ? { type: "pod", pod: active.pod }
                  : { type: "workload", kind: active.workload!.kind, name: active.workload!.name }) as LogsSource
              }
            />
          ))}
      </div>
    </div>
  );
}
