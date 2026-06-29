/* Parity guard: the TS decompose() must produce the SAME item boundaries as
 * the Python scan.decompose_markdown() (fixture generated from Python). Drift
 * between the two implementations is the subtle failure mode for per-rule
 * editing, so we test it head-on. Run: node test/decompose.parity.mjs */
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tsSrc = readFileSync(join(here, "../src/lib/decompose.ts"), "utf8");
const js = (await transform(tsSrc, { loader: "ts", format: "esm" })).code;
const mod = await import("data:text/javascript," + encodeURIComponent(js));
const fixture = JSON.parse(readFileSync(join(here, "../src/lib/decompose.fixture.json"), "utf8"));

let fail = 0;
fixture.forEach((c, idx) => {
  const got = mod.decompose(c.input).map((i) => ({ type: i.type, line_start: i.line_start, line_end: i.line_end }));
  const want = c.items;
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    fail++;
    console.error(`MISMATCH case #${idx}:\n  python: ${b}\n  ts:     ${a}`);
  }
});

if (fail) {
  console.error(`\nPARITY FAILED: ${fail}/${fixture.length} cases diverge.`);
  process.exit(1);
}
console.log(`decompose parity OK — ${fixture.length} cases, identical boundaries.`);
