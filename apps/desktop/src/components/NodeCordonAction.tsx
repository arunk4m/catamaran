import React, { useEffect, useState } from "react";
import { ArrowDownToLine, CircleCheck, CircleSlash2 } from "lucide-react";
import { getObject } from "../lib/manifest";
import { cordonNode, drainNode } from "../lib/actions";
import { notify } from "../lib/notify";
import { IconButton, ConfirmDialog } from "../ui";

/**
 * Header actions for a node: cordon/uncordon and drain. Reads the node's
 * current `spec.unschedulable` to label the cordon toggle. `getObjectFn`/
 * `cordonFn`/`drainFn` are injectable for testing.
 */
export function NodeCordonAction({
  context,
  name,
  getObjectFn = getObject,
  cordonFn = cordonNode,
  drainFn = drainNode,
}: {
  context: string;
  name: string;
  getObjectFn?: typeof getObject;
  cordonFn?: typeof cordonNode;
  drainFn?: typeof drainNode;
}) {
  const [cordoned, setCordoned] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<"cordon" | "drain" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    void getObjectFn(context, "Node", null, name).then((o) => {
      if (!active || !o.object) return;
      setCordoned((o.object.spec as { unschedulable?: boolean } | undefined)?.unschedulable === true);
    });
    return () => {
      active = false;
    };
  }, [context, name, getObjectFn]);

  if (cordoned === null) return null; // unknown until the node loads

  async function applyCordon() {
    setBusy(true);
    setErr("");
    const r = await cordonFn(context, name, !cordoned);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      notify.error(`Failed to ${cordoned ? "uncordon" : "cordon"} ${name}`, r.error);
      return;
    }
    setDialog(null);
    notify.success(`${cordoned ? "Uncordoned" : "Cordoned"} ${name}`);
    setCordoned(!cordoned);
  }

  async function applyDrain() {
    setBusy(true);
    setErr("");
    const r = await drainFn(context, name);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      notify.error(`Failed to drain ${name}`, r.error);
      return;
    }
    setDialog(null);
    notify.success(`Drained ${name}`, r.evicted != null ? `Evicted ${r.evicted} pod(s)` : undefined);
    setCordoned(true); // drain cordons the node
  }

  return (
    <>
      <IconButton
        icon={cordoned ? CircleCheck : CircleSlash2}
        label={cordoned ? "Uncordon" : "Cordon"}
        onClick={() => {
          setErr("");
          setDialog("cordon");
        }}
      />
      <IconButton
        icon={ArrowDownToLine}
        label="Drain"
        onClick={() => {
          setErr("");
          setDialog("drain");
        }}
      />

      {dialog === "cordon" && (
        <ConfirmDialog
          title={cordoned ? "Uncordon node?" : "Cordon node?"}
          message={
            <>
              <p style={{ marginTop: 0 }}>
                {cordoned ? "Allow" : "Stop"} scheduling new pods on <code>{name}</code>?
              </p>
              {err && <p className="text-destructive">Error: {err}</p>}
            </>
          }
          confirmLabel={cordoned ? "Uncordon" : "Cordon"}
          busy={busy}
          onConfirm={() => void applyCordon()}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === "drain" && (
        <ConfirmDialog
          title="Drain node?"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Cordon <code>{name}</code> and evict its pods (DaemonSet and static pods stay)?
              </p>
              {err && <p className="text-destructive">Error: {err}</p>}
            </>
          }
          confirmLabel="Drain"
          danger
          busy={busy}
          onConfirm={() => void applyDrain()}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}
