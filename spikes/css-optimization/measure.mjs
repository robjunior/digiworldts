// measures raw + gzip + brotli sizes of a CSS file, and runs a
// syntax-preservation check so an optimizer can't silently drop modern CSS.
// Usage: node measure.mjs <file.css> <label>
import { readFileSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants as zc } from "node:zlib";

const [file, label = file] = process.argv.slice(2);
const css = readFileSync(file, "utf8");

const raw = Buffer.byteLength(css);
const gzip = gzipSync(css, { level: 9 }).length;
const br = brotliCompressSync(css, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length;

// token-preservation probes: modern CSS features that MUST survive minification
const probes = ["color-mix", "oklab", "clip-path", "drop-shadow", "var(--"];
const counts = {};
for (const p of probes) counts[p] = (css.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

// crude selector + declaration counts (presence, not correctness)
const selectors = (css.match(/[^{}]+\{/g) || []).length;
const declarations = (css.match(/:[^;{}]+;/g) || []).length;

console.log(
  JSON.stringify({
    label,
    file: file.split("/").pop(),
    raw_kb: +(raw / 1024).toFixed(2),
    gzip_kb: +(gzip / 1024).toFixed(2),
    brotli_kb: +(br / 1024).toFixed(2),
    selectors,
    declarations,
    probes,
    ...counts,
  })
);
