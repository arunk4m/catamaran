import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Select } from "./Select";

const options = [{ value: "default" }, { value: "kube-system", label: "kube-system" }];

describe("Select", () => {
  it("shows the selected value", () => {
    render(<Select value="kube-system" onValueChange={() => {}} options={options} aria-label="Namespace" />);
    expect(screen.getByRole("combobox", { name: "Namespace" }).textContent).toContain("kube-system");
  });

  it("emits value-first changes when an option is picked", async () => {
    const onValueChange = vi.fn();
    render(<Select value="default" onValueChange={onValueChange} options={options} aria-label="Namespace" />);
    await userEvent.click(screen.getByRole("combobox", { name: "Namespace" }));
    await userEvent.click(await screen.findByRole("option", { name: "kube-system" }));
    expect(onValueChange).toHaveBeenCalledWith("kube-system");
  });

  it("maps an empty-string value to a sentinel without crashing", () => {
    render(
      <Select
        value=""
        onValueChange={() => {}}
        options={[{ value: "", label: "All namespaces" }, { value: "default" }]}
        aria-label="Namespace"
      />,
    );
    expect(screen.getByRole("combobox", { name: "Namespace" }).textContent).toContain(
      "All namespaces",
    );
  });
});
