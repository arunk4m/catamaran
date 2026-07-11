import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";

const { prepareMock, notifyMock, openUrlMock, ssoProfilesMock, ssoLoginMock, profileForContextMock } =
  vi.hoisted(() => ({
    prepareMock: vi.fn(),
    notifyMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    openUrlMock: vi.fn(),
    ssoProfilesMock: vi.fn(),
    ssoLoginMock: vi.fn(),
    profileForContextMock: vi.fn(),
  }));
vi.mock("../lib/spyglass", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/spyglass")>();
  return { ...actual, prepareEmbed: prepareMock };
});
vi.mock("../lib/notify", () => ({ notify: notifyMock }));
vi.mock("../lib/aws", () => ({
  openExternalUrl: openUrlMock,
  ssoProfiles: ssoProfilesMock,
  ssoLogin: ssoLoginMock,
  profileForContext: profileForContextMock,
}));

import { SpyglassView, looksLikeAuthError } from "./SpyglassView";
import { SPYGLASS_CATALOG } from "../lib/settings";

const KIALI_META = SPYGLASS_CATALOG.find((t) => t.id === "kiali")!;
const GRAFANA_META = SPYGLASS_CATALOG.find((t) => t.id === "grafana")!;

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
  ssoProfilesMock.mockReset();
  ssoLoginMock.mockReset();
  profileForContextMock.mockReset();
});

describe("looksLikeAuthError", () => {
  it("flags credential/token failures and not missing tools or outages", () => {
    expect(looksLikeAuthError("The server has asked for the client to provide credentials")).toBe(true);
    expect(looksLikeAuthError("building the cluster client timed out")).toBe(true);
    expect(looksLikeAuthError("Unauthorized (401)")).toBe(true);
    expect(looksLikeAuthError("your token or client certificate may have expired")).toBe(true);
    expect(looksLikeAuthError("No Grafana service found in kind-local.")).toBe(false);
    expect(looksLikeAuthError("service has no running pods")).toBe(false);
  });
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
    render(<SpyglassView meta={KIALI_META} context="tusk-dev" source={{ mode: "auto" }} />);
    expect(screen.getByText(/Hoisting the spyglass/)).toBeDefined();

    const frame = await screen.findByTitle("Kiali — tusk-dev");
    expect(frame.getAttribute("src")).toBe(`${EMBED.base}${EMBED.initialPath}`);
    expect(screen.getByText("mesh: aiapp, default")).toBeDefined();
  });

  it("shows the error state and retries", async () => {
    prepareMock.mockResolvedValueOnce({ error: "No Kiali service found in kind-local." });
    prepareMock.mockResolvedValueOnce({ prep: EMBED });
    render(<SpyglassView meta={KIALI_META} context="kind-local" source={{ mode: "auto" }} />);

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("No Kiali service found in kind-local.")).toBeDefined();
    // A non-auth error offers Retry but not the AWS-refresh action.
    expect(screen.queryByText("Refresh AWS access")).toBeNull();
    fireEvent.click(screen.getByText("Retry"));
    await screen.findByTitle("Kiali — kind-local");
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from expired credentials via Refresh AWS access", async () => {
    // First prepare fails with an auth-shaped error; after SSO login it works.
    prepareMock.mockResolvedValueOnce({
      error: "building the cluster client timed out: the server has asked for the client to provide credentials",
    });
    prepareMock.mockResolvedValueOnce({ prep: EMBED });
    ssoProfilesMock.mockResolvedValue({ profiles: [{ profile: "tusk-dev", contexts: ["tusk-dev"] }] });
    profileForContextMock.mockReturnValue("tusk-dev");
    ssoLoginMock.mockResolvedValue({ ok: true });

    render(<SpyglassView meta={GRAFANA_META} context="tusk-dev" source={{ mode: "auto" }} />);
    expect(await screen.findByRole("alert")).toBeDefined();
    // Auth errors surface the credential-refresh path.
    const refresh = await screen.findByText("Refresh AWS access");
    fireEvent.click(refresh);

    await waitFor(() => expect(ssoLoginMock).toHaveBeenCalledWith("tusk-dev"));
    await screen.findByTitle("Grafana — tusk-dev");
    expect(prepareMock).toHaveBeenCalledTimes(2);
    expect(notifyMock.success).toHaveBeenCalled();
  });

  it("explains external URLs and opens them in the browser", async () => {
    prepareMock.mockResolvedValue({ prep: { kind: "external", url: "https://grafana.example" } });
    render(
      <SpyglassView meta={GRAFANA_META} context="tusk-dev" source={{ mode: "url", url: "https://grafana.example" }} />,
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
      <SpyglassView meta={KIALI_META} context="tusk-dev" source={{ mode: "auto" }} onSaveView={onSaveView} />,
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
      <SpyglassView meta={KIALI_META} context="tusk-dev" source={{ mode: "auto" }} onSaveView={onSaveView} />,
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
        meta={KIALI_META}
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
    render(<SpyglassView meta={GRAFANA_META} context="tusk-dev" source={{ mode: "auto" }} />);
    await screen.findByTitle("Grafana — tusk-dev");
    fireEvent.click(screen.getByText("Reload"));
    await waitFor(() => expect(prepareMock).toHaveBeenCalledTimes(2));
  });

  it("steers focus away from the iframe when the tab is inactive (kept alive)", async () => {
    prepareMock.mockResolvedValue({ prep: EMBED });
    const { rerender } = render(
      <SpyglassView meta={KIALI_META} context="tusk-dev" source={{ mode: "auto" }} active={true} />,
    );
    const frame = await screen.findByTitle("Kiali — tusk-dev");
    expect(frame.getAttribute("aria-hidden")).toBeNull();
    expect(frame.getAttribute("tabindex")).toBeNull();

    // Made inactive by a tab switch: the iframe stays mounted but drops out of
    // the tab order and is hidden from assistive tech.
    rerender(<SpyglassView meta={KIALI_META} context="tusk-dev" source={{ mode: "auto" }} active={false} />);
    const same = screen.getByTitle("Kiali — tusk-dev");
    expect(same).toBe(frame); // not remounted
    expect(same.getAttribute("aria-hidden")).toBe("true");
    expect(same.getAttribute("tabindex")).toBe("-1");
    // prepare did not run again on the active toggle.
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });
});
