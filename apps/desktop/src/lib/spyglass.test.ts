import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverTools,
  listSpyglassForwards,
  openSpyglassTool,
  pickDiscovered,
  probeUrl,
  resetSpyglassCache,
  resolveSpyglassOpening,
  spyglassForwardStart,
  spyglassForwardStop,
  spyglassTitle,
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

beforeEach(() => resetSpyglassCache());

describe("spyglass capability wrappers", () => {
  it("discovers tools and surfaces failures as outcomes", async () => {
    const ok = vi.fn().mockResolvedValue({ tools: [KIALI_ROW] });
    const out = await discoverTools("tusk-dev", ok);
    expect(ok).toHaveBeenCalledWith("obs.discover", { context: "tusk-dev" });
    expect(out.tools?.[0].service).toBe("kiali");

    const bad = vi.fn().mockRejectedValue(new Error("cluster unreachable"));
    expect((await discoverTools("tusk-dev", bad)).error).toContain("unreachable");
  });

  it("probes URLs", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, status: 200, frameBlocked: true, authRedirect: false });
    const out = await probeUrl("http://127.0.0.1:1234", invoke);
    expect(invoke).toHaveBeenCalledWith("obs.probe", { url: "http://127.0.0.1:1234" });
    expect(out.probe?.frameBlocked).toBe(true);
  });

  it("starts, lists and stops keyed forwards", async () => {
    const invoke = vi.fn().mockResolvedValue({ localPort: 51000, reused: false });
    const started = await spyglassForwardStart("tusk-dev", "infra", "grafana", 80, invoke);
    expect(invoke).toHaveBeenCalledWith("net.portForwardStart", {
      context: "tusk-dev",
      namespace: "infra",
      service: "grafana",
      port: 80,
    });
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
    expect(stop).toHaveBeenCalledWith("net.portForwardStop", {
      context: "tusk-dev",
      namespace: "infra",
      service: "grafana",
      port: 80,
    });
    expect(stopped.stopped).toBe(true);
  });
});

describe("pickDiscovered / spyglassTitle", () => {
  it("picks the row for the requested tool", () => {
    expect(pickDiscovered([GRAFANA_ROW, KIALI_ROW], "kiali")?.port).toBe(20001);
    expect(pickDiscovered([GRAFANA_ROW], "kiali")).toBeNull();
  });

  it("titles windows with the context", () => {
    expect(spyglassTitle("kiali", "tusk-dev")).toBe("Kiali — tusk-dev");
    expect(spyglassTitle("grafana", null)).toBe("Grafana");
  });
});

describe("resolveSpyglassOpening", () => {
  it("uses a configured URL as-is (no forward, no context needed)", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, status: 302, frameBlocked: false, authRedirect: true });
    const out = await resolveSpyglassOpening("kiali", null, { mode: "url", url: "https://kiali.example" }, invoke);
    expect(out.opening).toMatchObject({ url: "https://kiali.example", via: "url" });
    expect(out.opening?.probe?.authRedirect).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("obs.probe", { url: "https://kiali.example" });
  });

  it("requires a context for auto and service modes", async () => {
    const invoke = vi.fn();
    const out = await resolveSpyglassOpening("grafana", null, { mode: "auto" }, invoke);
    expect(out.error).toContain("Open a cluster first");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("auto mode discovers, forwards and probes", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "obs.discover") return { tools: [KIALI_ROW, GRAFANA_ROW] };
      if (id === "net.portForwardStart") return { localPort: 50123, reused: false };
      if (id === "obs.probe") return { ok: true, status: 200, frameBlocked: true, authRedirect: false };
      throw new Error(`unexpected capability ${id}`);
    });
    const out = await resolveSpyglassOpening("grafana", "tusk-dev", { mode: "auto" }, invoke as never);
    expect(out.opening).toMatchObject({
      url: "http://127.0.0.1:50123",
      via: "forward",
      localPort: 50123,
    });
    expect(invoke).toHaveBeenCalledWith("net.portForwardStart", {
      context: "tusk-dev",
      namespace: "infra",
      service: "grafana",
      port: 80,
    });
  });

  it("caches discovery per tool+context so re-opens skip the scan", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "obs.discover") return { tools: [GRAFANA_ROW] };
      if (id === "net.portForwardStart") return { localPort: 50124, reused: true };
      return { ok: true, status: 200, frameBlocked: true, authRedirect: false };
    });
    await resolveSpyglassOpening("grafana", "tusk-dev", { mode: "auto" }, invoke as never);
    await resolveSpyglassOpening("grafana", "tusk-dev", { mode: "auto" }, invoke as never);
    const discoverCalls = invoke.mock.calls.filter(([id]) => id === "obs.discover");
    expect(discoverCalls).toHaveLength(1);
  });

  it("reports a missing tool with a Settings pointer", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "obs.discover") return { tools: [KIALI_ROW] };
      throw new Error(`unexpected capability ${id}`);
    });
    const out = await resolveSpyglassOpening("grafana", "kind-local", { mode: "auto" }, invoke as never);
    expect(out.error).toContain("No Grafana service found in kind-local");
    expect(out.error).toContain("Settings");
  });

  it("pinned service mode skips discovery entirely", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "net.portForwardStart") return { localPort: 50125, reused: false };
      if (id === "obs.probe") return { ok: true, status: 200, frameBlocked: false, authRedirect: false };
      throw new Error(`unexpected capability ${id}`);
    });
    const out = await resolveSpyglassOpening(
      "kiali",
      "tusk-dev",
      { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
      invoke as never,
    );
    expect(out.opening?.via).toBe("forward");
    expect(invoke.mock.calls.some(([id]) => id === "obs.discover")).toBe(false);
  });

  it("surfaces forward failures", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "net.portForwardStart") throw new Error("service has no running pods");
      throw new Error(`unexpected capability ${id}`);
    });
    const out = await resolveSpyglassOpening(
      "grafana",
      "tusk-dev",
      { mode: "service", namespace: "infra", service: "grafana", port: 80 },
      invoke as never,
    );
    expect(out.error).toContain("no running pods");
  });

  it("fails when the forwarded port never answers", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "net.portForwardStart") return { localPort: 50999, reused: false };
      if (id === "obs.probe") return { ok: false, frameBlocked: false, authRedirect: false, error: "connection refused" };
      throw new Error(`unexpected capability ${id}`);
    });
    const out = await resolveSpyglassOpening(
      "grafana",
      "tusk-dev",
      { mode: "service", namespace: "infra", service: "grafana", port: 80 },
      invoke as never,
    );
    expect(out.error).toContain("not answering");
    // The probe retried before giving up.
    const probes = invoke.mock.calls.filter(([id]) => id === "obs.probe");
    expect(probes.length).toBeGreaterThan(1);
  }, 10_000);
});

describe("openSpyglassTool", () => {
  it("hands the resolved URL to the shell window command", async () => {
    const invoke = vi.fn(async (id: string) => {
      if (id === "net.portForwardStart") return { localPort: 50200, reused: false };
      if (id === "obs.probe") return { ok: true, status: 200, frameBlocked: true, authRedirect: false };
      throw new Error(`unexpected capability ${id}`);
    });
    const command = vi.fn().mockResolvedValue(undefined);
    const out = await openSpyglassTool(
      "kiali",
      "tusk-dev",
      { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
      invoke as never,
      command,
    );
    expect(out.opening?.url).toBe("http://127.0.0.1:50200");
    expect(command).toHaveBeenCalledWith("open_tool_window", {
      tool: "kiali",
      url: "http://127.0.0.1:50200",
      title: "Kiali — tusk-dev",
    });
  });

  it("does not open a window when resolution failed, and reports command failures", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("nope");
    });
    const command = vi.fn();
    const out = await openSpyglassTool("grafana", "tusk-dev", { mode: "auto" }, invoke as never, command);
    expect(out.error).toBeTruthy();
    expect(command).not.toHaveBeenCalled();

    const okInvoke = vi.fn().mockResolvedValue({ ok: true, status: 200, frameBlocked: false, authRedirect: false });
    const badCommand = vi.fn().mockRejectedValue(new Error("window manager unavailable"));
    const failed = await openSpyglassTool(
      "grafana",
      null,
      { mode: "url", url: "https://grafana.example" },
      okInvoke as never,
      badCommand,
    );
    expect(failed.error).toContain("window manager unavailable");
  });
});
