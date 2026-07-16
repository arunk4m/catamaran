import { describe, it, expect, vi, beforeEach } from "vitest";
import { SPYGLASS_CATALOG } from "./settings";
import {
  discoverTools,
  embedStart,
  embedStop,
  kialiDefaultPath,
  listSpyglassForwards,
  pickDiscovered,
  prepareEmbed,
  probeUrl,
  resetSpyglassCache,
  spyglassForwardStart,
  spyglassForwardStop,
  type DiscoveredTool,
} from "./spyglass";

const KIALI_ROW: DiscoveredTool = {
  tool: "kiali",
  namespace: "istio-system",
  service: "kiali",
  port: 20001,
  ingressUrl: "http://kiali.dev.example",
};
const GRAFANA_ROW: DiscoveredTool = {
  tool: "grafana",
  namespace: "infra",
  service: "grafana",
  port: 80,
  ingressUrl: null,
};

/** Resolve a built-in tool's meta for prepareEmbed. */
const meta = (id: string) => SPYGLASS_CATALOG.find((t) => t.id === id)!;

/** A fake invoker for the whole embed pipeline, recording calls. */
function pipelineInvoke(overrides: Record<string, (args: never) => unknown> = {}) {
  return vi.fn(async (id: string, args: unknown) => {
    if (id in overrides) return overrides[id](args as never);
    if (id === "obs.discover")
      return { tools: [KIALI_ROW, GRAFANA_ROW], meshNamespaces: ["aiapp", "default"] };
    if (id === "obs.embedStart") return { url: "http://127.0.0.1:51000", localPort: 51000, reused: false };
    if (id === "obs.probe") return { ok: true, status: 200, frameBlocked: false, authRedirect: false };
    throw new Error(`unexpected capability ${id}`);
  });
}

beforeEach(() => resetSpyglassCache());

describe("spyglass capability wrappers", () => {
  it("discovers tools with mesh namespaces", async () => {
    const ok = vi.fn().mockResolvedValue({ tools: [KIALI_ROW], meshNamespaces: ["default"] });
    const out = await discoverTools("tusk-dev", ok);
    expect(ok).toHaveBeenCalledWith("obs.discover", { context: "tusk-dev" });
    expect(out.tools?.[0].service).toBe("kiali");
    expect(out.meshNamespaces).toEqual(["default"]);

    const bad = vi.fn().mockRejectedValue(new Error("cluster unreachable"));
    expect((await discoverTools("tusk-dev", bad)).error).toContain("unreachable");
  });

  it("probes URLs", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, status: 200, frameBlocked: true, authRedirect: false });
    const out = await probeUrl("http://127.0.0.1:1234", invoke);
    expect(invoke).toHaveBeenCalledWith("obs.probe", { url: "http://127.0.0.1:1234" });
    expect(out.probe?.frameBlocked).toBe(true);
  });

  it("starts and stops embed relays", async () => {
    const start = vi.fn().mockResolvedValue({ url: "http://127.0.0.1:51000", localPort: 51000, reused: true });
    const started = await embedStart("tusk-dev", "infra", "grafana", 80, start);
    expect(start).toHaveBeenCalledWith("obs.embedStart", {
      context: "tusk-dev",
      namespace: "infra",
      service: "grafana",
      port: 80,
    });
    expect(started.url).toBe("http://127.0.0.1:51000");

    const stop = vi.fn().mockResolvedValue({ stopped: true });
    const stopped = await embedStop(
      { context: "tusk-dev", namespace: "infra", service: "grafana", port: 80 },
      stop,
    );
    expect(stop).toHaveBeenCalledWith("obs.embedStop", {
      context: "tusk-dev",
      namespace: "infra",
      service: "grafana",
      port: 80,
    });
    expect(stopped.stopped).toBe(true);
  });

  it("starts, lists and stops keyed forwards", async () => {
    const invoke = vi.fn().mockResolvedValue({ localPort: 51000, reused: false });
    const started = await spyglassForwardStart("tusk-dev", "infra", "grafana", 80, invoke);
    expect(started.localPort).toBe(51000);

    const list = vi.fn().mockResolvedValue({
      forwards: [{ context: "tusk-dev", namespace: "infra", service: "grafana", port: 80, localPort: 51000 }],
    });
    expect((await listSpyglassForwards(list)).forwards).toHaveLength(1);

    const stop = vi.fn().mockResolvedValue({ stopped: true });
    const stopped = await spyglassForwardStop(
      { context: "tusk-dev", namespace: "infra", service: "grafana", port: 80 },
      stop,
    );
    expect(stopped.stopped).toBe(true);
  });
});

describe("pickDiscovered / kialiDefaultPath", () => {
  it("picks the first row for the requested tool", () => {
    expect(pickDiscovered([GRAFANA_ROW, KIALI_ROW], "kiali")?.port).toBe(20001);
    expect(pickDiscovered([GRAFANA_ROW], "kiali")).toBeNull();
  });

  it("builds the animated traffic graph over the mesh namespaces", () => {
    const path = kialiDefaultPath("/kiali", ["aiapp", "default"]);
    expect(path.startsWith("/kiali/console/graph/namespaces/?")).toBe(true);
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("animation")).toBe("true");
    expect(params.get("graphType")).toBe("versionedApp");
    expect(params.get("namespaces")).toBe("aiapp,default");
  });

  it("omits the namespaces param when the mesh is empty, and works at root", () => {
    const path = kialiDefaultPath("", []);
    expect(path.startsWith("/console/graph/namespaces/?")).toBe(true);
    expect(path).not.toContain("namespaces=");
    expect(path).toContain("animation=true");
  });
});

describe("prepareEmbed", () => {
  it("returns url-mode sources as external without touching the backend", async () => {
    const invoke = vi.fn();
    const out = await prepareEmbed(meta("grafana"), "tusk-dev", { mode: "url", url: "https://grafana.example" }, invoke);
    expect(out.prep).toEqual({ kind: "external", url: "https://grafana.example" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requires a context for auto and service modes", async () => {
    const invoke = vi.fn();
    const out = await prepareEmbed(meta("kiali"), null, { mode: "auto" }, invoke);
    expect(out.error).toContain("Open a cluster first");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("auto mode discovers, relays, detects the /kiali prefix and opens the animated graph", async () => {
    const invoke = pipelineInvoke();
    const out = await prepareEmbed(meta("kiali"), "tusk-dev", { mode: "auto" }, invoke as never);
    expect(out.error).toBeUndefined();
    const prep = out.prep;
    if (prep?.kind !== "embed") throw new Error(`expected embed, got ${JSON.stringify(prep)}`);
    expect(prep.base).toBe("http://127.0.0.1:51000");
    expect(prep.initialPath).toBe(kialiDefaultPath("/kiali", ["aiapp", "default"]));
    expect(prep.initialPath).toContain("animation=true");
    expect(prep.meshNamespaces).toEqual(["aiapp", "default"]);
    expect(invoke).toHaveBeenCalledWith("obs.embedStart", {
      context: "tusk-dev",
      namespace: "istio-system",
      service: "kiali",
      port: 20001,
    });
  });

  it("falls back to a root-served kiali when /kiali/ is not found", async () => {
    const invoke = pipelineInvoke({
      "obs.probe": (args: { url: string }) =>
        args.url.endsWith("/kiali/")
          ? { ok: true, status: 404, frameBlocked: false, authRedirect: false }
          : { ok: true, status: 200, frameBlocked: false, authRedirect: false },
    });
    const out = await prepareEmbed(meta("kiali"), "tusk-dev", { mode: "auto" }, invoke as never);
    const prep = out.prep;
    if (prep?.kind !== "embed") throw new Error("expected embed");
    expect(prep.initialPath.startsWith("/console/graph/namespaces/?")).toBe(true);
  });

  it("a saved view wins over the default path", async () => {
    const invoke = pipelineInvoke();
    const saved = "/kiali/console/graph/namespaces/?namespaces=aiapp&animation=false";
    const out = await prepareEmbed(meta("kiali"), "tusk-dev", { mode: "auto", savedPath: saved }, invoke as never);
    const prep = out.prep;
    if (prep?.kind !== "embed") throw new Error("expected embed");
    expect(prep.initialPath).toBe(saved);
    // The default stays available for "Reset view".
    expect(prep.defaultPath).toContain("animation=true");
  });

  it("grafana opens at root and never probes for a prefix", async () => {
    const invoke = pipelineInvoke();
    const out = await prepareEmbed(meta("grafana"), "tusk-dev", { mode: "auto" }, invoke as never);
    const prep = out.prep;
    if (prep?.kind !== "embed") throw new Error("expected embed");
    expect(prep.initialPath).toBe("/");
    const probed = invoke.mock.calls.filter(([id]) => id === "obs.probe").map(([, args]) => (args as { url: string }).url);
    expect(probed).toEqual(["http://127.0.0.1:51000/"]);
  });

  it("pinned grafana skips discovery entirely; pinned kiali still asks for mesh namespaces", async () => {
    const grafanaInvoke = pipelineInvoke();
    await prepareEmbed(
      meta("grafana"),
      "tusk-dev",
      { mode: "service", namespace: "infra", service: "grafana", port: 80 },
      grafanaInvoke as never,
    );
    expect(grafanaInvoke.mock.calls.some(([id]) => id === "obs.discover")).toBe(false);

    resetSpyglassCache();
    const kialiInvoke = pipelineInvoke();
    const out = await prepareEmbed(
      meta("kiali"),
      "tusk-dev",
      { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
      kialiInvoke as never,
    );
    expect(kialiInvoke.mock.calls.some(([id]) => id === "obs.discover")).toBe(true);
    if (out.prep?.kind !== "embed") throw new Error("expected embed");
    expect(out.prep.meshNamespaces).toEqual(["aiapp", "default"]);
  });

  it("caches discovery per context so re-opens skip the scan", async () => {
    const invoke = pipelineInvoke();
    await prepareEmbed(meta("kiali"), "tusk-dev", { mode: "auto" }, invoke as never);
    await prepareEmbed(meta("grafana"), "tusk-dev", { mode: "auto" }, invoke as never);
    const discoverCalls = invoke.mock.calls.filter(([id]) => id === "obs.discover");
    expect(discoverCalls).toHaveLength(1);
  });

  it("reports a missing tool with a Settings pointer", async () => {
    const invoke = pipelineInvoke({
      "obs.discover": () => ({ tools: [KIALI_ROW], meshNamespaces: [] }),
    });
    const out = await prepareEmbed(meta("grafana"), "kind-local", { mode: "auto" }, invoke as never);
    expect(out.error).toContain("No Grafana service found in kind-local");
    expect(out.error).toContain("Settings");
  });

  it("surfaces relay failures and dead relays", async () => {
    const failStart = pipelineInvoke({
      "obs.embedStart": () => {
        throw new Error("service has no running pods");
      },
    });
    const failed = await prepareEmbed(
      meta("grafana"),
      "tusk-dev",
      { mode: "service", namespace: "infra", service: "grafana", port: 80 },
      failStart as never,
    );
    expect(failed.error).toContain("no running pods");

    resetSpyglassCache();
    const neverAnswers = pipelineInvoke({
      "obs.probe": () => ({ ok: false, frameBlocked: false, authRedirect: false, error: "connection refused" }),
    });
    const dead = await prepareEmbed(
      meta("grafana"),
      "tusk-dev",
      { mode: "service", namespace: "infra", service: "grafana", port: 80 },
      neverAnswers as never,
    );
    expect(dead.error).toContain("not answering");
    expect(neverAnswers.mock.calls.filter(([id]) => id === "obs.probe").length).toBeGreaterThan(1);
  }, 10_000);
});
