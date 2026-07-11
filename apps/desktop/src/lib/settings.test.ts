import { describe, it, expect, beforeEach } from "vitest";
import {
  loadClusterNamespaces,
  saveClusterNamespaces,
  getDefaultNamespace,
  setDefaultNamespace,
  DEFAULT_WORKSPACE_LAYOUT,
  loadWorkspaceLayout,
  saveWorkspaceLayout,
  contextDisplayName,
  loadContextProfiles,
  saveContextProfiles,
  loadKubeconfigFiles,
  saveKubeconfigFiles,
  loadContextOrder,
  orderContexts,
  saveContextOrder,
  loadUpdateChannel,
  saveUpdateChannel,
  REQUEST_TIMEOUT,
  clampTimeoutSecs,
  getRequestTimeoutSecs,
  setRequestTimeoutSecs,
  loadHiddenColumns,
  saveHiddenColumns,
  DEFAULT_DECK_LAYOUT,
  loadDeckLayout,
  saveDeckLayout,
} from "./settings";

beforeEach(() => localStorage.clear());

describe("request timeout setting", () => {
  it("defaults to the documented default when unset", () => {
    expect(getRequestTimeoutSecs()).toBe(REQUEST_TIMEOUT.DEFAULT);
  });

  it("clamps values to the supported range", () => {
    expect(clampTimeoutSecs(100)).toBe(REQUEST_TIMEOUT.MAX);
    expect(clampTimeoutSecs(0)).toBe(REQUEST_TIMEOUT.MIN);
    expect(clampTimeoutSecs(-5)).toBe(REQUEST_TIMEOUT.MIN);
    expect(clampTimeoutSecs(15)).toBe(15);
    expect(clampTimeoutSecs("nonsense")).toBe(REQUEST_TIMEOUT.DEFAULT);
  });

  it("persists and reloads a clamped value", () => {
    expect(setRequestTimeoutSecs(25)).toBe(25);
    expect(getRequestTimeoutSecs()).toBe(25);
    // Out-of-range writes are clamped on the way in.
    expect(setRequestTimeoutSecs(999)).toBe(REQUEST_TIMEOUT.MAX);
    expect(getRequestTimeoutSecs()).toBe(REQUEST_TIMEOUT.MAX);
  });

  it("falls back to the default when stored data is corrupt", () => {
    localStorage.setItem("catamaran.requestTimeoutSecs", "{not json");
    expect(getRequestTimeoutSecs()).toBe(REQUEST_TIMEOUT.DEFAULT);
  });
});

describe("settings persistence", () => {
  it("round-trips per-cluster namespaces", () => {
    expect(loadClusterNamespaces()).toEqual({});
    saveClusterNamespaces({ "kind-dev": "kube-system", prod: "monitoring" });
    expect(loadClusterNamespaces()).toEqual({ "kind-dev": "kube-system", prod: "monitoring" });
  });

  it("round-trips the default namespace", () => {
    expect(getDefaultNamespace()).toBe("");
    setDefaultNamespace("monitoring");
    expect(getDefaultNamespace()).toBe("monitoring");
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem("catamaran.clusterNamespaces", "{not json");
    expect(loadClusterNamespaces()).toEqual({});
  });

  it("persists workspace panel widths and bounds invalid values", () => {
    expect(loadWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    saveWorkspaceLayout({ leftSidebarWidth: 260, rightSidebarWidth: 640 });
    expect(loadWorkspaceLayout()).toEqual({ leftSidebarWidth: 260, rightSidebarWidth: 640 });

    localStorage.setItem(
      "catamaran.workspaceLayout",
      JSON.stringify({ leftSidebarWidth: 20, rightSidebarWidth: 2000 }),
    );
    expect(loadWorkspaceLayout()).toEqual({ leftSidebarWidth: 160, rightSidebarWidth: 960 });
  });

  it("persists context names, short labels, colors, and logos", () => {
    const profiles = {
      production: { displayName: "Production EU", shortName: "EU", color: "#dc2626", logo: "custom" as const, logoUrl: "https://example.com/logo.png" },
    };
    saveContextProfiles(profiles);
    expect(loadContextProfiles()).toEqual(profiles);
    expect(contextDisplayName("production", profiles.production)).toBe("Production EU");
    expect(contextDisplayName("staging", undefined)).toBe("staging");
  });

  it("persists and deduplicates additional kubeconfig files", () => {
    saveKubeconfigFiles(["/tmp/a", "/tmp/b", "/tmp/a"]);
    expect(loadKubeconfigFiles()).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("persists hidden columns per view independently", () => {
    expect(loadHiddenColumns("nodes")).toEqual([]);
    saveHiddenColumns("nodes", ["cpu", "memory", "cpu"]);
    expect(loadHiddenColumns("nodes")).toEqual(["cpu", "memory"]);
    // A different view keeps its own set.
    expect(loadHiddenColumns("pods")).toEqual([]);
    saveHiddenColumns("pods", ["restarts"]);
    expect(loadHiddenColumns("nodes")).toEqual(["cpu", "memory"]);
    expect(loadHiddenColumns("pods")).toEqual(["restarts"]);
  });

  it("returns no hidden columns when storage is corrupt", () => {
    localStorage.setItem("catamaran.hiddenColumns", "{not json");
    expect(loadHiddenColumns("nodes")).toEqual([]);
  });

  it("persists context order and appends unordered contexts", () => {
    saveContextOrder(["prod", "dev", "prod"]);
    expect(loadContextOrder()).toEqual(["prod", "dev"]);
    expect(orderContexts([{ name: "dev" }, { name: "new" }, { name: "prod" }], loadContextOrder()))
      .toEqual([{ name: "prod" }, { name: "dev" }, { name: "new" }]);
  });

  it("persists the update channel and defaults to stable", () => {
    expect(loadUpdateChannel()).toBe("stable");
    saveUpdateChannel("dev");
    expect(loadUpdateChannel()).toBe("dev");
  });

  it("falls back to stable for unknown stored channels", () => {
    localStorage.setItem("catamaran.updateChannel", "nightly");
    expect(loadUpdateChannel()).toBe("stable");
  });
});

describe("deck layout", () => {
  it("defaults to a single, unlinked pane", () => {
    expect(loadDeckLayout()).toEqual(DEFAULT_DECK_LAYOUT);
  });

  it("round-trips split, ratio, and linked", () => {
    saveDeckLayout({ split: true, ratio: 0.65, linked: true });
    expect(loadDeckLayout()).toEqual({ split: true, ratio: 0.65, linked: true });
  });

  it("bounds the ratio and coerces invalid fields", () => {
    saveDeckLayout({ split: true, ratio: 5, linked: true });
    expect(loadDeckLayout().ratio).toBe(0.8);
    localStorage.setItem("catamaran.deck", JSON.stringify({ split: "yes", ratio: "x", linked: 0 }));
    expect(loadDeckLayout()).toEqual({ split: false, ratio: 0.5, linked: false });
  });

  it("falls back to the default on corrupt storage", () => {
    localStorage.setItem("catamaran.deck", "{nope");
    expect(loadDeckLayout()).toEqual(DEFAULT_DECK_LAYOUT);
  });
});

describe("AWS access portal", () => {
  it("round-trips a configured portal URL", async () => {
    const { loadAwsPortalUrl, saveAwsPortalUrl } = await import("./settings");
    expect(loadAwsPortalUrl()).toBe("");
    saveAwsPortalUrl("https://deepinsightai.awsapps.com/start/#/");
    expect(loadAwsPortalUrl()).toBe("https://deepinsightai.awsapps.com/start/#/");
  });

  it("treats non-web values as unset", async () => {
    const { loadAwsPortalUrl, saveAwsPortalUrl } = await import("./settings");
    saveAwsPortalUrl("javascript:alert(1)");
    expect(loadAwsPortalUrl()).toBe("");
    saveAwsPortalUrl("   ");
    expect(loadAwsPortalUrl()).toBe("");
  });
});

describe("observability (spyglass) config", () => {
  it("defaults every catalog tool to auto-detect", async () => {
    const { loadObservabilityConfig, SPYGLASS_TOOL_IDS } = await import("./settings");
    const cfg = loadObservabilityConfig();
    expect(Object.keys(cfg).sort()).toEqual([...SPYGLASS_TOOL_IDS].sort());
    for (const id of SPYGLASS_TOOL_IDS) {
      expect(cfg[id]).toEqual({ mode: "auto" });
    }
    // The four newer tools are present alongside kiali/grafana.
    expect(SPYGLASS_TOOL_IDS).toContain("airflow");
    expect(SPYGLASS_TOOL_IDS).toContain("redpanda");
    expect(SPYGLASS_TOOL_IDS).toContain("temporal");
    expect(SPYGLASS_TOOL_IDS).toContain("tusklens");
  });

  it("round-trips pinned services and URLs per tool", async () => {
    const { loadObservabilityConfig, saveObservabilityConfig, DEFAULT_OBSERVABILITY } =
      await import("./settings");
    saveObservabilityConfig({
      ...DEFAULT_OBSERVABILITY,
      kiali: { mode: "service", namespace: "istio-system", service: "kiali", port: 20001 },
      grafana: { mode: "url", url: "https://grafana.example" },
      temporal: { mode: "service", namespace: "temporal", service: "temporal-web", port: 8080 },
    });
    const cfg = loadObservabilityConfig();
    expect(cfg.kiali).toEqual({ mode: "service", namespace: "istio-system", service: "kiali", port: 20001 });
    expect(cfg.grafana).toEqual({ mode: "url", url: "https://grafana.example" });
    expect(cfg.temporal).toEqual({ mode: "service", namespace: "temporal", service: "temporal-web", port: 8080 });
    expect(cfg.airflow).toEqual({ mode: "auto" });
  });

  it("round-trips and sanitizes saved views", async () => {
    const { loadObservabilityConfig, saveObservabilityConfig } = await import("./settings");
    saveObservabilityConfig({
      kiali: { mode: "auto", savedPath: "/kiali/console/graph/namespaces/?namespaces=aiapp" },
      grafana: { mode: "auto" },
    });
    expect(loadObservabilityConfig().kiali.savedPath).toBe(
      "/kiali/console/graph/namespaces/?namespaces=aiapp",
    );

    // Full URLs and protocol-relative paths never survive as saved views.
    localStorage.setItem(
      "catamaran.observability",
      JSON.stringify({
        kiali: { mode: "auto", savedPath: "https://evil.example/x" },
        grafana: { mode: "auto", savedPath: "//evil.example/x" },
      }),
    );
    const cfg = loadObservabilityConfig();
    expect(cfg.kiali.savedPath).toBeUndefined();
    expect(cfg.grafana.savedPath).toBeUndefined();
  });

  it("sanitizes garbage back to auto", async () => {
    const { loadObservabilityConfig } = await import("./settings");
    localStorage.setItem("catamaran.observability", "not json");
    expect(loadObservabilityConfig().kiali.mode).toBe("auto");

    localStorage.setItem(
      "catamaran.observability",
      JSON.stringify({
        kiali: { mode: "service", namespace: "x", service: "y", port: 99999 }, // port out of range
        grafana: { mode: "url", url: "javascript:alert(1)" }, // non-web scheme
      }),
    );
    const cfg = loadObservabilityConfig();
    expect(cfg.kiali).toEqual({ mode: "auto" });
    expect(cfg.grafana).toEqual({ mode: "auto" });
  });
});
