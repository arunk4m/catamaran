import React, { useEffect, useRef } from "react";
import { startPodExec, type ExecSession } from "../lib/exec";

/**
 * Interactive in-pod shell rendered with xterm. xterm and its CSS are loaded
 * dynamically so they stay out of the jsdom test graph; this component is
 * verified live against a cluster rather than in unit tests.
 */
export function PodTerminal({
  context,
  namespace,
  pod,
  container,
}: {
  context: string;
  namespace: string;
  pod: string;
  /** Exec into this specific container (for multi-container pods). */
  container?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup = () => {};
    let disposed = false;

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");
      if (disposed || !ref.current) return;

      const term = new Terminal({
        convertEol: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        theme: { background: "#1b1f23", foreground: "#e6e6e6" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current);
      fit.fit();
      term.focus();
      term.write("Connecting…\r\n");

      let session: ExecSession | null = null;
      void startPodExec(
        context,
        namespace,
        pod,
        (chunk) => term.write(chunk),
        (err) => term.write(`\r\n[session ended${err ? `: ${err}` : ""}]\r\n`),
        container,
      ).then((s) => {
        if (disposed) {
          s.close();
          return;
        }
        session = s;
        term.onData((d) => s.send(d));
      });

      cleanup = () => {
        session?.close();
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [context, namespace, pod, container]);

  return <div ref={ref} style={{ height: "100%", width: "100%", background: "#000", padding: 6, boxSizing: "border-box" }} />;
}
