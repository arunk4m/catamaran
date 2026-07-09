import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { listCustomResourceMock, listNamespacesMock } = vi.hoisted(() => ({
  listCustomResourceMock: vi.fn(),
  listNamespacesMock: vi.fn(),
}));
vi.mock("../lib/crds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/crds")>();
  return { ...actual, listCustomResource: listCustomResourceMock };
});
vi.mock("../lib/workloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workloads")>();
  return { ...actual, listNamespaces: listNamespacesMock };
});

import { CustomResourceBrowser } from "./CustomResourceBrowser";

const crd = {
  name: "widgets.example.com",
  group: "example.com",
  version: "v1",
  kind: "Widget",
  plural: "widgets",
  namespaced: true,
};

beforeEach(() => {
  listCustomResourceMock.mockReset();
  listNamespacesMock.mockReset();
  listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
});

describe("CustomResourceBrowser", () => {
  it("lists custom resource instances", async () => {
    listCustomResourceMock.mockResolvedValue({
      items: [{ name: "demo-widget", namespace: "default", age: "1m" }],
    });
    render(<CustomResourceBrowser context="kind-dev" crd={crd} />);
    await waitFor(() => expect(screen.getByText("demo-widget")).toBeDefined());
    expect(listCustomResourceMock).toHaveBeenCalledWith("kind-dev", crd, "");
    // the kind name heads the first column
    expect(screen.getByText("Widget")).toBeDefined();
  });

  it("shows an error when listing fails", async () => {
    listCustomResourceMock.mockResolvedValue({ error: "the server could not find the requested resource" });
    render(<CustomResourceBrowser context="kind-dev" crd={crd} />);
    await waitFor(() => expect(screen.getByText(/could not find/)).toBeDefined());
  });
});

describe("CRD column visibility", () => {
  it("hides a column via the picker and persists it per CRD", async () => {
    localStorage.clear();
    listCustomResourceMock.mockResolvedValue({
      items: [{ name: "demo-widget", namespace: "default", age: "1m" }],
    });
    const user = userEvent.setup();
    const view = render(<CustomResourceBrowser context="kind-dev" crd={crd} />);
    await waitFor(() => expect(screen.getByText("demo-widget")).toBeDefined());
    expect(screen.getByRole("columnheader", { name: /Age/ })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    await user.click(await screen.findByLabelText("Age"));

    await waitFor(() => expect(screen.queryByRole("columnheader", { name: /Age/ })).toBeNull());
    expect(JSON.parse(localStorage.getItem("catamaran.hiddenColumns")!)).toEqual({
      "crd:widgets.example.com": ["age"],
    });

    // Remounting the CRD view keeps the column hidden.
    view.unmount();
    render(<CustomResourceBrowser context="kind-dev" crd={crd} />);
    await waitFor(() => expect(screen.getByText("demo-widget")).toBeDefined());
    expect(screen.queryByRole("columnheader", { name: /Age/ })).toBeNull();
  });

  it("pins the identifying column so it can't be hidden", async () => {
    localStorage.clear();
    listCustomResourceMock.mockResolvedValue({
      items: [{ name: "demo-widget", namespace: "default", age: "1m" }],
    });
    const user = userEvent.setup();
    render(<CustomResourceBrowser context="kind-dev" crd={crd} />);
    await waitFor(() => expect(screen.getByText("demo-widget")).toBeDefined());

    await user.click(screen.getByRole("button", { name: "Choose columns" }));
    const nameToggle = await screen.findByLabelText("Widget");
    expect(nameToggle).toHaveProperty("disabled", true);
  });
});
