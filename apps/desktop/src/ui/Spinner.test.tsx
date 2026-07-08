import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("exposes an accessible status role with a default label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading");
  });

  it("uses a custom label when provided", () => {
    render(<Spinner label="Fetching pods" />);
    expect(screen.getByLabelText("Fetching pods")).toBeDefined();
  });

  it("renders an animated svg ring with a muted track circle", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("animate-spin")).toBe(true);
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("forwards extra classes onto the svg", () => {
    const { container } = render(<Spinner className="size-8 text-primary" />);
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("size-8")).toBe(true);
    expect(svg?.classList.contains("text-primary")).toBe(true);
  });
});
