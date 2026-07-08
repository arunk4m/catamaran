import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { listResourceMock, listCrdsMock } = vi.hoisted(() => ({
  listResourceMock: vi.fn(),
  listCrdsMock: vi.fn(),
}));
vi.mock("../lib/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/manifest")>();
  return { ...actual, listResource: listResourceMock };
});
vi.mock("../lib/crds", () => ({ listCrds: listCrdsMock }));

import { CommandPalette } from "./CommandPalette";

const widgetCrd = {
  name: "widgets.example.com",
  group: "example.com",
  version: "v1",
  kind: "Widget",
  plural: "widgets",
  namespaced: true,
};

beforeEach(() => {
  localStorage.clear();
  listResourceMock.mockReset();
  listCrdsMock.mockReset();
  listResourceMock.mockImplementation((_c: string, kind: string) =>
    Promise.resolve({
      items: kind === "Pod" ? [{ name: "web-1", namespace: "default", age: "1m" }] : [],
    }),
  );
  listCrdsMock.mockResolvedValue({ crds: [widgetCrd] });
});

function setup() {
  const onOpenView = vi.fn();
  const onOpenResource = vi.fn();
  const onOpenCrd = vi.fn();
  const r = render(
    <CommandPalette
      open
      onOpenChange={vi.fn()}
      context="kind-dev"
      onOpenView={onOpenView}
      onOpenResource={onOpenResource}
      onOpenCrd={onOpenCrd}
    />,
  );
  return { ...r, onOpenView, onOpenResource, onOpenCrd };
}

describe("CommandPalette", () => {
  it("opens a view and records it in Recent", async () => {
    const { onOpenView, unmount } = setup();
    await userEvent.click(await screen.findByText("Pods"));
    expect(onOpenView).toHaveBeenCalledWith("pods");
    unmount();

    // Reopening shows the just-opened view under "Recent".
    setup();
    expect(await screen.findByText("Recent")).toBeDefined();
  });

  it("can navigate to the workload controller views", async () => {
    const { onOpenView } = setup();
    const search = screen.getByPlaceholderText(/Search resources/);
    for (const [label, kind] of [
      ["StatefulSets", "statefulsets"],
      ["DaemonSets", "daemonsets"],
      ["CronJobs", "cronjobs"],
    ] as const) {
      await userEvent.clear(search);
      await userEvent.type(search, label);
      await userEvent.click(await screen.findByText(label));
      expect(onOpenView).toHaveBeenCalledWith(kind);
    }
  });

  it("searches resources by name and deep-links to the selected one", async () => {
    const { onOpenResource } = setup();
    await waitFor(() => expect(listResourceMock).toHaveBeenCalled());
    await userEvent.type(screen.getByPlaceholderText(/Search resources/), "web");
    await userEvent.click(await screen.findByText("web-1"));
    expect(onOpenResource).toHaveBeenCalledWith("pods", "default", "web-1");
  });

  it("surfaces CRDs in Go to and opens them", async () => {
    const { onOpenCrd } = setup();
    await userEvent.type(screen.getByPlaceholderText(/Search resources/), "widget");
    await userEvent.click(await screen.findByText("Widget (CRD)"));
    expect(onOpenCrd).toHaveBeenCalledWith(widgetCrd);
  });
});
