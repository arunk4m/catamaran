import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { CuratedCrdGroup } from "./CuratedCrdGroup";

const crds = [
  { name: "scaledobjects.keda.sh", group: "keda.sh", version: "v1alpha1", kind: "ScaledObject", plural: "scaledobjects", namespaced: true },
  { name: "scaledjobs.keda.sh", group: "keda.sh", version: "v1alpha1", kind: "ScaledJob", plural: "scaledjobs", namespaced: true },
  { name: "nodepools.karpenter.sh", group: "karpenter.sh", version: "v1", kind: "NodePool", plural: "nodepools", namespaced: false },
  { name: "ec2nodeclasses.karpenter.k8s.aws", group: "karpenter.k8s.aws", version: "v1", kind: "EC2NodeClass", plural: "ec2nodeclasses", namespaced: false },
  { name: "widgets.example.com", group: "example.com", version: "v1", kind: "Widget", plural: "widgets", namespaced: true },
];

const trigger = (heading: string) => (open: boolean, onToggle: () => void) => (
  <button onClick={onToggle}>{heading} {open ? "▾" : "▸"}</button>
);

describe("CuratedCrdGroup", () => {
  it("lists only KEDA CRDs and opens one", async () => {
    const listCrdsFn = vi.fn().mockResolvedValue({ crds });
    const onSelectCrd = vi.fn();
    render(
      <CuratedCrdGroup
        cluster="tusk-dev"
        groups={["keda.sh"]}
        open={false}
        onSelectCrd={onSelectCrd}
        renderTrigger={trigger("KEDA")}
        listCrdsFn={listCrdsFn}
      />,
    );
    fireEvent.click(screen.getByText(/KEDA/));
    // Sorted by kind: ScaledJob before ScaledObject.
    expect(await screen.findByText("ScaledJob")).toBeDefined();
    expect(screen.getByText("ScaledObject")).toBeDefined();
    // Non-KEDA CRDs are excluded.
    expect(screen.queryByText("Widget")).toBeNull();
    expect(screen.queryByText("NodePool")).toBeNull();

    fireEvent.click(screen.getByText("ScaledObject"));
    expect(onSelectCrd).toHaveBeenCalledWith(expect.objectContaining({ kind: "ScaledObject" }));
  });

  it("matches Karpenter's two API groups", async () => {
    const listCrdsFn = vi.fn().mockResolvedValue({ crds });
    render(
      <CuratedCrdGroup
        cluster="tusk-dev"
        groups={["karpenter.sh", "karpenter.k8s.aws"]}
        open={false}
        onSelectCrd={() => {}}
        renderTrigger={trigger("Karpenter")}
        listCrdsFn={listCrdsFn}
      />,
    );
    fireEvent.click(screen.getByText(/Karpenter/));
    expect(await screen.findByText("EC2NodeClass")).toBeDefined();
    expect(screen.getByText("NodePool")).toBeDefined();
    expect(screen.queryByText("ScaledObject")).toBeNull();
  });

  it("says 'Not installed' when the operator's CRDs are absent", async () => {
    const listCrdsFn = vi.fn().mockResolvedValue({ crds: [crds[4]] }); // only Widget
    render(
      <CuratedCrdGroup
        cluster="kind-local"
        groups={["keda.sh"]}
        open={false}
        onSelectCrd={() => {}}
        renderTrigger={trigger("KEDA")}
        listCrdsFn={listCrdsFn}
      />,
    );
    fireEvent.click(screen.getByText(/KEDA/));
    expect(await screen.findByText("Not installed")).toBeDefined();
  });
});
