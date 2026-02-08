import test from "node:test";
import assert from "node:assert/strict";

import { buildReferenceGraph } from "../src/graph/reference_graph_builder.mjs";

function makeStubGitHubFetch({ prsByNumber, issuesByNumber, commentsByNumber, timelinesByIssue }) {
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    async getPR(number) {
      calls.push(`getPR:${number}`);
      const pr = prsByNumber[number];
      if (!pr) throw new Error(`missing stub PR ${number}`);
      return pr;
    },
    async listPRComments(number) {
      calls.push(`listPRComments:${number}`);
      const all = commentsByNumber[number] ?? [];
      return { issueComments: all, reviewComments: [], all };
    },
    async getIssue(number) {
      calls.push(`getIssue:${number}`);
      const issue = issuesByNumber[number];
      if (!issue) throw new Error(`missing stub issue ${number}`);
      return issue;
    },
    async getIssueTimeline(number) {
      calls.push(`getIssueTimeline:${number}`);
      return timelinesByIssue[number] ?? [];
    },
  };
}

test("buildReferenceGraph: traverses 2 layers with classification and caps", async () => {
  const gh = makeStubGitHubFetch({
    prsByNumber: {
      10: { number: 10, title: "Root", body: "Fixes #1 and refs #2", html_url: "u10", merged_at: null, closed_at: null, state: "open" },
      20: { number: 20, title: "Closer", body: "Follow-up for #3", html_url: "u20", merged_at: "2020-01-01T00:00:00Z", closed_at: null, state: "closed" },
      30: { number: 30, title: "L2 closer", body: "", html_url: "u30", merged_at: null, closed_at: null, state: "closed" },
    },
    issuesByNumber: {
      // #1 is an issue (no pull_request field)
      1: { number: 1, title: "Issue 1" },
      // #2 is actually a PR (issue payload has pull_request marker)
      2: { number: 2, pull_request: { url: "x" } },
      3: { number: 3, title: "Issue 3" },
    },
    commentsByNumber: {
      10: [{ body: "extra mention octo/hello#1" }],
      20: [{ body: "comment mentions #3 too" }],
    },
    timelinesByIssue: {
      1: [
        { __typename: "ClosedEvent", closer: { __typename: "PullRequest", number: 20 } },
      ],
      3: [
        { __typename: "ClosedEvent", closer: { __typename: "PullRequest", number: 30 } },
      ],
    },
  });

  const graph = await buildReferenceGraph({
    gh,
    owner: "octo",
    repo: "hello",
    prNumber: 10,
    budgets: {
      maxLayer1References: 10,
      maxClosingPrsPerIssue: 5,
      maxLayer2ReferencesPerPr: 10,
      maxLayer2ClosingPrsPerIssue: 5,
    },
  });

  assert.equal(graph.rootId, "pr:octo/hello#10");
  assert.ok(graph.nodes["pr:octo/hello#10"]);
  // Root references issue #1 and PR #2.
  assert.ok(graph.nodes["issue:octo/hello#1"]);
  assert.ok(graph.nodes["pr:octo/hello#2"]);

  const edgeTypes = graph.edges.map((e) => `${e.type}:${e.from}->${e.to}`);
  assert.ok(edgeTypes.includes("references:pr:octo/hello#10->issue:octo/hello#1"));
  assert.ok(edgeTypes.includes("references:pr:octo/hello#10->pr:octo/hello#2"));

  // Issue #1 closed by PR #20 (timeline).
  assert.ok(graph.nodes["pr:octo/hello#20"]);
  assert.ok(edgeTypes.includes("closed_by:issue:octo/hello#1->pr:octo/hello#20"));

  // PR #20 references issue #3 (layer 2), and issue #3 closed by PR #30 (timeline).
  assert.ok(graph.nodes["issue:octo/hello#3"]);
  assert.ok(edgeTypes.includes("references:pr:octo/hello#20->issue:octo/hello#3"));
  assert.ok(graph.nodes["pr:octo/hello#30"]);
  assert.ok(edgeTypes.includes("closed_by:issue:octo/hello#3->pr:octo/hello#30"));

  // Sanity check: we didn't need to fetch PR #2 itself (just classified).
  assert.ok(!gh.calls.includes("getPR:2"));
});

