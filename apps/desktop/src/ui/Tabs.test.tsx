import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Tabs } from "./Tabs";

const tabs = [
  { id: "pods", label: "Pods" },
  { id: "services", label: "Services" },
];

describe("Tabs", () => {
  it("marks the active tab", () => {
    render(<Tabs tabs={tabs} active="services" onChange={() => {}} />);
    const active = screen.getByRole("tab", { name: "Services" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Pods" }).getAttribute("aria-selected")).toBe("false");
  });

  it("emits the tab id on click", async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="pods" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Services" }));
    expect(onChange).toHaveBeenCalledWith("services");
  });
});
