import test from "node:test";
import assert from "node:assert/strict";

import { retrieveCandidates } from "../dist/candidates/retrieveCandidates.js";

function makeStubRunner(responses) {
  let i = 0;
  /** @type {string[][]} */
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    const r = responses[i++];
    if (!r) throw new Error(`stub runner out of responses after ${i - 1} calls`);
    return r;
  };
  return { runner, calls };
}

test("retrieveCandidates parses qmd --json hits and fetches frontmatter via qmd get", async () => {
  const queryOut = [
    "Expanding query...",
    "Searching ...",
    "[",
    '  {"docid":"#a","score":0.91,"file":"qmd://pr-sheriff-corpus/OpenClaw/OpenClaw/pull/742.md","title":"x","snippet":"s1"},',
    '  {"docid":"#b","score":0.81,"file":"qmd://pr-sheriff-corpus/OpenClaw/OpenClaw/issue/12.md","title":"y","snippet":"s2"}',
    "]",
  ].join("\n");

  const prDoc = [
    "---",
    'schema: "pr_sheriff_corpus_v1"',
    'doc_type: "github_pull"',
    'repo: "OpenClaw/OpenClaw"',
    "number: 742",
    'title: "Fix input latency"',
    'url: "https://github.com/OpenClaw/OpenClaw/pull/742"',
    'updated_at: "2026-02-07T00:00:00Z"',
    'merged_at: "2026-02-07T01:00:00Z"',
    "---",
    "# PR #742: Fix input latency",
    "",
  ].join("\n");

  const issueDoc = [
    "---",
    'schema: "pr_sheriff_corpus_v1"',
    'doc_type: "github_issue"',
    'repo: "OpenClaw/OpenClaw"',
    "number: 12",
    'title: "Crash on launch"',
    'url: "https://github.com/OpenClaw/OpenClaw/issues/12"',
    'updated_at: "2026-02-01T00:00:00Z"',
    "---",
    "# Issue #12: Crash on launch",
    "",
  ].join("\n");

  const { runner, calls } = makeStubRunner([
    { exitCode: 0, stdout: queryOut, stderr: "" },
    { exitCode: 0, stdout: prDoc, stderr: "" },
    { exitCode: 0, stdout: issueDoc, stderr: "" },
  ]);

  const res = await retrieveCandidates({
    summary: "some pr summary",
    n: 2,
    config: { qmdCollection: "pr-sheriff-corpus", qmdIndex: null },
    qmdRunner: runner,
  });

  assert.equal(res.error, null);
  assert.equal(res.candidates.length, 2);
  assert.equal(res.candidates[0].corpus.repo, "OpenClaw/OpenClaw");
  assert.equal(res.candidates[0].corpus.number, 742);
  assert.equal(res.candidates[0].corpus.docType, "github_pull");
  assert.equal(res.candidates[0].corpus.title, "Fix input latency");
  assert.equal(res.candidates[1].corpus.docType, "github_issue");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 2), ["query", "some pr summary"]);
  assert.deepEqual(calls[1].slice(0, 2), ["get", "qmd://pr-sheriff-corpus/OpenClaw/OpenClaw/pull/742.md"]);
});

test("retrieveCandidates returns a nice error when qmd collection is missing", async () => {
  const { runner } = makeStubRunner([
    { exitCode: 1, stdout: "Collection not found: pr-sheriff-corpus\n", stderr: "" },
  ]);

  const res = await retrieveCandidates({
    summary: "x",
    n: 5,
    config: { qmdCollection: "pr-sheriff-corpus", qmdIndex: null },
    qmdRunner: runner,
  });

  assert.equal(res.candidates.length, 0);
  assert.equal(res.error?.code, "QMD_COLLECTION_NOT_FOUND");
});

