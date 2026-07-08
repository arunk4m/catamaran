import { describe, it, expect, vi } from "vitest";
import { getManifest, listNodes, applyManifest, listEvents, listResource } from "./manifest";

describe("getManifest", () => {
  it("passes kind/namespace/name and returns yaml", async () => {
    const invoke = vi.fn().mockResolvedValue({ yaml: "kind: Pod\n" });
    const out = await getManifest("kind-dev", "Pod", "default", "web-1", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.getManifest", {
      context: "kind-dev",
      kind: "Pod",
      namespace: "default",
      name: "web-1",
    });
    expect(out.yaml).toContain("kind: Pod");
  });

  it("normalises errors", async () => {
    const out = await getManifest("c", "Pod", null, "x", () =>
      Promise.reject(new Error("not found")),
    );
    expect(out.error).toContain("not found");
  });
});

describe("listNodes", () => {
  it("returns node summaries", async () => {
    const invoke = vi.fn().mockResolvedValue({
      nodes: [{ name: "cp", status: "Ready", version: "v1.35.0", roles: "control-plane" }],
    });
    const out = await listNodes("kind-dev", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listNodes", { context: "kind-dev" });
    expect(out.nodes?.[0].status).toBe("Ready");
  });

  it("normalises errors", async () => {
    const out = await listNodes("c", () => Promise.reject(new Error("forbidden")));
    expect(out.error).toContain("forbidden");
  });
});

describe("listEvents", () => {
  it("passes an exact involved-object filter", async () => {
    const invoke = vi.fn().mockResolvedValue({ events: [] });
    await listEvents("kind-dev", "default", { kind: "Pod", name: "web-1" }, invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listEvents", {
      context: "kind-dev",
      namespace: "default",
      objectKind: "Pod",
      objectName: "web-1",
    });
  });
});

describe("applyManifest", () => {
  it("passes context+yaml and returns applied", async () => {
    const invoke = vi.fn().mockResolvedValue({ applied: true, kind: "ConfigMap", name: "cm" });
    const out = await applyManifest("kind-dev", "kind: ConfigMap\n", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.applyManifest", {
      context: "kind-dev",
      yaml: "kind: ConfigMap\n",
    });
    expect(out.applied).toBe(true);
    expect(out.kind).toBe("ConfigMap");
  });

  it("normalises errors", async () => {
    const out = await applyManifest("c", "bad", () => Promise.reject(new Error("invalid")));
    expect(out.error).toContain("invalid");
  });
});

describe("listResource", () => {
  it("passes kind+namespace and returns items", async () => {
    const invoke = vi.fn().mockResolvedValue({
      items: [{ name: "cm1", namespace: "default" }],
    });
    const out = await listResource("kind-dev", "ConfigMap", "default", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listResource", {
      context: "kind-dev",
      kind: "ConfigMap",
      namespace: "default",
    });
    expect(out.items?.[0].name).toBe("cm1");
  });

  it("normalises errors", async () => {
    const out = await listResource("c", "Secret", "default", () =>
      Promise.reject(new Error("forbidden")),
    );
    expect(out.error).toContain("forbidden");
  });
});
