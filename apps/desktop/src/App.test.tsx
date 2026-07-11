import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

// Capture the Tauri event handler App registers for the macOS Cmd+W menu item,
// and a stub window so we can assert tab-close vs. window-close behavior.
const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  const windowClose = vi.fn();
  return {
    handlers,
    windowClose,
    listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
      handlers.set(name, cb);
      return Promise.resolve(() => handlers.delete(name));
    }),
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: tauri.windowClose }),
}));

const { checkForUpdateMock, notifyUpdateAvailableMock } = vi.hoisted(() => ({
  checkForUpdateMock: vi.fn(),
  notifyUpdateAvailableMock: vi.fn(),
}));
vi.mock("./lib/updater", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/updater")>()),
  checkForUpdate: checkForUpdateMock,
}));
vi.mock("./lib/notify", () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), updateAvailable: notifyUpdateAvailableMock },
}));

vi.mock("./components/ClusterHotbar", () => ({
  ClusterHotbar: ({
    onOpenContext,
    onOpenSettings,
    onOpenSpyglass,
  }: {
    onOpenContext: (c: string) => void;
    onOpenSettings: () => void;
    onOpenSpyglass?: (tool: string) => void;
  }) => (
    <div>
      <button onClick={() => onOpenContext("kind-dev")}>open-kind-dev</button>
      <button onClick={() => onOpenContext("prod")}>open-prod</button>
      <button onClick={onOpenSettings}>open-settings</button>
      <button onClick={() => onOpenSpyglass?.("kiali")}>open-kiali</button>
    </div>
  ),
}));
vi.mock("./components/SpyglassView", () => ({
  SpyglassView: ({
    meta,
    context,
    active,
  }: {
    meta: { id: string };
    context: string | null;
    active?: boolean;
  }) => (
    <div data-testid="spyglass">
      {meta.id}:{context}:{active ? "active" : "hidden"}
    </div>
  ),
}));
vi.mock("./components/Sidebar", () => ({
  Sidebar: ({
    onSelect,
    activeCluster,
  }: {
    onSelect: (c: string, k: string) => void;
    activeCluster: string;
  }) => <button onClick={() => onSelect(activeCluster, "services")}>nav-services</button>,
}));
vi.mock("./components/ClusterOverview", () => ({
  ClusterOverview: ({ context }: { context: string }) => (
    <div data-testid="overview">{context}</div>
  ),
}));
vi.mock("./components/ResourceBrowser", () => ({
  RESOURCE_LABELS: { overview: "Overview", pods: "Pods", services: "Services", settings: "Settings" },
  K8S_KIND: { overview: "", pods: "Pod", services: "Service", settings: "" },
  ResourceBrowser: ({
    context,
    kind,
    onOpenResource,
    onOpenEdit,
  }: {
    context: string;
    kind: string;
    onOpenResource?: (target: { kind: string; namespace: string | null; name: string }) => void;
    onOpenEdit?: (kind: string, namespace: string | null, name: string) => void;
  }) => (
    <div data-testid="browser">
      {context}:{kind}
      <button
        onClick={() => onOpenResource?.({ kind: "Pod", namespace: "default", name: "web-1" })}
      >
        linked-pod
      </button>
      <button onClick={() => onOpenEdit?.("Deployment", "default", "web")}>edit-web</button>
    </div>
  ),
}));
vi.mock("./components/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings">workspace settings</div>,
}));
vi.mock("./components/EditResourceTab", () => ({
  EditResourceTab: ({ kind, name }: { kind: string; name: string }) => (
    <div data-testid="edit-tab">
      {kind}/{name}
    </div>
  ),
}));

import { App } from "./App";

beforeEach(() => {
  // The deck layout (split/linked) persists across launches; isolate tests.
  localStorage.clear();
  checkForUpdateMock.mockReset();
  checkForUpdateMock.mockResolvedValue(null); // up to date unless a test says otherwise
  notifyUpdateAvailableMock.mockReset();
});

describe("App", () => {
  it("checks for updates on startup and toasts, linking to the Updates section", async () => {
    checkForUpdateMock.mockResolvedValue({ version: "0.3.0", currentVersion: "0.2.0", notes: "" });
    render(<App />);
    await waitFor(() => expect(notifyUpdateAvailableMock).toHaveBeenCalledWith("0.3.0", expect.any(Function)));
    // The toast's action opens the Settings tab (deep-linked to Updates).
    const onView = notifyUpdateAvailableMock.mock.calls[0][1] as () => void;
    onView();
    expect(await screen.findByTestId("settings")).toBeDefined();
  });

  it("shows the welcome state until a cluster is opened", () => {
    render(<App />);
    expect(screen.getByText(/pure-Rust Kubernetes workspace/)).toBeDefined();
    expect(screen.queryByTestId("overview")).toBeNull();
  });

  it("opening a cluster lands on its Overview tab", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
    expect(screen.getByRole("tab", { name: /Overview · kind-dev/ })).toBeDefined();
  });

  it("selecting a resource opens a separate (cluster, kind) tab", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services")); // sidebar → Services

    expect(screen.getByTestId("browser").textContent).toContain("kind-dev:services");
    expect(screen.getByRole("tab", { name: /Overview · kind-dev/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Services · kind-dev/ })).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: /Overview · kind-dev/ }));
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
  });

  it("opens linked Kubernetes resources in their product view", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services"));
    fireEvent.click(screen.getByText("linked-pod"));
    expect(screen.getByTestId("browser").textContent).toContain("kind-dev:pods");
  });

  it("opens an edit tab from a resource and de-dupes re-edits", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services"));
    fireEvent.click(screen.getByText("edit-web"));
    expect(screen.getByTestId("edit-tab").textContent).toBe("Deployment/web");
    expect(screen.getByRole("tab", { name: /edit: Deployment\/web/ })).toBeDefined();

    // Re-edit the same resource from the services tab → focuses, doesn't duplicate.
    fireEvent.click(screen.getByRole("tab", { name: /Services/ }));
    fireEvent.click(screen.getByText("edit-web"));
    expect(screen.getAllByRole("tab", { name: /edit: Deployment\/web/ })).toHaveLength(1);
  });

  it("opens views across multiple clusters and closes tabs", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("open-prod"));

    expect(screen.getByTestId("overview").textContent).toBe("prod");
    expect(screen.getByRole("tab", { name: /Overview · prod/ })).toBeDefined();

    fireEvent.click(screen.getByLabelText("Close Overview · prod"));
    expect(screen.queryByRole("tab", { name: /Overview · prod/ })).toBeNull();
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
  });

  it("focuses an existing tab instead of duplicating it", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services"));
    fireEvent.click(screen.getByText("nav-services")); // again → no duplicate

    expect(screen.getAllByRole("tab", { name: /Services · kind-dev/ })).toHaveLength(1);
  });

  it("opens settings as a global workspace tab", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-settings"));

    expect(screen.getByTestId("settings").textContent).toBe("workspace settings");
    expect(screen.getByRole("tab", { name: /^Settings$/ })).toBeDefined();
    expect(screen.queryByText("nav-services")).toBeNull();
  });

  it("close-active-tab (Cmd+W) closes the active tab, not the window", () => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    tauri.windowClose.mockClear();
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("open-prod"));
    expect(screen.getByTestId("overview").textContent).toBe("prod");

    const handler = tauri.handlers.get("close-active-tab");
    expect(handler).toBeDefined();
    act(() => handler!({ payload: undefined }));

    expect(screen.queryByRole("tab", { name: /Overview · prod/ })).toBeNull();
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
    expect(tauri.windowClose).not.toHaveBeenCalled();
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  it("close-active-tab (Cmd+W) closes the window when the last tab is closed", () => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    tauri.windowClose.mockClear();
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));

    const handler = tauri.handlers.get("close-active-tab");
    expect(handler).toBeDefined();
    act(() => handler!({ payload: undefined }));

    expect(tauri.windowClose).toHaveBeenCalledTimes(1);
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  describe("split view (the deck)", () => {
    it("Cmd+\\ splits the deck, seeds the starboard pane, and each pane sails its own cluster", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      expect(screen.getAllByTestId("overview")).toHaveLength(1);

      // Split: the starboard pane appears, seeded with the current view.
      fireEvent.keyDown(window, { key: "\\", metaKey: true });
      expect(screen.getByTestId("pane-port")).toBeDefined();
      expect(screen.getByTestId("pane-starboard")).toBeDefined();
      const seeded = screen.getAllByTestId("overview").map((n) => n.textContent);
      expect(seeded).toEqual(["kind-dev", "kind-dev"]);

      // The starboard pane holds focus, so the hotbar opens prod there.
      fireEvent.click(screen.getByText("open-prod"));
      const contexts = screen.getAllByTestId("overview").map((n) => n.textContent);
      expect(contexts).toEqual(["kind-dev", "prod"]);

      // Cmd+\ again collapses back to a single pane, keeping the focused one.
      fireEvent.keyDown(window, { key: "\\", metaKey: true });
      expect(screen.queryByTestId("pane-starboard")).toBeNull();
      expect(screen.getAllByTestId("overview").map((n) => n.textContent)).toEqual(["prod"]);
    });

    it("linked panes mirror kind navigation onto the other pane's own cluster", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      fireEvent.keyDown(window, { key: "\\", metaKey: true });
      fireEvent.click(screen.getByText("open-prod")); // starboard: prod

      // Enable linked cruising from either pane header.
      fireEvent.click(screen.getAllByLabelText("Link panes")[0]);

      // Navigate the focused (starboard/prod) pane to Services via the sidebar.
      fireEvent.click(screen.getByText("nav-services"));

      const browsers = screen.getAllByTestId("browser").map((n) => n.textContent ?? "");
      expect(browsers.some((t) => t.startsWith("prod:services"))).toBe(true);
      expect(browsers.some((t) => t.startsWith("kind-dev:services"))).toBe(true);
    });

    it("closing a pane keeps the survivor's tabs", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      fireEvent.keyDown(window, { key: "\\", metaKey: true });
      fireEvent.click(screen.getByText("open-prod"));

      fireEvent.click(screen.getByLabelText("Close starboard pane"));
      expect(screen.queryByTestId("pane-starboard")).toBeNull();
      expect(screen.getAllByTestId("overview").map((n) => n.textContent)).toEqual(["kind-dev"]);
    });

    it("an unseeded starboard pane opens on the landing screen", () => {
      render(<App />);
      // No tabs at all: splitting yields an empty starboard pane (landing).
      fireEvent.keyDown(window, { key: "\\", metaKey: true });
      expect(screen.getByTestId("pane-starboard")).toBeDefined();
      // Both panes show the landing screen (two mastheads).
      expect(screen.getAllByText(/Two clusters\./)).toHaveLength(2);
    });

    it("Cmd+Alt+arrows move focus between panes", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      fireEvent.keyDown(window, { key: "\\", metaKey: true }); // focus: starboard
      fireEvent.click(screen.getByText("open-prod"));

      // Focus port, then the hotbar targets it.
      fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true, altKey: true });
      fireEvent.click(screen.getByText("open-prod"));
      expect(screen.getAllByTestId("overview").map((n) => n.textContent)).toEqual(["prod", "prod"]);
    });
  });

  describe("spyglass (Kiali / Grafana) tabs", () => {
    it("opens a single Kiali tab targeting the focused cluster", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      fireEvent.click(screen.getByText("open-kiali"));

      const spyglass = screen.getByTestId("spyglass");
      expect(spyglass.textContent).toBe("kiali:kind-dev:active");
      // Re-opening focuses the existing tab rather than stacking a second one.
      fireEvent.click(screen.getByText("open-kiali"));
      expect(screen.getAllByTestId("spyglass")).toHaveLength(1);
    });

    it("keeps the Kiali iframe mounted (just hidden) when switching to another tab", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      fireEvent.click(screen.getByText("open-kiali"));
      expect(screen.getByTestId("spyglass").textContent).toBe("kiali:kind-dev:active");

      // Switch to a resource tab: Kiali stays in the DOM (keep-alive), now hidden.
      fireEvent.click(screen.getByText("nav-services"));
      expect(screen.getByTestId("browser").textContent).toContain("kind-dev:services");
      const spyglass = screen.getByTestId("spyglass");
      expect(spyglass.textContent).toBe("kiali:kind-dev:hidden");
      // Its keep-alive wrapper is hidden so it takes no space / no focus.
      expect(spyglass.closest(".cat-pane-keepalive")?.hasAttribute("hidden")).toBe(true);
    });

    it("a locked Kiali pane sends sidebar navigation to the other pane when split", () => {
      render(<App />);
      fireEvent.click(screen.getByText("open-kind-dev"));
      fireEvent.keyDown(window, { key: "\\", metaKey: true }); // split, focus starboard
      // Focus the port pane and open Kiali there.
      fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true, altKey: true });
      fireEvent.click(screen.getByText("open-kiali"));
      expect(screen.getByTestId("spyglass").textContent).toBe("kiali:kind-dev:active");

      // With the Kiali pane focused, the sidebar Services selection must NOT
      // replace Kiali — it lands in the starboard pane instead.
      fireEvent.click(screen.getByText("nav-services"));
      // Kiali survives, still mounted in the port pane.
      expect(screen.getByTestId("spyglass").textContent).toContain("kiali:kind-dev");
      // Services opened in the OTHER pane.
      expect(
        screen.getAllByTestId("browser").some((n) => n.textContent?.includes("services")),
      ).toBe(true);
      // The starboard pane holds the services browser, the port still holds Kiali.
      const starboard = screen.getByTestId("pane-starboard");
      expect(starboard.querySelector('[data-testid="browser"]')).not.toBeNull();
      const port = screen.getByTestId("pane-port");
      expect(port.querySelector('[data-testid="spyglass"]')).not.toBeNull();
    });
  });
});
