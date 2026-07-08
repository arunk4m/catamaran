import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { TextInput } from "./TextInput";

describe("TextInput", () => {
  it("renders the value and emits value-first changes", () => {
    const onValueChange = vi.fn();
    render(<TextInput value="abc" onValueChange={onValueChange} />);
    const input = screen.getByDisplayValue("abc");
    fireEvent.change(input, { target: { value: "abcd" } });
    expect(onValueChange).toHaveBeenCalledWith("abcd");
  });

  it("calls onEnter when Enter is pressed", () => {
    const onEnter = vi.fn();
    render(<TextInput value="" onValueChange={() => {}} onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("does not throw on Enter without an onEnter handler", () => {
    render(<TextInput value="" onValueChange={() => {}} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // no assertion needed; absence of a thrown error is the contract
  });
});
