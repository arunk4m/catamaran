import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders an svg with an area path for the series", () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} ariaLabel="CPU" />);
    const svg = container.querySelector("svg.cat-sparkline");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("CPU");
    // a line path + an area path (the area closes with Z)
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(2);
    expect(paths[0].getAttribute("d")).toContain("Z");
  });

  it("draws a flat line for a single sample", () => {
    const { container } = render(<Sparkline values={[4]} />);
    const line = container.querySelectorAll("path")[1];
    // two points at the same y → a horizontal line spanning the width
    expect(line.getAttribute("d")).toMatch(/^M0,.* L600,/);
  });
});
