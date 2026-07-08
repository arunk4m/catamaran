import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextAvatar } from "./ContextAvatar";

describe("ContextAvatar", () => {
  it("shows a short-name badge together with a selected logo", () => {
    const { container } = render(
      <ContextAvatar context="production-eu" profile={{ logo: "shield", shortName: "EU" }} />,
    );
    expect(screen.getByText("EU")).toBeDefined();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("does not duplicate the short name for an initials logo", () => {
    render(<ContextAvatar context="production-eu" profile={{ logo: "initials", shortName: "EU" }} />);
    expect(screen.getAllByText("EU")).toHaveLength(1);
  });
});
