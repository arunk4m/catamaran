import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("shows the default caption and an accessible spinner", () => {
    render(<LoadingState />);
    expect(screen.getByText("Loading")).toBeDefined();
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading");
  });

  it("captions the load with a custom label", () => {
    render(<LoadingState label="Loading pods" />);
    expect(screen.getByText("Loading pods")).toBeDefined();
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Loading pods");
  });
});
