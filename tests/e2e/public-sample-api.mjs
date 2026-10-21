import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const expected = JSON.parse(
  readFileSync(
    new URL("../fixtures/public-sample-studies.json", import.meta.url),
  ),
);
const origin = process.env.EXPLORER_TEST_URL || "http://127.0.0.1:3000";
const response = await fetch(
  origin +
    "/api/studies?fetchAll=true&searchMode=exact&excludeLowQuality=false&excludeMissingGenotype=false&limit=1000&offset=0",
);
assert.equal(response.status, 200);
const { data } = await response.json();
assert.equal(
  data.length,
  expected.length,
  "This check expects the environment-specific 1,000-study development database",
);
const byId = new Map(data.map((row) => [row.id, row]));
for (const row of expected) {
  const actual = byId.get(row.id);
  assert.ok(actual, "Missing fixture study " + row.id);
  for (const key of [
    "ci_text",
    "p_value",
    "pvalue_mlog",
    "mapped_gene",
    "initial_sample_size",
    "replication_sample_size",
  ])
    assert.deepEqual(actual[key], row[key], key + " for study " + row.id);
}
console.log(
  "PASS real Run All API preserves effect direction/type and evidence metadata for all " +
    data.length +
    " study records",
);
