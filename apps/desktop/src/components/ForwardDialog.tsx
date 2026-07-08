import React, { useState } from "react";
import { ConfirmDialog, TextInput } from "../ui";
import { startPortForward } from "../lib/forward";

function validPort(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * Prompt for a remote (and optional local) port, then start a port-forward to
 * a Pod or Service. Leaving the local port blank lets the OS pick a free one.
 */
export function ForwardDialog({
  context,
  namespace,
  kind,
  name,
  defaultRemotePort,
  onClose,
}: {
  context: string;
  namespace: string;
  kind: string;
  name: string;
  defaultRemotePort?: number;
  onClose: () => void;
}) {
  const [remote, setRemote] = useState(defaultRemotePort ? String(defaultRemotePort) : "");
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const remotePort = validPort(remote);
    if (remotePort === null) {
      setError("Enter a remote port between 1 and 65535");
      return;
    }
    let localPort: number | undefined;
    if (local.trim()) {
      const l = validPort(local);
      if (l === null) {
        setError("Local port must be between 1 and 65535");
        return;
      }
      localPort = l;
    }
    setBusy(true);
    setError("");
    try {
      await startPortForward({ context, namespace, kind, name, remotePort, localPort });
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={`Forward ${kind.toLowerCase()} port`}
      message={
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-muted-foreground">
            Forward a local port to <code>{name}</code>
            {namespace ? (
              <>
                {" "}
                in <code>{namespace}</code>
              </>
            ) : null}
            .
          </p>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {kind === "Service" ? "Service port" : "Container port"}
              <div className="w-28">
                <TextInput
                  value={remote}
                  onValueChange={setRemote}
                  placeholder="e.g. 80"
                  aria-label="Remote port"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Local port (optional)
              <div className="w-28">
                <TextInput
                  value={local}
                  onValueChange={setLocal}
                  placeholder="auto"
                  aria-label="Local port"
                />
              </div>
            </label>
          </div>
          {error && <p className="m-0 text-sm text-destructive">Error: {error}</p>}
        </div>
      }
      confirmLabel="Forward"
      busy={busy}
      onConfirm={() => void submit()}
      onCancel={onClose}
    />
  );
}
