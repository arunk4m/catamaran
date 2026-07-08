import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("renders the title and children", () => {
    render(<Panel title="Cluster">body content</Panel>);
    expect(screen.getByText("Cluster")).toBeDefined();
    expect(screen.getByText("body content")).toBeDefined();
  });

  it("omits the title when none is given", () => {
    render(<Panel>only body</Panel>);
    expect(screen.queryByText("Cluster")).toBeNull();
    expect(screen.getByText("only body")).toBeDefined();
  });
});
