import React, { useState } from "react";
import {
  ArrowLeftRight,
  LogOut,
  Logs,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Scaling,
  SquareTerminal,
  Trash2,
  Zap,
} from "lucide-react";
import { deletePod, evictPod, type PodSummary } from "../lib/workloads";
import {
  deleteResource,
  scaleResource,
  rolloutRestart,
  cronjobSetSuspend,
  cronjobTriggerNow,
} from "../lib/actions";
import { notify } from "../lib/notify";
import { IconButton, ConfirmDialog, TextInput } from "../ui";
import { ForwardDialog } from "./ForwardDialog";

type Opener = (s: { context: string; namespace: string; pod: string }) => void;

const SCALABLE = ["Deployment", "StatefulSet", "ReplicaSet"];
const RESTARTABLE = ["Deployment", "StatefulSet", "DaemonSet"];
// Workloads whose pods are reachable via spec.selector.matchLabels.
const LOGGABLE = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"];

/** Pod header actions: Logs, Shell, Delete (with a delete confirm). */
export function PodActions({
  context,
  pod,
  onDeleted,
  onOpenTerminal,
  onOpenLogs,
  onEdit,
}: {
  context: string;
  pod: PodSummary;
  onDeleted?: () => void;
  onOpenTerminal?: Opener;
  onOpenLogs?: Opener;
  onEdit?: () => void;
}) {
  const [dialog, setDialog] = useState<"delete" | "evict" | "forward" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const target = { context, namespace: pod.namespace, pod: pod.name };

  async function doDelete() {
    setBusy(true);
    setError("");
    const out = await deletePod(context, pod.namespace, pod.name);
    setBusy(false);
    if (out.error) {
      setError(out.error);
      notify.error(`Failed to delete ${pod.name}`, out.error);
      return;
    }
    setDialog(null);
    notify.success(`Deleted pod ${pod.name}`);
    onDeleted?.();
  }

  async function doEvict() {
    setBusy(true);
    setError("");
    const out = await evictPod(context, pod.namespace, pod.name);
    setBusy(false);
    if (out.error) {
      setError(out.error);
      notify.error(`Failed to evict ${pod.name}`, out.error);
      return;
    }
    setDialog(null);
    notify.success(`Evicted pod ${pod.name}`);
    onDeleted?.();
  }

  return (
    <>
      <IconButton icon={Logs} label="Logs" onClick={() => onOpenLogs?.(target)} />
      <IconButton icon={SquareTerminal} label="Shell" onClick={() => onOpenTerminal?.(target)} />
      {onEdit && <IconButton icon={Pencil} label="Edit" onClick={onEdit} />}
      <IconButton icon={ArrowLeftRight} label="Forward" onClick={() => setDialog("forward")} />
      <IconButton
        icon={LogOut}
        label="Evict"
        onClick={() => {
          setError("");
          setDialog("evict");
        }}
      />
      <IconButton
        icon={Trash2}
        label="Delete"
        danger
        onClick={() => {
          setError("");
          setDialog("delete");
        }}
      />
      {dialog === "forward" && (
        <ForwardDialog
          context={context}
          namespace={pod.namespace}
          kind="Pod"
          name={pod.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title="Delete pod?"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Delete <code>{pod.name}</code> in <code>{pod.namespace}</code>? This cannot be
                undone.
              </p>
              {error && <p className="text-destructive">Error: {error}</p>}
            </>
          }
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={() => void doDelete()}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "evict" && (
        <ConfirmDialog
          title="Evict pod?"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Gracefully evict <code>{pod.name}</code> in <code>{pod.namespace}</code> (respects
                disruption budgets)?
              </p>
              {error && <p className="text-destructive">Error: {error}</p>}
            </>
          }
          confirmLabel="Evict"
          danger
          busy={busy}
          onConfirm={() => void doEvict()}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** Service header action: open a port-forward to the service. */
export function ServiceForwardAction({
  context,
  namespace,
  name,
}: {
  context: string;
  namespace: string | null;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon={ArrowLeftRight} label="Forward" onClick={() => setOpen(true)} />
      {open && (
        <ForwardDialog
          context={context}
          namespace={namespace ?? ""}
          kind="Service"
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Non-pod header actions: Scale (workloads), Restart, Delete — each gated. */
export function ResourceActions({
  context,
  kind,
  namespace,
  name,
  cronjobSuspended,
  onDeleted,
  onChanged,
  onOpenLogs,
  onEdit,
}: {
  context: string;
  kind: string;
  namespace: string | null;
  name: string;
  /** For CronJob details: current suspend state, to label Suspend/Resume. */
  cronjobSuspended?: boolean;
  onDeleted: () => void;
  /** Fired after a successful non-delete write action so the detail refreshes. */
  onChanged?: () => void;
  onOpenLogs?: (s: { context: string; namespace: string; kind: string; name: string }) => void;
  onEdit?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scaling, setScaling] = useState(false);
  const [replicas, setReplicas] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const isCronJob = kind === "CronJob";

  async function doSetSuspend() {
    setBusy("suspend");
    setErr("");
    const resume = cronjobSuspended;
    const r = await cronjobSetSuspend(context, namespace ?? "", name, !cronjobSuspended);
    setBusy("");
    if (r.error) {
      setErr(r.error);
      notify.error(`Failed to ${resume ? "resume" : "suspend"} ${name}`, r.error);
      return;
    }
    notify.success(`${resume ? "Resumed" : "Suspended"} ${name}`);
    onChanged?.();
  }

  async function doTrigger() {
    setBusy("trigger");
    setErr("");
    const r = await cronjobTriggerNow(context, namespace ?? "", name);
    setBusy("");
    if (r.error) {
      setErr(r.error);
      notify.error(`Failed to run ${name}`, r.error);
      return;
    }
    setTriggering(false);
    notify.success(`Triggered ${name}`, r.jobName ? `Created job ${r.jobName}` : undefined);
    onChanged?.();
  }

  async function doDelete() {
    setBusy("delete");
    setErr("");
    const r = await deleteResource(context, kind, namespace, name);
    setBusy("");
    if (r.error) {
      setErr(r.error);
      notify.error(`Failed to delete ${name}`, r.error);
      return;
    }
    setConfirmDelete(false);
    notify.success(`Deleted ${kind} ${name}`);
    onDeleted();
  }

  async function doScale() {
    const n = Number(replicas);
    if (!Number.isInteger(n) || n < 0) {
      setErr("Enter a non-negative replica count");
      return;
    }
    setBusy("scale");
    setErr("");
    const r = await scaleResource(context, kind, namespace ?? "", name, n);
    setBusy("");
    if (r.error) {
      setErr(r.error);
      notify.error(`Failed to scale ${name}`, r.error);
      return;
    }
    setScaling(false);
    notify.success(`Scaled ${name} to ${n}`);
    onChanged?.();
  }

  async function doRestart() {
    setBusy("restart");
    setErr("");
    const r = await rolloutRestart(context, kind, namespace ?? "", name);
    setBusy("");
    if (r.error) {
      notify.error(`Failed to restart ${name}`, r.error);
      return;
    }
    notify.success(`Rollout restart triggered for ${name}`);
    onChanged?.();
  }

  return (
    <>
      {LOGGABLE.includes(kind) && onOpenLogs && (
        <IconButton
          icon={Logs}
          label="Logs"
          onClick={() => onOpenLogs({ context, namespace: namespace ?? "", kind, name })}
        />
      )}
      {onEdit && <IconButton icon={Pencil} label="Edit" onClick={onEdit} />}
      {SCALABLE.includes(kind) && (
        <IconButton icon={Scaling} label="Scale" onClick={() => setScaling(true)} />
      )}
      {RESTARTABLE.includes(kind) && (
        <IconButton
          icon={RotateCw}
          label="Restart"
          disabled={busy === "restart"}
          onClick={() => void doRestart()}
        />
      )}
      {isCronJob && (
        <IconButton icon={Zap} label="Run now" onClick={() => setTriggering(true)} />
      )}
      {isCronJob && (
        <IconButton
          icon={cronjobSuspended ? Play : Pause}
          label={cronjobSuspended ? "Resume" : "Suspend"}
          disabled={busy === "suspend"}
          onClick={() => void doSetSuspend()}
        />
      )}
      <IconButton icon={Trash2} label="Delete" danger onClick={() => setConfirmDelete(true)} />

      {triggering && (
        <ConfirmDialog
          title="Run CronJob now"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Create a one-off Job from <code>{name}</code> and run it immediately.
              </p>
              {err && <p style={{ color: "var(--cat-color-danger)" }}>Error: {err}</p>}
            </>
          }
          confirmLabel="Run"
          busy={busy === "trigger"}
          onConfirm={() => void doTrigger()}
          onCancel={() => setTriggering(false)}
        />
      )}

      {scaling && (
        <ConfirmDialog
          title={`Scale ${kind}`}
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Set the replica count for <code>{name}</code>.
              </p>
              <div style={{ width: 120 }}>
                <TextInput
                  value={replicas}
                  onValueChange={setReplicas}
                  placeholder="replicas"
                  aria-label="Replicas"
                />
              </div>
              {err && <p style={{ color: "var(--cat-color-danger)" }}>Error: {err}</p>}
            </>
          }
          confirmLabel="Scale"
          busy={busy === "scale"}
          onConfirm={() => void doScale()}
          onCancel={() => setScaling(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${kind}?`}
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Delete <code>{name}</code>
                {namespace ? (
                  <>
                    {" "}
                    in <code>{namespace}</code>
                  </>
                ) : null}
                ? This cannot be undone.
              </p>
              {err && <p style={{ color: "var(--cat-color-danger)" }}>Error: {err}</p>}
            </>
          }
          confirmLabel="Delete"
          danger
          busy={busy === "delete"}
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
