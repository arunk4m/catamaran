import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}}>
        body
      </Drawer>,
    );
    expect(screen.queryByText("body")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders title and body when open, and closes via the button", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Pod · web-1" onClose={onClose}>
        body content
      </Drawer>,
    );
    expect(screen.getByText("Pod · web-1")).toBeDefined();
    expect(screen.getByText("body content")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
