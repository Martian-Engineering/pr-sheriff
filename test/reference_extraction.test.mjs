import test from "node:test";
import assert from "node:assert/strict";

import { extractReferencedNumbers } from "../src/graph/reference_extraction.mjs";

test("extractReferencedNumbers: shorthand and qualified references (same repo only)", () => {
  const nums = extractReferencedNumbers(
    [
      "Fixes #12 and relates to #7.",
      "Not this: other/repo#99",
      "Yes this: octo/hello#42",
      "Also: https://github.com/octo/hello/issues/100",
      "And: https://github.com/octo/hello/pull/101",
    ].join("\n"),
    { owner: "octo", repo: "hello" },
  );
  assert.deepEqual(nums, [7, 12, 42, 100, 101]);
});

test("extractReferencedNumbers: avoids matching inside identifiers", () => {
  const nums = extractReferencedNumbers("abc#12def _#13 also #14", { owner: "o", repo: "r" });
  assert.deepEqual(nums, [14]);
});

