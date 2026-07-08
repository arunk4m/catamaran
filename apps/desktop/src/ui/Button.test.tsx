import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders each variant as a button", () => {
    const { rerender } = render(<Button>X</Button>);
    expect(screen.getByRole("button", { name: "X" })).toBeDefined();
    rerender(<Button variant="ghost">X</Button>);
    expect(screen.getByRole("button", { name: "X" })).toBeDefined();
    rerender(<Button variant="danger">X</Button>);
    expect(screen.getByRole("button", { name: "X" })).toBeDefined();
  });

  it("does not fire onClick when disabled and forwards className", () => {
    const onClick = vi.fn();
    render(
      <Button disabled className="extra" onClick={onClick}>
        X
      </Button>,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(btn.className).toContain("extra");
  });
});
