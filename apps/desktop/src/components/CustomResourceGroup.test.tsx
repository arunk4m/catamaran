import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { CustomResourceGroup } from "./CustomResourceGroup";

const crds = [
  {
    name: "widgets.example.com",
    group: "example.com",
    version: "v1",
    kind: "Widget",
    plural: "widgets",
    namespaced: true,
  },
  {
    name: "gateways.gateway.networking.k8s.io",
    group: "gateway.networking.k8s.io",
    version: "v1",
    kind: "Gateway",
    plural: "gateways",
    namespaced: true,
  },
];

const trigger = (open: boolean, onToggle: () => void) => (
  <button onClick={onToggle}>Custom Resources {open ? "▾" : "▸"}</button>
);

describe("CustomResourceGroup", () => {
  it("lazily loads CRDs grouped by API group and selects a kind", async () => {
    const listCrdsFn = vi.fn().mockResolvedValue({ crds });
    const onSelectCrd = vi.fn();
    render(
      <CustomResourceGroup
        cluster="kind-dev"
        open
        onSelectCrd={onSelectCrd}
        renderTrigger={trigger}
        listCrdsFn={listCrdsFn}
      />,
    );
    // API groups appear, sorted; kinds are hidden until the group is expanded.
    await waitFor(() => expect(screen.getByText("example.com")).toBeDefined());
    expect(screen.queryByText("Widget")).toBeNull();
    fireEvent.click(screen.getByText("example.com"));
    fireEvent.click(screen.getByText("Widget"));
    expect(onSelectCrd).toHaveBeenCalledWith(expect.objectContaining({ kind: "Widget" }));
    expect(listCrdsFn).toHaveBeenCalledWith("kind-dev");
  });

  it("does not load until opened", () => {
    const listCrdsFn = vi.fn().mockResolvedValue({ crds });
    render(
      <CustomResourceGroup
        cluster="kind-dev"
        open={false}
        onSelectCrd={() => {}}
        renderTrigger={trigger}
        listCrdsFn={listCrdsFn}
      />,
    );
    expect(listCrdsFn).not.toHaveBeenCalled();
  });
});
