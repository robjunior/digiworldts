// Pure cssnano minify of an already-emitted CSS file (no Vite integration noise),
// so we measure cssnano's minify delta on the EXACT same bytes as the baseline.
// Usage: node minify-cssnano.mjs <in.css> <out.css>
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";
import cssnano from "cssnano";

const [inFile, outFile] = process.argv.slice(2);
const css = readFileSync(inFile, "utf8");
const result = await postcss([cssnano({ preset: ["default", { colormin: false }] })]).process(css, {
  from: inFile,
});
writeFileSync(outFile, result.css);
console.log(`cssnano: ${inFile} -> ${outFile} (${(result.css.length / 1024).toFixed(1)} kB raw)`);
