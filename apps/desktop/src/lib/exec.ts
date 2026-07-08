import { invokeCommand, on } from "../transport/transport";

export interface ExecSession {
  /** Send a keystroke / input string to the pod's stdin. */
  send: (data: string) => void;
  /** Close the session and unsubscribe. */
  close: () => void;
}

/**
 * Open an interactive shell into a pod. `onData` receives stdout chunks;
 * `onExit` fires when the session ends (with an optional error). Returns a
 * session handle for sending input and closing.
 */
export async function startPodExec(
  context: string,
  namespace: string,
  pod: string,
  onData: (chunk: string) => void,
  onExit: (error: string | null) => void,
  container?: string,
): Promise<ExecSession> {
  const session = await invokeCommand<number>("start_pod_exec", {
    context,
    namespace,
    pod,
    container: container ?? null,
    shell: null,
  });
  const disposeOut = on(`exec:out:${session}`, (p) => onData(p as string));
  const disposeExit = on(`exec:exit:${session}`, (p) => onExit((p as string | null) ?? null));
  return {
    send: (data) => void invokeCommand("exec_input", { session, data }),
    close: () => {
      disposeOut();
      disposeExit();
      void invokeCommand("exec_close", { session });
    },
  };
}
