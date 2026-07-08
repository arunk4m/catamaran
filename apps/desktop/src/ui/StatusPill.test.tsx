import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders the status label with a coloured dot", () => {
    const { container } = render(<StatusPill status="Running" kind="success" />);
    expect(screen.getByText("Running")).toBeDefined();
    expect(container.querySelector(".bg-emerald-500")).not.toBeNull();
  });

  it("defaults to a neutral dot", () => {
    const { container } = render(<StatusPill status="Unknown" />);
    expect(screen.getByText("Unknown")).toBeDefined();
    expect(container.querySelector(".bg-muted-foreground")).not.toBeNull();
  });
});
