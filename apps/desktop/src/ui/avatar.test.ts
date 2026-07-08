import { describe, it, expect } from "vitest";
import { avatarColor, avatarInitials } from "./avatar";

describe("avatarColor", () => {
  it("is deterministic and returns a hex colour", () => {
    expect(avatarColor("kind-dev")).toBe(avatarColor("kind-dev"));
    expect(avatarColor("kind-dev")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("avatarInitials", () => {
  it("derives up to two initials, splitting on separators", () => {
    expect(avatarInitials("prod")).toBe("PR");
    expect(avatarInitials("kind-dev")).toBe("KD");
    expect(avatarInitials("my_staging_cluster")).toBe("MS");
    expect(avatarInitials("")).toBe("?");
  });
});
