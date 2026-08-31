import { style, globalStyle } from "@vanilla-extract/css";
import { tokens, tints } from "./tokens.css";

// Faithful port of .page-strip from frontend/src/styles/extensions.css
// (lines 327-339): chamfered polygon, drop-shadow-as-border, oklab color-mix.
export const pageStrip = style({
  vars: { "--_tone": "transparent" },
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: "16px",
  alignItems: "center",
  minHeight: "40px",
  padding: "0 clamp(16px, 4vw, 32px)",
  margin: "0 0 20px",
  background: "linear-gradient(90deg, var(--_tone) 0 3px, var(--bg) 3px)",
  clipPath:
    "polygon(var(--notch) 0, 100% 0, 100% calc(100% - var(--notch)), calc(100% - var(--notch)) 100%, 0 100%, 0 var(--notch))",
  filter:
    "drop-shadow(1px 0 0 var(--hairline)) drop-shadow(-1px 0 0 var(--hairline)) drop-shadow(0 1px 0 var(--hairline)) drop-shadow(0 -1px 0 var(--hairline))",
  transition: "background .3s var(--ease)",
});

globalStyle(`${pageStrip}.is-action`, { vars: { "--_tone": tokens.signal } });
globalStyle(`${pageStrip}.is-reward`, { vars: { "--_tone": tokens.battle } });
globalStyle(`${pageStrip}.is-warn`, { vars: { "--_tone": tokens.battle } });

// Prove oklab color-mix round-trips through the extractor.
export const resBadge = style({
  color: tints.meat,
  background: "color-mix(in oklab, var(--signal) 10%, transparent)",
  clipPath: "polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)",
});
