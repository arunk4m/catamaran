/**
 * Design tokens — the single source of truth for the visual language.
 *
 * Values are mirrored as CSS custom properties in `styles.css` (Dusk palette).
 * Use the CSS vars (`var(--cat-color-accent)`) in component styles; use this
 * object when you need a token value in TypeScript (e.g. computed inline
 * styles, charts).
 */
export const tokens = {
  color: {
    bg: "#0f1226",
    surface: "#171b36",
    surfaceAlt: "#232a52",
    border: "#333c6b",
    text: "#dbe1f8",
    textMuted: "#8f98c2",
    accent: "#7d8cf8",
    accentHover: "#98a5ff",
    brand: "#ff7a66",
    danger: "#f87171",
    success: "#34d399",
    warning: "#fbbf24",
  },
  space: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px", xxl: "32px" },
  radius: { sm: "4px", md: "7px", lg: "12px", pill: "999px" },
  font: {
    family: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    mono: "'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace",
    size: { xs: "12px", sm: "13px", md: "14px", lg: "18px", xl: "24px" },
  },
  shadow: { md: "0 2px 8px rgba(0,0,0,0.3)" },
} as const;

export type Tokens = typeof tokens;
