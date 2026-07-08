import { describe, it, expect, beforeEach } from "vitest";
import { getInitialTheme, applyTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("defaults to the Dusk dark theme", () => {
    expect(getInitialTheme()).toEqual({ name: "dusk", mode: "dark" });
  });

  it("applies and persists a named light theme, and reads it back", () => {
    applyTheme({ name: "ember", mode: "light" });
    expect(document.documentElement.dataset.theme).toBe("ember");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(getInitialTheme()).toEqual({ name: "ember", mode: "light" });
  });

  it("marks dark with both data attributes and the shadcn `dark` class", () => {
    applyTheme({ name: "mono", mode: "light" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyTheme({ name: "mono", mode: "dark" });
    expect(document.documentElement.dataset.theme).toBe("mono");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(getInitialTheme()).toEqual({ name: "mono", mode: "dark" });
  });

  it("normalizes unknown palette names into the default palette", () => {
    localStorage.setItem("catamaran.theme", JSON.stringify({ name: "supabase", mode: "dark" }));
    expect(getInitialTheme()).toEqual({ name: "dusk", mode: "dark" });
  });

  it("normalizes an unknown mode into the default mode", () => {
    localStorage.setItem("catamaran.theme", JSON.stringify({ name: "ember", mode: "sepia" }));
    expect(getInitialTheme()).toEqual({ name: "ember", mode: "dark" });
  });

  it("falls back to the default when stored data is corrupt", () => {
    localStorage.setItem("catamaran.theme", "{not json");
    expect(getInitialTheme()).toEqual({ name: "dusk", mode: "dark" });
  });
});
