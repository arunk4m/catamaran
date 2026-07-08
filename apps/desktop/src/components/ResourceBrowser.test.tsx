import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const {
  listNamespacesMock,
  podLogsMock,
  watchResourceMock,
  listNodesMock,
  getManifestMock,
  getObjectMock,
  listResourceMock,
} = vi.hoisted(() => ({
  listNamespacesMock: vi.fn(),
  podLogsMock: vi.fn(),
  watchResourceMock: vi.fn(),
  listNodesMock: vi.fn(),
  getManifestMock: vi.fn(),
  getObjectMock: vi.fn(),
  listResourceMock: vi.fn(),
}));
vi.mock("../lib/workloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workloads")>();
  return {
    ...actual,
    listNamespaces: listNamespacesMock,
    podLogs: podLogsMock,
    podMetrics: async () => ({ metrics: [] }),
  };
});
vi.mock("../lib/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/manifest")>();
  return {
    ...actual,
    listNodes: listNodesMock,
    getManifest: getManifestMock,
    getObject: getObjectMock,
    listResource: listResourceMock,
  };
});
vi.mock("../lib/watch", () => ({
  watchResource: watchResourceMock,
  WATCHABLE_KINDS: [
    "pods",
    "deployments",
    "statefulsets",
    "daemonsets",
    "jobs",
    "cronjobs",
    "configmaps",
    "secrets",
    "resourcequotas",
    "limitranges",
    "services",
    "ingresses",
    "endpointslices",
    "networkpolicies",
    "persistentvolumeclaims",
    "persistentvolumes",
    "storageclasses",
    "serviceaccounts",
    "roles",
    "clusterroles",
    "rolebindings",
    "clusterrolebindings",
  ],
}));
vi.mock("./PodTerminal", () => ({ PodTerminal: () => <div data-testid="pod-terminal" /> }));
// CodeMirror needs real layout (unavailable in jsdom); stand in a textarea.
vi.mock("../ui/CodeEditor", () => ({
  CodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange?: (v: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

import { ResourceBrowser } from "./ResourceBrowser";

const pod = {
  name: "web-1",
  namespace: "default",
  phase: "Running",
  ready: "1/1",
  restarts: 0,
  node: "node-a",
};

// watchResource(ctx, ns, kind, onRows) — push one snapshot, return a handle.
function watchWith(rows: Array<{ name: string }>) {
  return (_ctx: string, _ns: string, _kind: string, onRows: (r: unknown) => void) => {
    onRows(rows);
    return Promise.resolve({ stop: vi.fn() });
  };
}

beforeEach(() => {
  listNamespacesMock.mockReset();
  podLogsMock.mockReset();
  watchResourceMock.mockReset();
  listNodesMock.mockReset();
  getManifestMock.mockReset();
  getObjectMock.mockReset();
  getObjectMock.mockResolvedValue({ object: { metadata: { name: "web" } } });
  listResourceMock.mockReset();
});

describe("ResourceBrowser", () => {
  it("streams pods live", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([pod]));

    render(<ResourceBrowser context="kind-dev" kind="pods" />);

    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "pods", expect.any(Function), expect.any(Function));
    expect(screen.getByText("live")).toBeDefined();
  });

  it("streams deployments live", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web", namespace: "default", ready: "1/1", upToDate: 1, available: 1 }]),
    );

    render(<ResourceBrowser context="kind-dev" kind="deployments" />);

    await waitFor(() => expect(screen.getByText("web")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "deployments", expect.any(Function), expect.any(Function));
  });

  it("streams statefulsets live with the governing service column", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["data"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "pg", namespace: "data", ready: "2/3", updated: 3, service: "pg-headless", age: "5d" }]),
    );

    render(<ResourceBrowser context="kind-dev" kind="statefulsets" />);

    await waitFor(() => expect(screen.getByText("pg")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "statefulsets", expect.any(Function), expect.any(Function));
    expect(screen.getByText("pg-headless")).toBeDefined();
  });

  it("streams jobs live and shows a Complete status", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["ops"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "backup-1", namespace: "ops", completions: "1/1", active: 0, failed: 0, duration: "2m", owner: "backup", age: "3h" }]),
    );

    render(<ResourceBrowser context="kind-dev" kind="jobs" />);

    await waitFor(() => expect(screen.getByText("backup-1")).toBeDefined());
    expect(screen.getByText("Complete")).toBeDefined();
    expect(screen.getByText("backup")).toBeDefined();
  });

  it("relabels the CronJob detail action when a watch update flips suspend", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["ops"] });
    let emit!: (rows: unknown) => void;
    watchResourceMock.mockImplementation((_c: string, _n: string, _k: string, onRows: (r: unknown) => void) => {
      emit = onRows;
      onRows([{ name: "nightly", namespace: "ops", schedule: "0 2 * * *", suspended: false, active: 0, lastSchedule: "2h", age: "9d" }]);
      return Promise.resolve({ stop: vi.fn() });
    });

    render(<ResourceBrowser context="kind-dev" kind="cronjobs" />);
    fireEvent.click(await screen.findByText("nightly"));

    // Active CronJob → the action reads "Suspend".
    expect(await screen.findByRole("button", { name: "Suspend" })).toBeDefined();

    // A live watch update marks it suspended; the still-open detail must follow.
    emit([{ name: "nightly", namespace: "ops", schedule: "0 2 * * *", suspended: true, active: 0, lastSchedule: "2h", age: "9d" }]);
    expect(await screen.findByRole("button", { name: "Resume" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
  });

  it("streams cronjobs live and marks suspended ones", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["ops"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "nightly", namespace: "ops", schedule: "0 2 * * *", suspended: true, active: 0, lastSchedule: "2h", age: "9d" }]),
    );

    render(<ResourceBrowser context="kind-dev" kind="cronjobs" />);

    await waitFor(() => expect(screen.getByText("nightly")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "cronjobs", expect.any(Function), expect.any(Function));
    expect(screen.getByText("0 2 * * *")).toBeDefined();
    expect(screen.getByText("Suspended")).toBeDefined();
  });

  it("streams configmaps live with a key count", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web-config", namespace: "default", keys: 3, age: "2d" }]),
    );

    render(<ResourceBrowser context="kind-dev" kind="configmaps" />);

    await waitFor(() => expect(screen.getByText("web-config")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "configmaps", expect.any(Function), expect.any(Function));
    expect(screen.getByText("3")).toBeDefined();
  });

  it("streams secrets showing type + key count but never any values", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web-tls", namespace: "default", type: "kubernetes.io/tls", keys: 2, age: "1d" }]),
    );

    const { container } = render(<ResourceBrowser context="kind-dev" kind="secrets" />);

    await waitFor(() => expect(screen.getByText("web-tls")).toBeDefined());
    expect(screen.getByText("kubernetes.io/tls")).toBeDefined();
    // The list shows only metadata — no data/value columns exist to leak material.
    expect(container.textContent).not.toContain("tls.crt");
  });

  it("streams resourcequotas and limitranges with typed counts", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["team"] });
    watchResourceMock.mockImplementation(watchWith([{ name: "team-q", namespace: "team", resources: 4, age: "5d" }]));
    const { unmount } = render(<ResourceBrowser context="kind-dev" kind="resourcequotas" />);
    await waitFor(() => expect(screen.getByText("team-q")).toBeDefined());
    expect(screen.getByText("4")).toBeDefined();
    unmount();

    watchResourceMock.mockImplementation(watchWith([{ name: "mem-lr", namespace: "team", limits: 2, age: "3d" }]));
    render(<ResourceBrowser context="kind-dev" kind="limitranges" />);
    await waitFor(() => expect(screen.getByText("mem-lr")).toBeDefined());
    expect(screen.getByText("2")).toBeDefined();
  });

  it("streams ingresses live with class, hosts and address", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([
        { name: "web", namespace: "default", class: "nginx", hosts: "app.example.com", address: "203.0.113.4", ports: "80, 443", age: "3d" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="ingresses" />);
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith(
        "kind-dev",
        "",
        "ingresses",
        expect.any(Function),
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("web")).toBeDefined();
    expect(screen.getByText("app.example.com")).toBeDefined();
    expect(screen.getByText("203.0.113.4")).toBeDefined();
  });

  it("streams endpointslices live with ready counts and owning service", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([
        { name: "web-abc", namespace: "default", addressType: "IPv4", endpoints: "2/3", ports: "8080", service: "web", age: "1h" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="endpointslices" />);
    await waitFor(() => expect(screen.getByText("web-abc")).toBeDefined());
    expect(screen.getByText("2/3")).toBeDefined();
    expect(screen.getByText("web")).toBeDefined();
  });

  it("streams networkpolicies live with rule counts and pod selector", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([
        { name: "deny", namespace: "default", podSelector: "app=web", ingress: 1, egress: 2, policyTypes: "Ingress, Egress", age: "5d" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="networkpolicies" />);
    await waitFor(() => expect(screen.getByText("deny")).toBeDefined());
    expect(screen.getByText("app=web")).toBeDefined();
    expect(screen.getByText("Ingress, Egress")).toBeDefined();
  });

  it("streams PVCs live and humanizes a raw-byte capacity", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([
        // Raw bytes as MinIO/some provisioners report — must render as a size, not digits.
        { name: "data", namespace: "default", status: "Bound", capacity: "7586630231655", accessModes: "RWO", storageClass: "standard", volume: "pv-123", age: "3d" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="persistentvolumeclaims" />);
    await waitFor(() => expect(screen.getByText("data")).toBeDefined());
    expect(screen.getByText("6.9Ti")).toBeDefined();
    expect(screen.queryByText("7586630231655")).toBeNull();
    expect(screen.getByText("pv-123")).toBeDefined();
  });

  it("streams cluster PersistentVolumes live (no namespace) with reclaim policy and claim", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: [] });
    watchResourceMock.mockImplementation(
      watchWith([
        { name: "pv-123", capacity: "20Gi", accessModes: "RWO", reclaimPolicy: "Retain", status: "Bound", claim: "default/data", storageClass: "standard", age: "5d" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="persistentvolumes" />);
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith(
        "kind-dev",
        "",
        "persistentvolumes",
        expect.any(Function),
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("pv-123")).toBeDefined();
    expect(screen.getByText("Retain")).toBeDefined();
    expect(screen.getByText("default/data")).toBeDefined();
  });

  it("streams StorageClasses live and marks the default", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: [] });
    watchResourceMock.mockImplementation(
      watchWith([
        { name: "standard", provisioner: "kubernetes.io/aws-ebs", reclaimPolicy: "Delete", volumeBindingMode: "WaitForFirstConsumer", default: true, age: "9d" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="storageclasses" />);
    await waitFor(() => expect(screen.getByText("standard")).toBeDefined());
    expect(screen.getByText("kubernetes.io/aws-ebs")).toBeDefined();
    // "Default" appears as both the column header and the badge on the default class.
    expect(screen.getAllByText("Default").length).toBeGreaterThanOrEqual(2);
  });

  it("streams ServiceAccounts live with a secret count", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["ci"] });
    watchResourceMock.mockImplementation(watchWith([{ name: "builder", namespace: "ci", secrets: 2, age: "3d" }]));
    render(<ResourceBrowser context="kind-dev" kind="serviceaccounts" />);
    await waitFor(() => expect(screen.getByText("builder")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "serviceaccounts", expect.any(Function), expect.any(Function));
    expect(screen.getByText("2")).toBeDefined();
  });

  it("streams Roles live with a rule count", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([{ name: "pod-reader", namespace: "default", rules: 3, age: "1d" }]));
    render(<ResourceBrowser context="kind-dev" kind="roles" />);
    await waitFor(() => expect(screen.getByText("pod-reader")).toBeDefined());
    expect(screen.getByText("3")).toBeDefined();
  });

  it("streams cluster ClusterRoles live (no namespace)", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: [] });
    watchResourceMock.mockImplementation(watchWith([{ name: "view", rules: 10, age: "9d" }]));
    render(<ResourceBrowser context="kind-dev" kind="clusterroles" />);
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "clusterroles", expect.any(Function), expect.any(Function)),
    );
    expect(await screen.findByText("view")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
  });

  it("streams RoleBindings live with roleRef and subject count", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "read-pods", namespace: "default", role: "Role/pod-reader", subjects: 1, age: "2d" }]),
    );
    render(<ResourceBrowser context="kind-dev" kind="rolebindings" />);
    await waitFor(() => expect(screen.getByText("read-pods")).toBeDefined());
    expect(screen.getByText("Role/pod-reader")).toBeDefined();
  });

  it("streams cluster ClusterRoleBindings live (no namespace)", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: [] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "admin-binding", role: "ClusterRole/cluster-admin", subjects: 0, age: "5d" }]),
    );
    render(<ResourceBrowser context="kind-dev" kind="clusterrolebindings" />);
    await waitFor(() => expect(screen.getByText("admin-binding")).toBeDefined());
    expect(screen.getByText("ClusterRole/cluster-admin")).toBeDefined();
  });

  it("starts on the provided namespace and reports filter changes", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default", "kube-system"] });
    watchResourceMock.mockImplementation(watchWith([pod]));
    const onNamespaceChange = vi.fn();
    render(
      <ResourceBrowser
        context="kind-dev"
        kind="pods"
        initialNamespace="kube-system"
        onNamespaceChange={onNamespaceChange}
      />,
    );
    // Watches the initial (preserved) namespace, not "all".
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith(
        "kind-dev",
        "kube-system",
        "pods",
        expect.any(Function),
        expect.any(Function),
      ),
    );

    // Selecting a second namespace is additive (multi-select): the serialized
    // filter now holds both, and the watch widens to all namespaces (filtered
    // client-side) since more than one is selected.
    await userEvent.click(screen.getByRole("combobox", { name: "Namespace" }));
    await userEvent.click(await screen.findByRole("option", { name: "default" }));
    expect(onNamespaceChange).toHaveBeenCalledWith("kube-system,default");
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith(
        "kind-dev",
        "",
        "pods",
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });

  it("shows a loading indicator while the first fetch is still in flight", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    // A watch that never delivers a snapshot keeps the browser in its loading
    // state, so the content area should show the loading placeholder.
    watchResourceMock.mockImplementation(() => new Promise(() => {}));
    render(<ResourceBrowser context="kind-dev" kind="pods" />);
    expect(await screen.findByText("Loading pods")).toBeDefined();
  });

  it("filters rows client-side to the selected namespaces when several are chosen", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default", "kube-system", "ops"] });
    // Two namespaces selected → watch runs across all namespaces and the rows
    // are narrowed client-side to the selection.
    watchResourceMock.mockImplementation(
      watchWith([
        { ...pod, name: "web-1", namespace: "default" },
        { ...pod, name: "dns-1", namespace: "kube-system" },
        { ...pod, name: "backup-1", namespace: "ops" },
      ]),
    );
    render(<ResourceBrowser context="kind-dev" kind="pods" initialNamespace="default,kube-system" />);
    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(screen.getByText("dns-1")).toBeDefined();
    expect(screen.queryByText("backup-1")).toBeNull();
  });

  it("opens the pod detail drawer when a pod row is clicked", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([pod]));
    render(<ResourceBrowser context="kind-dev" kind="pods" />);
    await waitFor(() => screen.getByText("web-1"));
    fireEvent.click(screen.getByText("web-1"));

    // The detail side-panel opens with the pod action icons in its header.
    await waitFor(() => expect(screen.getByRole("button", { name: "Shell" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Logs" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Details" })).toBeDefined();
  });

  it("deep-links to a resource's detail via the focus prop (global search)", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([pod]));
    render(
      <ResourceBrowser
        context="kind-dev"
        kind="pods"
        focus={{ name: "web-1", namespace: "default", nonce: 1 }}
      />,
    );
    // Detail opens automatically once the matching row loads — no click needed.
    await waitFor(() => expect(screen.getByRole("button", { name: "Shell" })).toBeDefined());
    expect(screen.getByRole("complementary", { name: "Details" })).toBeDefined();
  });

  it("opens a tabbed detail with a YAML tab when a deployment row is clicked", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web", namespace: "default", ready: "1/1", upToDate: 1, available: 1 }]),
    );
    getManifestMock.mockResolvedValue({ yaml: "kind: Deployment\nmetadata:\n  name: web\n" });
    render(<ResourceBrowser context="kind-dev" kind="deployments" />);
    await waitFor(() => screen.getByText("web"));

    fireEvent.click(screen.getByText("web"));

    // Drawer opens on the Overview tab; switch to YAML to see the manifest.
    await waitFor(() => screen.getByRole("tab", { name: "YAML" }));
    await userEvent.click(screen.getByRole("tab", { name: "YAML" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Manifest YAML") as HTMLTextAreaElement).value).toContain(
        "kind: Deployment",
      ),
    );
    expect(getManifestMock).toHaveBeenCalledWith(
      "kind-dev",
      "Deployment",
      "default",
      "web",
      undefined,
      undefined,
    );
  });

  it("opens an edit tab from the detail Edit action", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web", namespace: "default", ready: "1/1", upToDate: 1, available: 1 }]),
    );
    const onOpenEdit = vi.fn();
    render(<ResourceBrowser context="kind-dev" kind="deployments" onOpenEdit={onOpenEdit} />);
    fireEvent.click(await screen.findByText("web"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(onOpenEdit).toHaveBeenCalledWith("Deployment", "default", "web");
  });

  it("lists a generic kind (endpoints) via listResource", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listResourceMock.mockResolvedValue({ items: [{ name: "ep-1", namespace: "default" }] });
    render(<ResourceBrowser context="kind-dev" kind="endpoints" />);

    await waitFor(() => expect(screen.getByText("ep-1")).toBeDefined());
    expect(listResourceMock).toHaveBeenCalledWith("kind-dev", "Endpoints", "");
    expect(watchResourceMock).not.toHaveBeenCalled();
  });

  it("lists cluster-scoped nodes without a namespace selector", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({
      nodes: [
        { name: "cp-1", status: "Ready", unschedulable: false, taints: 0, version: "v1.35.0", roles: "control-plane" },
      ],
    });
    render(<ResourceBrowser context="kind-dev" kind="nodes" />);

    await waitFor(() => expect(screen.getByText("cp-1")).toBeDefined());
    expect(listNodesMock).toHaveBeenCalledWith("kind-dev");
    expect(screen.queryByLabelText("Namespace")).toBeNull();
    // A healthy, schedulable node shows no cordon/taint chips.
    expect(screen.queryByText("SchedulingDisabled")).toBeNull();
    expect(screen.queryByText(/Tainted/)).toBeNull();
  });

  it("flags cordoned and tainted nodes alongside readiness", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({
      nodes: [
        { name: "worker-1", status: "Ready", unschedulable: true, taints: 2, version: "v1.35.0", roles: "<none>" },
      ],
    });
    render(<ResourceBrowser context="kind-dev" kind="nodes" />);

    await waitFor(() => expect(screen.getByText("worker-1")).toBeDefined());
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("SchedulingDisabled")).toBeDefined();
    expect(screen.getByText("Tainted (2)")).toBeDefined();
  });

  it("hides a node column via the column picker and remembers it", async () => {
    localStorage.clear();
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({
      nodes: [{ name: "cp-1", status: "Ready", unschedulable: false, taints: 0, version: "v1.35.0", roles: "control-plane" }],
    });
    const user = userEvent.setup();
    const view = render(<ResourceBrowser context="kind-dev" kind="nodes" />);

    await waitFor(() => expect(screen.getByText("cp-1")).toBeDefined());
    // Version column starts visible.
    expect(screen.getByRole("columnheader", { name: /Version/ })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    await user.click(await screen.findByLabelText("Version"));

    // Header is gone…
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: /Version/ })).toBeNull(),
    );
    // …and the choice is persisted.
    expect(JSON.parse(localStorage.getItem("catamaran.hiddenColumns")!)).toEqual({ nodes: ["version"] });

    // Remounting the nodes view keeps the column hidden.
    view.unmount();
    render(<ResourceBrowser context="kind-dev" kind="nodes" />);
    await waitFor(() => expect(screen.getByText("cp-1")).toBeDefined());
    expect(screen.queryByRole("columnheader", { name: /Version/ })).toBeNull();
  });

  it("keeps hidden node columns after switching kubernetes context", async () => {
    localStorage.clear();
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({
      nodes: [{ name: "cp-1", status: "Ready", unschedulable: false, taints: 0, version: "v1.35.0", roles: "control-plane" }],
    });
    const user = userEvent.setup();

    const first = render(<ResourceBrowser context="cluster-a" kind="nodes" />);
    await waitFor(() => expect(screen.getByText("cp-1")).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    await user.click(await screen.findByLabelText("Version"));
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: /Version/ })).toBeNull());

    // Switching cluster mounts a fresh Nodes view for the new context; the
    // choice is stored per-view (not per-context), so it must carry over.
    first.unmount();
    render(<ResourceBrowser context="cluster-b" kind="nodes" />);
    await waitFor(() => expect(screen.getByText("cp-1")).toBeDefined());
    expect(screen.queryByRole("columnheader", { name: /Version/ })).toBeNull();
    // Other columns remain visible.
    expect(screen.getByRole("columnheader", { name: /Roles/ })).toBeDefined();
  });

  it("shows a namespace load error and does not watch", async () => {
    listNamespacesMock.mockResolvedValue({ error: "forbidden: namespaces" });
    render(<ResourceBrowser context="kind-dev" kind="pods" />);
    await waitFor(() => expect(screen.getByText(/forbidden: namespaces/)).toBeDefined());
    expect(watchResourceMock).not.toHaveBeenCalled();
  });

  it("shows a resource load error for nodes", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({ error: "list nodes timed out" });
    render(<ResourceBrowser context="kind-dev" kind="nodes" />);
    await waitFor(() => expect(screen.getByText(/list nodes timed out/)).toBeDefined());
  });
});
