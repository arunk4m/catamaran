import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its content by default", () => {
    render(<Badge>Pending</Badge>);
    expect(screen.getByText("Pending")).toBeDefined();
  });

  it("renders content for any variant", () => {
    const { rerender } = render(<Badge variant="success">Running</Badge>);
    expect(screen.getByText("Running")).toBeDefined();
    rerender(<Badge variant="danger">Failed</Badge>);
    expect(screen.getByText("Failed")).toBeDefined();
  });
});
