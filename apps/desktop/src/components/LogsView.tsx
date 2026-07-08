import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clock, Download, History, Pause, Play, RefreshCw, WrapText } from "lucide-react";
import { podLogs, podsForSelector } from "../lib/workloads";
import { getObject } from "../lib/manifest";
import { startLogStream, type LogStream, type LogTarget, type LogStatus } from "../lib/logsStream";
import { saveTextFile } from "../lib/files";
import { Spinner, Select, IconButton, TextInput } from "../ui";

/** What a logs view is following: a single pod, or every pod of a workload. */
export type LogsSource =
  | { type: "pod"; pod: string }
  | { type: "workload"; kind: string; name: string };

/** Sentinel option value meaning "all pods" / "all containers". */
const ALL = "__all__";
/** Cap the live-tail buffer so a chatty stream can't grow without bound. */
const MAX_LINES = 5000;

/** Selectable log windows: a trailing line count, or a time span. */
const WINDOW_CHOICES = [
  { value: "tail:100", label: "Last 100 lines" },
  { value: "tail:200", label: "Last 200 lines" },
  { value: "tail:1000", label: "Last 1,000 lines" },
  { value: "tail:5000", label: "Last 5,000 lines" },
  { value: "since:300", label: "Last 5 minutes" },
  { value: "since:900", label: "Last 15 minutes" },
  { value: "since:3600", label: "Last hour" },
  { value: "since:21600", label: "Last 6 hours" },
  { value: "since:86400", label: "Last 24 hours" },
];

/** Decode a window selection ("tail:200" / "since:3600") into fetch options. */
export function windowOptions(selection: string): { tailLines?: number; sinceSeconds?: number } {
  const [mode, raw] = selection.split(":");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { tailLines: 200 };
  return mode === "since" ? { sinceSeconds: n } : { tailLines: n };
}

/** Classify a klog-style line (I/W/E0629 …) for colourising. */
function lineLevel(line: string): "error" | "warn" | "info" | "plain" {
  // Timestamps mode prefixes each line with RFC3339 — skip it for detection.
  const text = line.replace(/^\d{4}-\d{2}-\d{2}T[0-9:.+Zz-]+\s+/, "");
  if (/^E\d{4}\b/.test(text) || /\b(error|fatal|panic)\b/i.test(text)) return "error";
  if (/^W\d{4}\b/.test(text) || /\bwarn(ing)?\b/i.test(text)) return "warn";
  if (/^I\d{4}\b/.test(text)) return "info";
  return "plain";
}

const LEVEL_CLASS: Record<string, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-foreground/90",
  plain: "text-foreground/80",
};

/**
 * Pod / workload logs in a themed, scrollable panel. Supports picking a single
 * pod or all pods of a workload, a single container or all containers, text
 * search, line-wrap, downloading the buffer, and a live-tail (follow) mode that
 * streams new lines as they arrive.
 */
export function LogsView({
  context,
  namespace,
  source,
  initialContainer,
}: {
  context: string;
  namespace: string;
  source: LogsSource;
  /** Preselect this container instead of "all" (from a per-container action). */
  initialContainer?: string;
}) {
  const srcType = source.type;
  const srcPod = source.type === "pod" ? source.pod : "";
  const srcKind = source.type === "workload" ? source.kind : "";
  const srcName = source.type === "workload" ? source.name : "";

  const [pods, setPods] = useState<string[]>(srcType === "pod" ? [srcPod] : []);
  const [containersByPod, setContainersByPod] = useState<Record<string, string[]>>({});
  const [pod, setPod] = useState<string>(srcType === "pod" ? srcPod : ALL);
  const [container, setContainer] = useState<string>(initialContainer || ALL);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [streamError, setStreamError] = useState("");
  const [loading, setLoading] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [follow, setFollow] = useState(false);
  const [logWindow, setLogWindow] = useState("tail:200");
  const [timestamps, setTimestamps] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [streamStatus, setStreamStatus] = useState<LogStatus | "connecting">("connecting");
  const [search, setSearch] = useState("");
  const linesRef = useRef<string[]>([]);
  const streamRef = useRef<LogStream | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  // Discover the candidate pods. For a workload, resolve its selector → pods.
  useEffect(() => {
    let active = true;
    if (srcType === "pod") {
      setPods([srcPod]);
      setPod(srcPod);
      return;
    }
    void (async () => {
      const o = await getObject(context, srcKind, namespace, srcName);
      const spec = (o.object?.spec ?? {}) as { selector?: { matchLabels?: Record<string, string> } };
      const out = await podsForSelector(context, namespace, spec.selector?.matchLabels ?? {});
      if (!active) return;
      setPods((out.pods ?? []).map((p) => p.name));
      setPod(ALL);
    })();
    return () => {
      active = false;
    };
  }, [context, namespace, srcType, srcPod, srcKind, srcName]);

  // Discover containers for whichever pods are in scope.
  useEffect(() => {
    let active = true;
    const targets = pod === ALL ? pods : [pod];
    void (async () => {
      const entries = await Promise.all(
        targets
          .filter((p) => p && !containersByPod[p])
          .map(async (p) => {
            const o = await getObject(context, "Pod", namespace, p);
            const cs = ((o.object?.spec ?? {}) as { containers?: { name: string }[] }).containers ?? [];
            return [p, cs.map((c) => c.name)] as const;
          }),
      );
      if (!active || entries.length === 0) return;
      setContainersByPod((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    return () => {
      active = false;
    };
  }, [context, namespace, pod, pods, containersByPod]);

  // Union of container names across the in-scope pods.
  const containerOptions = useMemo(() => {
    const targets = pod === ALL ? pods : [pod];
    const set = new Set<string>();
    targets.forEach((p) => (containersByPod[p] ?? []).forEach((c) => set.add(c)));
    return [...set];
  }, [pod, pods, containersByPod]);

  // The concrete (pod, container) pairs in scope, with a source label when more
  // than one — shared by snapshot fetch and live-tail.
  const targetPods = useMemo(
    () => (pod === ALL ? pods : [pod]).filter(Boolean),
    [pod, pods],
  );
  const targetsReady =
    targetPods.length > 0 &&
    targetPods.every((targetPod) => Object.prototype.hasOwnProperty.call(containersByPod, targetPod));

  const targets = useMemo<LogTarget[]>(() => {
    const list: LogTarget[] = [];
    for (const p of targetPods) {
      const discovered = containersByPod[p];
      const cs = container === ALL
        ? discovered && discovered.length > 0 ? discovered : [undefined]
        : [container];
      const multi = targetPods.length > 1 || cs.length > 1;
      for (const c of cs) {
        list.push({ pod: p, container: c, label: multi ? `${p}${c ? `/${c}` : ""}` : "" });
      }
    }
    return list;
  }, [targetPods, container, containersByPod]);

  const setBuffer = (next: string[]) => {
    linesRef.current = next;
    setLines(next);
  };

  // Snapshot fetch (used when not following).
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      const collected: string[] = [];
      let firstError = "";
      for (const t of targets) {
        const out = await podLogs(context, namespace, t.pod, undefined, t.container, {
          ...windowOptions(logWindow),
          timestamps,
          previous,
        });
        if (out.error) {
          if (!firstError) firstError = out.error;
          continue;
        }
        const text = out.logs ?? "";
        if (!text) continue;
        text.split("\n").forEach((l) => collected.push(t.label && l ? `${t.label} | ${l}` : l));
      }
      if (!active) return;
      setBuffer(collected);
      setError(collected.length === 0 && firstError ? firstError : "");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [context, namespace, targets, logWindow, timestamps, previous]);

  useEffect(() => {
    if (follow) return;
    return load();
  }, [follow, load]);

  // Live-tail: open a multiplexed stream and append lines as they arrive.
  useEffect(() => {
    if (!follow) return;
    if (!targetsReady || targets.length === 0) {
      setLoading(true);
      setStreamStatus("connecting");
      return;
    }
    let stopped = false;
    setBuffer([]);
    setError("");
    setStreamError("");
    setLoading(true);
    setStreamStatus("connecting");
    void startLogStream(
      context,
      namespace,
      targets,
      (sourceTag, line) => {
        const text = sourceTag ? `${sourceTag} | ${line}` : line;
        const next = [...linesRef.current, text];
        if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
        setBuffer(next);
      },
      (status) => {
        if (!stopped) setStreamStatus(status);
      },
      { ...windowOptions(logWindow), timestamps },
    ).then((s) => {
      setLoading(false);
      if (stopped) s.stop();
      else streamRef.current = s;
    }).catch((cause: unknown) => {
      if (stopped) return;
      setLoading(false);
      setStreamError(cause instanceof Error ? cause.message : String(cause));
      setFollow(false);
    });
    return () => {
      stopped = true;
      streamRef.current?.stop();
      streamRef.current = null;
    };
  }, [follow, context, namespace, targets, targetsReady, logWindow, timestamps]);

  const visible = useMemo(() => {
    if (!search) return lines;
    const q = search.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, search]);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !autoScrollRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [visible, follow]);

  function toggleFollow() {
    setFollow((current) => {
      const next = !current;
      if (next) {
        autoScrollRef.current = true;
        setStreamError("");
      }
      return next;
    });
  }

  /** Previous-instance logs describe a terminated container — stop following. */
  function togglePrevious() {
    setPrevious((current) => {
      const next = !current;
      if (next) setFollow(false);
      return next;
    });
  }

  function trackScroll() {
    const viewport = scrollRef.current;
    if (!viewport) return;
    autoScrollRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48;
  }

  const [saveError, setSaveError] = useState("");
  function download() {
    const base = srcType === "pod" ? srcPod : srcName;
    setSaveError("");
    void saveTextFile(`${base || "logs"}.log`, lines.join("\n")).catch((e) =>
      setSaveError(String(e)),
    );
  }

  const title = srcType === "pod" ? srcPod : `${srcKind}/${srcName}`;

  return (
    <div className="flex h-full flex-col bg-card text-card-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-medium text-muted-foreground">{title} · logs</span>

        {srcType === "workload" && pods.length > 0 && (
          <Select
            value={pod}
            onValueChange={setPod}
            options={[{ value: ALL, label: `All pods (${pods.length})` }, ...pods.map((p) => ({ value: p }))]}
            aria-label="Pod"
          />
        )}

        {containerOptions.length > 0 && (
          <Select
            value={container}
            onValueChange={setContainer}
            options={[
              { value: ALL, label: `All containers (${containerOptions.length})` },
              ...containerOptions.map((c) => ({ value: c })),
            ]}
            aria-label="Container"
          />
        )}

        <Select value={logWindow} onValueChange={setLogWindow} options={WINDOW_CHOICES} aria-label="Log window" />
        {previous && <span className="text-amber-600 dark:text-amber-400">previous instance</span>}

        <div className="relative w-44">
          <TextInput value={search} onValueChange={setSearch} placeholder="Search logs…" aria-label="Search logs" />
        </div>
        {search && (
          <span className="tabular-nums text-muted-foreground">
            {visible.length}/{lines.length}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {loading && <Spinner label="Loading logs" />}
          {follow && streamStatus === "reconnecting" && (
            <span className="text-amber-600 dark:text-amber-400">reconnecting…</span>
          )}
          {follow && streamStatus === "connecting" && (
            <span className="text-muted-foreground">connecting…</span>
          )}
          {follow && !loading && streamStatus === "live" && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              live
            </span>
          )}
          <IconButton
            icon={Clock}
            label={timestamps ? "Hide timestamps" : "Show timestamps"}
            active={timestamps}
            onClick={() => setTimestamps((t) => !t)}
          />
          <IconButton
            icon={History}
            label={previous ? "Show current instance" : "Show previous instance"}
            active={previous}
            onClick={togglePrevious}
          />
          <IconButton
            icon={follow ? Pause : Play}
            label={follow ? "Pause live tail" : "Live tail"}
            onClick={toggleFollow}
            disabled={previous}
          />
          <IconButton icon={WrapText} label={wrap ? "Disable wrap" : "Wrap lines"} onClick={() => setWrap((w) => !w)} />
          {saveError && <span className="text-red-600 dark:text-red-400">save failed</span>}
          <IconButton icon={Download} label="Download" onClick={download} disabled={lines.length === 0} />
          <IconButton icon={RefreshCw} label="Refresh" onClick={() => load()} disabled={follow || loading} />
        </div>
      </div>

      <div
        ref={scrollRef}
        role="log"
        aria-label="Pod logs"
        aria-live={follow ? "polite" : "off"}
        onScroll={trackScroll}
        className="min-h-0 flex-1 overflow-auto font-mono text-xs leading-relaxed"
      >
        {streamError || error ? (
          <div className="p-3 text-red-600 dark:text-red-400">Error: {streamError || error}</div>
        ) : visible.length > 0 ? (
          <div className={wrap ? "whitespace-pre-wrap break-all p-2" : "min-w-max p-2"}>
            {visible.map((line, i) => (
              <div key={i} className={LEVEL_CLASS[lineLevel(line)]}>
                {line || " "}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 text-muted-foreground">
            {loading ? "Loading…" : search ? "No matching lines" : follow ? "Waiting for logs…" : "(no logs)"}
          </div>
        )}
      </div>
    </div>
  );
}
