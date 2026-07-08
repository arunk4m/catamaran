import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { CodeEditor } from "./CodeEditor";

describe("CodeEditor", () => {
  it("mounts a CodeMirror editor showing the initial value", () => {
    const { container } = render(<CodeEditor value="kind: Pod" ariaLabel="Manifest YAML" />);
    const cm = container.querySelector(".cm-editor");
    expect(cm).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("kind: Pod");
    // aria-label is applied to the editable content for screen readers.
    expect(container.querySelector('[aria-label="Manifest YAML"]')).not.toBeNull();
  });

  it("does not call onChange while editable is disabled (read-only)", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor value="a: 1" readOnly onChange={onChange} />);
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
