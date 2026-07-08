import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { NamespaceMultiSelect } from "./NamespaceMultiSelect";

const namespaces = ["default", "kube-system", "prod"];

describe("NamespaceMultiSelect", () => {
  it("summarizes an empty selection as 'All namespaces'", () => {
    render(<NamespaceMultiSelect namespaces={namespaces} selection={[]} onChange={() => {}} ariaLabel="Namespaces" />);
    expect(screen.getByRole("combobox", { name: "Namespaces" }).textContent).toContain("All namespaces");
  });

  it("summarizes a single selection by name and many by count", () => {
    const { rerender } = render(
      <NamespaceMultiSelect namespaces={namespaces} selection={["prod"]} onChange={() => {}} ariaLabel="Namespaces" />,
    );
    expect(screen.getByRole("combobox", { name: "Namespaces" }).textContent).toContain("prod");
    rerender(
      <NamespaceMultiSelect namespaces={namespaces} selection={["prod", "default"]} onChange={() => {}} ariaLabel="Namespaces" />,
    );
    expect(screen.getByRole("combobox", { name: "Namespaces" }).textContent).toContain("2 namespaces");
  });

  it("adds a namespace to the selection when toggled on", async () => {
    const onChange = vi.fn();
    render(<NamespaceMultiSelect namespaces={namespaces} selection={[]} onChange={onChange} ariaLabel="Namespaces" />);
    fireEvent.click(screen.getByRole("combobox", { name: "Namespaces" }));
    fireEvent.click(await screen.findByText("default"));
    expect(onChange).toHaveBeenCalledWith(["default"]);
  });

  it("removes a namespace when toggled off", async () => {
    const onChange = vi.fn();
    render(<NamespaceMultiSelect namespaces={namespaces} selection={["default", "prod"]} onChange={onChange} ariaLabel="Namespaces" />);
    fireEvent.click(screen.getByRole("combobox", { name: "Namespaces" }));
    fireEvent.click(await screen.findByText("default"));
    expect(onChange).toHaveBeenCalledWith(["prod"]);
  });

  it("clears to all namespaces via the 'All namespaces' option", async () => {
    const onChange = vi.fn();
    render(<NamespaceMultiSelect namespaces={namespaces} selection={["default"]} onChange={onChange} ariaLabel="Namespaces" />);
    fireEvent.click(screen.getByRole("combobox", { name: "Namespaces" }));
    fireEvent.click(await screen.findByText("All namespaces"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
