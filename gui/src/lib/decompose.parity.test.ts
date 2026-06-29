/* Python<->TS parity guard for decompose(). Runs under plain `node` (v22.6+ strips
 * TypeScript types natively — no test framework, no extra dependency) via `npm test`.
 *
 * This test and the Python DecomposeTests.test_matches_shared_fixture both assert
 * decompose() against the SAME golden corpus (decompose.fixture.json), so both
 * passing == byte-identical item boundaries across the two implementations. That
 * transitive check is the main guard against per-rule editing corrupting a file:
 * the GUI splices an item back into the raw .md using TS boundaries, so they must
 * match the Python scanner's. The fixture stores only the boundary fields
 * {type, line_start, line_end}; editing scan.py:decompose_markdown OR decompose.ts
 * requires regenerating the fixture and getting BOTH tests green again. */
import { decompose } from "./decompose.ts";
import fixture from "./decompose.fixture.json" with { type: "json" };

type Boundary = { type: string; line_start: number; line_end: number };
const cases = fixture as { input: string; items: Boundary[] }[];

let failures = 0;
for (let idx = 0; idx < cases.length; idx++) {
  const expected = cases[idx].items;
  const got: Boundary[] = decompose(cases[idx].input).map((it) => ({
    type: it.type,
    line_start: it.line_start,
    line_end: it.line_end,
  }));
  const ok =
    got.length === expected.length &&
    got.every(
      (g, i) =>
        g.type === expected[i].type &&
        g.line_start === expected[i].line_start &&
        g.line_end === expected[i].line_end,
    );
  if (!ok) {
    failures++;
    console.error(`case ${idx}: boundaries diverged`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  got:      ${JSON.stringify(got)}`);
  }
}

if (failures > 0) {
  throw new Error(
    `decompose parity FAILED: ${failures}/${cases.length} case(s) diverged from the shared fixture`,
  );
}
console.log(
  `decompose parity OK: all ${cases.length} cases match scan.py:decompose_markdown's golden corpus`,
);
