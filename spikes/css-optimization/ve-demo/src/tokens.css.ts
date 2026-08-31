import { createGlobalTheme } from "@vanilla-extract/css";

// Design tokens mirrored from frontend/src/styles/tokens.css.
// Exposes the SAME custom-property names (--bg, --signal, --notch, …) so
// existing vanilla CSS that reads var(--signal) keeps working after migration.
export const tokens = createGlobalTheme(":root", {
  bg: "#0a0a0c",
  panel: "#141418",
  ink: "#f4f1ea",
  muted: "#8a877f",
  hair: "#2a2a30",
  signal: "#e6001f",
  battle: "#e6001f",
  notch: "10px",
  ease: "cubic-bezier(0.2, 0, 0, 1)",
});

// oklab color-mix tints (vanilla-extract is just a template string pass-through,
// so color-mix()/oklab survive verbatim).
export const tints = {
  meat: "color-mix(in oklab, #e6001f 62%, #f4f1ea)",
};
