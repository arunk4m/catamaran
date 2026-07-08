import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { NodeCordonAction } from "./NodeCordonAction";

describe("NodeCordonAction", () => {
  it("offers Cordon for a schedulable node and applies it", async () => {
    const getObjectFn = vi.fn().mockResolvedValue({ object: { spec: {} } });
    const cordonFn = vi.fn().mockResolvedValue({ ok: true });
    render(<NodeCordonAction context="kind-dev" name="node-a" getObjectFn={getObjectFn} cordonFn={cordonFn} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Cordon" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Cordon" }));
    // confirm dialog → the dialog's Cordon button is the only reachable one
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cordon" }));
    await waitFor(() => expect(cordonFn).toHaveBeenCalledWith("kind-dev", "node-a", true));
    // label flips to Uncordon
    await waitFor(() => expect(screen.getByRole("button", { name: "Uncordon" })).toBeDefined());
  });

  it("offers Uncordon for a cordoned node", async () => {
    const getObjectFn = vi.fn().mockResolvedValue({ object: { spec: { unschedulable: true } } });
    const cordonFn = vi.fn().mockResolvedValue({ ok: true });
    render(<NodeCordonAction context="kind-dev" name="node-a" getObjectFn={getObjectFn} cordonFn={cordonFn} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Uncordon" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Uncordon" }));
    fireEvent.click(screen.getByRole("button", { name: "Uncordon" }));
    await waitFor(() => expect(cordonFn).toHaveBeenCalledWith("kind-dev", "node-a", false));
  });

  it("drains a node behind a confirm", async () => {
    const getObjectFn = vi.fn().mockResolvedValue({ object: { spec: {} } });
    const drainFn = vi.fn().mockResolvedValue({ evicted: 3, skipped: 1 });
    render(<NodeCordonAction context="kind-dev" name="node-a" getObjectFn={getObjectFn} drainFn={drainFn} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Drain" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Drain" }));
    // dialog open → the dialog's Drain button is the only reachable one
    fireEvent.click(screen.getByRole("button", { name: "Drain" }));
    await waitFor(() => expect(drainFn).toHaveBeenCalledWith("kind-dev", "node-a"));
  });
});
