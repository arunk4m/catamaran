import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const { listContextsMock } = vi.hoisted(() => ({ listContextsMock: vi.fn() }));
vi.mock("../lib/clusters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/clusters")>();
  return { ...actual, listContexts: listContextsMock };
});

import { ClusterHotbar } from "./ClusterHotbar";

beforeEach(() => listContextsMock.mockReset());

const theme = { name: "dusk" as const, mode: "dark" as const };

describe("ClusterHotbar", () => {
  it("renders an avatar per cluster and opens one on click", async () => {
    listContextsMock.mockResolvedValue({
      contexts: [
        { name: "kind-dev", cluster: "k", server: "s", isCurrent: true },
        { name: "prod", cluster: "p", server: "s", isCurrent: false },
      ],
    });
    const onOpenContext = vi.fn();
    render(
      <ClusterHotbar
        openContext="kind-dev"
        onOpenContext={onOpenContext}
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("kind-dev")).toBeDefined());
    // initials rendered
    expect(screen.getByText("KD")).toBeDefined();
    fireEvent.click(screen.getByLabelText("prod"));
    expect(onOpenContext).toHaveBeenCalledWith("prod");
  });

  it("toggles the theme", async () => {
    listContextsMock.mockResolvedValue({ contexts: [] });
    const onToggleTheme = vi.fn();
    render(
      <ClusterHotbar
        openContext={null}
        onOpenContext={() => {}}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenSettings={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Switch to light mode"));
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it("opens global settings from the gear button without a cluster context", async () => {
    listContextsMock.mockResolvedValue({ contexts: [] });
    const onOpenSettings = vi.fn();
    render(
      <ClusterHotbar
        openContext={null}
        onOpenContext={() => {}}
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByLabelText("Open settings"));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe("fleet indicators", () => {
  it("marks contexts that are open in the deck with an aboard dot", async () => {
    listContextsMock.mockResolvedValue({
      contexts: [
        { name: "kind-dev", cluster: "k", server: "s", isCurrent: true },
        { name: "prod", cluster: "p", server: "s", isCurrent: false },
      ],
    });
    render(
      <ClusterHotbar
        openContext="kind-dev"
        onOpenContext={() => {}}
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
        openContexts={["kind-dev"]}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("kind-dev")).toBeDefined());
    expect(screen.getByTestId("aboard-kind-dev")).toBeDefined();
    expect(screen.queryByTestId("aboard-prod")).toBeNull();
  });

  it("labels each context under its avatar", async () => {
    listContextsMock.mockResolvedValue({
      contexts: [{ name: "production-eu", cluster: "p", server: "s", isCurrent: false }],
    });
    render(
      <ClusterHotbar
        openContext={null}
        onOpenContext={() => {}}
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("production-eu")).toBeDefined());
  });
});

describe("ClusterHotbar spyglass launchers", () => {
  it("opens tools from the observability menu", async () => {
    listContextsMock.mockResolvedValue({ contexts: [] });
    const onOpenSpyglass = vi.fn();
    render(
      <ClusterHotbar
        openContext={null}
        onOpenContext={() => {}}
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
        onOpenSpyglass={onOpenSpyglass}
      />,
    );
    // The launcher is a single popover; open it, then pick tools.
    fireEvent.click(screen.getByLabelText("Open an observability tool"));
    fireEvent.click(await screen.findByText("Kiali"));
    expect(onOpenSpyglass).toHaveBeenCalledWith("kiali");

    fireEvent.click(screen.getByLabelText("Open an observability tool"));
    fireEvent.click(await screen.findByText("Temporal"));
    expect(onOpenSpyglass).toHaveBeenCalledWith("temporal");

    fireEvent.click(screen.getByLabelText("Open an observability tool"));
    fireEvent.click(await screen.findByText("Tusk Lens"));
    expect(onOpenSpyglass).toHaveBeenCalledWith("tusklens");
  });

  it("hides the launcher when no handler is wired", async () => {
    listContextsMock.mockResolvedValue({ contexts: [] });
    render(
      <ClusterHotbar
        openContext={null}
        onOpenContext={() => {}}
        theme={theme}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Open an observability tool")).toBeNull();
  });
});
