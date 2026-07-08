import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      // Enforced floor (vitest 3 shape — the old top-level `lines` was
      // silently ignored by vitest 1, and vitest 3's more accurate v8
      // remapping measures ~4pp lower than v1 did). Ratchet toward 85:
      // issue #28. Never lower this.
      thresholds: {
        lines: 80,
      },
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/main.tsx",
        "src/test-setup.ts",
        // xterm DOM integration — verified live, not unit-testable in jsdom.
        "src/components/PodTerminal.tsx",
      ],
    },
  },
});
