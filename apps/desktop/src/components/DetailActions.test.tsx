import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const {
  deletePodMock,
  evictPodMock,
  deleteResourceMock,
  scaleResourceMock,
  rolloutRestartMock,
  cronjobSetSuspendMock,
  cronjobTriggerNowMock,
} = vi.hoisted(() => ({
  deletePodMock: vi.fn(),
  evictPodMock: vi.fn(),
  deleteResourceMock: vi.fn(),
  scaleResourceMock: vi.fn(),
  rolloutRestartMock: vi.fn(),
  cronjobSetSuspendMock: vi.fn(),
  cronjobTriggerNowMock: vi.fn(),
}));
vi.mock("../lib/workloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workloads")>();
  return { ...actual, deletePod: deletePodMock, evictPod: evictPodMock };
});
vi.mock("../lib/actions", () => ({
  deleteResource: deleteResourceMock,
  scaleResource: scaleResourceMock,
  rolloutRestart: rolloutRestartMock,
  cronjobSetSuspend: cronjobSetSuspendMock,
  cronjobTriggerNow: cronjobTriggerNowMock,
}));
const { notifyMock } = vi.hoisted(() => ({
  notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/notify", () => ({ notify: notifyMock }));

import { PodActions, ResourceActions } from "./DetailActions";

const pod = {
  name: "web-1",
  namespace: "default",
  phase: "Running",
  ready: "1/1",
  restarts: 0,
  node: "node-a",
  age: "2d",
};

beforeEach(() => {
  deletePodMock.mockReset();
  evictPodMock.mockReset();
  deleteResourceMock.mockReset();
  scaleResourceMock.mockReset();
  rolloutRestartMock.mockReset();
  cronjobSetSuspendMock.mockReset();
  cronjobTriggerNowMock.mockReset();
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
});

describe("PodActions", () => {
  it("opens logs and shell via the header icons", () => {
    const onOpenLogs = vi.fn();
    const onOpenTerminal = vi.fn();
    render(
      <PodActions context="kind-dev" pod={pod} onOpenLogs={onOpenLogs} onOpenTerminal={onOpenTerminal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    fireEvent.click(screen.getByRole("button", { name: "Shell" }));
    expect(onOpenLogs).toHaveBeenCalledWith({ context: "kind-dev", namespace: "default", pod: "web-1" });
    expect(onOpenTerminal).toHaveBeenCalledWith({ context: "kind-dev", namespace: "default", pod: "web-1" });
  });

  it("confirms and deletes the pod", async () => {
    deletePodMock.mockResolvedValue({ deleted: true });
    const onDeleted = vi.fn();
    render(<PodActions context="kind-dev" pod={pod} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    // The dialog marks outside content aria-hidden, so the only reachable
    // "Delete" is now the dialog's confirm button.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletePodMock).toHaveBeenCalledWith("kind-dev", "default", "web-1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("evicts the pod behind a confirm", async () => {
    evictPodMock.mockResolvedValue({ ok: true });
    const onDeleted = vi.fn();
    render(<PodActions context="kind-dev" pod={pod} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button", { name: "Evict" }));
    // dialog open → its Evict button is the only reachable one
    fireEvent.click(screen.getByRole("button", { name: "Evict" }));
    await waitFor(() => expect(evictPodMock).toHaveBeenCalledWith("kind-dev", "default", "web-1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });
});

describe("ResourceActions", () => {
  it("scales a deployment through the scale dialog", async () => {
    scaleResourceMock.mockResolvedValue({ ok: true });
    render(
      <ResourceActions
        context="kind-dev"
        kind="Deployment"
        namespace="default"
        name="web"
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    fireEvent.change(screen.getByLabelText("Replicas"), { target: { value: "3" } });
    // Outside content is aria-hidden while the dialog is open → the dialog's
    // Scale button is the only reachable one.
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() =>
      expect(scaleResourceMock).toHaveBeenCalledWith("kind-dev", "Deployment", "default", "web", 3),
    );
    // A success toast confirms the operation.
    await waitFor(() => expect(notifyMock.success).toHaveBeenCalledWith(expect.stringMatching(/Scaled web to 3/)));
  });

  it("shows an error toast when an operation fails", async () => {
    scaleResourceMock.mockResolvedValue({ error: "forbidden" });
    render(
      <ResourceActions context="kind-dev" kind="Deployment" namespace="default" name="web" onDeleted={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    fireEvent.change(screen.getByLabelText("Replicas"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Scale" }));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalledWith(expect.any(String), "forbidden"));
    expect(notifyMock.success).not.toHaveBeenCalled();
  });

  it("triggers a rollout restart", async () => {
    rolloutRestartMock.mockResolvedValue({ ok: true });
    render(
      <ResourceActions
        context="kind-dev"
        kind="Deployment"
        namespace="default"
        name="web"
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() =>
      expect(rolloutRestartMock).toHaveBeenCalledWith("kind-dev", "Deployment", "default", "web"),
    );
  });

  it("does not offer Scale/Restart for a non-workload kind", () => {
    render(
      <ResourceActions
        context="kind-dev"
        kind="ConfigMap"
        namespace="default"
        name="cm"
        onDeleted={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Scale" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  it("triggers a CronJob run now with confirmation", async () => {
    cronjobTriggerNowMock.mockResolvedValue({ jobName: "nightly-123" });
    render(
      <ResourceActions
        context="kind-dev"
        kind="CronJob"
        namespace="ops"
        name="nightly"
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() =>
      expect(cronjobTriggerNowMock).toHaveBeenCalledWith("kind-dev", "ops", "nightly"),
    );
  });

  it("shows Resume for a suspended CronJob and calls setSuspend(false)", async () => {
    cronjobSetSuspendMock.mockResolvedValue({ ok: true });
    render(
      <ResourceActions
        context="kind-dev"
        kind="CronJob"
        namespace="ops"
        name="nightly"
        cronjobSuspended
        onDeleted={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(cronjobSetSuspendMock).toHaveBeenCalledWith("kind-dev", "ops", "nightly", false),
    );
  });

  it("shows Suspend for an active CronJob and calls setSuspend(true)", async () => {
    cronjobSetSuspendMock.mockResolvedValue({ ok: true });
    render(
      <ResourceActions
        context="kind-dev"
        kind="CronJob"
        namespace="ops"
        name="nightly"
        cronjobSuspended={false}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await waitFor(() =>
      expect(cronjobSetSuspendMock).toHaveBeenCalledWith("kind-dev", "ops", "nightly", true),
    );
  });
});
