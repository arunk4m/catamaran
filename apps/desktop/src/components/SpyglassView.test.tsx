import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";

const { prepareMock, notifyMock, openUrlMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  openUrlMock: vi.fn(),
}));
vi.mock("../lib/spyglass", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/spyglass")>();
  return { ...actual, prepareEmbed: prepareMock };
});
vi.mock("../lib/notify", () => ({ notify: notifyMock }));
vi.mock("../lib/aws", () => ({ openExternalUrl: openUrlMock }));

import { SpyglassView } from "./SpyglassView";

const EMBED = {
  kind: "embed" as const,
  base: "http://127.0.0.1:51000",
  initialPath: "/kiali/console/graph/namespaces/?animation=true",
  defaultPath: "/kiali/console/graph/namespaces/?animation=true",
  target: { namespace: "istio-system", service: "kiali", port: 20001 },
  meshNamespaces: ["aiapp", "default"],
};

beforeEach(() => {
  prepareMock.mockReset();
  notifyMock.success.mockReset();
  openUrlMock.mockReset();
});

function postSpyglassLocation(href: string, origin = "http://127.0.0.1:51000") {
  act(() => {
    fireEvent(
      window,
      new MessageEvent("message", { data: { catamaranSpyglass: { href } }, origin }),
    );
  });
}

describe("SpyglassView", () => {
  it("prepares the embed and renders the iframe on the initial path", async () => {
    prepareMock.mockResolvedValue({ prep: EMBED });
    render(<SpyglassView tool="kiali" context="tusk-dev" source={{ mode: "auto" }} />);
    expect(screen.getByText(/Hoisting the spyglass/)).toBeDefined();

    const frame = await screen.findByTitle("Kiali — tusk-dev");
    expect(frame.getAttribute("src")).toBe(`${EMBED.base}${EMBED.initialPath}`);
    expect(screen.getByText("mesh: aiapp, default")).toBeDefined();
  });

  it("shows the error state and retries", async () => {
    prepareMock.mockResolvedValueOnce({ error: "No Kiali service found in kind-local." });
    prepareMock.mockResolvedValueOnce({ prep: EMBED });
    render(<SpyglassView tool="kiali" context="kind-local" source={{ mode: "auto" }} />);

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("No Kiali service found in kind-local.")).toBeDefined();
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByTitle("Kiali — kind-local");
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  it("explains external URLs and opens them in the browser", async () => {
    prepareMock.mockResolvedValue({ prep: { kind: "external", url: "https://grafana.example" } });
    render(
      <SpyglassView tool="grafana" context="tusk-dev" source={{ mode: "url", url: "https://grafana.example" }} />,
    );
    expect(await screen.findByText(/can't be\s+embedded/)).toBeDefined();
    // Toolbar and notice card both offer the browser hand-off.
    fireEvent.click(screen.getAllByText("Open in browser")[0]);
    expect(openUrlMock).toHaveBeenCalledWith("https://grafana.example");
  });

  it("saves the view the embedded page last reported", async () => {
    prepareMock.mockResolvedValue({ prep: EMBED });
    const onSaveView = vi.fn();
    render(
      <SpyglassView tool="kiali" context="tusk-dev" source={{ mode: "auto" }} onSaveView={onSaveView} />,
    );
    await screen.findByTitle("Kiali — tusk-dev");

    // The relay-injected reporter posts a route change from inside the tool…
    postSpyglassLocation("/kiali/console/graph/namespaces/?namespaces=aiapp&layout=dagre");
    fireEvent.click(screen.getByText("Save view"));
    expect(onSaveView).toHaveBeenCalledWith("/kiali/console/graph/namespaces/?namespaces=aiapp&layout=dagre");
    expect(notifyMock.success).toHaveBeenCalled();
  });

  it("ignores reported locations from foreign origins", async () => {
    prepareMock.mockResolvedValue({ prep: EMBED });
    const onSaveView = vi.fn();
    render(
      <SpyglassView tool="kiali" context="tusk-dev" source={{ mode: "auto" }} onSaveView={onSaveView} />,
    );
    await screen.findByTitle("Kiali — tusk-dev");

    postSpyglassLocation("/evil", "https://attacker.example");
    fireEvent.click(screen.getByText("Save view"));
    // Falls back to the path the iframe actually opened on.
    expect(onSaveView).toHaveBeenCalledWith(EMBED.initialPath);
  });

  it("reset view clears the saved path and returns to the default", async () => {
    const saved = "/kiali/console/graph/namespaces/?namespaces=aiapp";
    prepareMock.mockResolvedValue({
      prep: { ...EMBED, initialPath: saved },
    });
    const onSaveView = vi.fn();
    render(
      <SpyglassView
        tool="kiali"
        context="tusk-dev"
        source={{ mode: "auto", savedPath: saved }}
        onSaveView={onSaveView}
      />,
    );
    const frame = await screen.findByTitle("Kiali — tusk-dev");
    expect(frame.getAttribute("src")).toBe(`${EMBED.base}${saved}`);

    fireEvent.click(screen.getByText("Reset view"));
    expect(onSaveView).toHaveBeenCalledWith(null);
    await waitFor(() =>
      expect(screen.getByTitle("Kiali — tusk-dev").getAttribute("src")).toBe(
        `${EMBED.base}${EMBED.defaultPath}`,
      ),
    );
  });

  it("reload re-prepares (reviving a dead tunnel)", async () => {
    prepareMock.mockResolvedValue({ prep: EMBED });
    render(<SpyglassView tool="grafana" context="tusk-dev" source={{ mode: "auto" }} />);
    await screen.findByTitle("Grafana — tusk-dev");
    fireEvent.click(screen.getByText("Reload"));
    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(2));
  });
});
